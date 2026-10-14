"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { acceptInvitation, requestInvitationVerification } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export function InvitationAcceptance({
  authenticated,
}: {
  authenticated: boolean;
}) {
  const [context, setContext] = useState<{ id: string; token: string } | null>(
    null,
  );
  const [ready, setReady] = useState(false);
  const captured = useRef(false);
  const [verification, verify] = useActionState(requestInvitationVerification, {
    error: "",
    message: "",
  });
  const [acceptance, accept] = useActionState(acceptInvitation, {
    error: "",
    message: "",
  });
  useEffect(() => {
    if (captured.current) return;
    captured.current = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const id = fragment.get("id") || "";
    const token = fragment.get("token") || "";
    if (/^[0-9a-f-]{36}$/i.test(id) && /^[a-f0-9]{64}$/.test(token))
      setContext({ id, token });
    // Fragments never reach the server. Remove them from the visible URL and
    // current browser-history entry before any subsequent navigation.
    if (window.location.hash)
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    setReady(true);
  }, []);
  if (!ready) return <p className="muted">Opening your invitation…</p>;
  if (!context)
    return (
      <>
        <p>
          Membership is by invitation. Open the original secure invitation link
          to join. If you have just verified your email in another browser,
          reopen that link here.
        </p>
        <p className="muted">
          If it has expired or was revoked, ask your community administrator for
          a new invitation.
        </p>
        <Link href="/login">Already a member? Sign in</Link>
      </>
    );
  return (
    <>
      <p>
        A friendly community is waiting. Your invitation is tied to its intended
        email address and expires seven days after it was created.
      </p>
      {authenticated && (
        <form action={accept}>
          <input type="hidden" name="id" value={context.id} />
          <input type="hidden" name="token" value={context.token} />
          <p>
            If you are signed in with the intended, verified email address, you
            can accept now.
          </p>
          {acceptance.error && (
            <p role="alert" className="message">
              {acceptance.error}
            </p>
          )}
          <SubmitButton>Accept invitation</SubmitButton>
        </form>
      )}
      <form action={verify}>
        <input type="hidden" name="id" value={context.id} />
        <input type="hidden" name="token" value={context.token} />
        <label htmlFor="invited-email">Your invited email address</label>
        <input
          id="invited-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          maxLength={254}
        />
        <p className="muted">
          We’ll send a short-lived email link to verify this address. Use the
          same browser when opening it. Existing accounts can use this link to
          sign in securely.
        </p>
        {verification.error && (
          <p role="alert" className="message">
            {verification.error}
          </p>
        )}
        {verification.message && (
          <p role="status" className="message">
            {verification.message}
          </p>
        )}
        <SubmitButton>Send verification email</SubmitButton>
      </form>
      <p>
        <Link href="/login">Back to sign in</Link>
      </p>
    </>
  );
}
