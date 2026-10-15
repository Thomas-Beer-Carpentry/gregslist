import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Temporal } from "@js-temporal/polyfill";
import { db, requestId } from "../lib/client";
import {
  Body,
  Button,
  Card,
  Feedback,
  Field,
  Muted,
  Select,
  Title,
} from "../ui";

type Ride = {
  id: string;
  driver_id: string;
  pickup: string;
  capacity: number;
  departure_at: string | null;
  timezone: string;
  route: string;
  return_available: boolean;
  return_departure_at: string | null;
  return_details: string | null;
  contribution_amount: number | null;
  contribution_currency: string;
  cost_notes: string | null;
  notes: string | null;
  status: string;
  needs_reconfirmation: boolean;
};
type Reservation = {
  id: string;
  ride_id: string;
  passenger_id: string;
  created_by: string;
  status: string;
};
type Relationship = {
  id: string;
  user_a: string;
  user_b: string;
  requested_by: string;
  status: string;
};
type Person = { id: string; display_name: string };
type Event = { status: string; starts_at: string };
type ParentPost = {
  id: string;
  status: string;
  post_type: string;
  ride_coordination_enabled: boolean;
};
type Mode = "self" | "both" | "partner";
const activeReservation = (r: Reservation) =>
  r.status === "confirmed" || r.status === "needs_arrangement";
const statusLabel = (status: string) =>
  status === "needs_arrangement"
    ? "Alternative transport needed"
    : status.replaceAll("_", " ");
function dateLabel(value: string | null, timezone: string) {
  if (!value) return "Time to be arranged";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}
function failure(error: unknown) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : "";
  return [
    "Not enough seats",
    "A passenger already",
    "An active mutually",
    "Your partner must",
    "Booking changed",
    "Capacity cannot",
    "Only the driver",
    "Only the passenger",
    "This ride",
    "Ride coordination is closed",
    "Drivers cannot",
    "Inactive rides",
    "Completed reservations",
    "One of these accounts",
    "Only the recipient",
    "Both partners",
    "This partner request",
    "Choose another active member",
    "Partner relationship unavailable",
    "Active membership required",
  ].some((prefix) => message.startsWith(prefix))
    ? message
    : "Could not update transport. Check your connection, refresh and try again.";
}

