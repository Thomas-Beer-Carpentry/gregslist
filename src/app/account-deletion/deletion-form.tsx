"use client";
import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { deleteOwnAccount } from "./actions";
export function DeletionForm() {
  const [state, action] = useActionState(deleteOwnAccount, { error: "" });
  return (
    <form action={action} aria-describedby="deletion-effects">
      {state.error && (
        <p role="alert" className="message">
          {state.error}
        </p>
      )}
      <label htmlFor="deletion-password">Current password</label>
      <input
        id="deletion-password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        maxLength={128}
      />
      <label htmlFor="deletion-confirmation">Type DELETE to confirm</label>
      <input
        id="deletion-confirmation"
        name="confirmation"
        autoComplete="off"
        required
        pattern="DELETE"
      />
      <label className="checkbox-label">
        <input name="confirm" type="checkbox" required />I understand that
        deletion starts immediately and cannot be undone.
      </label>
      <SubmitButton>Delete my account permanently</SubmitButton>
    </form>
  );
}
