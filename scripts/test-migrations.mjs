// Local-only migration and recovery rehearsal. The existing database supplies
// platform schema definitions only; no existing application/Auth/Storage rows
// are copied. All test data and both temporary databases are disposable.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const container = "supabase_db_gregslist";
const suffix = randomBytes(6).toString("hex");
const clean = `gregslist_phase6_clean_${suffix}`;
const restored = `gregslist_phase6_restore_${suffix}`;
const databasePattern = /^gregslist_phase6_(clean|restore)_[a-f0-9]{12}$/;
const created = new Set();
const children = new Set();
let interrupted = false;
let failure;

function checkDatabase(database) {
  assert.match(
    database,
    databasePattern,
    "Only generated rehearsal databases are writable",
  );
  assert.ok(database === clean || database === restored);
}
async function docker(args, input) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn("docker", ["exec", "-i", container, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.add(child);
    const output = [];
    const errors = [];
    let size = 0;
    const timer = setTimeout(() => child.kill("SIGTERM"), 55000);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > 32 * 1024 * 1024) child.kill("SIGTERM");
      else output.push(chunk);
    });
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      children.delete(child);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      children.delete(child);
      const stdout = Buffer.concat(output).toString("utf8");
      const stderr = Buffer.concat(errors).toString("utf8");
      if (code === 0 && size <= 32 * 1024 * 1024)
        resolveCommand({ stdout, stderr });
      else
        reject(
          Object.assign(new Error("Local rehearsal database command failed"), {
            code,
            stderr,
          }),
        );
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    interrupted = true;
    for (const child of children) child.kill("SIGTERM");
  });

async function sql(database, statement) {
  checkDatabase(database);
  if (interrupted)
    throw new Error("Rehearsal interrupted; cleaning up temporary databases");
  return docker(
    [
      "psql",
      "-X",
      "-U",
      "postgres",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-qAt",
    ],
    `set statement_timeout='40s'; set search_path=public,extensions;\n${statement}\n`,
  );
}
async function value(database, statement) {
  const result = await sql(database, statement);
  return result.stdout.trim();
}
async function createDatabase(database, { restore = false } = {}) {
  checkDatabase(database);
  await docker([
    "createdb",
    "-U",
    "postgres",
    "--template=template0",
    database,
  ]);
  created.add(database);
  await sql(
    database,
    `${restore ? "drop schema public cascade;" : ""}
    create schema extensions;
    grant usage on schema extensions to anon,authenticated,service_role;
    create extension pgcrypto with schema extensions;
    ${
      restore
        ? ""
        : `grant usage on schema public to anon,authenticated,service_role;
    alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role;
    alter default privileges for role postgres in schema public grant execute on functions to anon,authenticated,service_role;`
    }
  `,
  );
}
function restorableDump(dump, { platform = false } = {}) {
  // Operational Supabase roles own default ACLs we cannot rewrite. Existing
  // object ACLs remain intact. Public defaults are established explicitly above.
  let result = dump.replace(
    /^ALTER DEFAULT PRIVILEGES[^;\n]*;\r?\n/gm,
    (statement) => (/FOR ROLE postgres\b/.test(statement) ? statement : ""),
  );
  if (platform) {
    // Application-owned Auth triggers are recreated by their own migration,
    // after the private schema exists, rather than by platform bootstrapping.
    result = result.replace(
      /^CREATE TRIGGER identity_membership_cleanup[^;]*;\r?\n/gm,
      "",
    );
    // This one policy belongs to application migration 002, not the platform.
    // Its helper is intentionally absent until fresh migrations create it.
    const policies =
      result.match(
        /^CREATE POLICY private_photos ON storage\.objects[\s\S]*?;\r?\n/gm,
      ) || [];
    assert.equal(
      policies.length,
      1,
      "Known application photo policy is separated from platform prerequisites",
    );
    result = result.replace(
      /^CREATE POLICY private_photos ON storage\.objects[\s\S]*?;\r?\n/gm,
      "",
    );
  }
  return result;
}
function claims(actor, statement) {
  assert.match(actor, /^[a-f0-9-]{36}$/);
  return `begin; set local request.jwt.claims='{"sub":"${actor}","role":"authenticated"}'; set local request.jwt.claim.sub='${actor}'; set local role authenticated; ${statement}; commit;`;
}
async function rpcValue(database, actor, statement) {
  return value(database, claims(actor, statement));
}
async function runDatabaseTests(database, label) {
  const files = (await readdir(resolve("supabase/tests")))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  let assertions = 0;
  for (const file of files) {
    const result = await sql(
      database,
      await readFile(resolve("supabase/tests", file), "utf8"),
    );
    const lines = result.stdout.split(/\r?\n/);
    const plans = lines.filter((line) => /^1\.\.\d+$/.test(line));
    const passed = lines.filter((line) => /^ok \d+(?:\s|$)/.test(line));
    const failed = lines.filter((line) => /^not ok\b|^Bail out!/i.test(line));
    assert.equal(plans.length, 1, `${file}: exactly one pgTAP plan`);
    assert.deepEqual(failed, [], `${file}: all pgTAP assertions pass`);
    const planned = Number(plans[0].slice(3));
    assert.equal(
      passed.length,
      planned,
      `${file}: all planned assertions actually ran`,
    );
    assertions += planned;
  }
  console.log(
    `PASS ${label}: ${assertions} database assertions across ${files.length} files`,
  );
  return assertions;
}

