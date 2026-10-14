"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { confirmEmail } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export function ConfirmationForm() {
  const captured = useRef(false);
  const [context, setContext] = useState<{
    token: string;
    type: string;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const [state, action] = useActionState(confirmEmail, { error: "" });
  useEffect(() => {
    if (captured.current) return;
    captured.current = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get("token_hash") || "";
    const type = fragment.get("type") || "";
    if (
      /^[A-Za-z0-9_-]{32,256}$/.test(token) &&
      ["invite", "email", "recovery"].includes(type)
    )
      setContext({ token, type });
    if (window.location.hash)
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    setReady(true);
  }, []);
  if (!ready) return <p className="muted">Opening your secure email link…</p>;
  if (!context)
    return (
      <>
        <p role="alert" className="message">
          Open the complete secure link from your email. If you refreshed this
          page, reopen the original email link.
        </p>
        <Link href="/invite">Invitation help</Link>
      </>
    );
  return (
    <form action={action}>
      <input type="hidden" name="token_hash" value={context.token} />
      <input type="hidden" name="type" value={context.type} />
      <p>
        {context.type === "recovery"
          ? "Confirm your recovery link to choose a new password."
          : "Confirm your email to finish your invitation securely."}
      </p>
      <p className="muted">
        Continue only if you requested this email or were invited to Gregslist.
      </p>
      {state.error && (
        <p role="alert" className="message">
          {state.error}
        </p>
      )}
      <SubmitButton>
        {context.type === "recovery" ? "Verify recovery link" : "Verify email"}
      </SubmitButton>
    </form>
  );
}
