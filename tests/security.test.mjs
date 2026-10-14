import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
  "Tests require local Supabase",
);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  options,
);
const client = () =>
  createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
const anon = client(),
  suffix = randomBytes(6).toString("hex"),
  password = randomBytes(24).toString("base64url");
const users = [],
  inviteIds = [];
let admin, member, pending, other, revokedPerson;
let privatePostId;
async function registered(name, role) {
  const email = `${name}-${suffix}@example.test`;
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
        await service
          .from("profiles")
          .insert({ id: data.user.id, display_name: name })
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
  return { db, id: data.user.id, email };
}
async function invited(name) {
  const email = `${name}-${suffix}@example.test`;
  const { data: id, error } = await admin.db.rpc("issue_invitation", {
    target_email: email,
  });
  assert.ifError(error);
  inviteIds.push(id);
  const { data, error: linkError } = await service.auth.admin.generateLink({
    type: "invite",
    email,
  });
  assert.ifError(linkError);
  users.push(data.user.id);
  const db = client();
  assert.ifError(
    (
      await db.auth.verifyOtp({
        token_hash: data.properties.hashed_token,
        type: "invite",
      })
    ).error,
  );
  return {
    db,
    id: data.user.id,
    invitationId: id,
    hash: data.properties.hashed_token,
    email,
  };
}
before(async () => {
  admin = await registered("administrator", "admin");
  member = await registered("member", "member");
  pending = await registered("pending");
  other = await registered("other", "member");
});
after(async () => {
  await service.from("partner_relationships").delete().in("user_a", users);
  await service.from("notifications").delete().in("recipient_id", users);
  await service.from("saved_posts").delete().in("user_id", users);
  if (privatePostId)
    await service.from("posts").delete().eq("id", privatePostId);
  await service.from("invitations").delete().in("issued_by", users);
  await service.from("memberships").delete().in("user_id", users);
  await service.from("profiles").delete().in("id", users);
  for (const id of users) await service.auth.admin.deleteUser(id);
});
test("public registration is disabled at Auth, not only hidden", async () => {
  const { error } = await anon.auth.signUp({
    email: `public-${suffix}@example.test`,
    password,
  });
  assert.ok(error);
  assert.match(error.message, /disabled|not allowed/i);
});
test("anonymous users cannot read private tables", async () => {
  for (const table of [
    "profiles",
    "posts",
    "events",
    "ride_offers",
    "ride_reservations",
    "invitations",
  ]) {
    const result = await anon.from(table).select("*");
    assert.ok(result.error || result.data.length === 0, table);
  }
});
test("pending accounts cannot read community profiles or activate without invitation", async () => {
  assert.deepEqual((await pending.db.from("profiles").select("*")).data, []);
  assert.ok((await pending.db.rpc("activate_membership")).error);
});
test("members can read profiles but not invitation records", async () => {
  const invitation = await admin.db.rpc("issue_invitation", {
    target_email: `hidden-${suffix}@example.test`,
  });
  assert.ifError(invitation.error);
  assert.equal(
    (await admin.db.from("invitations").select("*").eq("id", invitation.data))
      .data.length,
    1,
  );
  assert.ok(
    (await member.db.from("profiles").select("*")).data.some(
      (p) => p.id === admin.id,
    ),
  );
  assert.deepEqual((await member.db.from("invitations").select("*")).data, []);
});
test("ordinary members cannot issue invites, revoke others, or elevate their role", async () => {
  assert.ok(
    (
      await member.db.rpc("issue_invitation", {
        target_email: "no@example.test",
      })
    ).error,
  );
  assert.ok(
    (await member.db.rpc("revoke_membership", { target_user: admin.id })).error,
  );
  assert.ok(
    (
      await member.db
        .from("memberships")
        .update({ role: "admin" })
        .eq("user_id", member.id)
    ).error,
  );
  assert.equal(
    (
      await service
        .from("memberships")
        .select("role")
        .eq("user_id", member.id)
        .single()
    ).data.role,
    "member",
  );
});
test("profile updates are limited to their owner", async () => {
  assert.ifError(
    (
      await member.db
        .from("profiles")
        .update({ display_name: "Updated member" })
        .eq("id", member.id)
    ).error,
  );
  await member.db
    .from("profiles")
    .update({ display_name: "Tampered" })
    .eq("id", admin.id);
  assert.equal(
    (
      await service
        .from("profiles")
        .select("display_name")
        .eq("id", admin.id)
        .single()
    ).data.display_name,
    "administrator",
  );
});
test("verified invitation activates once under concurrent redemption", async () => {
  const invitedUser = await invited("concurrent");
  const results = await Promise.all([
    invitedUser.db.rpc("activate_membership"),
    invitedUser.db.rpc("activate_membership"),
  ]);
  assert.equal(results.filter((r) => !r.error).length, 1);
  assert.equal(
    (
      await service
        .from("memberships")
        .select("*")
        .eq("user_id", invitedUser.id)
    ).data.length,
    1,
  );
  assert.ok(
    (
      await client().auth.verifyOtp({
        token_hash: invitedUser.hash,
        type: "invite",
      })
    ).error,
    "Auth link cannot be reused",
  );
});
test("revoked invitation cannot activate a verified account", async () => {
  const person = await invited("revoked-invite");
  assert.ifError(
    (
      await admin.db.rpc("revoke_invitation", {
        invitation_id: person.invitationId,
      })
    ).error,
  );
  assert.ok((await person.db.rpc("activate_membership")).error);
});
test("expired invitation cannot activate", async () => {
  const person = await invited("expired");
  assert.ifError(
    (
      await service
        .from("invitations")
        .update({
          created_at: "2020-01-01T00:00:00Z",
          expires_at: "2020-01-02T00:00:00Z",
        })
        .eq("id", person.invitationId)
    ).error,
  );
  assert.match(
    (await person.db.rpc("activate_membership")).error.message,
    /expired/i,
  );
});
test("member revocation blocks an already authenticated session", async () => {
  const person = await invited("revoked-member");
  revokedPerson = person;
  assert.ifError((await person.db.rpc("activate_membership")).error);
  assert.ifError(
    (await admin.db.rpc("revoke_membership", { target_user: person.id })).error,
  );
  assert.deepEqual((await person.db.from("profiles").select("*")).data, []);
  assert.ok((await person.db.rpc("activate_membership")).error);
});
test("private photo downloads require current membership", async () => {
  const path = `tests/${suffix}.png`;
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1sAAAAASUVORK5CYII=",
    "base64",
  );
  assert.ifError(
    (
      await service.storage
        .from("community-photos")
        .upload(path, bytes, { contentType: "image/png" })
    ).error,
  );
  const category = (
    await service.from("categories").select("id").limit(1).single()
  ).data;
  const created = await service
    .from("posts")
    .insert({
      author_id: member.id,
      category_id: category.id,
      post_type: "discussion",
      title: "Photo security fixture",
      description: "Private photo access test",
    })
    .select("id")
    .single();
  assert.ifError(created.error);
  const photo = await service
    .from("post_photos")
    .insert({
      post_id: created.data.id,
      uploader_id: member.id,
      object_path: path,
    })
    .select("id")
    .single();
  assert.ifError(photo.error);
  try {
    assert.ok(
      (await anon.storage.from("community-photos").download(path)).error,
    );
    assert.ok(
      (await pending.db.storage.from("community-photos").download(path)).error,
    );
    assert.ifError(
      (await member.db.storage.from("community-photos").download(path)).error,
    );
    assert.ok(
      (await revokedPerson.db.storage.from("community-photos").download(path))
        .error,
    );
  } finally {
    await service.from("post_photos").delete().eq("id", photo.data.id);
    await service.from("posts").delete().eq("id", created.data.id);
    await service.storage.from("community-photos").remove([path]);
  }
});
test("future ride and relationship mutation APIs cannot be bypassed", async () => {
  assert.ok(
    (
      await member.db.from("ride_offers").insert({
        post_id: crypto.randomUUID(),
        driver_id: member.id,
        capacity: 1,
        pickup: "Here",
      })
    ).error,
  );
  assert.ok(
    (
      await member.db
        .from("partner_participants")
        .insert({ user_id: member.id, relationship_id: crypto.randomUUID() })
    ).error,
  );
});