async function seed(database) {
  const ids = Object.fromEntries(
    ["admin", "member", "partner", "invitee"].map((name) => [
      name,
      randomUUID(),
    ]),
  );
  await sql(
    database,
    `insert into auth.users(id,email,email_confirmed_at) values ${Object.entries(
      ids,
    )
      .map(([name, id]) => `('${id}','rehearsal-${name}@example.test',now())`)
      .join(",")};
    insert into public.profiles(id,display_name,bio) values
      ('${ids.admin}','Rehearsal administrator','Synthetic recovery fixture'),
      ('${ids.member}','Rehearsal passenger',''),('${ids.partner}','Rehearsal partner','');
    insert into public.memberships(user_id,role) values ('${ids.admin}','admin'),('${ids.member}','member'),('${ids.partner}','member');`,
  );
  const parent = await rpcValue(
    database,
    ids.admin,
    `select public.write_post(null,jsonb_build_object('post_type','trip','title','Synthetic recovery journey','description','Not real community data','category_id',(select id from public.categories where name='General'),'ride_coordination_enabled',true))`,
  );
  assert.match(parent, /^[a-f0-9-]{36}$/);
  const rideIds = [];
  for (let index = 1; index <= 2; index++)
    rideIds.push(
      await rpcValue(
        database,
        ids.admin,
        `select public.write_ride(null,'${parent}',jsonb_build_object('capacity',2,'pickup','Synthetic meeting point ${index}'), '${randomUUID()}')`,
      ),
    );
  const link = await rpcValue(
    database,
    ids.member,
    `select public.request_partner('${ids.partner}')`,
  );
  await sql(
    database,
    claims(ids.partner, `select public.respond_partner('${link}','accept')`),
  );
  const booking = JSON.parse(
    await rpcValue(
      database,
      ids.member,
      `select public.book_ride('${rideIds[0]}','both','${randomUUID()}')`,
    ),
  );
  assert.equal(booking.reservation_ids.length, 2);
  const switched = JSON.parse(
    await rpcValue(
      database,
      ids.member,
      `select public.switch_ride('${rideIds[1]}','both','${randomUUID()}',array[${booking.reservation_ids.map((id) => `'${id}'::uuid`).join(",")}])`,
    ),
  );
  assert.equal(switched.reservation_ids.length, 2);
  const ownReservation = await value(
    database,
    `select id from public.ride_reservations where passenger_id='${ids.member}' and status='confirmed'`,
  );
  await sql(
    database,
    claims(
      ids.member,
      `select public.cancel_ride_reservation('${ownReservation}')`,
    ),
  );
  await sql(
    database,
    claims(ids.admin, `select public.withdraw_ride('${rideIds[1]}')`),
  );
  await sql(
    database,
    claims(ids.partner, `select public.unlink_partner('${link}')`),
  );
  const invitation = JSON.parse(
    await rpcValue(
      database,
      ids.admin,
      `select public.create_member_invitation('rehearsal-invitee@example.test','copy')`,
    ),
  );
  // This bearer secret belongs only to the synthetic fixture and is kept in
  // memory; no fixture token or credential-bearing URL is printed or persisted.
  await sql(
    database,
    claims(
      ids.invitee,
      `select public.accept_member_invitation('${invitation.id}','${invitation.token}')`,
    ),
  );
  await sql(
    database,
    claims(
      ids.admin,
      `select public.set_member_role('${ids.partner}','admin'); select public.set_member_role('${ids.partner}','member')`,
    ),
  );
  const event = await rpcValue(
    database,
    ids.admin,
    `select public.write_post(null,jsonb_build_object('post_type','event','title','Synthetic recovery event','description','Not real community data','category_id',(select id from public.categories where name='General'),'starts_at',now()+interval '10 days','event_location','Synthetic event location'))`,
  );
  await sql(
    database,
    claims(ids.member, `select public.set_event_rsvp('${event}','going')`),
  );
  await sql(
    database,
    claims(
      ids.admin,
      `select public.write_post('${event}',jsonb_build_object('post_type','event','title','Synthetic recovery event','description','Not real community data','category_id',(select id from public.categories where name='General'),'status','cancelled','confirm_cancel',true,'starts_at',(select starts_at from public.events where post_id='${event}'),'event_location','Synthetic event location'))`,
    ),
  );
  assert.equal(
    Number(
      await value(database, "select count(*) from public.ride_reservations"),
    ),
    4,
  );
  assert.equal(
    Number(
      await value(
        database,
        "select count(*) from public.ride_reservations where status='confirmed'",
      ),
    ),
    0,
  );
  assert.equal(
    Number(
      await value(
        database,
        "select count(*) from public.ride_reservations where status='needs_arrangement'",
      ),
    ),
    1,
  );
  assert.ok(
    Number(
      await value(
        database,
        "select count(*) from public.ride_reservation_history",
      ),
    ) === 8,
    "Two bookings, two cancelled old seats, two replacement seats, cancellation and withdrawal are audited",
  );
  assert.equal(
    await value(
      database,
      `select redeemed_by='${ids.invitee}'::uuid and redeemed_at is not null and length(token_hash)=64 from public.invitations where id='${invitation.id}'`,
    ),
    "t",
  );
  assert.equal(
    await value(
      database,
      `select status='cancelled' from public.events where post_id='${event}'`,
    ),
    "t",
  );
  assert.equal(
    await value(
      database,
      `select cancelled_at is not null and cancellation_reason='event_cancelled' from public.event_rsvps where event_id='${event}' and user_id='${ids.member}'`,
    ),
    "t",
  );
  assert.ok(
    Number(await value(database, "select count(*) from public.admin_audit")) >=
      4,
  );
  console.log(
    "PASS synthetic invitations, event cancellation, partner consent, ride switching/withdrawal and audit history",
  );
  return { ids, parent, rideIds };
}
async function snapshot(database) {
  const tables = JSON.parse(
    await value(
      database,
      `select jsonb_agg(jsonb_build_object('schema',table_schema,'table',table_name) order by table_schema,table_name) from information_schema.tables where table_type='BASE TABLE' and table_schema in ('public','private','auth','storage')`,
    ),
  );
  const queries = tables.map(({ schema, table }) => {
    assert.match(schema, /^[a-z_][a-z0-9_]*$/);
    assert.match(table, /^[a-z_][a-z0-9_]*$/);
    return `select '${schema}.${table}' as relation,md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) as digest from "${schema}"."${table}" t`;
  });
  return JSON.parse(
    await value(
      database,
      `select jsonb_object_agg(relation,digest) from (${queries.join(" union all ")}) tables`,
    ),
  );
}
async function securitySnapshot(database) {
  return JSON.parse(
    await value(
      database,
      `select jsonb_build_object(
    'private_bucket',not(select public from storage.buckets where id='community-photos'),
    'anonymous_profiles',has_table_privilege('anon','public.profiles','select'),
    'member_role_write',has_table_privilege('authenticated','public.memberships','update'),
    'direct_booking_write',has_table_privilege('authenticated','public.ride_reservations','insert'),
    'invitation_hash_read',has_column_privilege('authenticated','public.invitations','token_hash','select'),
    'audit_write',has_table_privilege('authenticated','public.admin_audit','update'),
    'member_verification_execute',has_function_privilege('authenticated','public.invitation_verification(uuid,text,text)','execute'),
    'server_verification_execute',has_function_privilege('service_role','public.invitation_verification(uuid,text,text)','execute'),
    'all_public_tables_rls',not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity),
    'photo_policy',(select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname='private_photos')=1
  )`,
    ),
  );
}
async function expectFailure(database, statement, pattern, label) {
  const result = await Promise.allSettled([sql(database, statement)]);
  assert.equal(result[0].status, "rejected", label);
  assert.match(result[0].reason.stderr || "", pattern, label);
}
async function verifyRestoredBehavior(database, fixture) {
  const { ids, parent, rideIds } = fixture;
  await expectFailure(
    database,
    claims(
      ids.member,
      `select public.book_ride('${rideIds[1]}','self','${randomUUID()}')`,
    ),
    /no longer available/,
    "Withdrawn rides still reject bookings after restore",
  );
  await expectFailure(
    database,
    claims(
      ids.member,
      `select public.book_ride('${rideIds[0]}','both','${randomUUID()}')`,
    ),
    /mutually confirmed partner/,
    "Unlinked partner authority stays revoked after restore",
  );
  await expectFailure(
    database,
    "begin; set local role anon; select * from public.profiles; rollback;",
    /permission denied/,
    "Anonymous profile access remains denied after restore",
  );
  await expectFailure(
    database,
    `begin;
    insert into public.ride_reservations(ride_id,post_id,passenger_id,created_by,modified_by) values
    ${[ids.member, ids.partner, ids.invitee].map((id) => `('${rideIds[0]}','${parent}','${id}','${ids.admin}','${ids.admin}')`).join(",")};
    commit;`,
    /Ride passenger capacity exceeded/,
    "Deferred capacity constraint survives backup and restore",
  );
  assert.equal(
    Number(
      await value(
        database,
        "select count(*) from public.ride_reservations where status='confirmed'",
      ),
    ),
    0,
    "Rejected writes leave original recovery history intact",
  );
  console.log(
    "PASS restored RLS, consent, inactive-ride and deferred capacity enforcement",
  );
}

