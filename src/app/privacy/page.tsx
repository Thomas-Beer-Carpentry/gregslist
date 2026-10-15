import Link from "next/link";
export default function Privacy() {
  return (
    <main id="main" tabIndex={-1} className="auth">
      <section className="card">
        <h1>Your data in Gregslist.</h1>
        <p>
          Gregslist is an invitation-only community. Active members can see
          posts, discussions, event attendance, passenger names and basic
          community profiles. Partner relationships are visible only to their
          participants. Administrators can see membership emails, invitations
          and administrative history.
        </p>
        <p>
          Supabase provides authentication, database and private image storage.
          Passwords are handled by Supabase Auth. Uploads are checked and
          re-encoded to WebP without embedded location metadata. Native session
          credentials are stored in device Keychain/Keystore; the web
          application uses server-only session cookies. No advertising, social
          ranking or third-party analytics are added.
        </p>
        <p>
          Ordinary posts and history are retained while relevant to the
          community; no general automatic expiry is currently configured.
          Suspension and removal end community access and preserve history. They
          do not delete your Auth account.
        </p>
        <p>
          Permanent deletion is separate and starts immediately after password
          verification. It removes the Auth account, contact/profile
          information, uploads and your authored text. Active arrangements
          close. Minimal pseudonymised event/ride/admin records are retained for
          up to twelve months, then purged, including remaining threads attached
          to your deleted posts. Other members’ unrelated content is retained.
          References to you written independently by other people may require
          administrator review.
        </p>
        <p>
          Auth/Storage failures leave a private retry job and are reported as
          incomplete. A configured maintenance job must run to finish retries
          and expire retained history. Backup and provider security-log
          availability, retention and expiry depend on the deployed hosting
          plan; these have not yet been verified. Application deletion does not
          claim immediate erasure of those provider-managed copies. A restore
          must reapply completed erasures before member access is restored.
        </p>
        <p>
          This describes the implemented behaviour; it is not a legal compliance
          certification. Deployment ownership, a member-support contact and the
          live backup schedule must be supplied before launch.
        </p>
        <p>
          <Link href="/account-deletion">Account deletion</Link> ·{" "}
          <Link href="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