test("saved posts, notifications and partner links remain private even to other active members", async () => {
  const { data: category } = await service
    .from("categories")
    .select("id")
    .limit(1)
    .single();
  const { data: post, error } = await service
    .from("posts")
    .insert({
      author_id: admin.id,
      category_id: category.id,
      post_type: "discussion",
      title: "Security fixture",
      description: "Test-only content",
    })
    .select("id")
    .single();
  assert.ifError(error);
  privatePostId = post.id;
  assert.ifError(
    (
      await service
        .from("saved_posts")
        .insert({ user_id: admin.id, post_id: post.id })
    ).error,
  );
  const notification = await service
    .from("notifications")
    .insert({ recipient_id: admin.id, kind: "test" })
    .select("id")
    .single();
  assert.ifError(notification.error);
  const [user_a, user_b] = [admin.id, other.id].sort();
  const relationship = await service
    .from("partner_relationships")
    .insert({ user_a, user_b, requested_by: admin.id })
    .select("id")
    .single();
  assert.ifError(relationship.error);
  assert.equal(
    (await admin.db.from("saved_posts").select("*").eq("post_id", post.id)).data
      .length,
    1,
  );
  assert.equal(
    (
      await admin.db
        .from("notifications")
        .select("*")
        .eq("id", notification.data.id)
    ).data.length,
    1,
  );
  assert.equal(
    (
      await admin.db
        .from("partner_relationships")
        .select("*")
        .eq("id", relationship.data.id)
    ).data.length,
    1,
  );
  assert.deepEqual(
    (await member.db.from("saved_posts").select("*").eq("post_id", post.id))
      .data,
    [],
  );
  assert.deepEqual(
    (
      await member.db
        .from("notifications")
        .select("*")
        .eq("id", notification.data.id)
    ).data,
    [],
  );
  assert.deepEqual(
    (
      await member.db
        .from("partner_relationships")
        .select("*")
        .eq("id", relationship.data.id)
    ).data,
    [],
  );
});
