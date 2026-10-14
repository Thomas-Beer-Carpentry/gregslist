import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { logout } from "@/app/actions";
import { Button } from "@/components/ui/button";
export const dynamic = "force-dynamic";
export default async function Home() {
  const { db, user, membership } = await requireMember();
  const { data: profile } = await db
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();
  return (
    <div className="shell">
      <aside>
        <Link className="brand" href="/">
          gregslist.
        </Link>
        <p className="muted">A place for your people.</p>
        <nav aria-label="Main navigation">
          <Link href="/" aria-current="page">
            Noticeboard
          </Link>
          <span className="muted" aria-disabled="true">
            Events
          </span>
          <span className="muted" aria-disabled="true">
            Saved posts
          </span>
          {membership.role === "admin" && (
            <Link href="/admin">Administration</Link>
          )}
        </nav>
        <Button disabled>Create post</Button>
        <p>{profile?.display_name}</p>
        <Link href="/settings">Account settings</Link>
        <form action={logout} style={{ marginTop: 16 }}>
          <Button variant="outline">Sign out</Button>
        </form>
      </aside>
      <main id="main">
        <header>
          <p className="eyebrow">The community noticeboard</p>
          <h1>A little closer together.</h1>
          <p className="muted">
            Useful things, shared plans, and good company.
          </p>
        </header>
        <section className="hero">
          <p className="eyebrow">Welcome to Gregslist</p>
          <h2>Your private corner of the internet.</h2>
          <p>
            You’re in. This is where your community’s plans and helpful little
            things will come together.
          </p>
        </section>
        <section className="card" style={{ marginTop: 24 }}>
          <h2>Your noticeboard starts here.</h2>
          <p className="muted">
            Community posts will appear here. Posting isn’t available yet.
          </p>
        </section>
      </main>
      <aside className="upcoming" aria-label="Upcoming events">
        <section className="card">
          <p className="eyebrow">On the horizon</p>
          <h2>Upcoming events</h2>
          <p className="muted">No upcoming events to show.</p>
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
