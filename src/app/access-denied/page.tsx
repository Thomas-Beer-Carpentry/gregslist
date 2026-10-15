import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase/server";
import { logout } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";
export default async function AccessDenied() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await db
    .from("memberships")
    .select("status,role")
    .eq("user_id", user.id)
    .maybeSingle();
  const status = membership?.status;
  return (
    <main id="main" tabIndex={-1} className="auth">
      <section className="card">
        <p className="eyebrow">Your private community</p>
        <h1>Access is unavailable.</h1>
        <p>
          {status === "active"
            ? "This area requires administrator access."
            : status === "suspended"
              ? "Your community access is suspended. Contact an administrator to discuss reactivation."
              : status === "removed" || status === "revoked"
                ? "Your community access has been removed. Your account and historical records have been retained. Contact an administrator if you need help."
                : "An accepted administrator invitation is required to join Gregslist. Open your invitation to verify your email and accept."}
        </p>
        {status === "active" ? (
          <Link href="/">Back to the noticeboard</Link>
        ) : (
          <Link href="/invite">Invitation help</Link>
        )}
        <p>
          <Link href="/account-deletion">Delete my account</Link>
        </p>
        <form action={logout}>
          <SubmitButton variant="outline">Sign out</SubmitButton>
        </form>
      </section>
    </main>
  );
}
