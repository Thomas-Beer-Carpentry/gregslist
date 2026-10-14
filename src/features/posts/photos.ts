import "server-only";
import { adminClient } from "@/lib/supabase/admin";
// Server-only helper, never a callable Server Action. Paths come from an
// owner-checked RPC or the server-generated upload path, never a browser field.
export async function cleanupPhotos(paths: string[]) {
  if (!paths.length) return;
  const admin = adminClient();
  const { error } = await admin.storage.from("community-photos").remove(paths);
  if (!error)
    await admin.from("photo_cleanup").delete().in("object_path", paths);
}
