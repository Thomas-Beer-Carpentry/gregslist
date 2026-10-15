import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname));
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  options,
);
const client = () =>
  createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
const tag = randomBytes(6).toString("hex"),
  password = randomBytes(24).toString("base64url");
const users = [],
  posts = [];
let host, driver, driver2, a, b, c, d, admin, pending, category;
async function member(name, role = "member", active = true) {
  const { data, error } = await service.auth.admin.createUser({
    email: `rides-${name}-${tag}@example.test`,
    password,
    email_confirm: true,
  });
  assert.ifError(error);
  users.push(data.user.id);
  assert.ifError(
    (
      await service
        .from("profiles")
        .insert({ id: data.user.id, display_name: name })
    ).error,
  );
  if (active)
    assert.ifError(
      (
        await service
          .from("memberships")
          .insert({ user_id: data.user.id, role })
      ).error,
    );
  const db = client();
  assert.ifError(
    (await db.auth.signInWithPassword({ email: data.user.email, password }))
      .error,
  );
  return { id: data.user.id, db };
}
function content(extra = {}) {
  return {
    post_type: "trip",
    title: `Ride trip ${tag}`,
    description: "Private transport plans",
    category_id: category,
    status: "open",
    ride_coordination_enabled: true,
    ...extra,
  };
}
async function post(extra = {}) {
  const r = await host.db.rpc("write_post", {
    target_id: null,
    content: content(extra),
  });
  assert.ifError(r.error);
  posts.push(r.data);
  return r.data;
}
async function ride(postId, capacity = 2, person = driver, extra = {}) {
  const r = await person.db.rpc("write_ride", {
    target_id: null,
    target_post: postId,
    content: {
      capacity,
      pickup: "Park gates",
      timezone: "Pacific/Auckland",
      ...extra,
    },
    operation_id: randomUUID(),
  });
  assert.ifError(r.error);
  return r.data;
}
const book = (person, id, mode = "self", key = randomUUID()) =>
  person.db.rpc("book_ride", {
    target_ride: id,
    booking_mode: mode,
    operation_id: key,
  });
