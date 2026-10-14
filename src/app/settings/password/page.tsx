export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { supabase, configured } from "@/lib/supabase/server";
import { setPassword } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
export default async function Password({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  if (!configured()) redirect("/login");
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { message } = await searchParams;
  return (
    <main id="main" className="auth">
      <section className="card">
        <p className="eyebrow">Account security</p>
        <h1>Choose your password.</h1>
        {message && (
          <p role="status" className="message">
            {message}
          </p>
        )}
        <form action={setPassword}>
          <label htmlFor="password">New password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
          <p className="muted">Use at least 12 characters.</p>
          <SubmitButton>Save password</SubmitButton>
        </form>
      </section>
    </main>
  );
}
