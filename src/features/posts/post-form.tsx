"use client";
import { useActionState, useState, type ChangeEvent } from "react";
import { savePost } from "./actions";
import {
  POST_TYPES,
  STATUSES,
  label,
  statusLabel,
  type Category,
  type PostRow,
} from "./model";
import { SubmitButton } from "@/components/submit-button";
type InitialEvent = {
  starts_local: string;
  ends_local: string;
  timezone: string;
  location: string;
  capacity: number | null;
  lifecycle: string;
};
export function PostForm({
  categories,
  post,
  event,
}: {
  categories: Category[];
  post?: PostRow;
  event?: InitialEvent;
}) {
  const [kind, setKind] = useState(post?.post_type || "discussion");
  const [state, action] = useActionState(savePost, { error: "" });
  const [ridesEnabled, setRidesEnabled] = useState(
    post?.ride_coordination_enabled || false,
  );
  const [confirmTransport, setConfirmTransport] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  // React resets uncontrolled action forms after a result, including validation
  // errors. Controlled values preserve the member's work when correction is needed.
  const [values, setValues] = useState({
    category_id: post?.category_id || "",
    title: post?.title || "",
    description: post?.description || "",
    location: post?.location || "",
    availability: post?.availability || "",
    conditions: post?.conditions || "",
    status: post?.status || "open",
    starts_local: event?.starts_local || "",
    ends_local: event?.ends_local || "",
    timezone: event?.timezone || "Pacific/Auckland",
    event_location: event?.location || "",
    capacity: event?.capacity?.toString() || "",
  });
  function field(name: keyof typeof values) {
    return {
      value: values[name],
      onChange: (
        e: ChangeEvent<
          HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        >,
      ) => setValues((v) => ({ ...v, [name]: e.target.value })),
    };
  }
  return (
    <form
      action={action}
      className="post-form"
      // Action failures must keep checkbox/select choices as well as text fields.
      onReset={(event) => event.preventDefault()}
    >
      {state.error && (
        <p className="message" role="alert">
          {state.error}
        </p>
      )}
      <input type="hidden" name="id" value={post?.id || ""} />
      <div className="form-grid">
        <div>
          <label htmlFor="post_type">Post type</label>
          {post ? (
            <>
              <input type="hidden" name="post_type" value={kind} />
              <select id="post_type" value={kind} disabled>
                <option value={kind}>{label(kind)}</option>
              </select>
              <p className="muted">Post type stays fixed after publishing.</p>
            </>
          ) : (
            <select
              id="post_type"
              name="post_type"
              value={kind}
              onChange={(e) => {
                const value = e.target.value as typeof kind;
                setKind(value);
                if (
                  (value === "event" && values.status === "fulfilled") ||
                  (value !== "event" && values.status === "completed")
                )
                  setValues((v) => ({ ...v, status: "open" }));
              }}
            >
              {POST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {label(t)}
                </option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label htmlFor="category_id">Category</label>
          <select
            id="category_id"
            name="category_id"
            {...field("category_id")}
            required
          >
            <option value="" disabled>
              Choose a category
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {!c.active ? " (retired)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label htmlFor="title">Title</label>
      <input
        id="title"
        name="title"
        required
        maxLength={160}
        {...field("title")}
      />
      <label htmlFor="description">Description</label>
      <textarea
        id="description"
        name="description"
        required
        maxLength={20000}
        rows={7}
        {...field("description")}
      />
      <p className="muted">
        Plain text keeps things simple. Add photos after saving your post.
      </p>
      {kind === "event" ? (
        <fieldset>
          <legend>Event details</legend>
          <div className="form-grid">
            <div>
              <label htmlFor="starts_local">Starts</label>
              <input
                id="starts_local"
                name="starts_local"
                type="datetime-local"
                required
                {...field("starts_local")}
              />
            </div>
            <div>
              <label htmlFor="ends_local">Ends (optional)</label>
              <input
                id="ends_local"
                name="ends_local"
                type="datetime-local"
                {...field("ends_local")}
              />
            </div>
          </div>
          <label htmlFor="capacity">Attendance capacity (optional)</label>
          <input
            id="capacity"
            name="capacity"
            type="number"
            inputMode="numeric"
            min="1"
            max="2147483647"
            {...field("capacity")}
          />
          <p className="muted">
            Leave blank for unlimited attendance. Only Going uses a place,
            including the organiser if they RSVP.
          </p>
          <label htmlFor="timezone">Timezone</label>
          <input
            id="timezone"
            name="timezone"
            required
            {...field("timezone")}
            placeholder="Pacific/Auckland"
          />
          <label htmlFor="event_location">
            Event location or meeting point
          </label>
          <input
            id="event_location"
            name="event_location"
            required
            maxLength={300}
            {...field("event_location")}
          />
        </fieldset>
      ) : (
        <>
          <label htmlFor="location">Location or pickup point (optional)</label>
          <input
            id="location"
            name="location"
            maxLength={300}
            {...field("location")}
          />
        </>
      )}
      {["offer", "request", "trip"].includes(kind) && (
        <>
          <label htmlFor="availability">Availability (optional)</label>
          <input
            id="availability"
            name="availability"
            maxLength={300}
            {...field("availability")}
            placeholder="For example, weekends or until Friday"
          />
          <label htmlFor="conditions">
            Conditions or useful details (optional)
          </label>
          <textarea
            id="conditions"
            name="conditions"
            maxLength={1000}
            rows={3}
            {...field("conditions")}
          />
        </>
      )}
      <label className="checkbox-label">
        <input
          type="checkbox"
          name="ride_coordination_enabled"
          value="yes"
          checked={ridesEnabled}
          onChange={(e) => setRidesEnabled(e.target.checked)}
        />
        People might need a ride for this
      </label>
      <p className="muted">
        Any community member can offer a ride. Active rides and unresolved
        reservations must be closed before disabling coordination.
      </p>
      <label htmlFor="status">Status</label>
      <select id="status" name="status" {...field("status")}>
        {STATUSES.filter((s) =>
          kind === "event"
            ? s !== "fulfilled" &&
              (event?.lifecycle !== "completed" ||
                ["completed", "archived"].includes(s))
            : s !== "completed",
        ).map((s) => (
          <option key={s} value={s}>
            {statusLabel(s, kind)}
          </option>
        ))}
      </select>
      {kind === "event" &&
        post &&
        values.status === "cancelled" &&
        post.status !== "cancelled" && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              name="confirm_cancel"
              value="yes"
              required
              checked={confirmCancel}
              onChange={(e) => setConfirmCancel(e.target.checked)}
            />
            Cancel this event and its attendance. Members will receive an event
            update.
          </label>
        )}
      {kind === "event" &&
        post?.status === "cancelled" &&
        values.status === "open" && (
          <p className="message">
            Reopening starts fresh attendance. Members must RSVP again.
          </p>
        )}
      {post?.ride_coordination_enabled &&
        values.status !== "open" &&
        values.status !== post.status &&
        !(kind === "event" && values.status === "cancelled") && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              name="confirm_transport_close"
              value="yes"
              checked={confirmTransport}
              onChange={(e) => setConfirmTransport(e.target.checked)}
            />
            Close associated ride arrangements. Reservations will be marked
            completed, or cancelled if this post is cancelled.
          </label>
        )}
      <SubmitButton>{post ? "Save changes" : "Publish post"}</SubmitButton>
    </form>
  );
}
