import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
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
const tag = randomBytes(6).toString("hex");
const password = randomBytes(24).toString("base64url");
const users = [],
  posts = [],
  invitations = [];
const photoPath = `membership-tests/${tag}.png`;
let admin,
  member,
  other,
  uninvited,
  category,
  privatePost,
  privateEvent,
  privateRide;

async function account(name, role = "member") {
  const email = `membership-${name}-${tag}-${users.length}@example.test`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.ifError(error);
  users.push(data.user.id);
  if (role) {
    assert.ifError(
      (
        await service.from("profiles").insert({
          id: data.user.id,
          display_name: `Membership ${name} ${tag}`,
          bio: "Community profile",
        })
      ).error,
    );
    assert.ifError(
      (
        await service
          .from("memberships")
          .insert({ user_id: data.user.id, role })
      ).error,
    );
  }
  const db = client();
  assert.ifError((await db.auth.signInWithPassword({ email, password })).error);
  return { id: data.user.id, email, db };
}
function postContent(extra = {}) {
  return {
    post_type: "discussion",
    title: `Membership fixture ${tag}`,
    description: "Private membership integration fixture",
    category_id: category,
    status: "open",
    ride_coordination_enabled: true,
    ...extra,
  };
}
async function post(person = member, extra = {}) {
  const result = await person.db.rpc("write_post", {
    target_id: null,
    content: postContent(extra),
  });
  assert.ifError(result.error);
  posts.push(result.data);
  return result.data;
}
async function offer(parent, driver = other) {
  const result = await driver.db.rpc("write_ride", {
    target_id: null,
    target_post: parent,
    content: { pickup: "Community meeting point", capacity: 3 },
    operation_id: randomUUID(),
  });
  assert.ifError(result.error);
  return result.data;
}
async function invite(email, delivery = "copy") {
  const result = await admin.db.rpc("create_member_invitation", {
    target_email: email,
    delivery,
  });
  assert.ifError(result.error);
  assert.ok(
    result.data && typeof result.data.id === "string",
    "Invitation reference returned",
  );
  assert.ok(
    typeof result.data.token === "string" && result.data.token.length >= 43,
    "At least 256 bits of invitation entropy encoded",
  );
  invitations.push(result.data.id);
  return result.data;
}
const accept = (person, invitation, token = invitation.token) =>
  person.db.rpc("accept_member_invitation", {
    target_invitation: invitation.id,
    raw_token: token,
  });
async function state(person) {
  const result = await service
    .from("memberships")
    .select("status,role")
    .eq("user_id", person.id)
    .single();
  assert.ifError(result.error);
  return result.data;
}
async function setStatus(person, status) {
  const result = await admin.db.rpc("set_member_status", {
    target_user: person.id,
    new_status: status,
  });
  assert.ifError(result.error);
}
async function auditFor(column, id) {
  const result = await admin.db
    .from("admin_audit")
    .select("*")
    .eq(column, id)
    .order("created_at");
  assert.ifError(result.error);
  return result.data;
}
async function assertPrivateAccessDenied(person) {
  for (const table of [
    "profiles",
    "posts",
    "events",
    "event_rsvps",
    "ride_offers",
    "ride_reservations",
    "partner_relationships",
    "partner_participants",
    "comments",
    "post_photos",
    "saved_posts",
    "notifications",
    "invitations",
    "admin_audit",
  ]) {
    const result = await person.db.from(table).select("*").limit(1);
    assert.ok(
      result.error || result.data.length === 0,
      `${table} remains private`,
    );
  }
  const calls = [
    ["write_post", { target_id: null, content: postContent() }],
    [
      "set_event_rsvp",
      { target_event: privateEvent, chosen_response: "going" },
    ],
    ["event_attendance", { target_event: privateEvent }],
    [
      "book_ride",
      {
        target_ride: privateRide,
        booking_mode: "self",
        operation_id: randomUUID(),
      },
    ],
    [
      "write_ride",
      {
        target_id: null,
        target_post: privatePost,
        content: { capacity: 1, pickup: "Here" },
        operation_id: randomUUID(),
      },
    ],
    ["request_partner", { target_user: other.id }],
    ["partner_candidates", {}],
    ["member_directory", { search_query: "" }],
    ["admin_members", { search_query: "" }],
  ];
  for (const [rpc, payload] of calls)
    assert.ok(
      (await person.db.rpc(rpc, payload)).error,
      `${rpc} requires current membership`,
    );
  assert.ok(
    (await person.db.storage.from("community-photos").download(photoPath))
      .error,
    "Private storage checks current membership",
  );
}

