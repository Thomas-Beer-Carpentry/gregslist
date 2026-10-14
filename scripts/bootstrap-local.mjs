import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const status = JSON.parse(
  execFileSync("node_modules/.bin/supabase", ["status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
);
if (!["127.0.0.1", "localhost"].includes(new URL(status.API_URL).hostname))
  throw new Error("Local only");
const client = createClient(status.API_URL, status.SERVICE_ROLE_KEY);
const saved = existsSync(".local-admin.json")
  ? JSON.parse(readFileSync(".local-admin.json", "utf8"))
  : null;
const email = saved?.email || "admin@gregslist.test";
const password = saved?.password || randomBytes(24).toString("base64url");
if (saved) {
  const { data, error } = await client.auth.admin.listUsers();
  if (error) throw error;
  const account = data.users.find((u) => u.email === email);
  if (account) {
    const { data: membership } = await client
      .from("memberships")
      .select("role,status")
      .eq("user_id", account.id)
      .single();
    if (membership?.role !== "admin" || membership.status !== "active")
      throw new Error(
        "Existing local account is not an active administrator. Operator action required.",
      );
    console.log(
      "Existing local administrator verified; credentials preserved.",
    );
    process.exit(0);
  }
}
const { data, error } = await client.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (error) throw error;
const id = data.user.id;
execFileSync(
  "docker",
  [
    "exec",
    "-i",
    "supabase_db_gregslist",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
  ],
  {
    input: `begin; insert into public.profiles(id,display_name) values('${id}','Greg'); insert into public.memberships(user_id,role) values('${id}','admin'); commit;`,
    stdio: ["pipe", "ignore", "pipe"],
  },
);
writeFileSync(
  ".local-admin.json",
  JSON.stringify({ email, password }, null, 2),
  { mode: 0o600 },
);
console.log(
  "Local admin created. Credentials are in ignored .local-admin.json; never commit or publish them.",
);
