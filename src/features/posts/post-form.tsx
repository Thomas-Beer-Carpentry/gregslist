"use client";
import { useActionState, useState, type ChangeEvent } from "react";
import { savePost } from "./actions";
import {
  POST_TYPES,
  STATUSES,
  label,
  type Category,
  type PostRow,
} from "./model";
import { SubmitButton } from "@/components/submit-button";
type InitialEvent = {
  starts_local: string;
  ends_local: string;
  timezone: string;
  location: string;
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
    <form action={action} className="post-form">
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
                if (value === "event" && values.status === "fulfilled")
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
      <label htmlFor="status">Status</label>
      <select id="status" name="status" {...field("status")}>
        {STATUSES.filter((s) => kind !== "event" || s !== "fulfilled").map(
          (s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ),
        )}
      </select>
      <SubmitButton>{post ? "Save changes" : "Publish post"}</SubmitButton>
    </form>
  );
}