before(async () => {
  admin = await account("administrator", "admin");
  member = await account("member");
  other = await account("other");
  uninvited = await account("uninvited", null);
  const categories = await service
    .from("categories")
    .select("id")
    .limit(1)
    .single();
  assert.ifError(categories.error);
  category = categories.data.id;
  privatePost = await post();
  privateEvent = await post(member, {
    post_type: "event",
    starts_at: "2099-01-01T00:00:00Z",
    timezone: "Pacific/Auckland",
    event_location: "Community hall",
  });
  privateRide = await offer(privatePost);
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1sAAAAASUVORK5CYII=",
    "base64",
  );
  assert.ifError(
    (
      await service.storage
        .from("community-photos")
        .upload(photoPath, image, { contentType: "image/png" })
    ).error,
  );
  assert.ifError(
    (
      await service.from("post_photos").insert({
        post_id: privatePost,
        uploader_id: member.id,
        object_path: photoPath,
      })
    ).error,
  );
});
after(async () => {
  await service.storage.from("community-photos").remove([photoPath]);
  await service.from("admin_audit").delete().in("actor_id", users);
  await service.from("transport_operations").delete().in("actor_id", users);
  await service.from("ride_reservation_history").delete().in("post_id", posts);
  await service.from("notifications").delete().in("recipient_id", users);
  await service.from("ride_reservations").delete().in("post_id", posts);
  await service.from("ride_offers").delete().in("post_id", posts);
  await service.from("event_rsvps").delete().in("event_id", posts);
  await service.from("comments").delete().in("post_id", posts);
  await service.from("saved_posts").delete().in("post_id", posts);
  await service.from("post_photos").delete().in("post_id", posts);
  await service.from("events").delete().in("post_id", posts);
  await service.from("posts").delete().in("id", posts);
  await service.from("partner_participants").delete().in("user_id", users);
  for (const column of ["user_a", "user_b"])
    await service.from("partner_relationships").delete().in(column, users);
  await service.from("invitations").delete().in("issued_by", users);
  await service.from("memberships").delete().in("user_id", users);
  await service.from("profiles").delete().in("id", users);
  for (const id of users) await service.auth.admin.deleteUser(id);
});

test("administrator invitations contain unique secure tokens but persist only hashes and seven-day expiry", async () => {
  const person = await account("copy-invited", null);
  const invitation = await invite(person.email);
  const second = await invite(`second-${tag}@example.test`);
  assert.ok(
    invitation.token !== second.token,
    "Independent invitations have independent secrets",
  );
  const stored = await service
    .from("invitations")
    .select("*")
    .eq("id", invitation.id)
    .single();
  assert.ifError(stored.error);
  const row = stored.data;
  assert.ok(
    !JSON.stringify(row).includes(invitation.token),
    "Database invitation row contains no raw token",
  );
  assert.ok(
    String(row.token_hash).replace(/^\\x/, "") ===
      createHash("sha256").update(invitation.token).digest("hex"),
    "Token hash matches SHA-256",
  );
  assert.equal(
    new Date(row.expires_at) - new Date(row.created_at),
    7 * 24 * 60 * 60 * 1000,
  );
  assert.equal(row.email, person.email);
  assert.equal(row.issued_by, admin.id);
  assert.equal(row.redeemed_at, null);
});

test("ordinary members and anonymous accounts cannot create, inspect or verify invitations", async () => {
  const invitation = await invite(`private-invitation-${tag}@example.test`);
  for (const db of [member.db, client(), uninvited.db]) {
    assert.ok(
      (
        await db.rpc("create_member_invitation", {
          target_email: `forbidden-${tag}@example.test`,
          delivery: "copy",
        })
      ).error,
    );
    const rows = await db
      .from("invitations")
      .select("*")
      .eq("id", invitation.id);
    assert.ok(rows.error || rows.data.length === 0);
    assert.ok(
      (
        await db.rpc("invitation_verification", {
          target_invitation: invitation.id,
          raw_token: invitation.token,
          intended_email: `private-invitation-${tag}@example.test`,
        })
      ).error,
    );
  }
  assert.ok(
    (
      await admin.db.rpc("invitation_verification", {
        target_invitation: invitation.id,
        raw_token: invitation.token,
        intended_email: `private-invitation-${tag}@example.test`,
      })
    ).error,
    "Mail verification is service-only, even for administrator JWTs",
  );
});

