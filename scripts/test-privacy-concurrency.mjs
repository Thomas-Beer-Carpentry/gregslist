// Local-only regression rehearsal. Copy platform schema definitions, never
// existing data; reproduce each race before migration 012 and reject it after.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const container = "supabase_db_gregslist";
const database = `gregslist_privacy_verify_${randomBytes(6).toString("hex")}`;
assert.match(database, /^gregslist_privacy_verify_[a-f0-9]{12}$/);
const children = new Set();
const admin = randomUUID();
let created = false;
let interrupted = false;
let failure;

function command(args, input, { interactive = false } = {}) {
  const child = spawn("docker", ["exec", "-i", container, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.add(child);
  let stdout = "";
  let stderr = "";
  const timer = setTimeout(() => child.kill("SIGTERM"), 45000);
  const closed = new Promise((resolveCommand, reject) => {
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 32 * 1024 * 1024) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      children.delete(child);
      if (code === 0) resolveCommand({ stdout, stderr });
      else
        reject(
          Object.assign(new Error("Isolated privacy SQL command failed"), {
            code,
            stderr,
          }),
        );
    });
  });
  closed.catch(() => {});
  child.stdin.on("error", () => {});
  if (!interactive) child.stdin.end(input);
  return { child, closed, output: () => stdout };
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    interrupted = true;
    for (const child of children) child.kill("SIGTERM");
  });

const docker = (args, input) => command(args, input).closed;
const psql = [
  "psql",
  "-X",
  "-U",
  "postgres",
  "-d",
  database,
  "-v",
  "ON_ERROR_STOP=1",
  "-qAt",
];
async function sql(statement) {
  assert.match(database, /^gregslist_privacy_verify_[a-f0-9]{12}$/);
  if (interrupted) throw new Error("Privacy rehearsal interrupted");
  return docker(
    psql,
    `set statement_timeout='30s'; set search_path=public,extensions;\n${statement}\n`,
  );
}
async function value(statement) {
  return (await sql(statement)).stdout.trim();
}
function member(actor, statement) {
  assert.match(actor, /^[a-f0-9-]{36}$/);
  return `begin; set local request.jwt.claims='{"sub":"${actor}","role":"authenticated"}'; set local request.jwt.claim.sub='${actor}'; set local role authenticated; ${statement}; commit;`;
}
async function observe(check, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  assert.fail(label);
}
async function seed(label) {
  const user = randomUUID();
  const ownPost = randomUUID();
  const otherPost = randomUUID();
  const path = `${user}/${ownPost}/${randomUUID()}.webp`;
  await sql(`insert into auth.users(id,email,email_confirmed_at) values('${user}','${label}-${user}@example.test',now());
    insert into public.profiles(id,display_name,bio) values('${user}','Private member','Private biography');
    insert into public.memberships(user_id) values('${user}');
    insert into public.posts(id,author_id,category_id,post_type,title,description) values
    ('${ownPost}','${user}',(select id from public.categories where name='General'),'discussion','Own post','Own text'),
    ('${otherPost}','${admin}',(select id from public.categories where name='General'),'discussion','Unrelated post','Keep this text');
    insert into storage.objects(bucket_id,name) values('community-photos','${path}');`);
  return { user, ownPost, otherPost, path };
}

