"use client";
import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { Temporal } from "@js-temporal/polyfill";
import { SubmitButton } from "@/components/submit-button";
import { saveRide } from "./actions";
import type { Ride } from "./model";
export function RideForm({
  postId,
  operationId,
  ride,
}: {
  postId: string;
  operationId: string;
  ride?: Ride;
}) {
  const [state, action] = useActionState(saveRide, { error: "" });
  const errorId = useId();
  const errorMessage = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.error) errorMessage.current?.focus();
  }, [state]);
  const local = (value: string | null | undefined) =>
    value
      ? Temporal.Instant.from(value)
          .toZonedDateTimeISO(ride?.timezone || "Pacific/Auckland")
          .toPlainDateTime()
          .toString({ smallestUnit: "minute" })
      : "";
  const [returning, setReturning] = useState(ride?.return_available || false);
  const [values, setValues] = useState({
    pickup: ride?.pickup || "",
    capacity: String(ride?.capacity || 1),
    route: ride?.route || "",
    departure_local: local(ride?.departure_at),
    timezone: ride?.timezone || "Pacific/Auckland",
    return_local: local(ride?.return_departure_at),
    return_details: ride?.return_details || "",
    contribution_amount: ride?.contribution_amount?.toString() || "",
    contribution_currency: ride?.contribution_currency || "NZD",
    cost_notes: ride?.cost_notes || "",
    notes: ride?.notes || "",
  });
  function field(name: keyof typeof values) {
    return {
      value: values[name],
      "aria-describedby": state.error ? errorId : undefined,
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setValues((v) => ({ ...v, [name]: e.target.value })),
    };
  }
  const prefix = ride?.id || "new-ride";
  return (
    <form
      action={action}
      className="ride-form"
      aria-describedby={state.error ? errorId : undefined}
      // Action failures must keep checkbox/select choices as well as text fields.
      onReset={(event) => event.preventDefault()}
    >
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
      <input type="hidden" name="post_id" value={postId} />
      <input type="hidden" name="ride_id" value={ride?.id || ""} />
      <input type="hidden" name="operation_id" value={operationId} />
      <label htmlFor={`${prefix}-pickup`}>Pickup location</label>
      <input
        id={`${prefix}-pickup`}
        name="pickup"
        required
        maxLength={300}
        {...field("pickup")}
      />
      <div className="form-grid">
        <div>
          <label htmlFor={`${prefix}-capacity`}>
            Passenger seats (excluding driver)
          </label>
          <input
            id={`${prefix}-capacity`}
            name="capacity"
            type="number"
            min="1"
            max="2147483647"
            required
            {...field("capacity")}
          />
        </div>
        <div>
          <label htmlFor={`${prefix}-departure`}>Departure (optional)</label>
          <input
            id={`${prefix}-departure`}
            name="departure_local"
            type="datetime-local"
            {...field("departure_local")}
          />
        </div>
      </div>
      <label htmlFor={`${prefix}-zone`}>Ride timezone</label>
      <input
        id={`${prefix}-zone`}
        name="timezone"
        required
        {...field("timezone")}
      />
      <label htmlFor={`${prefix}-route`}>
        Route or extra pickup details (optional)
      </label>
      <textarea
        id={`${prefix}-route`}
        name="route"
        maxLength={1000}
        {...field("route")}
      />
      <label className="checkbox-label">
        <input
          name="return_available"
          type="checkbox"
          value="yes"
          checked={returning}
          onChange={(e) => setReturning(e.target.checked)}
        />
        Return trip available
      </label>
      {returning ? (
        <>
          <label htmlFor={`${prefix}-return`}>
            Return departure (optional)
          </label>
          <input
            id={`${prefix}-return`}
            name="return_local"
            type="datetime-local"
            {...field("return_local")}
          />
          <label htmlFor={`${prefix}-return-details`}>
            Return pickup or drop-off details
          </label>
          <textarea
            id={`${prefix}-return-details`}
            name="return_details"
            maxLength={1000}
            {...field("return_details")}
          />
        </>
      ) : (
        <>
          <input type="hidden" name="return_local" value="" />
          <input type="hidden" name="return_details" value="" />
        </>
      )}
      <div className="form-grid">
        <div>
          <label htmlFor={`${prefix}-amount`}>
            Suggested contribution (optional)
          </label>
          <input
            id={`${prefix}-amount`}
            name="contribution_amount"
            type="number"
            min="0"
            max="99999999.99"
            step="0.01"
            {...field("contribution_amount")}
          />
        </div>
        <div>
          <label htmlFor={`${prefix}-currency`}>Currency</label>
          <input
            id={`${prefix}-currency`}
            name="contribution_currency"
            pattern="[A-Z]{3}"
            maxLength={3}
            required
            {...field("contribution_currency")}
          />
        </div>
      </div>
      <p className="muted">
        Informational only. Arrange contributions directly with your driver.
      </p>
      <label htmlFor={`${prefix}-cost`}>Contribution notes (optional)</label>
      <input
        id={`${prefix}-cost`}
        name="cost_notes"
        maxLength={500}
        {...field("cost_notes")}
      />
      <label htmlFor={`${prefix}-notes`}>Passenger notes (optional)</label>
      <textarea
        id={`${prefix}-notes`}
        name="notes"
        maxLength={2000}
        {...field("notes")}
      />
      {ride?.needs_reconfirmation && (
        <p className="message">
          Saving confirms that you have reviewed the updated event details.
        </p>
      )}
      <SubmitButton>{ride ? "Save ride" : "Offer a Ride"}</SubmitButton>
    </form>
  );
}
