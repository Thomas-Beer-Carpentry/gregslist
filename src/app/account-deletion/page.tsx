import Link from "next/link";
import { configured, supabase } from "@/lib/supabase/server";
import { DeletionForm } from "./deletion-form";
export const dynamic = "force-dynamic";
export default async function AccountDeletion() {
  const user = configured()
    ? (await (await supabase()).auth.getUser()).data.user
    : null;
  return (
    <main id="main" tabIndex={-1} className="auth">
      <section className="card">
        <Link href="/settings">← Account settings</Link>
        <h1>Delete your account.</h1>
        <div id="deletion-effects">
          <p>
            Deletion starts immediately after you verify your password. There is
            no waiting or undo period.
          </p>
          <p>
            Your login, contact/profile information, uploads and authored
            post/comment text are removed. Active rides, reservations, partner
            links and relevant events close safely. A final administrator must
            first appoint another active administrator.
          </p>
          <p>
            Minimal pseudonymised event, ride and administrative history is kept
            for at most twelve months, then purged. At that point, threads and
            remaining comments attached to your deleted posts are also removed.
            Other members’ unrelated records remain.
          </p>
          <p>
            If Auth or Storage is temporarily unavailable, community access and
            visible personal content are removed immediately and the remaining
            removal is queued for retry. Completion is reported honestly. Backup
            copies expire under the hosting provider’s configured schedule;
            restored backups must reapply completed erasures.
          </p>
          <p>
            <Link href="/privacy">Read the data-handling policy</Link>
          </p>
        </div>
        {user ? (
          <DeletionForm />
        ) : (
          <p>
            <Link href="/login">
              Sign in to verify your identity and delete your account.
            </Link>{" "}
            Suspended or removed members can use this page after signing in.
          </p>
        )}
      </section>
    </main>
  );
}
