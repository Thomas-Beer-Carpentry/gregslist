// Shared server/CLI worker. It accepts an already privileged client and reads no
// credentials itself; it must never be called with an unverified request ID.
export async function finishAccountErasure(admin, userId) {
  const job = await admin
    .from("account_erasure_jobs")
    .select("user_id,photo_paths,auth_deleted_at,storage_deleted_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (job.error || !job.data) throw new Error("Erasure request unavailable.");
  if (!job.data.auth_deleted_at) {
    const removed = await admin.auth.admin.deleteUser(userId);
    if (
      removed.error &&
      removed.error.status !== 404 &&
      removed.error.code !== "user_not_found"
    ) {
      await admin
        .from("account_erasure_jobs")
        .update({ last_error: "auth_delete_retry" })
        .eq("user_id", userId);
      return false;
    }
    const saved = await admin
      .from("account_erasure_jobs")
      .update({ auth_deleted_at: new Date().toISOString(), last_error: null })
      .eq("user_id", userId);
    if (saved.error) return false;
  }
  let remaining = job.data.photo_paths;
  for (let batch = 0; batch < 10; batch++) {
    if (!remaining.length) {
      const saved = await admin
        .from("account_erasure_jobs")
        .update({
          photo_paths: [],
          storage_deleted_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("user_id", userId);
      return !saved.error;
    }
    const paths = remaining.slice(0, 50);
    const removed = await admin.storage.from("community-photos").remove(paths);
    if (removed.error) {
      await admin
        .from("account_erasure_jobs")
        .update({ last_error: "storage_delete_retry" })
        .eq("user_id", userId);
      return false;
    }
    const saved = await admin
      .from("photo_cleanup")
      .delete()
      .in("object_path", paths);
    if (saved.error) return false;
    remaining = remaining.slice(paths.length);
    const progress = await admin
      .from("account_erasure_jobs")
      .update({ photo_paths: remaining })
      .eq("user_id", userId);
    if (progress.error) return false;
  }
  return false;
}

export async function retryAccountErasures(admin, limit = 20) {
  const jobs = await admin
    .from("account_erasure_jobs")
    .select("user_id")
    .or("auth_deleted_at.is.null,storage_deleted_at.is.null")
    .order("erased_at")
    .limit(Math.min(limit, 100));
  if (jobs.error) throw new Error("Erasure queue unavailable.");
  let completed = 0;
  for (const job of jobs.data)
    if (await finishAccountErasure(admin, job.user_id)) completed++;
  // Also complete the existing ordinary post/photo deletion queue. Metadata
  // authorisation has already removed access; Storage failures retain the job.
  const queued = await admin
    .from("photo_cleanup")
    .select("object_path")
    .order("enqueued_at")
    .limit(100);
  if (queued.error) throw new Error("Photo cleanup queue unavailable.");
  if (queued.data.length) {
    const paths = queued.data.map((row) => row.object_path);
    if ((await admin.storage.from("community-photos").remove(paths)).error)
      throw new Error("Photo cleanup requires retry.");
    if (
      (await admin.from("photo_cleanup").delete().in("object_path", paths))
        .error
    )
      throw new Error("Photo cleanup queue requires retry.");
  }
  const purged = await admin.rpc("purge_expired_erasure_history");
  if (purged.error)
    throw new Error("Retention cleanup failed; retry required.");
  return {
    completed,
    pending: jobs.data.length - completed,
    expiredHistoriesPurged: purged.data,
    photoObjectsRemoved: queued.data.length,
  };
}
