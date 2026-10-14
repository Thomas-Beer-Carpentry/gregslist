import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { SubmitButton } from "@/components/submit-button";
import { managePartner } from "@/features/partners/actions";
export const dynamic = "force-dynamic";
export default async function PartnerSettings({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { db, user } = await requireMember();
  const [candidates, relationships] = await Promise.all([
    db.rpc("partner_candidates"),
    db
      .from("partner_relationships")
      .select("id,user_a,user_b,requested_by,status")
      .order("created_at", { ascending: false }),
  ]);
  if (candidates.error || relationships.error)
    throw new Error("Partner settings could not be loaded.");
  const names = new Map<string, string>(
    (candidates.data || []).map((p: { id: string; display_name: string }) => [
      p.id,
      p.display_name,
    ]),
  );
  const links = relationships.data || [],
    confirmed = links.find((r) => r.status === "confirmed"),
    pending = links.filter((r) => r.status === "pending");
  const { message } = await searchParams;
  function control(id: string, intent: string, text: string) {
    return (
      <form action={managePartner}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="intent" value={intent} />
        <SubmitButton variant="outline">{text}</SubmitButton>
      </form>
    );
  }
  const other = (r: { user_a: string; user_b: string }) =>
    names.get(r.user_a === user.id ? r.user_b : r.user_a) || "Community member";
  return (
    <main id="main" className="auth partner-settings">
      <Link href="/settings">← Account settings</Link>
      <section className="card">
        <h1>Linked partner.</h1>
        <p>
          Link with one community member to book transport together. Both
          members must agree. Linking is optional.
        </p>
        {message && (
          <p role="status" className="message">
            {message}
          </p>
        )}
        <p className="muted">
          Your partner may book seats for you. They may change or cancel
          bookings they created while your link remains active. You can always
          manage your own reservations. Unlinking keeps existing bookings and
          ends delegated access immediately.
        </p>
        {confirmed ? (
          <section>
            <h2>Linked with {other(confirmed)}</h2>
            {control(confirmed.id, "unlink", "Unlink partner")}
          </section>
        ) : (
          <>
            <h2>Request a partner link</h2>
            <form action={managePartner}>
              <input type="hidden" name="intent" value="request" />
              <label htmlFor="partner-id">Community member</label>
              <select id="partner-id" name="id" required defaultValue="">
                <option value="" disabled>
                  Choose a member
                </option>
                {Array.from(names).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
              <SubmitButton>Send partner request</SubmitButton>
            </form>
          </>
        )}
        <h2>Pending requests</h2>
        {pending.length ? (
          pending.map((r) => (
            <article className="partner-request" key={r.id}>
              <h3>{other(r)}</h3>
              {r.requested_by === user.id ? (
                <>
                  <p>Waiting for their acceptance.</p>
                  {control(r.id, "unlink", "Cancel request")}
                </>
              ) : (
                <>
                  <p>Would like to link with you.</p>
                  <div className="row">
                    {control(r.id, "accept", "Accept request")}
                    {control(r.id, "decline", "Decline request")}
                  </div>
                </>
              )}
            </article>
          ))
        ) : (
          <p className="muted">No pending partner requests.</p>
        )}
      </section>
    </main>
  );
}
