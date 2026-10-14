import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireMember } from "@/lib/auth";
import { SubmitButton } from "@/components/submit-button";
import {
  formatDate,
  label,
  type PostRow,
  type EventRow,
} from "@/features/posts/model";
import { RideForm } from "./ride-form";
import { BookingForm } from "./booking-form";
import { manageRide } from "./actions";
import type { Ride, Reservation, BookingReference } from "./model";
export async function RideCoordination({
  post,
  event,
  session,
}: {
  post: PostRow;
  event: EventRow | null;
  session: Awaited<ReturnType<typeof requireMember>>;
}) {
  const { db, user, membership } = session;
  const [offers, bookings, links] = await Promise.all([
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
      .or(`user_a.eq.${user.id},user_b.eq.${user.id}`)
      .maybeSingle(),
  ]);
  if (offers.error || bookings.error || links.error)
    throw new Error("Transport could not be loaded.");
  const rides = (offers.data || []) as Ride[],
    reservations = (bookings.data || []) as Reservation[];
  if (!post.ride_coordination_enabled && !rides.length) return null;
  const partnerId = links.data
    ? links.data.user_a === user.id
      ? links.data.user_b
      : links.data.user_a
    : null;
  const people = [
    ...new Set([
      ...rides.map((r) => r.driver_id),
      ...reservations.map((r) => r.passenger_id),
    ]),
  ];
  const profiles = people.length
    ? await db.from("profiles").select("id,display_name").in("id", people)
    : { data: [], error: null };
  if (profiles.error) throw new Error("Passenger names unavailable.");
  const names = new Map(
    (profiles.data || []).map((p) => [p.id, p.display_name]),
  );
  const active = reservations.filter((r) =>
    ["confirmed", "needs_arrangement"].includes(r.status),
  );
  const current: BookingReference[] = active
    .filter((r) => r.passenger_id === user.id || r.passenger_id === partnerId)
    .map((r) => ({
      id: r.id,
      ride_id: r.ride_id,
      scope: r.passenger_id === user.id ? "self" : "partner",
      manageable: r.passenger_id === user.id || r.created_by === user.id,
    }));
  const eligible =
    post.ride_coordination_enabled &&
    post.status === "open" &&
    (!event ||
      (event.status === "scheduled" &&
        new Date(event.starts_at).getTime() > Date.now()));
  const ownHistory = reservations.filter(
    (r) =>
      r.passenger_id === user.id ||
      (r.passenger_id === partnerId && r.created_by === user.id),
  );
  return (
    <section
      id="rides"
      className="card ride-coordination"
      aria-labelledby="rides-title"
    >
      <h2 id="rides-title">Ride coordination</h2>
      <p className="muted">
        Share the journey. Passenger seats exclude the driver. Ride bookings and
        event RSVPs are separate.
      </p>
      {!eligible && (
        <p className="message">
          New ride offers and bookings are closed for this post. Existing
          transport history is retained.
        </p>
      )}
      <p>
        <Link href="/settings/partner">Manage linked partner</Link>
      </p>
      {ownHistory.length > 0 && (
        <section aria-label="Your transport" className="transport-summary">
          <h3>Your transport</h3>
          {ownHistory.map((r) => {
            const ride = rides.find((o) => o.id === r.ride_id);
            const manageable = ["confirmed", "needs_arrangement"].includes(
              r.status,
            );
            return (
              <div className="reservation-row" key={r.id}>
                <p>
                  <strong>
                    {r.passenger_id === user.id
                      ? "You"
                      : names.get(r.passenger_id)}
                  </strong>{" "}
                  ·{" "}
                  {r.status === "needs_arrangement"
                    ? "Alternative transport needed"
                    : label(r.status)}{" "}
                  ·{" "}
                  {ride
                    ? `${names.get(ride.driver_id)} — ${ride.pickup}`
                    : "Ride unavailable"}
                </p>
                {manageable && (
                  <form action={manageRide}>
                    <input type="hidden" name="post_id" value={post.id} />
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="intent" value="cancel" />
                    <SubmitButton variant="outline">
                      {r.passenger_id === user.id
                        ? "Cancel my reservation"
                        : "Cancel partner reservation"}
                    </SubmitButton>
                  </form>
                )}
              </div>
            );
          })}
          <p className="muted">
            To change rides, choose the replacement below. A failed switch keeps
            your existing seats.
          </p>
        </section>
      )}
      {!rides.length && (
        <p>No rides offered yet. Can you help someone get there?</p>
      )}
      <div className="ride-cards">
        {rides.map((ride) => {
          const confirmed = reservations.filter(
            (r) => r.ride_id === ride.id && r.status === "confirmed",
          );
          const historical = reservations.filter(
            (r) => r.ride_id === ride.id && r.status !== "confirmed",
          );
          const available = Math.max(0, ride.capacity - confirmed.length);
          const bookable =
            eligible &&
            ride.status === "open" &&
            (!ride.departure_at ||
              new Date(ride.departure_at).getTime() > Date.now());
          const canManage =
            ride.driver_id === user.id || membership.role === "admin";
          return (
            <article key={ride.id} className="ride-card" data-ride-id={ride.id}>
              <div className="row">
                <h3>{names.get(ride.driver_id) || "Community driver"}</h3>
                <span className="badge">{label(ride.status)}</span>
              </div>
              <p>
                <strong>{ride.pickup}</strong>
              </p>
              <p>
                {ride.departure_at ? (
                  <>
                    <time dateTime={ride.departure_at}>
                      {formatDate(ride.departure_at, ride.timezone, true)}
                    </time>{" "}
                    · {ride.timezone}
                  </>
                ) : (
                  "Departure time to be arranged"
                )}
              </p>
              {ride.route && (
                <p className="preserve-lines">Route: {ride.route}</p>
              )}
              <p className="seat-count">
                <strong>
                  {bookable ? `${available} available` : "Unavailable"}
                </strong>{" "}
                · {ride.capacity} passenger{" "}
                {ride.capacity === 1 ? "seat" : "seats"} total
              </p>
              {ride.return_available && (
                <p>
                  Return trip available
                  {ride.return_departure_at
                    ? ` · ${formatDate(ride.return_departure_at, ride.timezone, true)}`
                    : ""}
                  {ride.return_details ? ` · ${ride.return_details}` : ""}
                </p>
              )}
              {ride.contribution_amount !== null && (
                <p>
                  Suggested contribution:{" "}
                  <strong>
                    {ride.contribution_currency}{" "}
                    {Number(ride.contribution_amount).toFixed(2)}
                  </strong>{" "}
                  (informational)
                </p>
              )}
              {ride.cost_notes && (
                <p className="preserve-lines">{ride.cost_notes}</p>
              )}
              {ride.notes && (
                <p className="preserve-lines">Passenger notes: {ride.notes}</p>
              )}
              {ride.status === "open" && ride.needs_reconfirmation && (
                <p className="message">
                  Event details changed. The driver needs to review these
                  transport arrangements. Departure details have not been
                  changed automatically.
                </p>
              )}
              <h4>Confirmed passengers</h4>
              {confirmed.length ? (
                <ul className="passenger-list">
                  {confirmed.map((r) => (
                    <li key={r.id}>
                      {names.get(r.passenger_id) || "Community member"}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No confirmed passengers.</p>
              )}
              {historical.length > 0 && (
                <details>
                  <summary>Passenger history</summary>
                  <ul className="passenger-list">
                    {historical.map((r) => (
                      <li key={r.id}>
                        {names.get(r.passenger_id) || "Community member"} ·{" "}
                        {r.status === "needs_arrangement"
                          ? "Alternative transport needed"
                          : label(r.status)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {bookable &&
              (ride.driver_id !== user.id || Boolean(partnerId)) ? (
                <BookingForm
                  rideId={ride.id}
                  postId={post.id}
                  operationId={randomUUID()}
                  hasPartner={Boolean(partnerId)}
                  current={current}
                  isDriver={ride.driver_id === user.id}
                />
              ) : (
                <p className="muted">
                  {bookable && ride.driver_id === user.id
                    ? "You’re driving this ride."
                    : "This ride is unavailable for new bookings."}
                </p>
              )}
              {canManage && ride.status === "open" && (
                <div className="ride-management">
                  {eligible && (
                    <details>
                      <summary>Edit ride</summary>
                      <RideForm
                        postId={post.id}
                        operationId={randomUUID()}
                        ride={ride}
                      />
                    </details>
                  )}
                  <details>
                    <summary>Withdraw ride</summary>
                    <form action={manageRide}>
                      <input type="hidden" name="post_id" value={post.id} />
                      <input type="hidden" name="id" value={ride.id} />
                      <input type="hidden" name="intent" value="withdraw" />
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          name="confirm"
                          value="yes"
                          required
                        />
                        Withdraw this ride. Passengers will need alternative
                        transport.
                      </label>
                      <SubmitButton variant="outline">
                        Confirm withdrawal
                      </SubmitButton>
                    </form>
                  </details>
                </div>
              )}
              {membership.role === "admin" &&
                confirmed.some((r) => r.passenger_id !== user.id) && (
                  <details>
                    <summary>Manage passenger reservations</summary>
                    {confirmed
                      .filter((r) => r.passenger_id !== user.id)
                      .map((r) => (
                        <form action={manageRide} key={r.id}>
                          <p>{names.get(r.passenger_id)}</p>
                          <input type="hidden" name="post_id" value={post.id} />
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="intent" value="cancel" />
                          <SubmitButton variant="outline">
                            Cancel passenger reservation
                          </SubmitButton>
                        </form>
                      ))}
                  </details>
                )}
            </article>
          );
        })}
      </div>
      {eligible && (
        <details className="offer-ride">
          <summary>Offer a Ride</summary>
          <RideForm postId={post.id} operationId={randomUUID()} />
        </details>
      )}
    </section>
  );
}
