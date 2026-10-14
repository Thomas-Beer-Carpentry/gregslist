import Link from "next/link";
export default function NotFound() {
  return (
    <main id="main" className="auth">
      <section className="card">
        <h1>That page isn’t available.</h1>
        <p>It may have been removed, or you may not have access.</p>
        <Link href="/">Back to the noticeboard</Link>
      </section>
    </main>
  );
}
