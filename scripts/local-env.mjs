import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
if (existsSync(".env.local")) {
  console.log(".env.local already exists; preserved.");
  process.exit(0);
}
const status = JSON.parse(
  execFileSync("node_modules/.bin/supabase", ["status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
);
writeFileSync(
  ".env.local",
  `NEXT_PUBLIC_SUPABASE_URL=${status.API_URL}\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${status.ANON_KEY}\nSUPABASE_SERVICE_ROLE_KEY=${status.SERVICE_ROLE_KEY}\nNEXT_PUBLIC_SITE_URL=http://localhost:3000\n`,
  { mode: 0o600 },
);
console.log(
  "Created ignored .env.local from local Supabase. No credentials printed.",
);
