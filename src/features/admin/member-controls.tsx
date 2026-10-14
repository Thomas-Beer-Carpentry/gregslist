import { manageMembership, manageRole } from "@/features/admin/actions";
import { SubmitButton } from "@/components/submit-button";

export function MemberControls({
  id,
  name,
  role,
  status,
}: {
  id: string;
  name: string;
  role: string;
  status: string;
}) {
  if (status === "removed" || status === "revoked") {
    return (
      <p className="muted">
        Access has been removed. The account and community history are retained.
      </p>
    );
  }
  return (
    <details className="admin-member-controls">
      <summary>Manage {name}</summary>
      {status === "suspended" ? (
        <form action={manageMembership}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="intent" value="reactivate" />
          <p>
            Reactivation restores community access. Events, rides, reservations
            and partner links are not automatically restored.
          </p>
          <SubmitButton variant="outline">Reactivate member</SubmitButton>
        </form>
      ) : (
        <form action={manageMembership}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="intent" value="suspend" />
          <p>
            Suspension immediately pauses community access. Historical records
            stay. Active RSVPs, passenger bookings and partner links are closed;
            driving is withdrawn and upcoming events they organise are
            cancelled.
          </p>
          <label className="checkbox-label">
            <input type="checkbox" name="confirm" required />I understand the
            effects of suspending {name}.
          </label>
          <SubmitButton variant="outline">Suspend member</SubmitButton>
        </form>
      )}
      <form action={manageMembership}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="intent" value="remove" />
        <p>
          Removal ends community access permanently. The same event, ride and
          attendance changes apply. Their account and historical records are
          retained; this does not delete personal data.
        </p>
        <label className="checkbox-label">
          <input type="checkbox" name="confirm" required />I understand the
          effects of removing {name}.
        </label>
        <SubmitButton variant="outline">Remove member</SubmitButton>
      </form>
      {(status === "active" || role === "admin") && (
        <form action={manageRole}>
          <input type="hidden" name="id" value={id} />
          <input
            type="hidden"
            name="role"
            value={role === "admin" ? "member" : "admin"}
          />
          <p>
            {role === "admin"
              ? "They will keep ordinary member access. The final active administrator cannot be demoted."
              : "Administrators can invite members, change community access and manage administrator roles."}
          </p>
          <label className="checkbox-label">
            <input type="checkbox" name="confirm" required />I confirm this role
            change for {name}.
          </label>
          <SubmitButton variant="outline">
            {role === "admin"
              ? "Remove administrator role"
              : "Make administrator"}
          </SubmitButton>
        </form>
      )}
    </details>
  );
}