test("copy invitations require the token and cannot use legacy verified-email activation", async () => {
  const person = await account("copy-redeemer", null);
  const invitation = await invite(person.email);
  assert.ok(
    (await person.db.rpc("activate_membership")).error,
    "Email verification alone cannot bypass copy-link token consent",
  );
  assert.ok(
    (await accept(person, invitation, randomBytes(32).toString("base64url")))
      .error,
  );
  assert.ok((await accept(person, { ...invitation, id: randomUUID() })).error);
  assert.ifError((await accept(person, invitation)).error);
  assert.deepEqual(await state(person), { status: "active", role: "member" });
});

test("invitation redemption binds to the intended verified email and rejects unauthenticated redemption", async () => {
  const person = await account("email-bound", null);
  const invitation = await invite(person.email);
  assert.ok((await accept(uninvited, invitation)).error);
  assert.ok(
    (
      await client().rpc("accept_member_invitation", {
        target_invitation: invitation.id,
        raw_token: invitation.token,
      })
    ).error,
  );
  assert.equal(
    (
      await service
        .from("memberships")
        .select("user_id")
        .eq("user_id", person.id)
    ).data.length,
    0,
  );
  assert.ifError((await accept(person, invitation)).error);
  assert.ok(
    (await accept(uninvited, invitation)).error,
    "Used invitation cannot activate another account",
  );
});

test("concurrent invitation redemption creates exactly one membership and audit entry; safe retries are idempotent", async () => {
  const person = await account("concurrent-redemption", null);
  const invitation = await invite(person.email);
  const results = await Promise.all([
    accept(person, invitation),
    accept(person, invitation),
    accept(person, invitation),
  ]);
  assert.ok(
    results.some((r) => !r.error),
    "One redemption succeeds",
  );
  const membership = await service
    .from("memberships")
    .select("*")
    .eq("user_id", person.id);
  assert.ifError(membership.error);
  assert.equal(membership.data.length, 1);
  assert.ifError(
    (await accept(person, invitation)).error,
    "Same active recipient may safely retry",
  );
  const audit = await auditFor("target_invitation_id", invitation.id);
  assert.equal(
    audit.filter((r) => r.action === "invitation_redeemed").length,
    1,
  );
  assert.ok(
    !JSON.stringify(audit).includes(invitation.token),
    "Audit never records token material",
  );
});

test("expired and revoked invitation tokens cannot redeem or request verification mail", async () => {
  for (const reason of ["expired", "revoked"]) {
    const person = await account(reason, null);
    const invitation = await invite(person.email);
    if (reason === "expired")
      assert.ifError(
        (
          await service
            .from("invitations")
            .update({
              created_at: "2020-01-01T00:00:00Z",
              expires_at: "2020-01-08T00:00:00Z",
            })
            .eq("id", invitation.id)
        ).error,
      );
    else
      assert.ifError(
        (
          await admin.db.rpc("revoke_invitation", {
            invitation_id: invitation.id,
          })
        ).error,
      );
    assert.ok(
      (await accept(person, invitation)).error,
      `${reason} redemption rejected`,
    );
    assert.ok(
      (
        await service.rpc("invitation_verification", {
          target_invitation: invitation.id,
          raw_token: invitation.token,
          intended_email: person.email,
        })
      ).error,
      `${reason} mail verification rejected`,
    );
  }
});

test("invitation revocation is administrator-only and repeated revocation has one audit record", async () => {
  const invitation = await invite(`revoke-${tag}@example.test`);
  assert.ok(
    (await member.db.rpc("revoke_invitation", { invitation_id: invitation.id }))
      .error,
  );
  for (let n = 0; n < 2; n++)
    assert.ifError(
      (
        await admin.db.rpc("revoke_invitation", {
          invitation_id: invitation.id,
        })
      ).error,
    );
  const audit = await auditFor("target_invitation_id", invitation.id);
  assert.equal(
    audit.filter((r) => r.action === "invitation_created").length,
    1,
  );
  assert.equal(
    audit.filter((r) => r.action === "invitation_revoked").length,
    1,
  );
});

