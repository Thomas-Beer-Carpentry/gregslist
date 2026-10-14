import Link from "next/link";
import { logout } from "@/app/actions";
import { requireMember } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/features/posts/model";
export async function NoticeboardShell({
  children,
  active = "feed",
  session,
}: {
  children: React.ReactNode;
  active?: "feed" | "saved" | "events" | "updates";
  session: Awaited<ReturnType<typeof requireMember>>;
}) {
  const { db, user, membership } = session;
  const [{ data: profile }, { data: events, error }] = await Promise.all([
    db.from("profiles").select("display_name").eq("id", user.id).single(),
    db
      .from("events")
      .select(
        "post_id,starts_at,timezone,location,posts!inner(id,title,status)",
      )
      .eq("status", "scheduled")
      .eq("posts.status", "open")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(5),
  ]);
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          gregslist.
        </Link>
        <p className="muted">A place for your people.</p>
        <nav aria-label="Main navigation">
          <Link href="/" aria-current={active === "feed" ? "page" : undefined}>
            Noticeboard
          </Link>
          <Link
            href="/events"
            aria-current={active === "events" ? "page" : undefined}
          >
            Events
          </Link>
          <Link
            href="/saved"
            aria-current={active === "saved" ? "page" : undefined}
          >
            Saved posts
          </Link>
          <Link
            href="/notifications"
            aria-current={active === "updates" ? "page" : undefined}
          >
            Updates
          </Link>
          {membership.role === "admin" && (
            <Link href="/admin">Administration</Link>
          )}
        </nav>
        <Button asChild>
          <Link href="/posts/new">Create post</Link>
        </Button>
        <p>{profile?.display_name}</p>
        <Link href="/settings">Account settings</Link>
        <form action={logout} style={{ marginTop: 16 }}>
          <Button variant="outline">Sign out</Button>
        </form>
      </aside>
      <main id="main">{children}</main>
      <aside className="upcoming" aria-label="Upcoming events">
        <section className="card">
          <p className="eyebrow">On the horizon</p>
          <h2>Upcoming events</h2>
          {error ? (
            <p role="status">Upcoming events couldn’t be loaded.</p>
          ) : events?.length ? (
            <ul className="event-list">
              {events.map((e) => (
                <li key={e.post_id}>
                  <time dateTime={e.starts_at}>
                    {formatDate(e.starts_at, e.timezone, true)}
                  </time>
                  <Link href={`/posts/${e.post_id}`}>
                    {(e.posts as unknown as { title: string }).title}
                  </Link>
                  <span className="muted">{e.location}</span>
                  <small className="muted">{e.timezone}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              No upcoming events yet. There’s always something to look forward
              to.
            </p>
          )}
        </section>
        <p className="muted">
          Private by design.
          <br />
          Made for real life.
        </p>
      </aside>
    </div>
  );
}
