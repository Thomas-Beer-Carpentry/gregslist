import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { sendInvite, revokeInvite, revokeMember } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
export const dynamic = "force-dynamic";
export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { db, user } = await requireMember(true);
  const { message } = await searchParams;
  const { data: invites } = await db
    .from("invitations")
    .select("*")
    .order("created_at", { ascending: false });
  const { data: members } = await db
    .from("memberships")
    .select("user_id,role,status,profiles(display_name)");
  return (
    <main id="main" style={{ maxWidth: 900, margin: "40px auto", padding: 24 }}>
      <Link href="/">← Noticeboard</Link>
      <h1>Community administration</h1>
      {message && (
        <p role="status" className="message">
          {message}
        </p>
      )}
      <section className="card">
        <h2>Invite a friend</h2>
        <form action={sendInvite}>
          <label htmlFor="email">Their email address</label>
          <input id="email" name="email" type="email" required />
          <SubmitButton>Send invitation</SubmitButton>
        </form>
        <p className="muted">
          Only the invited email can join. Invitations can be revoked below.
        </p>
      </section>
      <section className="card">
        <h2>Invitations</h2>
        {invites?.map((inv) => (
          <div key={inv.id} className="row" style={{ marginBottom: 16 }}>
            <span>
              {inv.email} ·{" "}
              {inv.revoked_at
                ? "Revoked"
                : inv.redeemed_at
                  ? "Used"
                  : new Date(inv.expires_at) < new Date()
                    ? "Expired"
                    : "Pending"}
            </span>
            {!inv.revoked_at && !inv.redeemed_at && (
              <form action={revokeInvite}>
                <input type="hidden" name="id" value={inv.id} />
                <SubmitButton variant="outline">Revoke invitation</SubmitButton>
              </form>
            )}
          </div>
        ))}
      </section>
      <section className="card">
        <h2>Members</h2>
        {members?.map((m) => (
          <div className="row" key={m.user_id} style={{ marginBottom: 16 }}>
            <span>
              {
                (m.profiles as unknown as { display_name: string })
                  ?.display_name
              }{" "}
              · {m.role} · {m.status}
            </span>
            {m.user_id !== user.id && m.status === "active" && (
              <form action={revokeMember}>
                <input type="hidden" name="id" value={m.user_id} />
                <SubmitButton variant="outline">Revoke access</SubmitButton>
              </form>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}
