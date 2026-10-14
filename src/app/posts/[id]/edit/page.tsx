import Link from "next/link";
import { notFound } from "next/navigation";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { requireMember } from "@/lib/auth";
import { NoticeboardShell } from "@/components/noticeboard-shell";
import { PostForm } from "@/features/posts/post-form";
import type { PostRow } from "@/features/posts/model";
export const dynamic = "force-dynamic";
export default async function EditPost({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireMember();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { data: post } = await session.db
    .from("posts")
    .select("*")
    .eq("id", id)
    .single();
  if (!post || post.author_id !== session.user.id) notFound();
  const [{ data: categories, error }, { data: event }] = await Promise.all([
    session.db.from("categories").select("id,name,active").order("name"),
    session.db.from("events").select("*").eq("post_id", id).maybeSingle(),
  ]);
  if (error) throw new Error("Categories unavailable");
  const local = (value: string) =>
    Temporal.Instant.from(value)
      .toZonedDateTimeISO(event.timezone)
      .toPlainDateTime()
      .toString({ smallestUnit: "minute" });
  return (
    <NoticeboardShell session={session}>
      <Link href={`/posts/${id}`}>← Back to post</Link>
      <h1>Edit your post.</h1>
      <section className="card">
        <PostForm
          categories={(categories || []).filter(
            (c) => c.active || c.id === post.category_id,
          )}
          post={post as PostRow}
          event={
            event
              ? {
                  starts_local: local(event.starts_at),
                  ends_local: event.ends_at ? local(event.ends_at) : "",
                  timezone: event.timezone,
                  location: event.location,
                }
              : undefined
          }
        />
      </section>
    </NoticeboardShell>
  );
}
