import Link from "next/link";
import { z } from "zod";
import { requireMember } from "@/lib/auth";
import { NoticeboardShell } from "@/components/noticeboard-shell";
import { Button } from "@/components/ui/button";
import {
  POST_TYPES,
  STATUSES,
  label,
  statusLabel,
  formatDate,
  type PostRow,
  type Category,
} from "./model";
export type FeedParams = {
  q?: string;
  category?: string;
  type?: string;
  status?: string;
  cursor?: string;
  message?: string;
};
export async function Feed({
  params,
  mode = "feed",
}: {
  params: FeedParams;
  mode?: "feed" | "saved" | "events";
}) {
  const session = await requireMember();
  const { db, user } = session;
  const q = (typeof params.q === "string" ? params.q : "").slice(0, 200);
  const category = z.uuid().safeParse(params.category).success
    ? params.category
    : null;
  const type =
    mode === "events"
      ? "event"
      : POST_TYPES.includes(params.type as (typeof POST_TYPES)[number])
        ? params.type
        : null;
  const status = STATUSES.includes(params.status as (typeof STATUSES)[number])
    ? params.status
    : null;
  let beforeTime: string | null = null,
    beforeId: string | null = null;
  try {
    const [time, id] = Buffer.from(params.cursor || "", "base64url")
      .toString()
      .split("|");
    if (z.uuid().safeParse(id).success && Number.isFinite(Date.parse(time))) {
      beforeTime = time;
      beforeId = id;
    }
  } catch {
    /* Invalid cursors start at the first page. */
  }
  const [{ data: categories, error: categoryError }, { data, error }] =
    await Promise.all([
      db.from("categories").select("id,name,active").order("name"),
      db.rpc("noticeboard_feed", {
        search_text: q,
        category_filter: category,
        type_filter: type,
        status_filter: status,
        saved_only: mode === "saved",
        before_time: beforeTime,
        before_id: beforeId,
        page_size: 21,
      }),
    ]);
  if (error || categoryError)
    throw new Error("The noticeboard could not be loaded.");
  const posts = (data || []).slice(0, 20) as PostRow[];
  const hasMore = (data || []).length > 20;
  const authors = posts.length
    ? (
        await db
          .from("profiles")
          .select("id,display_name")
          .in("id", [...new Set(posts.map((p) => p.author_id))])
      ).data || []
    : [];
  const saved = posts.length
    ? (
        await db
          .from("saved_posts")
          .select("post_id")
          .eq("user_id", user.id)
          .in(
            "post_id",
            posts.map((p) => p.id),
          )
      ).data || []
    : [];
  const base =
    mode === "saved" ? "/saved" : mode === "events" ? "/events" : "/";
  const next = new URLSearchParams();
  if (q) next.set("q", q);
  if (category) next.set("category", category);
  if (type && mode !== "events") next.set("type", type);
  if (status) next.set("status", status);
  const last = posts.at(-1);
  if (last)
    next.set(
      "cursor",
      Buffer.from(`${last.created_at}|${last.id}`).toString("base64url"),
    );
  return (
    <NoticeboardShell session={session} active={mode}>
      <header className="page-header">
        <p className="eyebrow">The community noticeboard</p>
        <h1>
          {mode === "saved"
            ? "Saved for later."
            : mode === "events"
              ? "Make a little time."
              : "A little closer together."}
        </h1>
        <p className="muted">
          {mode === "saved"
            ? "Your own collection of useful things."
            : mode === "events"
              ? "Plans, meetups and good company."
              : "Useful things, shared plans, and good company."}
        </p>
      </header>
      {params.message && (
        <p className="message" role="status">
          {params.message}
        </p>
      )}
      <form
        method="get"
        action={base}
        className="card filters"
        aria-label="Search and filter posts"
      >
        <label htmlFor="q">Search posts</label>
        <input
          id="q"
          name="q"
          type="search"
          maxLength={200}
          defaultValue={q}
          placeholder="A spare ticket, a good walk, a helping hand…"
        />
        <div className="filter-grid">
          <div>
            <label htmlFor="category">Category</label>
            <select id="category" name="category" defaultValue={category || ""}>
              <option value="">All categories</option>
              {(categories as Category[]).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {mode !== "events" && (
            <div>
              <label htmlFor="type">Post type</label>
              <select id="type" name="type" defaultValue={type || ""}>
                <option value="">All types</option>
                {POST_TYPES.map((t) => (
                  <option value={t} key={t}>
                    {label(t)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="status">Status</label>
            <select id="status" name="status" defaultValue={status || ""}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option value={s} key={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="row">
          <Button>Apply filters</Button>
          <Link href={base}>Clear filters</Link>
        </div>
      </form>
      <section aria-label="Posts">
        {posts.length ? (
          posts.map((post) => (
            <article className="card post-card" key={post.id}>
              <div className="row">
                <span className="badge">{label(post.post_type)}</span>
                <span className={`badge status-${post.status}`}>
                  {statusLabel(post.status, post.post_type)}
                </span>
                {saved.some((s) => s.post_id === post.id) && (
                  <span className="muted">Saved</span>
                )}
              </div>
              <h2>
                <Link href={`/posts/${post.id}`}>{post.title}</Link>
              </h2>
              <p className="muted post-meta">
                {authors.find((a) => a.id === post.author_id)?.display_name ||
                  "Community member"}{" "}
                ·{" "}
                <time dateTime={post.created_at}>
                  {formatDate(post.created_at)}
                </time>
                <br />
                {
                  (categories as Category[]).find(
                    (c) => c.id === post.category_id,
                  )?.name
                }
              </p>
              <p className="excerpt">
                {post.description.slice(0, 260)}
                {post.description.length > 260 ? "…" : ""}
              </p>
              {post.location && <p className="muted">{post.location}</p>}
            </article>
          ))
        ) : (
          <div className="card empty-state">
            <h2>
              {q || category || type || status
                ? "No matching posts."
                : mode === "saved"
                  ? "Nothing saved yet."
                  : "A quiet moment on the board."}
            </h2>
            <p className="muted">
              {mode === "saved"
                ? "Save a post from its detail page to find it here."
                : "Try different filters, or share something with the group."}
            </p>
            <Link href="/posts/new">Create a post</Link>
          </div>
        )}
      </section>
      <div className="row pagination">
        {beforeTime && <Link href={base}>Back to newest</Link>}
        {hasMore && (
          <Button asChild variant="outline">
            <Link href={`${base}?${next}`}>Older posts</Link>
          </Button>
        )}
      </div>
    </NoticeboardShell>
  );
}
