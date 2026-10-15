import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { updateProfile } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
export const dynamic = "force-dynamic";
export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { db, user } = await requireMember();
  const { data: profile } = await db
    .from("profiles")
    .select("display_name,bio")
    .eq("id", user.id)
    .single();
  const { message } = await searchParams;
  return (
    <main id="main" tabIndex={-1} className="auth">
      <Link href="/">← Noticeboard</Link>
      <section className="card">
        <h1>Your account.</h1>
        {message && (
          <p role="status" className="message">
            {message}
          </p>
        )}
        <form action={updateProfile}>
          <label htmlFor="display_name">Display name</label>
          <input
            id="display_name"
            name="display_name"
            defaultValue={profile?.display_name}
            required
            maxLength={80}
            autoComplete="nickname"
          />
          <label htmlFor="bio">A little about you</label>
          <textarea
            id="bio"
            name="bio"
            defaultValue={profile?.bio || ""}
            maxLength={300}
            rows={4}
            aria-describedby="bio-help"
          />
          <p id="bio-help" className="muted">
            Optional, up to 300 characters. Your display name and biography are
            visible to authorised community members. Keep contact details
            private.
          </p>
          <SubmitButton>Save name</SubmitButton>
        </form>
        <hr className="divider" />
        <Link href="/settings/password">Change password</Link>
        <p>
          <Link href="/settings/partner">Manage linked partner</Link>
        </p>
        <p>
          <Link href="/members">Meet your community</Link>
        </p>
        <p>
          <Link href="/privacy">Privacy and data handling</Link>
        </p>
        <p>
          <Link href="/account-deletion">Delete my account</Link>
        </p>
      </section>
    </main>
  );
}
