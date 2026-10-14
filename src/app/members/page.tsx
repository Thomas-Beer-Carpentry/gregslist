import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { NoticeboardShell } from "@/components/noticeboard-shell";
import { Button } from "@/components/ui/button";
import "@/features/admin/admin.css";

export const dynamic = "force-dynamic";

export default async function Members({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  const session = await requireMember();
  const { search = "" } = await searchParams;
  const query = search.trim().slice(0, 80);
  const { data, error } = await session.db.rpc("member_directory", {
    search_query: query,
  });
  if (error) throw new Error("The member directory could not be loaded.");
  const members = (data || []) as {
    display_name: string;
    bio: string;
    joined_at: string;
  }[];

  return (
    <NoticeboardShell session={session} active="members">
      <p className="eyebrow">The people who make this place</p>
      <h1>Your community.</h1>
      <p className="muted">
        Meet the active members of your private community. Add a little about
        yourself in <Link href="/settings">account settings</Link>.
      </p>
      <form className="admin-search" action="/members">
        <div>
          <label htmlFor="member-search">Search members by name</label>
          <input
            id="member-search"
            type="search"
            name="search"
            maxLength={80}
            defaultValue={query}
            placeholder="A familiar name"
          />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
        {query && <Link href="/members">Clear search</Link>}
      </form>
      {members.length ? (
        <div className="directory-grid">
          {members.map((member, index) => (
            <article
              className="card directory-card"
              key={`${member.display_name}-${index}`}
            >
              <h2>{member.display_name}</h2>
              {member.bio ? (
                <p>{member.bio}</p>
              ) : (
                <p className="muted">Part of the Gregslist community.</p>
              )}
            </article>
          ))}
        </div>
      ) : (
        <section className="card">
          <h2>No familiar names found.</h2>
          <p className="muted">
            Try a different name or clear your search to see your community.
          </p>
        </section>
      )}
    </NoticeboardShell>
  );
}
