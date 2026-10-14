import { configured, supabase } from "@/lib/supabase/server";
import { InvitationAcceptance } from "./invitation-acceptance";
export const dynamic = "force-dynamic";
export default async function Invite({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;
  const user = configured()
    ? (await (await supabase()).auth.getUser()).data.user
    : null;
  return (
    <main id="main" className="auth">
      <section className="card">
        <h1>A place for your people.</h1>
        {message && (
          <p role="status" className="message">
            {message}
          </p>
        )}
        <InvitationAcceptance
          authenticated={Boolean(user?.email_confirmed_at)}
        />
      </section>
    </main>
  );
}
