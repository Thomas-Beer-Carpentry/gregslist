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
    .select("display_name")
    .eq("id", user.id)
    .single();
  const { message } = await searchParams;
  return (
    <main id="main" className="auth">
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
          <SubmitButton>Save name</SubmitButton>
        </form>
        <hr className="divider" />
        <Link href="/settings/password">Change password</Link>
        <p>
          <Link href="/settings/partner">Manage linked partner</Link>
        </p>
      </section>
    </main>
  );
}
