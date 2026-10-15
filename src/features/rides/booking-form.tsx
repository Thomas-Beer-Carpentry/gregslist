"use client";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { reserveRide } from "./actions";
import type { BookingReference } from "./model";
export function BookingForm({
  rideId,
  postId,
  operationId,
  hasPartner,
  current,
  isDriver = false,
}: {
  rideId: string;
  postId: string;
  operationId: string;
  hasPartner: boolean;
  current: BookingReference[];
  isDriver?: boolean;
}) {
  const [mode, setMode] = useState(isDriver ? "partner" : "self");
  const [state, action] = useActionState(reserveRide, { error: "" });
  const errorId = useId();
  const errorMessage = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.error) errorMessage.current?.focus();
  }, [state]);
  const selected = current.filter((r) => mode === "both" || r.scope === mode);
  const switching = selected.some((r) => r.ride_id !== rideId);
  const allowed = selected.every((r) => r.ride_id === rideId || r.manageable);
  const already =
    selected.length === (mode === "both" ? 2 : 1) &&
    selected.every((r) => r.ride_id === rideId);
  return (
    <form
      action={action}
      className="booking-form"
      aria-describedby={state.error ? errorId : undefined}
      // Action failures must keep checkbox/select choices as well as text fields.
      onReset={(event) => event.preventDefault()}
    >
      <input type="hidden" name="post_id" value={postId} />
      <input type="hidden" name="ride_id" value={rideId} />
      <input type="hidden" name="operation_id" value={operationId} />
      <input
        type="hidden"
        name="intent"
        value={switching ? "switch" : "book"}
      />
      {selected.map((r) => (
        <input
          key={r.id}
          type="hidden"
          name="expected_reservation"
          value={r.id}
        />
      ))}
      <label htmlFor={`booking-${rideId}`}>Who needs a seat?</label>
      <select
        id={`booking-${rideId}`}
        name="booking_mode"
        aria-describedby={state.error ? errorId : undefined}
        value={mode}
        onChange={(e) => setMode(e.target.value)}
      >
        {!isDriver && <option value="self">Just me</option>}
        {hasPartner && (
          <>
            {!isDriver && <option value="both">Me and my partner</option>}
            <option value="partner">My partner only</option>
          </>
        )}
      </select>
      {switching && (
        <p className="muted">
          {mode === "both"
            ? "Switch both passengers together."
            : "Change only the selected passenger’s ride."}{" "}
          Existing seats are kept if the replacement fails.
        </p>
      )}
      {!allowed && (
        <p className="message">
          Your partner must manage the booking they created themselves.
        </p>
      )}
      <SubmitButton disabled={!allowed || already}>
        {already
          ? "Already booked"
          : switching
            ? mode === "both"
              ? "Switch both passengers"
              : "Change ride"
            : "Book seats"}
      </SubmitButton>
      {state.error && (
        <p
          role="alert"
          className="message"
          id={errorId}
          ref={errorMessage}
          tabIndex={-1}
        >
          {state.error}
        </p>
      )}
    </form>
  );
}