test("service-only invitation verification validates the exact email and token without activating membership", async () => {
  const person = await account("verification", null);
  const invitation = await invite(person.email);
  assert.ok(
    (
      await service.rpc("invitation_verification", {
        target_invitation: invitation.id,
        raw_token: invitation.token,
        intended_email: other.email,
      })
    ).error,
  );
  assert.ok(
    (
      await service.rpc("invitation_verification", {
        target_invitation: invitation.id,
        raw_token: "invalid",
        intended_email: person.email,
      })
    ).error,
  );
  const verified = await service.rpc("invitation_verification", {
    target_invitation: invitation.id,
    raw_token: invitation.token,
    intended_email: person.email,
  });
  assert.ifError(verified.error);
  const row = Array.isArray(verified.data) ? verified.data[0] : verified.data;
  assert.equal(row.email, person.email);
  assert.equal(row.account_exists, true);
  assert.equal(row.account_confirmed, true);
  assert.equal(
    (
      await service
        .from("memberships")
        .select("user_id")
        .eq("user_id", person.id)
    ).data.length,
    0,
  );
});

test("member directory is searchable and returns only safe community fields", async () => {
  const suspended = await account("directory-suspended");
  await setStatus(suspended, "suspended");
  const result = await member.db.rpc("member_directory", {
    search_query: `Membership member ${tag}`,
  });
  assert.ifError(result.error);
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].display_name, `Membership member ${tag}`);
  assert.equal(result.data[0].bio, "Community profile");
  const allowed = ["display_name", "bio", "joined_at"];
  assert.ok(
    Object.keys(result.data[0]).every((key) => allowed.includes(key)),
    "No authentication IDs, email or administrative metadata",
  );
  const hidden = await member.db.rpc("member_directory", {
    search_query: `Membership directory-suspended ${tag}`,
  });
  assert.ifError(hidden.error);
  assert.equal(hidden.data.length, 0);
  assert.ok(
    (await client().rpc("member_directory", { search_query: "" })).error,
  );
  assert.ok(
    (await uninvited.db.rpc("member_directory", { search_query: "" })).error,
  );
});

test("profile edits validate biography and protect owner identity and all membership fields", async () => {
  const person = await account("profile-editor");
  assert.ifError(
    (
      await person.db
        .from("profiles")
        .update({
          display_name: "Updated community name",
          bio: "A short biography",
        })
        .eq("id", person.id)
    ).error,
  );
  assert.ok(
    (
      await person.db
        .from("profiles")
        .update({ bio: "x".repeat(301) })
        .eq("id", person.id)
    ).error,
  );
  assert.ok(
    (
      await person.db
        .from("profiles")
        .update({ display_name: "" })
        .eq("id", person.id)
    ).error,
  );
  const original = await service
    .from("profiles")
    .select("display_name")
    .eq("id", other.id)
    .single();
  await person.db
    .from("profiles")
    .update({ display_name: "Not permitted", bio: "Not permitted" })
    .eq("id", other.id);
  assert.equal(
    (
      await service
        .from("profiles")
        .select("display_name")
        .eq("id", other.id)
        .single()
    ).data.display_name,
    original.data.display_name,
  );
  assert.ok(
    (
      await person.db
        .from("profiles")
        .update({ id: other.id })
        .eq("id", person.id)
    ).error,
  );
  assert.ok(
    (
      await person.db
        .from("memberships")
        .update({ role: "admin", status: "active" })
        .eq("user_id", person.id)
    ).error,
  );
  assert.equal((await state(person)).role, "member");
});

test("suspension immediately removes existing-session access across community features and storage", async () => {
  const person = await account("suspended-access");
  assert.ifError(
    (await person.db.storage.from("community-photos").download(photoPath))
      .error,
  );
  await setStatus(person, "suspended");
  assert.equal((await state(person)).status, "suspended");
  await assertPrivateAccessDenied(person);
  await person.db
    .from("profiles")
    .update({ display_name: "Should not persist" })
    .eq("id", person.id);
  assert.ok(
    (
      await service
        .from("profiles")
        .select("display_name")
        .eq("id", person.id)
        .single()
    ).data.display_name !== "Should not persist",
  );
});

