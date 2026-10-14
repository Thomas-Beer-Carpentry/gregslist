import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
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
const suffix = randomBytes(6).toString("hex"),
  password = randomBytes(24).toString("base64url");
const users = [],
  posts = [];
let host, alice, bob, admin, category;
async function member(name, role = "member") {
  const { data, error } = await service.auth.admin.createUser({
    email: `event-${name}-${suffix}@example.test`,
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
  assert.ifError(
    (await service.from("memberships").insert({ user_id: data.user.id, role }))
      .error,
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
    post_type: "event",
    title: `Event ${suffix}`,
    description: "Private community event",
    category_id: category,
    status: "open",
    starts_at: "2035-01-15T05:00:00Z",
    ends_at: "2035-01-15T07:00:00Z",
    timezone: "Pacific/Auckland",
    event_location: "Park gates",
    capacity: null,
    ...extra,
  };
}
async function event(extra = {}) {
  const { data, error } = await host.db.rpc("write_post", {
    target_id: null,
    content: content(extra),
  });
  assert.ifError(error);
  posts.push(data);
  return data;
}
async function rsvp(person, id, response) {
  return person.db.rpc("set_event_rsvp", {
    target_event: id,
    chosen_response: response,
  });
}
async function attendance(id) {
  const result = await host.db.rpc("event_attendance", { target_event: id });
  assert.ifError(result.error);
  return result.data;
}
before(async () => {
  host = await member("host");
  alice = await member("alice");
  bob = await member("bob");
  admin = await member("admin", "admin");
  category = (
    await service
      .from("categories")
      .select("id")
      .eq("name", "Events & Social")
      .single()
  ).data.id;
});
after(async () => {
  await service.from("notifications").delete().in("recipient_id", users);
  await service.from("event_rsvps").delete().in("event_id", posts);
  await service.from("ride_reservations").delete().in("post_id", posts);
  await service.from("ride_offers").delete().in("post_id", posts);
  for (const id of posts) await host.db.rpc("delete_post", { target_id: id });
  await service.from("memberships").delete().in("user_id", users);
  await service.from("profiles").delete().in("id", users);
  for (const id of users) await service.auth.admin.deleteUser(id);
});
test("RSVPs are personal, idempotent and Going alone consumes attendance capacity", async () => {
  const id = await event({ capacity: 1 });
  for (let i = 0; i < 2; i++)
    assert.ifError((await rsvp(alice, id, "going")).error);
  assert.ifError((await rsvp(bob, id, "maybe")).error);
  assert.ok(
    (await rsvp(host, id, "going")).error,
    "Organiser consumes capacity too",
  );
  let rows = await attendance(id);
  assert.equal(rows.filter((r) => r.response === "going").length, 1);
  assert.equal(rows.length, 2);
  assert.equal(
    (
      await service
        .from("event_rsvps")
        .select("*")
        .eq("event_id", id)
        .eq("user_id", alice.id)
    ).data.length,
    1,
  );
  assert.ok(
    (
      await bob.db
        .from("event_rsvps")
        .update({ response: "not_going" })
        .eq("event_id", id)
        .eq("user_id", alice.id)
    ).error,
  );
  assert.ifError((await rsvp(alice, id, "not_going")).error);
  assert.ifError((await rsvp(bob, id, "going")).error);
  rows = await attendance(id);
  assert.equal(rows.find((r) => r.user_id === bob.id).response, "going");
});
test("simultaneous last-place RSVPs have exactly one winner", async () => {
  const id = await event({ capacity: 1 });
  const results = await Promise.all([
    rsvp(alice, id, "going"),
    rsvp(bob, id, "going"),
  ]);
  assert.equal(results.filter((r) => !r.error).length, 1);
  assert.equal(
    results.filter((r) => r.error?.message.includes("full")).length,
    1,
  );
  assert.equal(
    (await attendance(id)).filter((r) => r.response === "going").length,
    1,
  );
});
test("failed Maybe to Going transition preserves the previous response", async () => {
  const id = await event({ capacity: 1 });
  await rsvp(alice, id, "going");
  await rsvp(bob, id, "maybe");
  assert.ok((await rsvp(bob, id, "going")).error);
  assert.equal(
    (
      await service
        .from("event_rsvps")
        .select("response")
        .eq("event_id", id)
        .eq("user_id", bob.id)
        .single()
    ).data.response,
    "maybe",
  );
});
test("capacity edits cannot evict attendees or partially update the event", async () => {
  const id = await event({ capacity: 2 });
  await rsvp(alice, id, "going");
  await rsvp(bob, id, "going");
  const result = await host.db.rpc("write_post", {
    target_id: id,
    content: content({ capacity: 1, title: "Must not be saved" }),
  });
  assert.ok(result.error);
  assert.equal(
    (await service.from("events").select("capacity").eq("post_id", id).single())
      .data.capacity,
    2,
  );
  assert.equal(
    (await service.from("posts").select("title").eq("id", id).single()).data
      .title,
    `Event ${suffix}`,
  );
});
test("capacity reduction and a concurrent RSVP cannot both overfill the event", async () => {
  const id = await event({ capacity: 2 });
  await rsvp(alice, id, "going");
  const results = await Promise.all([
    host.db.rpc("write_post", {
      target_id: id,
      content: content({ capacity: 1 }),
    }),
    rsvp(bob, id, "going"),
  ]);
  assert.equal(results.filter((r) => r.error).length, 1);
  const capacity = (
    await service.from("events").select("capacity").eq("post_id", id).single()
  ).data.capacity;
  assert.ok(
    (await attendance(id)).filter((r) => r.response === "going").length <=
      capacity,
  );
});
test("organiser updates preserve responses and notify relevant members once", async () => {
  const id = await event({ capacity: 3 });
  await rsvp(alice, id, "going");
  await rsvp(bob, id, "maybe");
  const next = content({ capacity: 3, event_location: "New meeting point" });
  assert.ifError(
    (await host.db.rpc("write_post", { target_id: id, content: next })).error,
  );
  assert.equal((await attendance(id)).length, 2);
  let notices = await alice.db
    .from("notifications")
    .select("*")
    .eq("post_id", id);
  assert.equal(notices.data.length, 1);
  assert.equal(notices.data[0].kind, "event_updated");
  assert.ifError(
    (await host.db.rpc("write_post", { target_id: id, content: next })).error,
  );
  assert.equal(
    (await alice.db.from("notifications").select("*").eq("post_id", id)).data
      .length,
    1,
  );
  assert.ok(
    (await bob.db.rpc("read_notification", { target_id: notices.data[0].id }))
      .error,
  );
  assert.ifError(
    (await alice.db.rpc("read_notification", { target_id: notices.data[0].id }))
      .error,
  );
  assert.ok(
    (
      await alice.db
        .from("notifications")
        .select("read_at")
        .eq("id", notices.data[0].id)
        .single()
    ).data.read_at,
  );
});
test("cancellation requires confirmation, cancels attendance, and reopening requires fresh RSVPs", async () => {
  const id = await event({ capacity: 2 });
  await rsvp(alice, id, "going");
  const cancel = content({ capacity: 2, status: "cancelled" });
  assert.ok(
    (await host.db.rpc("write_post", { target_id: id, content: cancel })).error,
  );
  assert.equal(
    (await service.from("events").select("status").eq("post_id", id).single())
      .data.status,
    "scheduled",
  );
  assert.ifError(
    (
      await host.db.rpc("write_post", {
        target_id: id,
        content: { ...cancel, confirm_cancel: true },
      })
    ).error,
  );
  assert.equal((await attendance(id)).length, 0);
  const old = (
    await service
      .from("event_rsvps")
      .select("*")
      .eq("event_id", id)
      .eq("user_id", alice.id)
      .single()
  ).data;
  assert.equal(old.cancellation_reason, "event_cancelled");
  assert.ok(old.cancelled_at);
  assert.ok((await rsvp(alice, id, "going")).error);
  assert.ifError(
    (
      await host.db.rpc("write_post", {
        target_id: id,
        content: content({ capacity: 2 }),
      })
    ).error,
  );
  assert.equal((await attendance(id)).length, 0);
  assert.ifError((await rsvp(alice, id, "going")).error);
  assert.equal((await attendance(id)).length, 1);
});
test("completion and archiving preserve history and close RSVPs", async () => {
  const id = await event();
  await rsvp(alice, id, "going");
  assert.ifError(
    (
      await host.db.rpc("write_post", {
        target_id: id,
        content: content({ status: "completed" }),
      })
    ).error,
  );
  assert.equal(
    (await service.from("events").select("status").eq("post_id", id).single())
      .data.status,
    "completed",
  );
  assert.ok((await rsvp(bob, id, "going")).error);
  assert.ok(
    (await host.db.rpc("write_post", { target_id: id, content: content() }))
      .error,
  );
  assert.ifError(
    (
      await host.db.rpc("write_post", {
        target_id: id,
        content: content({ status: "archived" }),
      })
    ).error,
  );
  assert.equal(
    (await attendance(id)).filter((r) => r.response === "going").length,
    1,
  );
  assert.ok(
    (await host.db.rpc("delete_post", { target_id: id })).error,
    "RSVP history is retained",
  );
  const past = await event({
    starts_at: "2020-01-01T00:00:00Z",
    ends_at: null,
  });
  assert.ok((await rsvp(alice, past, "going")).error);
  assert.ifError(
    (
      await host.db.rpc("write_post", {
        target_id: past,
        content: content({
          status: "archived",
          starts_at: "2020-01-01T00:00:00Z",
          ends_at: null,
        }),
      })
    ).error,
  );
});
test("anonymous users and non-organisers cannot bypass event authority", async () => {
  const id = await event();
  assert.ok(
    (
      await client().rpc("set_event_rsvp", {
        target_event: id,
        chosen_response: "going",
      })
    ).error,
  );
  assert.ok(
    (await client().rpc("event_attendance", { target_event: id })).error,
  );
  assert.ok(
    (
      await alice.db.rpc("write_post", {
        target_id: id,
        content: content({ capacity: 1 }),
      })
    ).error,
  );
  assert.ok((await rsvp(alice, id, "invalid")).error);
  const notEvent = await host.db.rpc("write_post", {
    target_id: null,
    content: { ...content(), post_type: "discussion" },
  });
  assert.ifError(notEvent.error);
  posts.push(notEvent.data);
  assert.ok((await rsvp(alice, notEvent.data, "going")).error);
});
test("event cancellation also cancels existing ride arrangements atomically", async () => {
  const id = await event();
  const ride = (
    await service
      .from("ride_offers")
      .insert({ post_id: id, driver_id: alice.id, capacity: 1, pickup: "Park" })
      .select("id")
      .single()
  ).data;
  const reservation = await service
    .from("ride_reservations")
    .insert({
      ride_id: ride.id,
      post_id: id,
      passenger_id: bob.id,
      created_by: bob.id,
      modified_by: bob.id,
    })
    .select("id")
    .single();
  assert.ifError(reservation.error);
  assert.ifError(
    (
      await host.db.rpc("write_post", {
        target_id: id,
        content: content({ status: "cancelled", confirm_cancel: true }),
      })
    ).error,
  );
  assert.equal(
    (
      await service
        .from("ride_offers")
        .select("status")
        .eq("id", ride.id)
        .single()
    ).data.status,
    "cancelled",
  );
  assert.equal(
    (
      await service
        .from("ride_reservations")
        .select("status")
        .eq("id", reservation.data.id)
        .single()
    ).data.status,
    "cancelled",
  );
  assert.equal(
    (
      await bob.db
        .from("notifications")
        .select("*")
        .eq("post_id", id)
        .eq("kind", "event_cancelled")
    ).data.length,
    1,
  );
  assert.equal(
    (
      await alice.db
        .from("notifications")
        .select("id")
        .eq("post_id", id)
        .eq("kind", "event_cancelled")
    ).data.length,
    1,
    "Driver receives the cancellation even without an RSVP",
  );
});
test("revocation closes existing RSVPs and never silently restores attendance", async () => {
  const id = await event({ capacity: 1 });
  await rsvp(bob, id, "going");
  const race = await Promise.all([
    admin.db.rpc("revoke_membership", { target_user: bob.id }),
    rsvp(bob, id, "going"),
  ]);
  assert.ifError(race[0].error);
  assert.equal((await attendance(id)).length, 0);
  assert.ok((await rsvp(bob, id, "going")).error);
  assert.ok((await bob.db.rpc("event_attendance", { target_event: id })).error);
  assert.ifError((await rsvp(alice, id, "going")).error);
  await service
    .from("memberships")
    .update({ status: "active", revoked_at: null })
    .eq("user_id", bob.id);
  assert.equal(
    (await attendance(id)).filter((r) => r.response === "going").length,
    1,
  );
  assert.ok(
    (await rsvp(bob, id, "going")).error,
    "Reactivation cannot reclaim an occupied seat",
  );
});

test("cancellation racing a new RSVP leaves no active attendance", async () => {
  const id = await event({ capacity: 2 });
  const result = await Promise.all([
    host.db.rpc("write_post", {
      target_id: id,
      content: content({
        capacity: 2,
        status: "cancelled",
        confirm_cancel: true,
      }),
    }),
    rsvp(alice, id, "going"),
  ]);
  assert.ifError(result[0].error);
  assert.equal((await attendance(id)).length, 0);
  const rows = (
    await service.from("event_rsvps").select("cancelled_at").eq("event_id", id)
  ).data;
  assert.ok(rows.every((r) => r.cancelled_at));
});
