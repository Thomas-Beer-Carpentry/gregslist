import Link from "next/link";
import { login } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;
  return (
    <main id="main" className="auth">
      <Link className="brand" href="/">
        gregslist<span style={{ color: "var(--sage-teal)" }}>.</span>
      </Link>
      <p className="tagline">Good people. Useful things. Plans together.</p>
      <section className="card">
        <p className="eyebrow">Your community, privately</p>
        <h1>Welcome back.</h1>
        <p className="muted">A little place to keep your people connected.</p>
        {message && (
          <p role="status" className="message">
            {message}
          </p>
        )}
        <form action={login}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <SubmitButton>Sign in</SubmitButton>
        </form>
        <hr className="divider" />
        <Link href="/recover">Forgot your password?</Link>
      </section>
      <p className="muted">
        Gregslist is invitation-only. Ask a community administrator for an
        invitation.
      </p>
    </main>
  );
}