/** All writes use the existing member-authorised, transactional transport RPCs. */
export function TransportSection({
  post,
  userId,
  isAdmin,
  onChanged,
}: {
  post: ParentPost;
  userId: string;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [rides, setRides] = useState<Ride[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState<Ride | "new" | null>(null);
  const [modes, setModes] = useState<Record<string, Mode>>({});
  // A failed network response must retry with the same key and exact payload.
  const operations = useRef(new Map<string, string>());
  const mounted = useRef(true);
  const context = useRef("");
  context.current = `${post.id}:${userId}`;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const load = useCallback(async () => {
    const expectedContext = `${post.id}:${userId}`;
    const [offers, bookings, links, eventResult] = await Promise.all([
      db
        .from("ride_offers")
        .select("*")
        .eq("post_id", post.id)
        .order("created_at")
        .order("id"),
      db
        .from("ride_reservations")
        .select("id,ride_id,passenger_id,created_by,status")
        .eq("post_id", post.id)
        .order("created_at"),
      db
        .from("partner_relationships")
        .select("user_a,user_b")
        .eq("status", "confirmed")
        .or(`user_a.eq.${userId},user_b.eq.${userId}`)
        .maybeSingle(),
      db
        .from("events")
        .select("status,starts_at")
        .eq("post_id", post.id)
        .maybeSingle(),
    ]);
    if (offers.error || bookings.error || links.error || eventResult.error)
      throw new Error("Transport could not be loaded.");
    const nextRides = (offers.data || []) as Ride[];
    const nextReservations = (bookings.data || []) as Reservation[];
    const ids = [
      ...new Set([
        ...nextRides.map((r) => r.driver_id),
        ...nextReservations.map((r) => r.passenger_id),
      ]),
    ];
    const profiles = ids.length
      ? await db.from("profiles").select("id,display_name").in("id", ids)
      : { data: [], error: null };
    if (profiles.error) throw new Error("Passenger names unavailable.");
    if (!mounted.current || context.current !== expectedContext) return;
    setRides(nextRides);
    setReservations(nextReservations);
    setNames(
      Object.fromEntries(
        (profiles.data || []).map((p) => [p.id, p.display_name]),
      ),
    );
    setPartnerId(
      links.data
        ? links.data.user_a === userId
          ? links.data.user_b
          : links.data.user_a
        : null,
    );
    setEvent(eventResult.data as Event | null);
    setLoaded(true);
  }, [post.id, userId]);
  useEffect(() => {
    setLoaded(false);
    setRides([]);
    setReservations([]);
    setEditing(null);
    void load().catch(() => {
      if (mounted.current)
        setMessage("Transport could not be loaded. Refresh to try again.");
    });
  }, [load]);
  async function run(work: () => Promise<string>) {
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      const result = await work();
      try {
        await load();
        if (mounted.current) setMessage(result);
      } catch {
        if (mounted.current)
          setMessage(`${result} Refresh transport to see the latest details.`);
      }
      onChanged();
    } catch (error) {
      if (mounted.current) setMessage(failure(error));
    } finally {
      if (mounted.current) setPending(false);
    }
  }
  async function refresh() {
    if (pending) return;
    setPending(true);
    try {
      await load();
      if (mounted.current) setMessage("Transport refreshed.");
    } catch {
      if (mounted.current)
        setMessage(
          "Transport could not be loaded. Check your connection and try again.",
        );
    } finally {
      if (mounted.current) setPending(false);
    }
  }
  async function book(
    ride: Ride,
    mode: Mode,
    selected: Reservation[],
    switching: boolean,
  ) {
    const payload = {
      target_ride: ride.id,
      booking_mode: mode,
      ...(switching
        ? { expected_reservations: selected.map((r) => r.id).sort() }
        : {}),
    };
    const signature = JSON.stringify({
      action: switching ? "switch" : "book",
      ...payload,
    });
    const operation = operations.current.get(signature) || requestId();
    operations.current.set(signature, operation);
    await run(async () => {
      const result = await db.rpc(switching ? "switch_ride" : "book_ride", {
        ...payload,
        operation_id: operation,
      });
      if (result.error) throw result.error;
      // Old idempotent responses may refer to seats subsequently cancelled.
      const ids = result.data?.reservation_ids;
      if (!Array.isArray(ids) || ids.length !== (mode === "both" ? 2 : 1))
        throw new Error("Booking response unavailable");
      const current = await db
        .from("ride_reservations")
        .select("id", { count: "exact", head: true })
        .in("id", ids)
        .eq("ride_id", ride.id)
        .eq("status", "confirmed");
      if (current.error) throw current.error;
      if (current.count !== ids.length) {
        operations.current.delete(signature);
        return "This request was already processed. Review your current bookings; this retry did not change seats.";
      }
      operations.current.delete(signature);
      return switching
        ? "Ride changed. Your replacement seats are confirmed."
        : "Your seats are confirmed.";
    });
  }
  function cancel(reservation: Reservation) {
    Alert.alert(
      "Cancel reservation?",
      "This releases the selected passenger’s seat. Other reservations stay unchanged.",
      [
        { text: "Keep seat", style: "cancel" },
        {
          text: "Cancel reservation",
          style: "destructive",
          onPress: () =>
            void run(async () => {
              const result = await db.rpc("cancel_ride_reservation", {
                target_reservation: reservation.id,
              });
              if (result.error) throw result.error;
              return "Reservation cancelled. The seat is available again.";
            }),
        },
      ],
    );
  }
  function withdraw(ride: Ride) {
    Alert.alert(
      "Withdraw this ride?",
      "Confirmed passengers will need alternative transport. The ride and booking history will be retained.",
      [
        { text: "Keep ride", style: "cancel" },
        {
          text: "Withdraw ride",
          style: "destructive",
          onPress: () =>
            void run(async () => {
              const result = await db.rpc("withdraw_ride", {
                target_ride: ride.id,
              });
              if (result.error) throw result.error;
              if (editing !== "new" && editing?.id === ride.id)
                setEditing(null);
              return "Ride withdrawn. Affected passengers need alternative transport.";
            }),
        },
      ],
    );
  }
  const eligible =
    loaded &&
    post.ride_coordination_enabled &&
    post.status === "open" &&
    (post.post_type !== "event" ||
      Boolean(
        event &&
        event.status === "scheduled" &&
        new Date(event.starts_at).getTime() > Date.now(),
      ));
  if (loaded && !post.ride_coordination_enabled && rides.length === 0)
    return null;
  const ownHistory = reservations.filter(
    (r) =>
      r.passenger_id === userId ||
      (partnerId && r.passenger_id === partnerId && r.created_by === userId),
  );
  const current = reservations.filter(
    (r) =>
      activeReservation(r) &&
      (r.passenger_id === userId || r.passenger_id === partnerId),
  );
  return (
    <View style={s.section}>
      <Title>Ride coordination</Title>
      <Muted>
        Share the journey. Passenger seats exclude the driver. Ride bookings and
        event RSVPs are separate.
      </Muted>
      <Feedback message={message} />
      <Button
        title="Refresh transport"
        secondary
        disabled={pending}
        onPress={() => void refresh()}
      />
      {!loaded && <Muted>Loading transport…</Muted>}
      {loaded && !eligible && (
        <Body>
          New offers and bookings are closed. Existing transport history is
          retained.
        </Body>
      )}
      {ownHistory.length > 0 && (
        <Card>
          <Title>Your transport</Title>
          {ownHistory.map((r) => {
            const ride = rides.find((item) => item.id === r.ride_id);
            return (
              <View key={r.id} style={s.item}>
                <Body>
                  {r.passenger_id === userId
                    ? "You"
                    : names[r.passenger_id] || "Your partner"}{" "}
                  · {statusLabel(r.status)}
                </Body>
                <Muted>
                  {ride
                    ? `${names[ride.driver_id] || "Community driver"} · ${ride.pickup}`
                    : "Ride unavailable"}
                </Muted>
                {activeReservation(r) && (
                  <Button
                    title={
                      r.passenger_id === userId
                        ? "Cancel my reservation"
                        : "Cancel partner reservation"
                    }
                    secondary
                    disabled={pending}
                    onPress={() => cancel(r)}
                  />
                )}
              </View>
            );
          })}
          <Muted>
            To change rides, choose a replacement below. A failed switch keeps
            your original seats.
          </Muted>
        </Card>
      )}
      {loaded && !rides.length && (
        <Body>No rides offered yet. Can you help someone get there?</Body>
      )}
      {rides.map((ride) => {
        const confirmed = reservations.filter(
          (r) => r.ride_id === ride.id && r.status === "confirmed",
        );
        const historical = reservations.filter(
          (r) => r.ride_id === ride.id && r.status !== "confirmed",
        );
        const ownDriver = ride.driver_id === userId;
        const mode = modes[ride.id] || (ownDriver ? "partner" : "self");
        const selected = current.filter(
          (r) =>
            mode === "both" ||
            (mode === "self"
              ? r.passenger_id === userId
              : r.passenger_id === partnerId),
        );
        const switching = selected.some((r) => r.ride_id !== ride.id);
        const allowed = selected.every(
          (r) =>
            r.ride_id === ride.id ||
            r.passenger_id === userId ||
            r.created_by === userId,
        );
        const already =
          selected.length === (mode === "both" ? 2 : 1) &&
          selected.every(
            (r) => r.ride_id === ride.id && r.status === "confirmed",
          );
        const bookable =
          eligible &&
          ride.status === "open" &&
          (!ride.departure_at ||
            new Date(ride.departure_at).getTime() > Date.now());
        const options = [
          ...(!ownDriver ? [{ label: "Just me", value: "self" }] : []),
          ...(partnerId && !ownDriver
            ? [{ label: "Me and my partner", value: "both" }]
            : []),
          ...(partnerId
            ? [{ label: "My partner only", value: "partner" }]
            : []),
        ];
        return (
          <Card key={ride.id}>
            <Title>{names[ride.driver_id] || "Community driver"}</Title>
            <Body>
              {statusLabel(ride.status)} · {ride.pickup}
            </Body>
            <Body>
              {dateLabel(ride.departure_at, ride.timezone)} · {ride.timezone}
            </Body>
            {!!ride.route && <Body>Route: {ride.route}</Body>}
            <Body>
              {bookable
                ? `${Math.max(0, ride.capacity - confirmed.length)} available`
                : "Unavailable"}{" "}
              · {ride.capacity} passenger seats total
            </Body>
            {ride.return_available && (
              <Body>
                Return trip available ·{" "}
                {dateLabel(ride.return_departure_at, ride.timezone)}
                {ride.return_details ? ` · ${ride.return_details}` : ""}
              </Body>
            )}
            {ride.contribution_amount !== null && (
              <Body>
                Suggested contribution: {ride.contribution_currency}{" "}
                {Number(ride.contribution_amount).toFixed(2)} (informational
                only)
              </Body>
            )}
            {!!ride.cost_notes && <Body>{ride.cost_notes}</Body>}
            {!!ride.notes && <Body>Passenger notes: {ride.notes}</Body>}
            {ride.status === "open" && ride.needs_reconfirmation && (
              <Body>
                Event details changed. The driver needs to review these
                arrangements. Departure details have not changed automatically.
              </Body>
            )}
            <Body>Confirmed passengers</Body>
            {confirmed.length ? (
              confirmed.map((r) => (
                <View key={r.id} style={s.item}>
                  <Body>• {names[r.passenger_id] || "Community member"}</Body>
                  {isAdmin && r.passenger_id !== userId && (
                    <Button
                      title={`Cancel ${names[r.passenger_id] || "passenger"} reservation`}
                      secondary
                      disabled={pending}
                      onPress={() => cancel(r)}
                    />
                  )}
                </View>
              ))
            ) : (
              <Muted>No confirmed passengers.</Muted>
            )}
            {historical.length > 0 && (
              <View style={s.item}>
                <Muted>Passenger history</Muted>
                {historical.map((r) => (
                  <Muted key={r.id}>
                    {names[r.passenger_id] || "Community member"} ·{" "}
                    {statusLabel(r.status)}
                  </Muted>
                ))}
              </View>
            )}
            {bookable && options.length > 0 ? (
              <View style={s.item}>
                <Select
                  label="Who needs a seat?"
                  value={mode}
                  onChange={(value) =>
                    setModes((previous) => ({
                      ...previous,
                      [ride.id]: value as Mode,
                    }))
                  }
                  options={options}
                />
                {switching && (
                  <Muted>
                    {mode === "both"
                      ? "Switch both passengers together."
                      : "Change only the selected passenger’s ride."}{" "}
                    Existing seats remain if the replacement fails.
                  </Muted>
                )}
                {!allowed && (
                  <Body>
                    Your partner must manage the booking they created
                    themselves.
                  </Body>
                )}
                <Button
                  title={
                    already
                      ? "Already booked"
                      : switching
                        ? mode === "both"
                          ? "Switch both passengers"
                          : "Change ride"
                        : "Book seats"
                  }
                  disabled={pending || !allowed || already}
                  onPress={() => void book(ride, mode, selected, switching)}
                />
              </View>
            ) : (
              <Muted>
                {bookable && ownDriver
                  ? "You’re driving this ride."
                  : "This ride is unavailable for new bookings."}
              </Muted>
            )}
            {(ownDriver || isAdmin) && ride.status === "open" && (
              <View style={s.item}>
                {eligible && (
                  <Button
                    title="Edit ride"
                    secondary
                    disabled={pending}
                    onPress={() => setEditing(ride)}
                  />
                )}
                <Button
                  title="Withdraw ride"
                  secondary
                  disabled={pending}
                  onPress={() => withdraw(ride)}
                />
              </View>
            )}
          </Card>
        );
      })}
      {eligible && !editing && (
        <Button
          title="Offer a Ride"
          disabled={pending}
          onPress={() => setEditing("new")}
        />
      )}
      {eligible && editing && (
        <RideEditor
          key={editing === "new" ? "new" : editing.id}
          ride={editing === "new" ? undefined : editing}
          disabled={pending}
          onClose={() => setEditing(null)}
          onSave={async (content) => {
            const payload = {
              target_id: editing === "new" ? null : editing.id,
              target_post: post.id,
              content,
            };
            const signature = JSON.stringify({ action: "write", ...payload });
            const operation = operations.current.get(signature) || requestId();
            operations.current.set(signature, operation);
            await run(async () => {
              const result = await db.rpc("write_ride", {
                ...payload,
                operation_id: operation,
              });
              if (result.error) throw result.error;
              operations.current.delete(signature);
              setEditing(null);
              return "Ride saved.";
            });
          }}
        />
      )}
    </View>
  );
}

function RideEditor({
  ride,
  disabled,
  onClose,
  onSave,
}: {
  ride?: Ride;
  disabled: boolean;
  onClose: () => void;
  onSave: (content: Record<string, unknown>) => Promise<void>;
}) {
  const local = (value: string | null | undefined) =>
    value
      ? Temporal.Instant.from(value)
          .toZonedDateTimeISO(ride?.timezone || "Pacific/Auckland")
          .toPlainDateTime()
          .toString({ smallestUnit: "minute" })
      : "";
  const [values, setValues] = useState({
    pickup: ride?.pickup || "",
    capacity: String(ride?.capacity || 1),
    departure: local(ride?.departure_at),
    timezone: ride?.timezone || "Pacific/Auckland",
    route: ride?.route || "",
    returning: ride?.return_available ? "yes" : "no",
    returnDeparture: local(ride?.return_departure_at),
    return_details: ride?.return_details || "",
    contribution_amount: ride?.contribution_amount?.toString() || "",
    contribution_currency: ride?.contribution_currency || "NZD",
    cost_notes: ride?.cost_notes || "",
    notes: ride?.notes || "",
  });
  const [error, setError] = useState("");
  function field(
    key: keyof typeof values,
    label: string,
    multiline = false,
    keyboardType?: "numeric" | "decimal-pad",
  ) {
    return (
      <Field
        label={label}
        value={values[key]}
        onChangeText={(value) =>
          setValues((previous) => ({ ...previous, [key]: value }))
        }
        multiline={multiline}
        keyboardType={keyboardType}
      />
    );
  }
  async function save() {
    setError("");
    const capacity = Number(values.capacity);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 2147483647)
      return setError("Passenger capacity must be a positive whole number.");
    if (
      !values.pickup.trim() ||
      values.pickup.trim().length > 300 ||
      values.route.length > 1000 ||
      values.return_details.length > 1000 ||
      values.cost_notes.length > 500 ||
      values.notes.length > 2000
    )
      return setError(
        "Check the pickup and detail lengths: pickup 300, route/return 1,000, contribution notes 500 and passenger notes 2,000 characters maximum.",
      );
    const currency = values.contribution_currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency))
      return setError("Use a three-letter currency, for example NZD.");
    if (
      values.contribution_amount &&
      !/^\d{1,8}(\.\d{1,2})?$/.test(values.contribution_amount)
    )
      return setError(
        "Suggested contribution must be a positive amount with at most two decimal places.",
      );
    let departure: string | null = null,
      returnDeparture: string | null = null;
    try {
      // Reject skipped and repeated local times instead of silently shifting them.
      const instant = (text: string) =>
        text
          ? Temporal.PlainDateTime.from(text)
              .toZonedDateTime(values.timezone.trim(), {
                disambiguation: "reject",
              })
              .toInstant()
              .toString()
          : null;
      // Validate the IANA timezone even when no departure is provided.
      Temporal.Now.instant().toZonedDateTimeISO(values.timezone.trim());
      departure = instant(values.departure.trim());
      returnDeparture =
        values.returning === "yes"
          ? instant(values.returnDeparture.trim())
          : null;
      if (
        departure &&
        returnDeparture &&
        Temporal.Instant.compare(returnDeparture, departure) <= 0
      )
        return setError("Return departure must be after departure.");
    } catch {
      return setError(
        "Enter dates as YYYY-MM-DDTHH:mm and a valid IANA timezone. Daylight-saving skipped or repeated times need another time.",
      );
    }
    await onSave({
      pickup: values.pickup.trim(),
      capacity,
      departure_at: departure,
      timezone: values.timezone.trim(),
      route: values.route,
      return_available: values.returning === "yes",
      return_departure_at: returnDeparture,
      return_details: values.returning === "yes" ? values.return_details : "",
      contribution_amount: values.contribution_amount
        ? Number(values.contribution_amount)
        : null,
      contribution_currency: currency,
      cost_notes: values.cost_notes,
      notes: values.notes,
    });
  }
  return (
    <Card>
      <Title>{ride ? "Edit ride" : "Offer a Ride"}</Title>
      <Feedback message={error} />
      {field("pickup", "Pickup location")}
      {field(
        "capacity",
        "Passenger seats (excluding driver)",
        false,
        "numeric",
      )}
      {field("departure", "Departure (optional, YYYY-MM-DDTHH:mm)")}
      {field("timezone", "Ride timezone (e.g. Pacific/Auckland)")}
      {field("route", "Route or extra pickup details (optional)", true)}
      <Select
        label="Return trip available"
        value={values.returning}
        options={[
          { label: "No", value: "no" },
          { label: "Yes", value: "yes" },
        ]}
        onChange={(value) =>
          setValues((previous) => ({ ...previous, returning: value }))
        }
      />
      {values.returning === "yes" && (
        <>
          {field(
            "returnDeparture",
            "Return departure (optional, YYYY-MM-DDTHH:mm)",
          )}
          {field("return_details", "Return pickup or drop-off details", true)}
        </>
      )}
      {field(
        "contribution_amount",
        "Suggested contribution (optional)",
        false,
        "decimal-pad",
      )}
      {field("contribution_currency", "Currency")}
      <Muted>
        Informational only. Arrange contributions directly with your driver.
      </Muted>
      {field("cost_notes", "Contribution notes (optional)", true)}
      {field("notes", "Passenger notes (optional)", true)}
      {ride?.needs_reconfirmation && (
        <Body>
          Saving confirms that you reviewed the changed event details.
        </Body>
      )}
      <Button
        title={ride ? "Save ride" : "Offer a Ride"}
        disabled={disabled}
        onPress={() => void save()}
      />
      <Button
        title="Close form"
        secondary
        disabled={disabled}
        onPress={onClose}
      />
    </Card>
  );
}

