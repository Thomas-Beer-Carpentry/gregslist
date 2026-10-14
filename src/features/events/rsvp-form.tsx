"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { respondToEvent } from "./actions";
function Choice({
  value,
  children,
  selected,
  disabled,
}: {
  value: string;
  children: React.ReactNode;
  selected: boolean;
  disabled: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="response"
      value={value}
      variant={selected ? "default" : "outline"}
      aria-pressed={selected}
      disabled={disabled || pending}
    >
      {children}
    </Button>
  );
}
export function RsvpForm({
  id,
  current,
  canRespond,
  canWithdraw,
}: {
  id: string;
  current: string | null;
  canRespond: boolean;
  canWithdraw: boolean;
}) {
  const [state, action] = useActionState(respondToEvent, {
    error: "",
    message: "",
  });
  return (
    <form action={action} className="rsvp-form">
      <input type="hidden" name="event_id" value={id} />
      <div className="row" role="group" aria-label="Your RSVP">
        <Choice
          value="going"
          selected={current === "going"}
          disabled={!canRespond}
        >
          Going
        </Choice>
        <Choice
          value="maybe"
          selected={current === "maybe"}
          disabled={!canRespond}
        >
          Maybe
        </Choice>
        <Choice
          value="not_going"
          selected={current === "not_going"}
          disabled={!canRespond && !canWithdraw}
        >
          Not Going
        </Choice>
      </div>
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
    </form>
  );
}