test("reactivation restores only suspended access and never silently restores prior arrangements", async () => {
  const person = await account("reactivated");
  assert.ifError(
    (
      await person.db.rpc("book_ride", {
        target_ride: privateRide,
        booking_mode: "self",
        operation_id: randomUUID(),
      })
    ).error,
  );
  await setStatus(person, "suspended");
  await setStatus(person, "active");
  assert.deepEqual(await state(person), { status: "active", role: "member" });
  assert.ifError(
    (await person.db.rpc("member_directory", { search_query: "" })).error,
  );
  assert.ifError(
    (await person.db.storage.from("community-photos").download(photoPath))
      .error,
  );
  const seats = await service
    .from("ride_reservations")
    .select("status")
    .eq("post_id", privatePost)
    .eq("passenger_id", person.id);
  assert.ifError(seats.error);
  assert.equal(seats.data.length, 1);
  assert.equal(seats.data[0].status, "cancelled");
});

test("removal preserves the account and history but is terminal for reactivation and invitation reuse", async () => {
  const person = await account("removed", null);
  const invitation = await invite(person.email);
  assert.ifError((await accept(person, invitation)).error);
  const oldPost = await post(person);
  await setStatus(person, "removed");
  await assertPrivateAccessDenied(person);
  assert.ok(
    (
      await admin.db.rpc("set_member_status", {
        target_user: person.id,
        new_status: "active",
      })
    ).error,
  );
  assert.ok((await accept(person, invitation)).error);
  assert.ok((await person.db.rpc("activate_membership")).error);
  assert.equal(
    (await service.from("posts").select("id").eq("id", oldPost)).data.length,
    1,
  );
  assert.ifError((await service.auth.admin.getUserById(person.id)).error);
});

test("ordinary members cannot use administrative operations or forge audit or membership records", async () => {
  for (const [rpc, payload] of [
    ["set_member_status", { target_user: other.id, new_status: "suspended" }],
    ["set_member_role", { target_user: member.id, new_role: "admin" }],
    ["admin_members", { search_query: "" }],
  ])
    assert.ok(
      (await member.db.rpc(rpc, payload)).error,
      `${rpc} requires administrator`,
    );
  const audit = await member.db.from("admin_audit").select("*");
  assert.ok(audit.error || audit.data.length === 0);
  assert.ok(
    (
      await member.db.from("admin_audit").insert({
        action: "administrator_granted",
        actor_id: member.id,
        target_member_id: member.id,
      })
    ).error,
  );
  assert.ok(
    (
      await member.db
        .from("admin_audit")
        .update({ action: "forged" })
        .eq("actor_id", admin.id)
    ).error,
  );
  assert.ok(
    (await member.db.from("admin_audit").delete().eq("actor_id", admin.id))
      .error,
  );
  assert.ok(
    (
      await member.db
        .from("memberships")
        .insert({ user_id: uninvited.id, role: "admin" })
    ).error,
  );
});

test("role changes require active targets and take effect on subsequent operations", async () => {
  const person = await account("role-changes");
  assert.ifError(
    (
      await admin.db.rpc("set_member_role", {
        target_user: person.id,
        new_role: "admin",
      })
    ).error,
  );
  assert.equal((await state(person)).role, "admin");
  assert.ifError(
    (await person.db.rpc("admin_members", { search_query: tag })).error,
  );
  assert.ifError(
    (
      await admin.db.rpc("set_member_role", {
        target_user: person.id,
        new_role: "member",
      })
    ).error,
  );
  assert.ok((await person.db.rpc("admin_members", { search_query: "" })).error);
  assert.ok(
    (
      await person.db.rpc("create_member_invitation", {
        target_email: `demoted-${tag}@example.test`,
        delivery: "copy",
      })
    ).error,
  );
  await setStatus(person, "suspended");
  assert.ok(
    (
      await admin.db.rpc("set_member_role", {
        target_user: person.id,
        new_role: "admin",
      })
    ).error,
  );
  assert.ok(
    (
      await admin.db.rpc("set_member_role", {
        target_user: other.id,
        new_role: "superadmin",
      })
    ).error,
  );
  assert.ok(
    (
      await admin.db.rpc("set_member_status", {
        target_user: other.id,
        new_status: "approved",
      })
    ).error,
  );
});

