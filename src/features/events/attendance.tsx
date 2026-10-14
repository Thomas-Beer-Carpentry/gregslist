import { requireMember } from "@/lib/auth";
import type { EventRow } from "@/features/posts/model";
import { RsvpForm } from "./rsvp-form";
type Attendee = {
  user_id: string;
  display_name: string;
  response: string;
  updated_at: string;
};
export async function EventAttendance({
  event,
  postStatus,
  session,
}: {
  event: EventRow;
  postStatus: string;
  session: Awaited<ReturnType<typeof requireMember>>;
}) {
  const [{ data, error }, { data: own, error: ownError }] = await Promise.all([
    session.db.rpc("event_attendance", { target_event: event.post_id }),
    session.db
      .from("event_rsvps")
      .select("response,cancelled_at")
      .eq("event_id", event.post_id)
      .eq("user_id", session.user.id)
      .maybeSingle(),
  ]);
  if (error || ownError) throw new Error("Attendance could not be loaded.");
  const attendees = (data || []) as Attendee[];
  const going = attendees.filter((r) => r.response === "going");
  const maybe = attendees.filter((r) => r.response === "maybe");
  const declined = attendees.filter((r) => r.response === "not_going");
  const scheduled = postStatus === "open" && event.status === "scheduled";
  const started = new Date(event.starts_at).getTime() <= Date.now();
  const current = own && !own.cancelled_at ? own.response : null;
  const open = scheduled && !started;
  const available =
    event.capacity === null ? null : Math.max(0, event.capacity - going.length);
  const closed =
    event.status === "cancelled"
      ? "This event was cancelled. Previous responses are retained as history."
      : postStatus === "archived"
        ? "This event is archived. RSVPs are closed."
        : event.status === "completed"
          ? "This event is completed. RSVPs are closed."
          : "This event has started. New RSVPs are closed; you can still withdraw an existing response.";
  return (
    <section className="card attendance" aria-labelledby="attendance-title">
      <h2 id="attendance-title">Who’s coming?</h2>
      <p className="attendance-count">
        <strong>{going.length} Going</strong>
        {event.capacity !== null
          ? ` · Capacity ${event.capacity}`
          : " · No attendance limit"}
        {open && available !== null
          ? ` · ${available} ${available === 1 ? "place" : "places"} available`
          : ""}
      </p>
      <p className="muted">
        Going uses a place. Maybe does not. Responses are visible to community
        members.
      </p>
      {!open && <p className="message">{closed}</p>}
      {open && available === 0 && (
        <p className="message">
          This event is full. You can choose Maybe or Not Going.
        </p>
      )}
      {own?.cancelled_at && (
        <p className="message">
          Your previous{" "}
          {own.response === "not_going"
            ? "Not Going"
            : own.response === "going"
              ? "Going"
              : "Maybe"}{" "}
          response was cancelled.
          {open ? " Please RSVP again if you would like to attend." : ""}
        </p>
      )}
      <RsvpForm
        id={event.post_id}
        current={current}
        canRespond={open}
        canWithdraw={scheduled && Boolean(current && current !== "not_going")}
      />
      <div className="attendee-columns">
        <div>
          <h3>Going</h3>
          {going.length ? (
            <ul>
              {going.map((r) => (
                <li key={r.user_id}>
                  {r.display_name}
                  {r.user_id === session.user.id ? " (you)" : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No confirmed attendees yet.</p>
          )}
        </div>
        <div>
          <h3>Maybe</h3>
          {maybe.length ? (
            <ul>
              {maybe.map((r) => (
                <li key={r.user_id}>
                  {r.display_name}
                  {r.user_id === session.user.id ? " (you)" : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No Maybe responses yet.</p>
          )}
        </div>
      </div>
      {declined.length > 0 && (
        <details>
          <summary>Not Going</summary>
          <ul>
            {declined.map((r) => (
              <li key={r.user_id}>
                {r.display_name}
                {r.user_id === session.user.id ? " (you)" : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
