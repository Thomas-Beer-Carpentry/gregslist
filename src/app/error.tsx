"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" tabIndex={-1} className="auth">
      <section className="card">
        <h1>Something went wrong.</h1>
        <p>We couldn’t complete that request. Please try again.</p>
        <Button onClick={reset}>Try again</Button>
      </section>
    </main>
  );
}