test("administrative member search stays administrator-only and includes management email and identity", async () => {
  const result = await admin.db.rpc("admin_members", {
    search_query: member.email,
  });
  assert.ifError(result.error);
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].user_id, member.id);
  assert.equal(result.data[0].email, member.email);
  assert.ok(
    (await member.db.rpc("admin_members", { search_query: member.email }))
      .error,
  );
});

test("state and role changes create attributable audit entries exactly once without secrets", async () => {
  const person = await account("audit-target");
  await setStatus(person, "suspended");
  await setStatus(person, "suspended");
  await setStatus(person, "active");
  for (let n = 0; n < 2; n++)
    assert.ifError(
      (
        await admin.db.rpc("set_member_role", {
          target_user: person.id,
          new_role: "admin",
        })
      ).error,
    );
  assert.ifError(
    (
      await admin.db.rpc("set_member_role", {
        target_user: person.id,
        new_role: "member",
      })
    ).error,
  );
  await setStatus(person, "removed");
  const audit = await auditFor("target_member_id", person.id);
  for (const action of [
    "member_suspended",
    "member_reactivated",
    "member_removed",
    "administrator_granted",
    "administrator_revoked",
  ])
    assert.equal(
      audit.filter((r) => r.action === action).length,
      1,
      `${action} logged once`,
    );
  assert.ok(
    audit.every(
      (r) =>
        r.actor_id === admin.id &&
        r.administrator_id === admin.id &&
        r.created_at,
    ),
    "Audit actor and administrator attribution retained",
  );
  assert.ok(
    audit.every(
      (r) =>
        typeof r.actor_name === "string" && typeof r.target_name === "string",
    ),
    "Human-readable audit snapshots retained",
  );
  assert.ok(
    !JSON.stringify(audit).includes(password),
    "No credentials in audit",
  );
});

test("suspending an organiser cancels upcoming events, withdraws driving and releases passenger seats without deleting history", async () => {
  const person = await account("organiser");
  const passenger = await account("affected-passenger");
  const partner = await account("affected-partner");
  const event = await post(person, {
    post_type: "event",
    starts_at: "2099-02-01T00:00:00Z",
    timezone: "Pacific/Auckland",
    event_location: "Future gathering",
  });
  const eventRide = await offer(event);
  assert.ifError(
    (
      await passenger.db.rpc("set_event_rsvp", {
        target_event: event,
        chosen_response: "going",
      })
    ).error,
  );
  assert.ifError(
    (
      await passenger.db.rpc("book_ride", {
        target_ride: eventRide,
        booking_mode: "self",
        operation_id: randomUUID(),
      })
    ).error,
  );
  const ownDrivingPost = await post();
  const ownRide = await offer(ownDrivingPost, person);
  assert.ifError(
    (
      await passenger.db.rpc("book_ride", {
        target_ride: ownRide,
        booking_mode: "self",
        operation_id: randomUUID(),
      })
    ).error,
  );
  const passengerPost = await post();
  const otherRide = await offer(passengerPost);
  assert.ifError(
    (
      await person.db.rpc("book_ride", {
        target_ride: otherRide,
        booking_mode: "self",
        operation_id: randomUUID(),
      })
    ).error,
  );
  const request = await person.db.rpc("request_partner", {
    target_user: partner.id,
  });
  assert.ifError(request.error);
  assert.ifError(
    (
      await partner.db.rpc("respond_partner", {
        target_relationship: request.data,
        decision: "accept",
      })
    ).error,
  );
  await setStatus(person, "suspended");
  assert.equal(
    (
      await service
        .from("events")
        .select("status")
        .eq("post_id", event)
        .single()
    ).data.status,
    "cancelled",
  );
  assert.equal(
    (await service.from("posts").select("status").eq("id", event).single()).data
      .status,
    "cancelled",
  );
  assert.equal(
    (
      await service
        .from("ride_offers")
        .select("status")
        .eq("id", eventRide)
        .single()
    ).data.status,
    "cancelled",
  );
  assert.equal(
    (
      await service
        .from("ride_reservations")
        .select("status")
        .eq("ride_id", eventRide)
        .single()
    ).data.status,
    "cancelled",
  );
  assert.ok(
    (
      await service
        .from("event_rsvps")
        .select("cancelled_at")
        .eq("event_id", event)
        .single()
    ).data.cancelled_at,
  );
  assert.equal(
    (
      await service
        .from("ride_offers")
        .select("status")
        .eq("id", ownRide)
        .single()
    ).data.status,
    "withdrawn",
  );
  assert.equal(
    (
      await service
        .from("ride_reservations")
        .select("status")
        .eq("ride_id", ownRide)
        .single()
    ).data.status,
    "needs_arrangement",
  );
  assert.equal(
    (
      await service
        .from("ride_reservations")
        .select("status")
        .eq("ride_id", otherRide)
        .single()
    ).data.status,
    "cancelled",
  );
  assert.equal(
    (
      await service
        .from("partner_relationships")
        .select("status")
        .eq("id", request.data)
        .single()
    ).data.status,
    "revoked",
  );
  assert.equal(
    (
      await service
        .from("partner_participants")
        .select("user_id")
        .eq("relationship_id", request.data)
    ).data.length,
    0,
  );
  const notifications = await passenger.db
    .from("notifications")
    .select("kind,message,post_id")
    .in("post_id", [event, ownDrivingPost]);
  assert.ifError(notifications.error);
  assert.ok(
    notifications.data.some(
      (r) => r.post_id === event && /cancel/i.test(r.kind),
    ),
    "Event audience informed",
  );
  assert.ok(
    notifications.data.some(
      (r) =>
        r.post_id === ownDrivingPost &&
        /withdraw|unavailable/i.test(`${r.kind} ${r.message}`),
    ),
    "Ride passengers informed",
  );
  await setStatus(person, "active");
  assert.equal(
    (
      await service
        .from("ride_offers")
        .select("status")
        .eq("id", ownRide)
        .single()
    ).data.status,
    "withdrawn",
  );
  assert.equal(
    (
      await service
        .from("events")
        .select("status")
        .eq("post_id", event)
        .single()
    ).data.status,
    "cancelled",
  );
});