try {
  const migrations = (await readdir(resolve("supabase/migrations")))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  assert.ok(
    migrations.length >= 7,
    "All established migrations must be present",
  );
  // The only operation against existing postgres is schema-only inspection of
  // Supabase platform prerequisites. No source rows, public or private schema.
  const platform = await docker([
    "pg_dump",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "--schema-only",
    "--no-owner",
    "--schema=auth",
    "--schema=storage",
  ]);
  await createDatabase(clean);
  await sql(clean, restorableDump(platform.stdout, { platform: true }));
  for (const migration of migrations) {
    const source = await readFile(
      resolve("supabase/migrations", migration),
      "utf8",
    );
    await sql(clean, `begin;\n${source}\ncommit;`);
  }
  console.log(
    `PASS ${migrations.length} migrations applied in order, each in its own transaction`,
  );
  await runDatabaseTests(clean, "clean migrations");
  const fixture = await seed(clean);
  const before = await snapshot(clean);
  const permissions = await securitySnapshot(clean);
  assert.deepEqual(permissions, {
    private_bucket: true,
    anonymous_profiles: false,
    member_role_write: false,
    direct_booking_write: false,
    invitation_hash_read: false,
    audit_write: false,
    member_verification_execute: false,
    server_verification_execute: true,
    all_public_tables_rls: true,
    photo_policy: true,
  });
  const backup = await docker([
    "pg_dump",
    "-U",
    "postgres",
    "-d",
    clean,
    "--no-owner",
    "--schema=public",
    "--schema=private",
    "--schema=auth",
    "--schema=storage",
  ]);
  const backupDigest = createHash("sha256").update(backup.stdout).digest("hex");
  assert.equal(backupDigest.length, 64);
  await createDatabase(restored, { restore: true });
  await sql(restored, restorableDump(backup.stdout));
  assert.deepEqual(
    await snapshot(restored),
    before,
    "Every synthetic row, timestamp and audit/history value survives recovery",
  );
  assert.deepEqual(
    await securitySnapshot(restored),
    permissions,
    "Recovered grants, RLS and private-bucket metadata match",
  );
  console.log(
    `PASS backup/restore preserves all synthetic rows across ${Object.keys(before).length} tables and security settings`,
  );
  await verifyRestoredBehavior(restored, fixture);
  await runDatabaseTests(restored, "restored database");
  assert.deepEqual(
    await snapshot(restored),
    before,
    "Failed writes and rollback-only tests preserve the recovered dataset",
  );
} catch (error) {
  failure = error;
} finally {
  for (const database of [...created].reverse()) {
    checkDatabase(database);
    try {
      await docker(["dropdb", "-U", "postgres", "--force", database]);
      created.delete(database);
    } catch (error) {
      failure ??= error;
    }
  }
}
if (failure) {
  if (failure.stderr) {
    // Only the database's primary error message; never query context, dumps,
    // parameters or fixture invitation credentials.
    const diagnostic = String(failure.stderr)
      .split(/\r?\n/)
      .find((line) => /ERROR:/.test(line));
    if (diagnostic)
      console.error(diagnostic.replace(/[a-f0-9]{64}/gi, "[redacted]"));
  }
  console.error(failure.message);
  // Platform schema SQL and backup contents never enter logs. Command errors
  // identify the failed boundary without printing SQL or fixture bearer tokens.
  if (failure.code !== undefined)
    console.error(`Database command exit code: ${failure.code}`);
  process.exitCode = 1;
} else
  console.log(
    "PASS migration/recovery rehearsal; both temporary databases removed, existing data untouched",
  );
