import { mkdirSync, openSync, closeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
// Separate local Docker settings avoid injecting an outbound HTTP proxy into
// requests between Supabase containers. The Docker daemon retains registry egress.
const dockerConfig = resolve(".cache/docker-local");
mkdirSync(dockerConfig, { recursive: true });
const args = process.argv.slice(2);
const isStart = args[0] === "start";
// Supabase prints local privileged keys at startup. Keep that output private.
const log = isStart
  ? openSync(".cache/supabase-start.log", "w", 0o600)
  : undefined;
const result = spawnSync("node_modules/.bin/supabase", args, {
  stdio: log === undefined ? "inherit" : ["inherit", log, log],
  env: { ...process.env, DOCKER_CONFIG: dockerConfig },
});
if (log !== undefined) closeSync(log);
if (result.error) throw result.error;
if (isStart)
  console.log(
    result.status === 0
      ? "Local Supabase services are ready. Startup output is in ignored .cache/supabase-start.log."
      : "Supabase startup failed. Inspect ignored .cache/supabase-start.log privately; it can contain local credentials.",
  );
process.exit(result.status ?? 1);
