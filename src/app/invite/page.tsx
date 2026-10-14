import Link from "next/link";
export default function Invite() {
  return (
    <main id="main" className="auth">
      <section className="card">
        <h1>A place for your people.</h1>
        <p>
          Membership is by invitation. Open the secure link in your invitation
          email to join.
        </p>
        <p>
          If your invitation has expired or was revoked, contact your community
          administrator.
        </p>
        <Link href="/login">Already a member? Sign in</Link>
      </section>
    </main>
  );
}
