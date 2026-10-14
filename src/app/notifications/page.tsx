import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { NoticeboardShell } from "@/components/noticeboard-shell";
import { SubmitButton } from "@/components/submit-button";
import { formatDate } from "@/features/posts/model";
import { readUpdate } from "@/features/events/actions";
export const dynamic = "force-dynamic";
export default async function EventUpdates({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const session = await requireMember();
  const { data, error } = await session.db
    .from("notifications")
    .select("id,message,kind,post_id,created_at,read_at")
    .eq("recipient_id", session.user.id)
    .in("kind", [
      "event_updated",
      "event_cancelled",
      "event_completed",
      "event_archived",
      "event_reopened",
      "ride_booked",
      "ride_switched",
      "ride_updated",
      "ride_withdrawn",
      "ride_booking_cancelled",
      "ride_cancelled",
      "ride_completed",
    ])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(50);
  if (error) throw new Error("Event updates unavailable");
  const { message } = await searchParams;
  return (
    <NoticeboardShell session={session} active="updates">
      <p className="eyebrow">Keep your plans in sync</p>
      <h1>Your updates.</h1>
      <p className="muted">
        The latest 50 event and ride updates for your plans.
      </p>
      {message && (
        <p role="status" className="message">
          {message}
        </p>
      )}
      {data?.length ? (
        data.map((update) => (
          <article className="card event-update" key={update.id}>
            <div className="row">
              <span className="badge">{update.read_at ? "Read" : "New"}</span>
              <time className="muted" dateTime={update.created_at}>
                {formatDate(update.created_at, "Pacific/Auckland", true)}
              </time>
            </div>
            <h2>{update.message}</h2>
            <div className="row">
              {update.post_id && (
                <Link href={`/posts/${update.post_id}`}>View post</Link>
              )}
              {!update.read_at && (
                <form action={readUpdate}>
                  <input type="hidden" name="id" value={update.id} />
                  <SubmitButton variant="outline">Mark as read</SubmitButton>
                </form>
              )}
            </div>
          </article>
        ))
      ) : (
        <section className="card">
          <h2>You’re up to date.</h2>
          <p className="muted">
            Relevant event and transport changes will appear here.
          </p>
        </section>
      )}
    </NoticeboardShell>
  );
}
