import Link from "next/link";
import { recover } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
export default async function Recover({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;
  return (
    <main id="main" tabIndex={-1} className="auth">
      <Link href="/login" className="brand">
        gregslist.
      </Link>
      <section className="card">
        <h1>Reset your password.</h1>
        {message && (
          <p role="status" className="message">
            {message}
          </p>
        )}
        <form action={recover}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
          <SubmitButton>Send recovery link</SubmitButton>
        </form>
      </section>
      <Link href="/login">Back to sign in</Link>
    </main>
  );
}
