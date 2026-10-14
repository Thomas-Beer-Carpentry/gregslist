"use client";

import { useActionState, useState } from "react";
import { createInvitation } from "@/features/admin/actions";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";

export function InvitationForm() {
  const [state, action] = useActionState(createInvitation, {
    error: "",
    message: "",
    link: "",
  });
  const [delivery, setDelivery] = useState("email");
  const [copyMessage, setCopyMessage] = useState("");

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(state.link);
      setCopyMessage(
        "Invitation link copied. Share it privately with the intended member.",
      );
    } catch {
      setCopyMessage("Select the invitation link and copy it manually.");
    }
  }

  return (
    <>
      <form action={action} onSubmit={() => setCopyMessage("")}>
        <label htmlFor="invitation-email">Their email address</label>
        <input
          id="invitation-email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="off"
        />
        <fieldset className="admin-delivery">
          <legend>How would you like to invite them?</legend>
          <label className="checkbox-label">
            <input
              type="radio"
              name="delivery"
              value="email"
              checked={delivery === "email"}
              onChange={() => setDelivery("email")}
            />
            Send an invitation email
          </label>
          <label className="checkbox-label">
            <input
              type="radio"
              name="delivery"
              value="copy"
              checked={delivery === "copy"}
              onChange={() => setDelivery("copy")}
            />
            Generate a link to copy
          </label>
        </fieldset>
        {state.error && (
          <p role="alert" className="message">
            {state.error}
          </p>
        )}
        {state.message && (
          <p role="status" className="message">
            {state.message}
          </p>
        )}
        <SubmitButton>
          {delivery === "email"
            ? "Send invitation"
            : "Generate invitation link"}
        </SubmitButton>
      </form>
      {state.link && (
        <section
          className="admin-copy-link"
          aria-label="Your new invitation link"
        >
          <label htmlFor="secure-invitation-link">Secure invitation link</label>
          <textarea
            id="secure-invitation-link"
            value={state.link}
            readOnly
            rows={3}
            spellCheck={false}
          />
          <Button type="button" variant="outline" onClick={copyLink}>
            Copy invitation link
          </Button>
          <p className="muted">
            This link is shown only now. Share it privately with the intended
            member. It expires in seven days; they must verify their email
            before joining.
          </p>
          {copyMessage && (
            <p role="status" className="message">
              {copyMessage}
            </p>
          )}
        </section>
      )}
    </>
  );
}
