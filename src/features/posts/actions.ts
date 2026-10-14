"use server";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth";
import { cleanupPhotos } from "./photos";
import { POST_TYPES, STATUSES, type FormState } from "./model";
const schema = z.object({
  title: z.string().trim().min(1, "Add a title.").max(160),
  description: z.string().trim().min(1, "Add a description.").max(20000),
  post_type: z.enum(POST_TYPES),
  category_id: z.uuid(),
  status: z.enum(STATUSES),
  availability: z.string().trim().max(300),
  conditions: z.string().trim().max(1000),
  location: z.string().trim().max(300),
});
const idSchema = z.uuid();
function id(form: FormData, key = "id") {
  const result = idSchema.safeParse(form.get(key));
  if (!result.success) throw new Error("Invalid content reference");
  return result.data;
}
function refresh(post?: string) {
  revalidatePath("/");
  revalidatePath("/saved");
  revalidatePath("/events");
  if (post) revalidatePath(`/posts/${post}`);
}
function fail(path: string, text: string): never {
  redirect(`${path}?message=${encodeURIComponent(text)}`);
}
export async function savePost(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const { db } = await requireMember();
  const parsed = schema.safeParse(
    Object.fromEntries(
      [
        "title",
        "description",
        "post_type",
        "category_id",
        "status",
        "availability",
        "conditions",
        "location",
      ].map((k) => [k, String(form.get(k) || "")]),
    ),
  );
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const rawId = String(form.get("id") || "");
  if (rawId && !idSchema.safeParse(rawId).success)
    return { error: "Invalid post." };
  const content: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.post_type === "event") {
    const zone = String(form.get("timezone") || "Pacific/Auckland");
    const location = String(form.get("event_location") || "").trim();
    if (!location || location.length > 300)
      return { error: "Add an event location (up to 300 characters)." };
    try {
      const start = Temporal.PlainDateTime.from(
        String(form.get("starts_local") || ""),
      ).toZonedDateTime(zone, { disambiguation: "reject" });
      const endText = String(form.get("ends_local") || "");
      const end = endText
        ? Temporal.PlainDateTime.from(endText).toZonedDateTime(zone, {
            disambiguation: "reject",
          })
        : null;
      if (end && Temporal.ZonedDateTime.compare(end, start) <= 0)
        return { error: "The end must be after the start." };
      Object.assign(content, {
        starts_at: start.toInstant().toString(),
        ends_at: end?.toInstant().toString() || null,
        timezone: zone,
        event_location: location,
      });
    } catch {
      return {
        error:
          "Choose valid event dates and an IANA timezone. Times skipped or repeated by daylight saving need a different time.",
      };
    }
  }
  const { data, error } = await db.rpc("write_post", {
    target_id: rawId || null,
    content,
  });
  if (error)
    return {
      error: error.message.includes("arrangements")
        ? "This post has attendance or ride arrangements. Contact an administrator before changing it."
        : "Could not save this post. Check your category, dates and permissions, then try again.",
    };
  refresh(data);
  redirect(`/posts/${data}?message=Post+saved`);
}
export async function deletePost(form: FormData) {
  const { db } = await requireMember();
  const post = id(form);
  if (form.get("confirm") !== "yes")
    fail(`/posts/${post}`, "Confirm deletion before removing a post.");
  const { data, error } = await db.rpc("delete_post", { target_id: post });
  if (error)
    fail(
      `/posts/${post}`,
      "Could not delete this post. Check ownership and existing arrangements.",
    );
  await cleanupPhotos(data || []);
  refresh(post);
  redirect("/?message=Post+deleted");
}
export async function saveComment(form: FormData) {
  const { db } = await requireMember();
  const post = id(form, "post_id");
  const comment = String(form.get("comment_id") || "");
  const body = z.string().trim().min(1).max(10000).safeParse(form.get("body"));
  if (!body.success || (comment && !idSchema.safeParse(comment).success))
    fail(`/posts/${post}`, "Comments must contain 1 to 10000 characters.");
  const { error } = await db.rpc("write_comment", {
    target_post: post,
    comment_id: comment || null,
    comment_body: body.data,
  });
  if (error)
    fail(
      `/posts/${post}`,
      "Could not save this comment. Check ownership and whether comments are open.",
    );
  refresh(post);
  redirect(`/posts/${post}?message=Comment+saved#comments`);
}
export async function deleteComment(form: FormData) {
  const { db } = await requireMember();
  const post = id(form, "post_id");
  const { error } = await db.rpc("delete_comment", { target_id: id(form) });
  if (error) fail(`/posts/${post}`, "Could not delete this comment.");
  refresh(post);
  redirect(`/posts/${post}?message=Comment+deleted#comments`);
}
export async function toggleSaved(form: FormData) {
  const { db } = await requireMember();
  const post = id(form);
  const { error } = await db.rpc("set_saved_post", {
    target_id: post,
    should_save: form.get("save") === "yes",
  });
  if (error) fail(`/posts/${post}`, "Could not update your saved posts.");
  refresh(post);
  redirect(`/posts/${post}`);
}
export async function removePhoto(form: FormData) {
  const { db } = await requireMember();
  const post = id(form, "post_id");
  const { data, error } = await db.rpc("remove_post_photo", {
    target_id: id(form),
  });
  if (error) fail(`/posts/${post}`, "Could not remove this photo.");
  await cleanupPhotos([data]);
  refresh(post);
  redirect(`/posts/${post}?message=Photo+removed`);
}
