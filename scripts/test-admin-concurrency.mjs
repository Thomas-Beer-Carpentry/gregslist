// Local-only final-administrator concurrency rehearsal. Copies schema definitions,
// never application data, and removes its isolated database even after failure.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, randomUUID } from "node:crypto";

const execute = promisify(execFile);
const container = "supabase_db_gregslist";
const database = `gregslist_phase5_verify_${randomBytes(6).toString("hex")}`;
assert.match(database, /^gregslist_phase5_verify_[a-f0-9]{12}$/);
const a = randomUUID(),
  b = randomUUID(),
  c = randomUUID();
let created = false;
let lockOwner;
let failure;

async function docker(args, input) {
  if (input === undefined)
    return execute("docker", ["exec", container, ...args], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30000,
    });
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", container, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(
            Object.assign(new Error("Local isolated SQL command failed"), {
              stdout,
              stderr,
              code,
            }),
          ),
    );
    child.stdin.end(input);
  });
}
const sql = (statement) =>
  docker([
    "psql",
    "-X",
    "-U",
    "postgres",
    "-d",
    database,
    "-v",
    "ON_ERROR_STOP=1",
    "-qAt",
    "-c",
    `set statement_timeout='15s'; ${statement}`,
  ]);
function asMember(actor, statement) {
  assert.match(actor, /^[a-f0-9-]{36}$/);
  return `begin; select set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',true); select set_config('request.jwt.claim.sub','${actor}',true); set local role authenticated; ${statement}; commit;`;
}
async function resetAdministrators() {
  await sql(
    `update public.memberships set status='active',role='admin',revoked_at=null where user_id in('${a}','${b}')`,
  );
  await sql(
    `update public.memberships set status='active',role='member',revoked_at=null where user_id='${c}'`,
  );
}
async function activeCount() {
  return Number(
    (
      await sql(
        "select count(*) from public.memberships where status='active' and role='admin'",
      )
    ).stdout.trim(),
  );
}
async function race(name, first, second) {
  await resetAdministrators();
  const result = await Promise.allSettled([sql(first), sql(second)]);
  assert.equal(
    result.filter((r) => r.status === "fulfilled").length,
    1,
    `${name}: exactly one operation commits`,
  );
  assert.equal(
    await activeCount(),
    1,
    `${name}: one active administrator survives`,
  );
  console.log(`PASS ${name}`);
}
async function staleAdministrator() {
  await resetAdministrators();
  const application = `phase5_stale_${randomBytes(6).toString("hex")}`;
  lockOwner = spawn(
    "docker",
    [
      "exec",
      "-i",
      container,
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
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let ownerOutput = "",
    ownerError = "";
  lockOwner.stdout.on("data", (chunk) => {
    ownerOutput += chunk;
  });
  lockOwner.stderr.on("data", (chunk) => {
    ownerError += chunk;
  });
  const ownerClosed = new Promise((resolve, reject) => {
    lockOwner.once("error", reject);
    lockOwner.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(`Isolated lock-owner failed (${code}); ${ownerError}`),
          ),
    );
  });
  ownerClosed.catch(() => {});
  lockOwner.stdin.write(
    "begin; select pg_advisory_xact_lock(71404,1);\n\\echo phase5_lock_ready\n",
  );
  for (
    let attempt = 0;
    !ownerOutput.includes("phase5_lock_ready") && attempt < 100;
    attempt++
  )
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(
    ownerOutput.includes("phase5_lock_ready"),
    "Deterministic coordinator acquired the transport lock",
  );
  const waiter = execute(
    "docker",
    [
      "exec",
      "-e",
      `PGAPPNAME=${application}`,
      container,
      "psql",
      "-X",
      "-U",
      "postgres",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-qAt",
      "-c",
      `set lock_timeout='15s'; set statement_timeout='20s'; ${asMember(b, `select public.set_member_role('${c}','admin')`)}`,
    ],
    { maxBuffer: 1024 * 1024, timeout: 25000 },
  );
  waiter.catch(() => {});
  // Observe the actual database wait instead of relying on request timing.
  let waiting = false;
  for (let attempt = 0; !waiting && attempt < 100; attempt++) {
    waiting =
      Number(
        (
          await sql(
            `select count(*) from pg_stat_activity where datname='${database}' and application_name='${application}' and wait_event='advisory'`,
          )
        ).stdout.trim(),
      ) === 1;
    if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(waiting, "Second administrator is waiting on the transport lock");
  lockOwner.stdin.end(
    `select set_config('request.jwt.claims','{"sub":"${a}","role":"authenticated"}',true); select set_config('request.jwt.claim.sub','${a}',true); set local role authenticated; select public.set_member_role('${b}','member'); commit;\n`,
  );
  const result = await Promise.allSettled([ownerClosed, waiter]);
  lockOwner = undefined;
  assert.equal(
    result[0].status,
    "fulfilled",
    "Coordinator demotes waiting administrator",
  );
  assert.equal(
    result[1].status,
    "rejected",
    "Waiting operation rechecks administrator authority after obtaining its lock",
  );
  assert.equal(await activeCount(), 1);
  const row = (
    await sql(`select role from public.memberships where user_id='${a}'`)
  ).stdout.trim();
  assert.equal(
    row,
    "admin",
    "Stale authority cannot demote the surviving administrator",
  );
  assert.equal(
    (
      await sql(`select role from public.memberships where user_id='${c}'`)
    ).stdout.trim(),
    "member",
    "Stale authority cannot promote a third account",
  );
  console.log("PASS waiting administrator authority is checked after demotion");
}

try {
  // pg_dump is schema-only and captures no member emails, passwords, tokens or
  // content. Only the three schemas needed for the existing membership APIs
  // are restored; storage and Supabase operational extension schemas stay out.
  const schema = await docker([
    "pg_dump",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "--schema-only",
    "--no-owner",
    "--schema=public",
    "--schema=private",
    "--schema=auth",
  ]);
  // Supabase operational roles own default-privilege declarations that the
  // postgres connection cannot rewrite. They only control objects created in
  // future, so omit those declarations while retaining every existing object
  // ACL, policy, constraint and function in this schema-only test clone.
  const restorableSchema = schema.stdout.replace(
    /^ALTER DEFAULT PRIVILEGES[^;\n]*;\r?\n/gm,
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
  await sql(
    "drop schema public cascade; create schema extensions; create extension pgcrypto with schema extensions",
  );
  await docker(
    [
      "psql",
      "-X",
      "-U",
      "postgres",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
    ],
    restorableSchema,
  );
  await sql(
    `insert into auth.users(id,email,email_confirmed_at) values('${a}','isolated-admin-a@example.test',now()),('${b}','isolated-admin-b@example.test',now()),('${c}','isolated-member-c@example.test',now()); insert into public.profiles(id,display_name) values('${a}','Isolated administrator A'),('${b}','Isolated administrator B'),('${c}','Isolated member C'); insert into public.memberships(user_id,role) values('${a}','admin'),('${b}','admin'),('${c}','member')`,
  );
  assert.equal(await activeCount(), 2);
  await race(
    "concurrent self-demotions",
    asMember(a, `select public.set_member_role('${a}','member')`),
    asMember(b, `select public.set_member_role('${b}','member')`),
  );
  await race(
    "concurrent cross-demotions",
    asMember(a, `select public.set_member_role('${b}','member')`),
    asMember(b, `select public.set_member_role('${a}','member')`),
  );
  await race(
    "concurrent cross-removals",
    asMember(a, `select public.set_member_status('${b}','removed')`),
    asMember(b, `select public.set_member_status('${a}','removed')`),
  );
  await race(
    "concurrent cross-suspensions",
    asMember(a, `select public.set_member_status('${b}','suspended')`),
    asMember(b, `select public.set_member_status('${a}','suspended')`),
  );
  await staleAdministrator();
  console.log("PASS 5 isolated administrator concurrency scenarios");
} catch (error) {
  failure = error;
} finally {
  if (lockOwner) {
    lockOwner.stdin.end("rollback;\n");
    lockOwner.kill("SIGTERM");
  }
  if (created) {
    // Identifier is generated above and constrained to a strict local prefix.
    try {
      await docker(["dropdb", "-U", "postgres", "--force", database]);
    } catch (error) {
      failure ??= error;
    }
  }
}
if (failure) {
  // SQL statements in this script contain only synthetic fixture identities;
  // schema contents and privileged environment values are never printed.
  console.error(failure.message);
  if (failure.stderr) console.error(failure.stderr.slice(0, 2000));
  process.exitCode = 1;
}