async function race(kind, fixed) {
  const fixture = await seed(`${kind}-${fixed ? "fixed" : "baseline"}`);
  const { user, ownPost, otherPost, path } = fixture;
  const application = `privacy_${kind}_${randomBytes(6).toString("hex")}`;
  const coordinator = command(psql, undefined, { interactive: true });
  try {
    const lockedRow =
      kind === "profile"
        ? `select 1 from public.profiles where id='${user}' for update;`
        : `select 1 from public.posts where id='${kind === "photo" ? ownPost : otherPost}' for update;`;
    coordinator.child.stdin.write(
      `set statement_timeout='30s'; begin; select pg_advisory_xact_lock(71404,1); ${lockedRow}\n\\echo privacy_lock_ready\n`,
    );
    await observe(
      () => coordinator.output().includes("privacy_lock_ready"),
      "Coordinator must hold the exact parent/profile lock before writer starts",
    );
    const mutation =
      kind === "photo"
        ? `select public.attach_post_photo('${ownPost}','${path}')`
        : kind === "comment"
          ? `select public.write_comment('${otherPost}',null,'Private text submitted before erasure')`
          : `update public.profiles set display_name='Resurrected name',bio='Resurrected biography',avatar_path='resurrected-path' where id='${user}'`;
    const waiter = command(
      ["env", `PGAPPNAME=${application}`, ...psql],
      `set lock_timeout='25s'; set statement_timeout='30s'; ${member(user, mutation)}\n`,
    );
    // The writer is proven to be blocked in PostgreSQL, not merely started.
    await observe(
      async () =>
        (await value(`select count(*) from pg_stat_activity where datname='${database}'
          and application_name='${application}' and wait_event_type='Lock'
          and cardinality(pg_blocking_pids(pid))>0
          and wait_event ${fixed && kind !== "profile" ? "='advisory'" : "in ('transactionid','tuple')"}`)) ===
        "1",
      `${kind}: expected writer must actually wait on the coordinator`,
    );
    coordinator.child.stdin.end(
      `set local request.jwt.claims='{"role":"service_role"}'; select public.prepare_account_erasure('${user}'); commit;\n`,
    );
    const result = await Promise.allSettled([
      coordinator.closed,
      waiter.closed,
    ]);
    assert.equal(result[0].status, "fulfilled", `${kind}: erasure commits`);
    if (fixed) {
      assert.equal(
        result[1].status,
        "rejected",
        `${kind}: stale write rejects`,
      );
      assert.match(
        result[1].reason.stderr,
        kind === "profile"
          ? /Erased profiles cannot be changed/
          : /Active membership required/,
        `${kind}: rejection must come from the erasure guard`,
      );
    } else
      assert.equal(
        result[1].status,
        "fulfilled",
        `${kind}: baseline must demonstrate the unsafe commit`,
      );
    assert.equal(
      await value(
        `select count(*) from public.memberships where user_id='${user}'`,
      ),
      "0",
      "Erasure removes access in either case",
    );
    const restored =
      kind === "photo"
        ? await value(
            `select count(*) from public.post_photos where uploader_id='${user}'`,
          )
        : kind === "comment"
          ? await value(
              `select count(*) from public.comments where author_id='${user}'`,
            )
          : await value(`select count(*) from public.profiles where id='${user}' and
              (display_name<>'Former member' or bio<>'' or avatar_path is not null)`);
    assert.equal(restored, fixed ? "0" : "1", `${kind}: personal-data outcome`);
    if (kind === "photo")
      assert.equal(
        await value(
          `select cardinality(photo_paths) from public.account_erasure_jobs where user_id='${user}'`,
        ),
        "0",
        "The race's unattached object was not in the erasure snapshot",
      );
    assert.equal(
      await value(
        `select description from public.posts where id='${otherPost}'`,
      ),
      "Keep this text",
      "Unrelated content stays unchanged",
    );
    console.log(
      `PASS ${kind}: ${fixed ? "blocked stale writer rejects after erasure" : "pre-fix personal-data resurrection reproduced"}`,
    );
  } finally {
    if (children.has(coordinator.child)) {
      coordinator.child.stdin.end("rollback;\n");
      coordinator.child.kill("SIGTERM");
      await coordinator.closed.catch(() => {});
    }
  }
}

async function normalMutations() {
  const { user, ownPost, otherPost, path } = await seed("ordinary");
  await sql(
    member(
      user,
      `update public.profiles set display_name='Updated member',bio='Updated biography',avatar_path=null where id='${user}'`,
    ),
  );
  assert.equal(
    await value(
      `select display_name||':'||bio from public.profiles where id='${user}'`,
    ),
    "Updated member:Updated biography",
    "Ordinary direct owner profile updates still work",
  );
  const comment = (
    await sql(
      member(
        user,
        `select public.write_comment('${otherPost}',null,'Initial comment')`,
      ),
    )
  ).stdout.trim();
  assert.match(comment, /^[a-f0-9-]{36}$/);
  await sql(
    member(
      user,
      `select public.write_comment('${otherPost}','${comment}','Edited comment'); select public.delete_comment('${comment}'); select public.set_saved_post('${otherPost}',true); select public.set_saved_post('${otherPost}',false);`,
    ),
  );
  const photo = (
    await sql(
      member(user, `select public.attach_post_photo('${ownPost}','${path}')`),
    )
  ).stdout.trim();
  assert.match(photo, /^[a-f0-9-]{36}$/);
  await sql(
    member(
      user,
      `select public.remove_post_photo('${photo}'); select public.delete_post('${ownPost}');`,
    ),
  );
  assert.equal(
    await value(`select count(*) from public.posts where id='${ownPost}'`),
    "0",
  );
  assert.equal(
    await value(`select count(*) from public.posts where id='${otherPost}'`),
    "1",
  );
  assert.equal(
    await value(`select count(*) from public.comments where id='${comment}'`),
    "0",
  );
  assert.equal(
    await value(
      `select count(*) from public.saved_posts where user_id='${user}'`,
    ),
    "0",
  );
  assert.equal(
    await value(
      `select count(*) from public.photo_cleanup where object_path='${path}'`,
    ),
    "1",
  );
  console.log(
    "PASS all six ordinary content mutations and direct owner profile updates remain usable",
  );
}

