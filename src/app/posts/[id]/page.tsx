import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireMember } from "@/lib/auth";
import { NoticeboardShell } from "@/components/noticeboard-shell";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { PhotoUploader } from "@/features/posts/photo-uploader";
import {
  deletePost,
  saveComment,
  deleteComment,
  toggleSaved,
  removePhoto,
} from "@/features/posts/actions";
import { RideCoordination } from "@/features/rides/coordination";
import { EventAttendance } from "@/features/events/attendance";
import { formatDate, label, statusLabel } from "@/features/posts/model";
export const dynamic = "force-dynamic";
export default async function PostDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ message?: string }>;
}) {
  const session = await requireMember();
  const { db, user, membership } = session;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { data: post, error } = await db
    .from("posts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Post unavailable");
  if (!post) notFound();
  const [
    { data: author },
    { data: category },
    { data: event },
    { data: photos, error: photoError },
    { data: comments, error: commentError },
    { data: saved },
    { count: rideHistoryCount, error: rideHistoryError },
  ] = await Promise.all([
    db
      .from("profiles")
      .select("display_name")
      .eq("id", post.author_id)
      .single(),
    db.from("categories").select("name").eq("id", post.category_id).single(),
    db.from("events").select("*").eq("post_id", id).maybeSingle(),
    db
      .from("post_photos")
      .select("id,position")
      .eq("post_id", id)
      .order("position"),
    db
      .from("comments")
      .select("id,author_id,body,created_at,updated_at")
      .eq("post_id", id)
      .order("created_at")
      .order("id"),
    db
      .from("saved_posts")
      .select("post_id")
      .eq("post_id", id)
      .eq("user_id", user.id)
      .maybeSingle(),
    db
      .from("ride_offers")
      .select("id", { count: "exact", head: true })
      .eq("post_id", id),
  ]);
  if (photoError || commentError || rideHistoryError)
    throw new Error("Post content unavailable");
  const commentAuthors = comments?.length
    ? (
        await db
          .from("profiles")
          .select("id,display_name")
          .in("id", [...new Set(comments.map((c) => c.author_id))])
      ).data || []
    : [];
  const hasRideHistory = Boolean(rideHistoryCount);
  let hasRsvpHistory = false;
  if (event) {
    const history = await db
      .from("event_rsvps")
      .select("user_id", { count: "exact", head: true })
      .eq("event_id", id);
    if (history.error) throw new Error("Event history unavailable");
    hasRsvpHistory = Boolean(history.count);
  }
  const own = post.author_id === user.id;
  const canDelete = own || membership.role === "admin";
  const openComments = !["archived", "cancelled"].includes(post.status);
  const { message } = await searchParams;
  return (
    <NoticeboardShell session={session}>
      <Link href="/">← Noticeboard</Link>
      {message && (
        <p role="status" className="message">
          {message}
        </p>
      )}
      <article className="card detail">
        <div className="row">
          <span className="badge">{label(post.post_type)}</span>
          <span className={`badge status-${post.status}`}>
            {statusLabel(post.status, post.post_type)}
          </span>
        </div>
        <h1>{post.title}</h1>
        <p className="muted">
          {author?.display_name} ·{" "}
          <time dateTime={post.created_at}>{formatDate(post.created_at)}</time>{" "}
          · {category?.name}
        </p>
        <div className="row detail-actions">
          <form action={toggleSaved}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="save" value={saved ? "no" : "yes"} />
            <SubmitButton variant="outline">
              {saved ? "Unsave post" : "Save post"}
            </SubmitButton>
          </form>
          {own && (
            <Button variant="outline" asChild>
              <Link href={`/posts/${id}/edit`}>Edit post</Link>
            </Button>
          )}
        </div>
        {event && (
          <section className="event-details">
            <h2>When and where</h2>
            <p>
              <time dateTime={event.starts_at}>
                {formatDate(event.starts_at, event.timezone, true)}
              </time>
              {event.ends_at && (
                <>
                  {" "}
                  –{" "}
                  <time dateTime={event.ends_at}>
                    {formatDate(event.ends_at, event.timezone, true)}
                  </time>
                </>
              )}
              <br />
              <span className="muted">{event.timezone}</span>
            </p>
            <p>{event.location}</p>
            {event.status !== "scheduled" && <p>{label(event.status)}</p>}
          </section>
        )}
        <div className="post-body">{post.description}</div>
        {post.location && (
          <p>
            <strong>Location:</strong> {post.location}
          </p>
        )}
        {post.availability && (
          <p>
            <strong>Availability:</strong> {post.availability}
          </p>
        )}
        {post.conditions && (
          <div className="post-body">
            <strong>Conditions:</strong> {post.conditions}
          </div>
        )}
        {photos?.length ? (
          <div className="photo-grid">
            {photos.map((photo, index) => (
              <figure key={photo.id}>
                <a
                  href={`/photos/${photo.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={`/photos/${photo.id}`}
                    alt={`${post.title} — photo ${index + 1}`}
                    loading="lazy"
                  />
                </a>
                {own && (
                  <form action={removePhoto}>
                    <input type="hidden" name="id" value={photo.id} />
                    <input type="hidden" name="post_id" value={id} />
                    <SubmitButton variant="outline">
                      Remove photo {index + 1}
                    </SubmitButton>
                  </form>
                )}
              </figure>
            ))}
          </div>
        ) : null}
        {own && <PhotoUploader postId={id} count={photos?.length || 0} />}
      </article>
      {event && (
        <EventAttendance
          event={event}
          postStatus={post.status}
          session={session}
        />
      )}
      <RideCoordination post={post} event={event} session={session} />
      <section id="comments" className="card">
        <h2>Comments</h2>
        {comments?.length ? (
          comments.map((comment) => (
            <article className="comment" key={comment.id}>
              <p className="muted">
                <strong>
                  {commentAuthors.find((a) => a.id === comment.author_id)
                    ?.display_name || "Community member"}
                </strong>{" "}
                ·{" "}
                <time dateTime={comment.created_at}>
                  {formatDate(comment.created_at, "Pacific/Auckland", true)}
                </time>
                {comment.updated_at !== comment.created_at ? " · edited" : ""}
              </p>
              <p className="post-body">{comment.body}</p>
              {comment.author_id === user.id && openComments && (
                <details>
                  <summary>Edit comment</summary>
                  <form action={saveComment}>
                    <input type="hidden" name="post_id" value={id} />
                    <input type="hidden" name="comment_id" value={comment.id} />
                    <label htmlFor={`edit-${comment.id}`}>Your comment</label>
                    <textarea
                      id={`edit-${comment.id}`}
                      name="body"
                      required
                      maxLength={10000}
                      rows={3}
                      defaultValue={comment.body}
                    />
                    <SubmitButton>Save comment</SubmitButton>
                  </form>
                </details>
              )}
              {(comment.author_id === user.id ||
                membership.role === "admin") && (
                <form action={deleteComment}>
                  <input type="hidden" name="id" value={comment.id} />
                  <input type="hidden" name="post_id" value={id} />
                  <SubmitButton variant="outline">Delete comment</SubmitButton>
                </form>
              )}
            </article>
          ))
        ) : (
          <p className="muted">No comments yet. Start the conversation.</p>
        )}
        {openComments ? (
          <form action={saveComment}>
            <input type="hidden" name="post_id" value={id} />
            <label htmlFor="new-comment">Add a comment</label>
            <textarea
              id="new-comment"
              name="body"
              required
              maxLength={10000}
              rows={4}
            />
            <SubmitButton>Post comment</SubmitButton>
          </form>
        ) : (
          <p className="message">
            Comments are closed on this {post.status} post.
          </p>
        )}
      </section>
      {canDelete && (hasRsvpHistory || hasRideHistory) && (
        <section className="card">
          <p className="muted">
            {hasRsvpHistory
              ? "RSVP history is retained. The organiser can cancel or archive this event instead of deleting it."
              : "Ride history is retained. Close or archive this post instead of deleting its transport records."}
          </p>
        </section>
      )}
      {canDelete && !hasRsvpHistory && !hasRideHistory && (
        <section className="card">
          <details>
            <summary>Delete this post</summary>
            <p>
              This permanently removes the post, its comments, saved references
              and photos.
            </p>
            <form action={deletePost}>
              <input type="hidden" name="id" value={id} />
              <label className="checkbox-label">
                <input type="checkbox" name="confirm" value="yes" required />I
                understand and want to delete this post
              </label>
              <SubmitButton variant="outline">
                Delete post permanently
              </SubmitButton>
            </form>
          </details>
        </section>
      )}
    </NoticeboardShell>
  );
}
