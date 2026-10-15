import { createClient } from "@supabase/supabase-js";
import { retryAccountErasures } from "../src/lib/privacy-worker.mjs";
if (process.env.GREGSLIST_ENV_FILE)
  process.loadEnvFile(process.env.GREGSLIST_ENV_FILE);
else process.loadEnvFile(".env.local");
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const result = await retryAccountErasures(db);
console.log(JSON.stringify(result));
