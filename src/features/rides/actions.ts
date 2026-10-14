"use server";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import type { RideState } from "./model";
const uuid = z.uuid();
function refresh(post: string) {
  revalidatePath(`/posts/${post}`);
  revalidatePath("/notifications");
}
function friendly(message: string) {
  const prefixes = [
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
    "Operation key",
  ];
  return prefixes.some((p) => message.startsWith(p))
    ? message + "."
    : "Could not update transport. Refresh and check the details and your permissions.";
}
export async function saveRide(
  _previous: RideState,
  form: FormData,
): Promise<RideState> {
  const { db } = await requireMember();
  const post = uuid.safeParse(form.get("post_id")),
    operation = uuid.safeParse(form.get("operation_id"));
  const rawId = String(form.get("ride_id") || "");
  if (
    !post.success ||
    !operation.success ||
    (rawId && !uuid.safeParse(rawId).success)
  )
    return { error: "Invalid ride reference. Refresh and try again." };
  const capacity = Number(form.get("capacity"));
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 2147483647)
    return { error: "Passenger capacity must be a positive whole number." };
  const details = z
    .object({
      pickup: z.string().trim().min(1).max(300),
      route: z.string().max(1000),
      return_details: z.string().max(1000),
      cost_notes: z.string().max(500),
      notes: z.string().max(2000),
      timezone: z.string().min(1).max(100),
      contribution_currency: z.string().regex(/^[A-Z]{3}$/),
    })
    .safeParse(
      Object.fromEntries(
        [
          "pickup",
          "route",
          "return_details",
          "cost_notes",
          "notes",
          "timezone",
          "contribution_currency",
        ].map((k) => [k, String(form.get(k) || "")]),
      ),
    );
  if (!details.success)
    return {
      error: "Check the pickup, timezone, currency and detail lengths.",
    };
  const amountText = String(form.get("contribution_amount") || "");
  if (amountText && !/^\d{1,8}(\.\d{1,2})?$/.test(amountText))
    return {
      error:
        "Suggested contribution must be a positive amount with at most two decimal places.",
    };
  const content: Record<string, unknown> = {
    ...details.data,
    capacity,
    return_available: form.get("return_available") === "yes",
    contribution_amount: amountText ? Number(amountText) : null,
  };
  try {
    for (const [input, column] of [
      ["departure_local", "departure_at"],
      ["return_local", "return_departure_at"],
    ]) {
      const text = String(form.get(input) || "");
      content[column] = text
        ? Temporal.PlainDateTime.from(text)
            .toZonedDateTime(details.data.timezone, {
              disambiguation: "reject",
            })
            .toInstant()
            .toString()
        : null;
    }
    if (
      content.return_departure_at &&
      content.departure_at &&
      String(content.return_departure_at) <= String(content.departure_at)
    )
      return { error: "Return departure must be after departure." };
  } catch {
    return {
      error:
        "Choose valid dates and an IANA timezone. Times skipped or repeated by daylight saving need a different time.",
    };
  }
  const { error } = await db.rpc("write_ride", {
    target_id: rawId || null,
    target_post: post.data,
    content,
    operation_id: operation.data,
  });
  if (error) return { error: friendly(error.message) };
  refresh(post.data);
  redirect(`/posts/${post.data}?message=Ride+saved#rides`);
}
export async function reserveRide(
  _previous: RideState,
  form: FormData,
): Promise<RideState> {
  const { db } = await requireMember();
  const post = uuid.safeParse(form.get("post_id")),
    ride = uuid.safeParse(form.get("ride_id")),
    operation = uuid.safeParse(form.get("operation_id")),
    mode = z
      .enum(["self", "both", "partner"])
      .safeParse(form.get("booking_mode"));
  if (!post.success || !ride.success || !operation.success || !mode.success)
    return { error: "Invalid booking details. Refresh and try again." };
  const switching = form.get("intent") === "switch";
  const expected = z
    .array(uuid)
    .max(2)
    .safeParse(form.getAll("expected_reservation"));
  if (!expected.success)
    return { error: "Invalid previous booking. Refresh and try again." };
  const { data: target } = await db
    .from("ride_offers")
    .select("post_id")
    .eq("id", ride.data)
    .maybeSingle();
  if (target?.post_id !== post.data) return { error: "Ride unavailable." };
  const { data, error } = await db.rpc(
    switching ? "switch_ride" : "book_ride",
    {
      target_ride: ride.data,
      booking_mode: mode.data,
      operation_id: operation.data,
      ...(switching ? { expected_reservations: expected.data } : {}),
    },
  );
  refresh(post.data);
  if (error) return { error: friendly(error.message) };
  // A retried operation may refer to seats subsequently cancelled or switched.
  // Read current committed state before presenting a fresh confirmation.
  const result = z
    .object({ reservation_ids: z.array(uuid).min(1).max(2) })
    .safeParse(data);
  if (!result.success)
    return {
      error: "Booking response unavailable. Refresh your transport details.",
    };
  const current = await db
    .from("ride_reservations")
    .select("id", { count: "exact", head: true })
    .in("id", result.data.reservation_ids)
    .eq("ride_id", ride.data)
    .eq("status", "confirmed");
  if (current.error || current.count !== result.data.reservation_ids.length)
    return {
      error:
        "This booking request was already processed. Review your current reservations; no seats were changed by this retry.",
    };

  redirect(
    `/posts/${post.data}?message=${switching ? "Ride+changed" : "Booking+confirmed"}#rides`,
  );
}
export async function manageRide(form: FormData) {
  const { db } = await requireMember();
  const id = uuid.safeParse(form.get("id")),
    post = uuid.safeParse(form.get("post_id"));
  if (!id.success || !post.success)
    throw new Error("Invalid transport reference");
  const withdrawing = form.get("intent") === "withdraw";
  if (withdrawing && form.get("confirm") !== "yes")
    redirect(`/posts/${post.data}?message=Confirm+withdrawal#rides`);
  const { error } = await db.rpc(
    withdrawing ? "withdraw_ride" : "cancel_ride_reservation",
    withdrawing ? { target_ride: id.data } : { target_reservation: id.data },
  );
  refresh(post.data);
  redirect(
    `/posts/${post.data}?message=${encodeURIComponent(error ? friendly(error.message) : withdrawing ? "Ride withdrawn. Passengers need alternative transport." : "Reservation cancelled.")}#rides`,
  );
}
