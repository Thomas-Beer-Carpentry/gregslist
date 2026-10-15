import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { InvitationForm } from "@/features/admin/invitation-form";
import { MemberControls } from "@/features/admin/member-controls";
import { revokeInvitation } from "@/features/admin/actions";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/features/posts/model";
import "@/features/admin/admin.css";

export const dynamic = "force-dynamic";

type AdminMember = {
  user_id: string;
  display_name: string;
  bio: string;
  email: string;
  role: string;
  status: string;
  joined_at: string;
  status_changed_at: string | null;
};
type Invitation = {
  id: string;
  email: string;
  issued_by: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  redeemed_at: string | null;
  redeemed_by: string | null;
  delivery: string;
};
type AuditEntry = {
  id: string;
  action: string;
  actor_name: string | null;
  target_name: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

function date(value: string) {
  return formatDate(value, "Pacific/Auckland", true);
}
function statusLabel(value: string) {
  if (value === "revoked" || value === "removed") return "Removed";
  if (value === "suspended") return "Suspended";
  return "Active";
}
function invitationStatus(invitation: Invitation) {
  if (invitation.redeemed_at) return "Accepted";
  if (invitation.revoked_at) return "Revoked";
  if (new Date(invitation.expires_at).getTime() <= Date.now()) return "Expired";
  return "Pending";
}
function auditLabel(action: string) {
  const labels: Record<string, string> = {
    invitation_created: "Invitation created",
    invitation_revoked: "Invitation revoked",
    invitation_redeemed: "Invitation accepted",
    invitation_sent: "Invitation email sent",
    member_suspended: "Member suspended",
    member_reactivated: "Member reactivated",
    member_removed: "Member removed",
    administrator_granted: "Administrator role granted",
    administrator_revoked: "Administrator role removed",
  };
  return labels[action] || action.replaceAll("_", " ");
}

export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{
    message?: string;
    search?: string;
    invitations?: string;
    invitationPage?: string;
  }>;
}) {
  const { db, user } = await requireMember(true);
  const {
    message,
    search = "",
    invitations: inviteFilter,
    invitationPage,
  } = await searchParams;
  const allInvitations = inviteFilter === "all";
  const page = /^\d{1,6}$/.test(invitationPage || "")
    ? Number(invitationPage)
    : 0;
  let invitationQuery = db
    .from("invitations")
    .select(
      "id,email,issued_by,created_at,expires_at,revoked_at,redeemed_at,redeemed_by,delivery",
      { count: "exact" },
    );
  if (!allInvitations)
    invitationQuery = invitationQuery
      .is("revoked_at", null)
      .is("redeemed_at", null)
      .gt("expires_at", new Date().toISOString());
  const invitationPageLink = (value: number) =>
    `/admin?invitations=${allInvitations ? "all" : "pending"}&invitationPage=${value}#invitations`;
  const query = search.trim().slice(0, 80);
  const [memberResult, inviteResult, auditResult] = await Promise.all([
    db.rpc("admin_members", { search_query: query }),
    invitationQuery
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(page * 50, page * 50 + 49),
    db
      .from("admin_audit")
      .select("id,action,actor_name,target_name,details,created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(50),
  ]);
  if (memberResult.error || inviteResult.error || auditResult.error)
    throw new Error("Community administration could not be loaded.");
  const members = (memberResult.data || []) as AdminMember[];
  const invitations = (inviteResult.data || []) as Invitation[];
  const audit = (auditResult.data || []) as AuditEntry[];
  const pending = invitations.filter(
    (invitation) => invitationStatus(invitation) === "Pending",
  );

  return (
    <main id="main" tabIndex={-1} className="administration">
      <Link href="/">← Noticeboard</Link>
      <p className="eyebrow">Care for your community</p>
      <h1>Community administration</h1>
      <p className="muted">
        Invite your people, manage access and keep a clear record of important
        changes.
      </p>
      {message && (
        <p role="status" className="message">
          {message}
        </p>
      )}
      <nav className="admin-section-links" aria-label="Administration sections">
        <Link href="#invite-member">Invite Member</Link>
        <Link href="#invitations">Invitations</Link>
        <Link href="#members">Manage members</Link>
        <Link href="#history">Administrative history</Link>
        <Link href="/members">Member directory</Link>
      </nav>
      <dl className="admin-summary" aria-label="Administration overview">
        <div>
          <dt>Members shown</dt>
          <dd>{members.length}</dd>
        </div>
        <div>
          <dt>Active administrators shown</dt>
          <dd>
            {
              members.filter(
                (member) =>
                  member.role === "admin" && member.status === "active",
              ).length
            }
          </dd>
        </div>
        <div>
          <dt>Pending invitations shown</dt>
          <dd>{pending.length}</dd>
        </div>
      </dl>
      <section
        id="invite-member"
        className="card"
        aria-labelledby="invite-heading"
      >
        <p className="eyebrow">A welcoming first step</p>
        <h2 id="invite-heading">Invite Member</h2>
        <p>
          Only the intended email address can join. Invitations are single-use,
          expire after seven days and can be revoked.
        </p>
        <InvitationForm />
      </section>
      <section
        id="invitations"
        className="card"
        aria-labelledby="invitations-heading"
      >
        <h2 id="invitations-heading">Invitations</h2>
        <p className="muted">
          Secure links are shown only when created. Pending invitations are
          listed first; use history to review accepted, expired or revoked
          invitations.
        </p>
        <nav className="admin-section-links" aria-label="Invitation views">
          <Link href="/admin?invitations=pending#invitations">
            Pending invitations
          </Link>
          <Link href="/admin?invitations=all#invitations">
            All invitation history
          </Link>
        </nav>
        {invitations.length ? (
          invitations.map((invitation) => {
            const status = invitationStatus(invitation);
            return (
              <article
                key={invitation.id}
                className="admin-invitation"
                aria-label={`Invitation for ${invitation.email}`}
              >
                <div className="row">
                  <h3>{invitation.email}</h3>
                  <span className="badge">{status}</span>
                </div>
                <p className="muted">
                  Created {date(invitation.created_at)} ·{" "}
                  {invitation.delivery === "copy"
                    ? "Copy link"
                    : "Email invitation"}
                </p>
                <p className="muted">Expires {date(invitation.expires_at)}</p>
                {invitation.redeemed_at && (
                  <p className="muted">
                    Accepted {date(invitation.redeemed_at)}
                  </p>
                )}
                {invitation.revoked_at && (
                  <p className="muted">Revoked {date(invitation.revoked_at)}</p>
                )}
                {status === "Pending" && (
                  <form action={revokeInvitation}>
                    <input type="hidden" name="id" value={invitation.id} />
                    <SubmitButton variant="outline">
                      Revoke invitation
                    </SubmitButton>
                  </form>
                )}
              </article>
            );
          })
        ) : (
          <p className="muted">
            No invitations in this view. A friendly welcome starts above.
          </p>
        )}
        <nav className="admin-section-links" aria-label="Invitation pages">
          {page > 0 && (
            <Link href={invitationPageLink(page - 1)}>Newer invitations</Link>
          )}
          {(inviteResult.count || 0) > (page + 1) * 50 && (
            <Link href={invitationPageLink(page + 1)}>Older invitations</Link>
          )}
        </nav>
      </section>
      <section id="members" className="card" aria-labelledby="members-heading">
        <h2 id="members-heading">Members</h2>
        <p className="muted">
          Email addresses and access controls are available here only to
          administrators. The community directory shows display names and
          biographies.
        </p>
        <form className="admin-search" action="/admin">
          <div>
            <label htmlFor="admin-member-search">Search members</label>
            <input
              id="admin-member-search"
              type="search"
              name="search"
              defaultValue={query}
              maxLength={80}
              placeholder="Name or email address"
            />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
          {query && <Link href="/admin#members">Clear search</Link>}
        </form>
        {members.length ? (
          members.map((member) => (
            <article
              key={member.user_id}
              className="admin-member"
              aria-label={`Member ${member.display_name}`}
            >
              <div className="row">
                <h3>{member.display_name}</h3>
                <span className="badge">{statusLabel(member.status)}</span>
                <span className="badge">
                  {member.role === "admin" ? "Administrator" : "Member"}
                </span>
                {member.user_id === user.id && (
                  <span className="badge">You</span>
                )}
              </div>
              <p>{member.email}</p>
              {member.bio && <p>{member.bio}</p>}
              <p className="muted">
                Joined {date(member.joined_at)}
                {member.status_changed_at &&
                  ` · Access changed ${date(member.status_changed_at)}`}
              </p>
              <MemberControls
                id={member.user_id}
                name={member.display_name}
                role={member.role}
                status={member.status}
              />
            </article>
          ))
        ) : (
          <p className="muted">
            No members match your search. Try another name or email address.
          </p>
        )}
      </section>
      <section id="history" className="card" aria-labelledby="history-heading">
        <h2 id="history-heading">Administrative history</h2>
        <p className="muted">
          The latest 50 administrative actions. History is retained and cannot
          be edited here.
        </p>
        {audit.length ? (
          <ol className="admin-audit">
            {audit.map((entry) => (
              <li key={entry.id} className="admin-audit-entry">
                <strong>{auditLabel(entry.action)}</strong>
                <p>
                  {entry.actor_name || "Administrator"}
                  {entry.target_name
                    ? ` · ${entry.target_name}`
                    : typeof entry.details.email === "string"
                      ? ` · ${entry.details.email}`
                      : ""}
                </p>
                <time className="muted" dateTime={entry.created_at}>
                  {date(entry.created_at)}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">
            Important community administration changes will appear here.
          </p>
        )}
      </section>
    </main>
  );
}
