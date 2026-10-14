import { createClient } from "@supabase/supabase-js";
process.loadEnvFile(".env.local");
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const { data, error } = await db
  .from("photo_cleanup")
  .select("object_path")
  .order("enqueued_at")
  .limit(100);
if (error) throw new Error("Could not read photo cleanup queue.");
if (data.length) {
  const paths = data.map((p) => p.object_path);
  const result = await db.storage.from("community-photos").remove(paths);
  if (result.error)
    throw new Error("Storage cleanup failed; queue preserved for retry.");
  const removed = await db
    .from("photo_cleanup")
    .delete()
    .in("object_path", paths);
  if (removed.error) throw new Error("Queue update failed; retry is safe.");
}
console.log(
  `Removed ${data.length} queued photo objects. No private paths printed.`,
);