async function rows(postId, status = "confirmed") {
  const r = await service
    .from("ride_reservations")
    .select("*")
    .eq("post_id", postId)
    .eq("status", status);
  assert.ifError(r.error);
  return r.data;
}
async function link(x, y) {
  const r = await x.db.rpc("request_partner", { target_user: y.id });
  assert.ifError(r.error);
  assert.ifError(
    (
      await y.db.rpc("respond_partner", {
        target_relationship: r.data,
        decision: "accept",
      })
    ).error,
  );
  return r.data;
}
async function unlink(person, id) {
  assert.ifError(
    (await person.db.rpc("unlink_partner", { target_relationship: id })).error,
  );
}
before(async () => {
  host = await member("host");
  driver = await member("driver");
  driver2 = await member("driver2");
  a = await member("a");
  b = await member("b");
  c = await member("c");
  d = await member("d");
  admin = await member("admin", "admin");
  pending = await member("pending", "member", false);
  category = (await service.from("categories").select("id").limit(1).single())
    .data.id;
});
after(async () => {
  await service.from("transport_operations").delete().in("actor_id", users);
  await service.from("ride_reservation_history").delete().in("post_id", posts);
  await service.from("notifications").delete().in("recipient_id", users);
  await service.from("ride_reservations").delete().in("post_id", posts);
  await service.from("ride_offers").delete().in("post_id", posts);
  await service.from("event_rsvps").delete().in("event_id", posts);
  for (const id of posts) await host.db.rpc("delete_post", { target_id: id });
  const rel = await service
    .from("partner_relationships")
    .select("id")
    .in("user_a", users);
  await service.from("partner_participants").delete().in("user_id", users);
  await service
    .from("partner_relationships")
    .delete()
    .in(
      "id",
      (rel.data || []).map((r) => r.id),
    );
  await service.from("memberships").delete().in("user_id", users);
  await service.from("profiles").delete().in("id", users);
  for (const id of users) await service.auth.admin.deleteUser(id);
});
test("ordinary post persists optional coordination and supports multiple drivers", async () => {
  const id = await post();
  assert.equal(
    (
      await host.db
        .from("posts")
        .select("ride_coordination_enabled")
        .eq("id", id)
        .single()
    ).data.ride_coordination_enabled,
    true,
  );
  const first = await ride(id, 2),
    second = await ride(id, 1, driver2);
  assert.notEqual(first, second);
  assert.equal(
    (await a.db.from("ride_offers").select("id").eq("post_id", id)).data.length,
    2,
  );
});
test("partner status changes create recipient-private updates without duplicate notices", async () => {
  const sender = await member("notice-sender");
  const recipient = await member("notice-recipient");
  const notices = async (person) => {
    const result = await person.db
      .from("notifications")
      .select("kind,message,recipient_id")
      .like("kind", "partner_%");
    assert.ifError(result.error);
    return result.data;
  };
  const request = await sender.db.rpc("request_partner", {
    target_user: recipient.id,
  });
  assert.ifError(request.error);
  assert.deepEqual(
    (await notices(recipient)).map((row) => row.kind),
    ["partner_requested"],
  );
  assert.deepEqual(await notices(sender), []);
  assert.deepEqual(await notices(c), []);
  assert.ifError(
    (
      await recipient.db.rpc("respond_partner", {
        target_relationship: request.data,
        decision: "decline",
      })
    ).error,
  );
  assert.deepEqual(
    (await notices(sender)).map((row) => row.kind),
    ["partner_declined"],
  );
  const relationship = await link(sender, recipient);
  assert.ok(
    (await notices(sender)).some((row) => row.kind === "partner_accepted"),
  );
  const before = (await notices(sender)).length;
  await recipient.db.rpc("respond_partner", {
    target_relationship: relationship,
    decision: "accept",
  });
  assert.equal((await notices(sender)).length, before);
  await unlink(sender, relationship);
  const received = await notices(recipient);
  assert.ok(received.some((row) => row.kind === "partner_unlinked"));
  assert.ok(received.every((row) => row.recipient_id === recipient.id));
  assert.ok(received.every((row) => !row.message.includes("@")));
});
test("single booking confirms automatically; idempotency replays exactly and rejects payload reuse", async () => {
  const id = await post(),
    r = await ride(id, 1),
    key = randomUUID();
  const first = await book(a, r, "self", key);
  assert.ifError(first.error);
  const repeated = await Promise.all([
    book(a, r, "self", key),
    book(a, r, "self", key),
  ]);
  for (const result of repeated) {
    assert.ifError(result.error);
    assert.deepEqual(result.data, first.data);
  }
  assert.equal((await rows(id)).length, 1);
  assert.ifError((await book(a, r)).error);
  assert.equal((await rows(id)).length, 1);
  const other = await ride(id, 1, driver2);
  assert.ok((await book(a, other, "self", key)).error);
  assert.ok((await book(a, other)).error);
});
test("partner consent cannot be forged and declined/pending relationships give no authority", async () => {
  const id = await post(),
    r = await ride(id);
  assert.ok((await book(a, r, "both")).error);
  assert.ok((await a.db.rpc("request_partner", { target_user: a.id })).error);
  const req = await a.db.rpc("request_partner", { target_user: b.id });
  assert.ifError(req.error);
  assert.ok(
    (
      await a.db.rpc("respond_partner", {
        target_relationship: req.data,
        decision: "accept",
      })
    ).error,
  );
  assert.ok(
    (
      await c.db.rpc("respond_partner", {
        target_relationship: req.data,
        decision: "accept",
      })
    ).error,
  );
  assert.ok((await book(a, r, "partner")).error);
  assert.ifError(
    (
      await b.db.rpc("respond_partner", {
        target_relationship: req.data,
        decision: "decline",
      })
    ).error,
  );
  assert.ok((await book(a, r, "partner")).error);
  assert.deepEqual(
    (await c.db.from("partner_relationships").select("*").eq("id", req.data))
      .data,
    [],
  );
});
test("two-seat and partner-only bookings preserve passenger ownership and record actor", async () => {
  const rel = await link(a, b);
  try {
    const id = await post(),
      r = await ride(id, 2);
    assert.ifError((await book(a, r, "both")).error);
    const active = await rows(id);
    assert.deepEqual(
      active.map((x) => x.passenger_id).sort(),
      [a.id, b.id].sort(),
    );
    assert.ok(active.every((x) => x.created_by === a.id));
    const partnerRow = active.find((x) => x.passenger_id === b.id);
    assert.ifError(
      (
        await b.db.rpc("cancel_ride_reservation", {
          target_reservation: partnerRow.id,
        })
      ).error,
    );
    assert.equal((await rows(id)).length, 1);
    const id2 = await post(),
      r2 = await ride(id2, 1);
    assert.ifError((await book(a, r2, "partner")).error);
    assert.equal((await rows(id2))[0].passenger_id, b.id);
  } finally {
    await unlink(a, rel);
  }
});
test("two-seat request fails atomically when only one place is available", async () => {
  const rel = await link(a, b);
  try {
    const id = await post(),
      r = await ride(id, 1);
    assert.ok((await book(a, r, "both")).error);
    assert.equal((await rows(id)).length, 0);
  } finally {
    await unlink(a, rel);
  }
});
test("last-seat races and conflicting rides never overbook or duplicate a passenger", async () => {
  for (let n = 0; n < 3; n++) {
    const id = await post(),
      r = await ride(id, 1);
    const results = await Promise.all([book(a, r), book(b, r), book(c, r)]);
    assert.equal(results.filter((x) => !x.error).length, 1);
    assert.equal((await rows(id)).length, 1);
  }
  const id = await post(),
    r1 = await ride(id, 2),
    r2 = await ride(id, 2, driver2);
  const result = await Promise.all([book(a, r1), book(a, r2)]);
  assert.equal(result.filter((x) => !x.error).length, 1);
  assert.equal((await rows(id)).length, 1);
});
test("two-seat requests racing singles remain all-or-nothing", async () => {
  const rel = await link(a, b);
  try {
    const id = await post(),
      r = await ride(id, 2);
    const result = await Promise.all([book(a, r, "both"), book(c, r)]);
    assert.equal(result.filter((x) => !x.error).length, 1);
    const active = await rows(id);
    assert.ok(active.length === 1 || active.length === 2);
    if (active.length === 2)
      assert.deepEqual(
        active.map((x) => x.passenger_id).sort(),
        [a.id, b.id].sort(),
      );
  } finally {
    await unlink(a, rel);
  }
});
test("cancellation releases capacity, is repeatable, and unrelated actors cannot cancel", async () => {
  const id = await post(),
    r = await ride(id, 1);
  await book(a, r);
  const reservation = (await rows(id))[0];
  assert.ok(
    (
      await b.db.rpc("cancel_ride_reservation", {
        target_reservation: reservation.id,
      })
    ).error,
  );
  assert.ifError(
    (
      await a.db.rpc("cancel_ride_reservation", {
        target_reservation: reservation.id,
      })
    ).error,
  );
  assert.ifError(
    (
      await a.db.rpc("cancel_ride_reservation", {
        target_reservation: reservation.id,
      })
    ).error,
  );
  assert.ifError((await book(b, r)).error);
  assert.equal((await rows(id, "cancelled")).length, 1);
  assert.ok(
    (
      await service
        .from("ride_reservation_history")
        .select("id")
        .eq("reservation_id", reservation.id)
    ).data.length >= 2,
  );
});
test("switching secures replacement atomically, preserves old seats on failure and rejects stale commands", async () => {
  const id = await post(),
    r1 = await ride(id, 2),
    r2 = await ride(id, 1, driver2);
  await book(a, r1);
  await book(b, r2);
  const old = (await rows(id)).find((x) => x.passenger_id === a.id);
  const args = {
    target_ride: r2,
    booking_mode: "self",
    operation_id: randomUUID(),
    expected_reservations: [old.id],
  };
  assert.ok((await a.db.rpc("switch_ride", args)).error);
  assert.equal(
    (await rows(id)).find((x) => x.passenger_id === a.id).ride_id,
    r1,
  );
  const occupied = (await rows(id)).find((x) => x.passenger_id === b.id);
  await b.db.rpc("cancel_ride_reservation", {
    target_reservation: occupied.id,
  });
  assert.ifError((await a.db.rpc("switch_ride", args)).error);
  assert.equal(
    (await rows(id)).find((x) => x.passenger_id === a.id).ride_id,
    r2,
  );
  assert.ifError((await a.db.rpc("switch_ride", args)).error);
  assert.ok(
    (
      await a.db.rpc("switch_ride", {
        ...args,
        target_ride: r1,
        operation_id: randomUUID(),
      })
    ).error,
  );
});
test("partner switches are atomic, explicit and restricted to actor-created partner bookings", async () => {
  const rel = await link(a, b);
  try {
    const id = await post(),
      r1 = await ride(id, 2),
      r2 = await ride(id, 1, driver2);
    await book(a, r1, "both");
    const old = await rows(id);
    const args = {
      target_ride: r2,
      booking_mode: "both",
      operation_id: randomUUID(),
      expected_reservations: old.map((x) => x.id),
    };
    assert.ok((await a.db.rpc("switch_ride", args)).error);
    assert.ok((await rows(id)).every((x) => x.ride_id === r1));
    assert.ifError(
      (
        await b.db.rpc("switch_ride", {
          ...args,
          booking_mode: "self",
          expected_reservations: [old.find((x) => x.passenger_id === b.id).id],
        })
      ).error,
    );
    assert.equal(
      (await rows(id)).find((x) => x.passenger_id === a.id).ride_id,
      r1,
    );
    const partnerNow = (await rows(id)).find((x) => x.passenger_id === b.id);
    assert.ok(
      (
        await a.db.rpc("cancel_ride_reservation", {
          target_reservation: partnerNow.id,
        })
      ).error,
    );
  } finally {
    await unlink(a, rel);
  }
});
test("driver authority, capacity reduction and self-seat checks are enforced", async () => {
  const id = await post(),
    r = await ride(id, 2);
  assert.ok((await book(driver, r)).error);
  await book(a, r);
  await book(b, r);
  const change = {
    target_id: r,
    target_post: id,
    content: { capacity: 1, pickup: "Changed" },
    operation_id: randomUUID(),
  };
  assert.ok((await driver.db.rpc("write_ride", change)).error);
  assert.equal(
    (
      await driver.db
        .from("ride_offers")
        .select("capacity,pickup")
        .eq("id", r)
        .single()
    ).data.pickup,
    "Park gates",
  );
  assert.ok(
    (
      await a.db.rpc("write_ride", {
        ...change,
        content: { capacity: 3, pickup: "Forged" },
      })
    ).error,
  );
  assert.ifError(
    (
      await admin.db.rpc("write_ride", {
        ...change,
        content: { capacity: 3, pickup: "Admin corrected" },
      })
    ).error,
  );
});
test("withdrawal races booking safely and informs passengers that new arrangements are needed", async () => {
  const id = await post(),
    r = await ride(id, 2);
  await book(a, r);
  const result = await Promise.all([
    driver.db.rpc("withdraw_ride", { target_ride: r }),
    book(b, r),
  ]);
  assert.ifError(result[0].error);
  assert.equal((await rows(id)).length, 0);
  assert.ok((await rows(id, "needs_arrangement")).length >= 1);
  assert.ok((await book(c, r)).error);
  assert.ifError(
    (await driver.db.rpc("withdraw_ride", { target_ride: r })).error,
  );
  assert.equal(
    (
      await a.db
        .from("notifications")
        .select("id")
        .eq("post_id", id)
        .eq("kind", "ride_withdrawn")
    ).data.length,
    1,
  );
  const replacement = await ride(id, 2, driver2);
  assert.ifError((await book(a, replacement)).error);
  assert.equal((await rows(id)).length, 1);
});
test("event cancellation races bookings and preserves cancelled transport history", async () => {
  const extra = {
    post_type: "event",
    starts_at: "2035-01-15T05:00:00Z",
    ends_at: "2035-01-15T07:00:00Z",
    event_location: "Park",
    timezone: "Pacific/Auckland",
  };
  const id = await post(extra),
    r = await ride(id, 2);
  await book(a, r);
  const results = await Promise.all([
    host.db.rpc("write_post", {
      target_id: id,
      content: content({ ...extra, status: "cancelled", confirm_cancel: true }),
    }),
    book(b, r),
  ]);
  assert.ifError(results[0].error);
  assert.equal((await rows(id)).length, 0);
  assert.equal(
    (await driver.db.from("ride_offers").select("status").eq("id", r).single())
      .data.status,
    "cancelled",
  );
  assert.ok((await book(c, r)).error);
  assert.ok(
    (
      await driver.db.rpc("write_ride", {
        target_id: null,
        target_post: id,
        content: { capacity: 1, pickup: "Park" },
        operation_id: randomUUID(),
      })
    ).error,
  );
});
test("event changes preserve driver times, require transport review and notify affected members", async () => {
  const extra = {
    post_type: "event",
    starts_at: "2035-01-15T05:00:00Z",
    event_location: "Park",
    timezone: "Pacific/Auckland",
  };
  const id = await post(extra),
    r = await ride(id, 2, driver, { departure_at: "2035-01-15T03:00:00Z" });
  await book(a, r);
  assert.ifError(
    (
      await host.db.rpc("write_post", {
        target_id: id,
        content: content({
          ...extra,
          starts_at: "2035-01-16T05:00:00Z",
          event_location: "Beach",
        }),
      })
    ).error,
  );
  const actual = (
    await driver.db.from("ride_offers").select("*").eq("id", r).single()
  ).data;
  assert.equal(actual.needs_reconfirmation, true);
  assert.equal(
    new Date(actual.departure_at).toISOString(),
    "2035-01-15T03:00:00.000Z",
  );
  assert.equal(
    (
      await a.db
        .from("notifications")
        .select("id")
        .eq("post_id", id)
        .eq("kind", "event_updated")
    ).data.length,
    1,
  );
  assert.ifError(
    (
      await driver.db.rpc("write_ride", {
        target_id: r,
        target_post: id,
        content: {
          capacity: 2,
          pickup: "Review confirmed",
          departure_at: actual.departure_at,
        },
        operation_id: randomUUID(),
      })
    ).error,
  );
  assert.equal(
    (
      await driver.db
        .from("ride_offers")
        .select("needs_reconfirmation")
        .eq("id", r)
        .single()
    ).data.needs_reconfirmation,
    false,
  );
});
test("coordination cannot be disabled with active or unresolved arrangements", async () => {
  const id = await post(),
    r = await ride(id, 1);
  await book(a, r);
  assert.ok(
    (
      await host.db.rpc("write_post", {
        target_id: id,
        content: content({ ride_coordination_enabled: false }),
      })
    ).error,
  );
  await driver.db.rpc("withdraw_ride", { target_ride: r });
  assert.ok(
    (
      await host.db.rpc("write_post", {
        target_id: id,
        content: content({ ride_coordination_enabled: false }),
      })
    ).error,
  );
  const old = (await rows(id, "needs_arrangement"))[0];
  await a.db.rpc("cancel_ride_reservation", { target_reservation: old.id });
  assert.ifError(
    (
      await host.db.rpc("write_post", {
        target_id: id,
        content: content({ ride_coordination_enabled: false }),
      })
    ).error,
  );
  assert.ok(
    (
      await driver.db.rpc("write_ride", {
        target_id: null,
        target_post: id,
        content: { capacity: 1, pickup: "Park" },
        operation_id: randomUUID(),
      })
    ).error,
  );
});
test("unlink preserves reservations, removes former actor authority and lets the passenger manage history", async () => {
  const rel = await link(a, b);
  const id = await post(),
    r = await ride(id, 1);
  const key = randomUUID();
  assert.ifError((await book(a, r, "partner", key)).error);
  const old = (await rows(id))[0];
  await unlink(b, rel);
  assert.equal((await rows(id)).length, 1);
  assert.ok(
    (await a.db.rpc("cancel_ride_reservation", { target_reservation: old.id }))
      .error,
  );
  assert.ok((await book(a, r, "partner")).error);
  assert.ifError((await book(a, r, "partner", key)).error);
  assert.equal((await rows(id)).length, 1);
  assert.ifError(
    (await b.db.rpc("cancel_ride_reservation", { target_reservation: old.id }))
      .error,
  );
});
test("simultaneous conflicting partner acceptances yield only one exclusive relationship", async () => {
  const r1 = await a.db.rpc("request_partner", { target_user: b.id }),
    r2 = await c.db.rpc("request_partner", { target_user: b.id });
  assert.ifError(r1.error);
  assert.ifError(r2.error);
  const result = await Promise.all([
    b.db.rpc("respond_partner", {
      target_relationship: r1.data,
      decision: "accept",
    }),
    b.db.rpc("respond_partner", {
      target_relationship: r2.data,
      decision: "accept",
    }),
  ]);
  assert.equal(result.filter((x) => !x.error).length, 1);
  const requestStates = (
    await service
      .from("partner_relationships")
      .select("status")
      .in("id", [r1.data, r2.data])
  ).data;
  assert.equal(requestStates.filter((r) => r.status === "confirmed").length, 1);
  assert.equal(
    requestStates.filter((r) => r.status === "revoked").length,
    1,
    "Conflicting request closes without forging a recipient decline",
  );
  const slots = (
    await service.from("partner_participants").select("*").eq("user_id", b.id)
  ).data;
  assert.equal(slots.length, 1);
  await unlink(b, slots[0].relationship_id);
});
test("non-members, anonymous users and direct writes cannot bypass privacy or booking rules", async () => {
  const id = await post(),
    r = await ride(id, 1);
  await book(a, r);
  for (const db of [client(), pending.db]) {
    assert.ok(
      (
        await db.rpc("book_ride", {
          target_ride: r,
          booking_mode: "self",
          operation_id: randomUUID(),
        })
      ).error,
    );
    for (const table of ["ride_offers", "ride_reservations"]) {
      const result = await db.from(table).select("*").eq("post_id", id);
      assert.ok(result.error || result.data.length === 0);
    }
  }
  assert.equal(
    (
      await c.db
        .from("ride_reservations")
        .select(
          "passenger_id,profiles!ride_reservations_passenger_id_fkey(display_name)",
        )
        .eq("post_id", id)
    ).data[0].profiles.display_name,
    "a",
  );
  assert.ok(
    (
      await a.db.from("ride_reservations").insert({
        post_id: id,
        ride_id: r,
        passenger_id: b.id,
        created_by: a.id,
        modified_by: a.id,
      })
    ).error,
  );
  assert.ok(
    (await a.db.from("ride_offers").update({ capacity: 99 }).eq("id", r)).error,
  );
  assert.ok(
    (
      await a.db.from("partner_relationships").insert({
        user_a: [a.id, b.id].sort()[0],
        user_b: [a.id, b.id].sort()[1],
        requested_by: a.id,
        status: "confirmed",
      })
    ).error,
  );
  assert.ok((await a.db.from("transport_operations").select("*")).error);
});
test("closed posts, departed rides and invalid ride fields are rejected", async () => {
  const id = await post();
  for (const details of [
    { capacity: 0, pickup: "Park" },
    { capacity: 1, pickup: "" },
    { capacity: 1, pickup: "Park", departure_at: "infinity" },
    {
      capacity: 1,
      pickup: "Park",
      return_available: true,
      departure_at: "2035-01-02T00:00:00Z",
      return_departure_at: "2035-01-01T00:00:00Z",
    },
  ])
    assert.ok(
      (
        await driver.db.rpc("write_ride", {
          target_id: null,
          target_post: id,
          content: details,
          operation_id: randomUUID(),
        })
      ).error,
    );
  const past = await ride(id, 1, driver, {
    departure_at: "2020-01-01T00:00:00Z",
  });
  assert.ok((await book(a, past)).error);
  assert.ifError(
    (
      await host.db.rpc("write_post", {
        target_id: id,
        content: content({ status: "archived", confirm_transport_close: true }),
      })
    ).error,
  );
  assert.ok((await book(a, past)).error);
  assert.equal(
    (
      await driver.db
        .from("ride_offers")
        .select("status")
        .eq("id", past)
        .single()
    ).data.status,
    "completed",
  );
});
test("concurrent first submissions share one idempotent result and replay never resurrects a cancelled seat", async () => {
  const id = await post(),
    r = await ride(id, 2),
    key = randomUUID();
  const results = await Promise.all([
    book(a, r, "self", key),
    book(a, r, "self", key),
  ]);
  for (const result of results) assert.ifError(result.error);
  assert.deepEqual(results[0].data, results[1].data);
  let active = await rows(id);
  assert.equal(active.length, 1);
  await a.db.rpc("cancel_ride_reservation", {
    target_reservation: active[0].id,
  });
  assert.ifError((await book(a, r, "self", key)).error);
  assert.equal((await rows(id)).length, 0);
  assert.ifError((await book(b, r, "self", key)).error);
  assert.equal((await rows(id)).length, 1);
});
test("capacity reductions racing bookings are serialized and operator writes cannot overfill", async () => {
  const id = await post(),
    r = await ride(id, 2);
  await book(a, r);
  const result = await Promise.all([
    book(b, r),
    driver.db.rpc("write_ride", {
      target_id: r,
      target_post: id,
      content: { capacity: 1, pickup: "Park gates" },
      operation_id: randomUUID(),
    }),
  ]);
  assert.equal(result.filter((x) => x.error).length, 1);
  const capacity = (
    await service.from("ride_offers").select("capacity").eq("id", r).single()
  ).data.capacity;
  assert.ok((await rows(id)).length <= capacity);
  const second = await post(),
    r2 = await ride(second, 2);
  await book(a, r2);
  await book(b, r2);
  const forced = await service
    .from("ride_offers")
    .update({ capacity: 1 })
    .eq("id", r2);
  assert.ok(forced.error);
  assert.equal(
    (await service.from("ride_offers").select("capacity").eq("id", r2).single())
      .data.capacity,
    2,
  );
});
test("both passengers can switch together and a partner-only switch never moves the actor", async () => {
  const rel = await link(a, b);
  try {
    const id = await post(),
      r1 = await ride(id, 2),
      r2 = await ride(id, 2, driver2);
    await book(a, r1, "both");
    const previous = await rows(id);
    assert.ifError(
      (
        await a.db.rpc("switch_ride", {
          target_ride: r2,
          booking_mode: "both",
          operation_id: randomUUID(),
          expected_reservations: previous.map((r) => r.id),
        })
      ).error,
    );
    const next = await rows(id);
    assert.equal(next.length, 2);
    assert.ok(next.every((r) => r.ride_id === r2));
    assert.equal((await rows(id, "cancelled")).length, 2);
    const partner = next.find((r) => r.passenger_id === b.id);
    assert.ifError(
      (
        await a.db.rpc("switch_ride", {
          target_ride: r1,
          booking_mode: "partner",
          operation_id: randomUUID(),
          expected_reservations: [partner.id],
        })
      ).error,
    );
    const final = await rows(id);
    assert.equal(final.find((r) => r.passenger_id === a.id).ride_id, r2);
    assert.equal(final.find((r) => r.passenger_id === b.id).ride_id, r1);
  } finally {
    await unlink(b, rel);
  }
});
test("switching a pair can add a new passenger atomically without losing the existing seat", async () => {
  const rel = await link(a, b);
  try {
    const id = await post(),
      r1 = await ride(id, 1),
      r2 = await ride(id, 2, driver2);
    await book(a, r1);
    const old = (await rows(id))[0];
    assert.ifError(
      (
        await a.db.rpc("switch_ride", {
          target_ride: r2,
          booking_mode: "both",
          operation_id: randomUUID(),
          expected_reservations: [old.id],
        })
      ).error,
    );
    assert.equal((await rows(id)).length, 2);
    assert.ok((await rows(id)).every((r) => r.ride_id === r2));
  } finally {
    await unlink(a, rel);
  }
});
test("unlinking racing partner booking cannot authorise any later partner mutation", async () => {
  const rel = await link(a, b);
  const id = await post(),
    r = await ride(id, 2);
  const result = await Promise.all([
    book(a, r, "both"),
    a.db.rpc("unlink_partner", { target_relationship: rel }),
  ]);
  assert.ifError(result[1].error);
  assert.equal((await rows(id)).length, result[0].error ? 0 : 2);
  assert.ok((await book(a, r, "partner")).error);
  const partner = (await rows(id)).find((r) => r.passenger_id === b.id);
  if (partner)
    assert.ok(
      (
        await a.db.rpc("cancel_ride_reservation", {
          target_reservation: partner.id,
        })
      ).error,
    );
});
test("administrators can cancel and withdraw but ordinary members cannot manage another driver", async () => {
  const id = await post(),
    r = await ride(id, 2);
  await book(a, r);
  assert.ok((await b.db.rpc("withdraw_ride", { target_ride: r })).error);
  const reservation = (await rows(id))[0];
  assert.ifError(
    (
      await admin.db.rpc("cancel_ride_reservation", {
        target_reservation: reservation.id,
      })
    ).error,
  );
  await book(b, r);
  assert.ifError(
    (await admin.db.rpc("withdraw_ride", { target_ride: r })).error,
  );
  assert.equal((await rows(id)).length, 0);
  assert.equal((await rows(id, "needs_arrangement")).length, 1);
});
test("switching across parents is rejected without releasing the original seat", async () => {
  const first = await post(),
    r1 = await ride(first, 1),
    second = await post(),
    r2 = await ride(second, 1);
  await book(a, r1);
  const previous = (await rows(first))[0];
  assert.ok(
    (
      await a.db.rpc("switch_ride", {
        target_ride: r2,
        booking_mode: "self",
        operation_id: randomUUID(),
        expected_reservations: [previous.id],
      })
    ).error,
  );
  assert.equal((await rows(first))[0].id, previous.id);
  assert.equal((await rows(second)).length, 0);
});
test("ordinary cancellation and event completion close transport consistently with explicit confirmation", async () => {
  const id = await post(),
    r = await ride(id, 1);
  await book(a, r);
  assert.ok(
    (
      await host.db.rpc("write_post", {
        target_id: id,
        content: content({ status: "cancelled" }),
      })
    ).error,
  );
  assert.ifError(
    (
      await host.db.rpc("write_post", {
        target_id: id,
        content: content({
          status: "cancelled",
          confirm_transport_close: true,
        }),
      })
    ).error,
  );
  assert.equal((await rows(id)).length, 0);
  assert.equal((await rows(id, "cancelled")).length, 1);
  assert.equal(
    (await service.from("ride_offers").select("status").eq("id", r).single())
      .data.status,
    "cancelled",
  );
  const unresolvedId = await post(),
    unresolvedRide = await ride(unresolvedId, 1);
  await book(a, unresolvedRide);
  await driver.db.rpc("withdraw_ride", { target_ride: unresolvedRide });
  assert.ok(
    (
      await host.db.rpc("write_post", {
        target_id: unresolvedId,
        content: content({ status: "archived" }),
      })
    ).error,
  );
  assert.ifError(
    (
      await host.db.rpc("write_post", {
        target_id: unresolvedId,
        content: content({ status: "archived", confirm_transport_close: true }),
      })
    ).error,
  );
  assert.equal((await rows(unresolvedId, "cancelled")).length, 1);
  const extra = {
    post_type: "event",
    starts_at: "2035-01-15T05:00:00Z",
    event_location: "Park",
  };
  const eventId = await post(extra),
    eventRide = await ride(eventId, 1);
  await book(b, eventRide);
  assert.ifError(
    (
      await host.db.rpc("write_post", {
        target_id: eventId,
        content: content({
          ...extra,
          status: "completed",
          confirm_transport_close: true,
        }),
      })
    ).error,
  );
  assert.equal((await rows(eventId, "completed")).length, 1);
  assert.equal(
    (
      await service
        .from("ride_offers")
        .select("status")
        .eq("id", eventRide)
        .single()
    ).data.status,
    "completed",
  );
  assert.ok((await book(a, eventRide)).error);
});
test("ride offer retries are idempotent and the authenticated account determines the driver", async () => {
  const id = await post(),
    key = randomUUID();
  const payload = {
    target_id: null,
    target_post: id,
    content: { capacity: 1, pickup: "Retry offer", driver_id: a.id },
    operation_id: key,
  };
  const results = await Promise.all([
    driver.db.rpc("write_ride", payload),
    driver.db.rpc("write_ride", payload),
  ]);
  for (const r of results) assert.ifError(r.error);
  assert.equal(results[0].data, results[1].data);
  assert.equal(
    (
      await service
        .from("ride_offers")
        .select("driver_id")
        .eq("id", results[0].data)
        .single()
    ).data.driver_id,
    driver.id,
  );
});
test("database constraints reject direct overcapacity, duplicate passengers, self seats and mismatched parents", async () => {
  const id = await post(),
    r1 = await ride(id, 1),
    r2 = await ride(id, 1, driver2);
  await book(a, r1);
  const insert = (rideId, parent, passenger) =>
    service.from("ride_reservations").insert({
      ride_id: rideId,
      post_id: parent,
      passenger_id: passenger,
      created_by: passenger,
      modified_by: passenger,
    });
  assert.ok((await insert(r1, id, b.id)).error);
  assert.ok((await insert(r2, id, a.id)).error);
  assert.ok((await insert(r2, id, driver2.id)).error);
  const other = await post();
  assert.ok((await insert(r2, other, b.id)).error);
  assert.equal((await rows(id)).length, 1);
});
test("membership revocation withdraws driving, cancels passenger seats and revokes partner authority", async () => {
  const rel = await link(c, d);
  const id = await post(),
    r = await ride(id, 2, c);
  await book(a, r);
  const otherId = await post(),
    otherRide = await ride(otherId, 2);
  await book(c, otherRide);
  assert.ifError(
    (await admin.db.rpc("revoke_membership", { target_user: c.id })).error,
  );
  assert.equal((await rows(id)).length, 0);
  assert.equal((await rows(otherId)).length, 0);
  assert.equal(
    (
      await service
        .from("partner_participants")
        .select("*")
        .eq("relationship_id", rel)
    ).data.length,
    0,
  );
  assert.ok((await book(c, otherRide)).error);
  assert.deepEqual((await c.db.from("ride_offers").select("*")).data, []);
});