export function PartnerScreen({ userId }: { userId: string }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [links, setLinks] = useState<Relationship[]>([]);
  const [target, setTarget] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load = useCallback(async () => {
    const [candidates, relationships] = await Promise.all([
      db.rpc("partner_candidates"),
      db
        .from("partner_relationships")
        .select("id,user_a,user_b,requested_by,status")
        .order("created_at", { ascending: false }),
    ]);
    if (candidates.error || relationships.error)
      throw candidates.error || relationships.error;
    if (!alive.current) return;
    setPeople((candidates.data || []) as Person[]);
    setLinks((relationships.data || []) as Relationship[]);
    setLoaded(true);
  }, []);
  useEffect(() => {
    void load().catch(() => {
      if (alive.current)
        setMessage(
          "Partner settings could not be loaded. Refresh to try again.",
        );
    });
  }, [load]);
  async function act(
    intent: "request" | "accept" | "decline" | "unlink",
    id: string,
  ) {
    if (pending || !id) return;
    setPending(true);
    setMessage("");
    try {
      const result =
        intent === "request"
          ? await db.rpc("request_partner", { target_user: id })
          : intent === "unlink"
            ? await db.rpc("unlink_partner", { target_relationship: id })
            : await db.rpc("respond_partner", {
                target_relationship: id,
                decision: intent,
              });
      if (result.error) throw result.error;
      await load();
      if (alive.current)
        setMessage(
          intent === "request"
            ? "Partner request sent. The other member must accept."
            : intent === "accept"
              ? "Partner link confirmed."
              : intent === "decline"
                ? "Partner request declined."
                : "Partner link ended. Existing reservations are unchanged.",
        );
    } catch (error) {
      if (alive.current) setMessage(failure(error));
    } finally {
      if (alive.current) setPending(false);
    }
  }
  function unlink(link: Relationship) {
    Alert.alert(
      link.status === "confirmed" ? "Unlink partner?" : "Cancel request?",
      "Existing reservations stay unchanged. Delegated access to partner bookings ends immediately.",
      [
        { text: "Keep link", style: "cancel" },
        {
          text: link.status === "confirmed" ? "Unlink" : "Cancel request",
          style: "destructive",
          onPress: () => void act("unlink", link.id),
        },
      ],
    );
  }
  const names = new Map(people.map((p) => [p.id, p.display_name]));
  const other = (link: Relationship) =>
    names.get(link.user_a === userId ? link.user_b : link.user_a) ||
    "Community member";
  const confirmed = links.find((link) => link.status === "confirmed");
  const requests = links.filter((link) => link.status === "pending");
  return (
    <View style={s.section}>
      <Title>Linked partner</Title>
      <Body>
        Link with one community member to book transport together. Both members
        must agree. Linking is optional.
      </Body>
      <Muted>
        Your partner may change or cancel reservations they created while your
        link is active. You can always manage your own seats. Unlinking keeps
        existing bookings and ends delegated access immediately.
      </Muted>
      <Feedback message={message} />
      <Button
        title="Refresh partner settings"
        secondary
        disabled={pending}
        onPress={() => {
          setMessage("");
          void load().catch(() =>
            setMessage("Partner settings could not be loaded."),
          );
        }}
      />
      {!loaded && <Muted>Loading partner settings…</Muted>}
      {confirmed ? (
        <Card>
          <Title>Linked with {other(confirmed)}</Title>
          <Button
            title="Unlink partner"
            secondary
            disabled={pending}
            onPress={() => unlink(confirmed)}
          />
        </Card>
      ) : (
        loaded && (
          <Card>
            <Title>Request a partner link</Title>
            <Select
              label="Community member"
              value={target}
              onChange={setTarget}
              options={[
                { label: "Choose a member", value: "" },
                ...people
                  .filter((p) => p.id !== userId)
                  .map((p) => ({ label: p.display_name, value: p.id })),
              ]}
            />
            <Button
              title="Send partner request"
              disabled={pending || !target}
              onPress={() => void act("request", target)}
            />
          </Card>
        )
      )}
      <Title>Pending requests</Title>
      {loaded && !requests.length && (
        <Muted>No pending partner requests.</Muted>
      )}
      {requests.map((link) => (
        <Card key={link.id}>
          <Title>{other(link)}</Title>
          {link.requested_by === userId ? (
            <>
              <Body>Waiting for their acceptance.</Body>
              <Button
                title="Cancel request"
                secondary
                disabled={pending}
                onPress={() => unlink(link)}
              />
            </>
          ) : (
            <>
              <Body>Would like to link with you.</Body>
              <Button
                title="Accept request"
                disabled={pending}
                onPress={() => void act("accept", link.id)}
              />
              <Button
                title="Decline request"
                secondary
                disabled={pending}
                onPress={() => void act("decline", link.id)}
              />
            </>
          )}
        </Card>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  section: { gap: 16, paddingVertical: 12 },
  item: { gap: 8, paddingVertical: 8 },
});