async function privileges() {
  return JSON.parse(
    await value(`select jsonb_build_object(
    'member_content',bool_and(has_function_privilege('authenticated',oid,'execute')),
    'anonymous_content',bool_or(has_function_privilege('anon',oid,'execute')),
    'server_content',bool_and(has_function_privilege('service_role',oid,'execute')),
    'member_profile',has_column_privilege('authenticated','public.profiles','display_name','update') and has_column_privilege('authenticated','public.profiles','bio','update'),
    'member_erasure_write',has_column_privilege('authenticated','public.profiles','erased_at','update')
    ) from pg_proc where oid in ('public.write_comment(uuid,uuid,text)'::regprocedure,'public.delete_comment(uuid)'::regprocedure,'public.set_saved_post(uuid,boolean)'::regprocedure,'public.attach_post_photo(uuid,text)'::regprocedure,'public.remove_post_photo(uuid)'::regprocedure,'public.delete_post(uuid)'::regprocedure)`),
  );
}

try {
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
  // Application objects are recreated in migration order, while operational
  // default ACLs are excluded just as in the existing migration rehearsal.
  const schema = platform.stdout
    .replace(/^ALTER DEFAULT PRIVILEGES[^;\n]*;\r?\n/gm, "")
    .replace(/^CREATE TRIGGER identity_membership_cleanup[^;]*;\r?\n/gm, "")
    .replace(
      /^CREATE POLICY private_photos ON storage\.objects[\s\S]*?;\r?\n/gm,
      "",
    );
  await docker([
    "createdb",
    "-U",
    "postgres",
    "--template=template0",
    database,
  ]);
  created = true;
  await sql(`create schema extensions; grant usage on schema extensions,public to anon,authenticated,service_role;
    create extension pgcrypto with schema extensions;
    alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role;
    alter default privileges for role postgres in schema public grant execute on functions to anon,authenticated,service_role;`);
  await sql(schema);
  const migrations = (await readdir(resolve("supabase/migrations")))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  const fix = "202610150012_erasure_write_serialization.sql";
  assert.equal(
    migrations.at(-1),
    fix,
    "Update the baseline boundary when later migrations are added",
  );
  for (const migration of migrations.filter((name) => name !== fix))
    await sql(
      `begin;\n${await readFile(resolve("supabase/migrations", migration), "utf8")}\ncommit;`,
    );
  await sql(`insert into auth.users(id,email,email_confirmed_at) values('${admin}','privacy-isolated-admin@example.test',now());
    insert into public.profiles(id,display_name) values('${admin}','Isolated administrator');
    insert into public.memberships(user_id,role) values('${admin}','admin');`);
  const before = await privileges();
  for (const kind of ["photo", "comment", "profile"]) await race(kind, false);
  await sql(
    `begin;\n${await readFile(resolve("supabase/migrations", fix), "utf8")}\ncommit;`,
  );
  assert.deepEqual(
    await privileges(),
    before,
    "Migration preserves established execution and profile-update privileges",
  );
  assert.deepEqual(before, {
    member_content: true,
    anonymous_content: false,
    server_content: true,
    member_profile: true,
    member_erasure_write: false,
  });
  for (const kind of ["photo", "comment", "profile"]) await race(kind, true);
  await normalMutations();
} catch (error) {
  failure = error;
} finally {
  for (const child of children) child.kill("SIGTERM");
  if (created) {
    try {
      await docker(["dropdb", "-U", "postgres", "--force", database]);
    } catch (error) {
      failure ??= error;
    }
  }
}
if (failure) {
  console.error(failure.message);
  if (failure.stderr) {
    const diagnostic = String(failure.stderr)
      .split(/\r?\n/)
      .find((line) => /ERROR:/.test(line));
    if (diagnostic) console.error(diagnostic);
  }
  process.exitCode = 1;
} else
  console.log(
    "PASS 3 races reproduced before the fix, rejected after it; privileges and ordinary writes preserved; disposable database removed",
  );