test("suspension racing a booking and partner acceptance leaves no authorised active arrangement", async () => {
  const person = await account("race-suspension");
  const partner = await account("race-partner");
  const parent = await post();
  const ride = await offer(parent);
  const request = await person.db.rpc("request_partner", {
    target_user: partner.id,
  });
  assert.ifError(request.error);
  const results = await Promise.all([
    person.db.rpc("book_ride", {
      target_ride: ride,
      booking_mode: "self",
      operation_id: randomUUID(),
    }),
    partner.db.rpc("respond_partner", {
      target_relationship: request.data,
      decision: "accept",
    }),
    admin.db.rpc("set_member_status", {
      target_user: person.id,
      new_status: "suspended",
    }),
  ]);
  assert.ifError(results[2].error);
  assert.equal((await state(person)).status, "suspended");
  assert.equal(
    (
      await service
        .from("ride_reservations")
        .select("id")
        .eq("passenger_id", person.id)
        .eq("status", "confirmed")
    ).data.length,
    0,
  );
  assert.equal(
    (
      await service
        .from("partner_participants")
        .select("user_id")
        .eq("user_id", person.id)
    ).data.length,
    0,
  );
  assert.ok(
    (
      await person.db.rpc("book_ride", {
        target_ride: ride,
        booking_mode: "self",
        operation_id: randomUUID(),
      })
    ).error,
  );
});

test("suspended and removed former recipients cannot regain access by redeeming another invitation", async () => {
  for (const status of ["suspended", "removed"]) {
    const person = await account(`cannot-reinvite-${status}`, null);
    const accepted = await invite(person.email);
    assert.ifError((await accept(person, accepted)).error);
    await setStatus(person, status);
    assert.ok(
      (await accept(person, accepted)).error,
      "An idempotent redemption retry cannot revive inactive membership",
    );
    const invitation = await admin.db.rpc("create_member_invitation", {
      target_email: person.email,
      delivery: "copy",
    });
    assert.ok(
      invitation.error,
      "A new invitation cannot replace an existing inactive membership",
    );
    assert.equal((await state(person)).status, status);
  }
});
