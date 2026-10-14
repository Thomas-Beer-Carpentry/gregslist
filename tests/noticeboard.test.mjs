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
const make = () =>
  createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
const tag = randomBytes(6).toString("hex"),
  password = randomBytes(24).toString("base64url");
const ids = [],
  posts = [];
let alice, bob, revoked, category;
async function person(name) {
  const { data, error } = await service.auth.admin.createUser({
    email: `${name}-${tag}@example.test`,
    password,
    email_confirm: true,
  });
  assert.ifError(error);
  ids.push(data.user.id);
  assert.ifError(
    (
      await service
        .from("profiles")
        .insert({ id: data.user.id, display_name: name })
    ).error,
  );
  assert.ifError(
    (await service.from("memberships").insert({ user_id: data.user.id })).error,
  );
  const db = make();
  assert.ifError(
    (await db.auth.signInWithPassword({ email: data.user.email, password }))
      .error,
  );
  return { id: data.user.id, db };
}
function content(extra = {}) {
  return {
    title: `Tools ${tag}`,
    description: "A drill available to borrow",
    post_type: "offer",
    category_id: category,
    status: "open",
    ...extra,
  };
}
async function create(extra = {}) {
  const r = await alice.db.rpc("write_post", {
    target_id: null,
    content: content(extra),
  });
  assert.ifError(r.error);
  posts.push(r.data);
  return r.data;
}
before(async () => {
  alice = await person("alice");
  bob = await person("bob");
  revoked = await person("revoked");
  assert.ifError(
    (
      await service
        .from("memberships")
        .update({ status: "revoked" })
        .eq("user_id", revoked.id)
    ).error,
  );
  category = (
    await service.from("categories").select("id").eq("name", "General").single()
  ).data.id;
});
after(async () => {
  for (const id of posts) {
    await alice.db.rpc("delete_post", { target_id: id });
  }
  await service.from("comments").delete().in("author_id", ids);
  await service.from("saved_posts").delete().in("user_id", ids);
  await service.from("post_photos").delete().in("uploader_id", ids);
  await service.from("events").delete().in("post_id", posts);
  await service.from("posts").delete().in("author_id", ids);
  await service.from("memberships").delete().in("user_id", ids);
  await service.from("profiles").delete().in("id", ids);
  for (const id of ids) await service.auth.admin.deleteUser(id);
});
test("member creates a post; forged author and timestamps cannot be supplied", async () => {
  const id = await create({ author_id: bob.id, created_at: "2000-01-01" });
  const { data } = await alice.db
    .from("posts")
    .select("*")
    .eq("id", id)
    .single();
  assert.equal(data.author_id, alice.id);
  assert.equal(data.ride_coordination_enabled, false);
  assert.ok(new Date(data.created_at).getFullYear() > 2020);
});
test("only owner edits and post type is immutable; raw table writes stay denied", async () => {
  const id = await create();
  assert.ok(
    (
      await bob.db.rpc("write_post", {
        target_id: id,
        content: content({ title: "Stolen" }),
      })
    ).error,
  );
  assert.ok(
    (await alice.db.from("posts").update({ author_id: bob.id }).eq("id", id))
      .error,
  );
  assert.ok(
    (
      await alice.db.rpc("write_post", {
        target_id: id,
        content: content({ post_type: "request" }),
      })
    ).error,
  );
  assert.ifError(
    (
      await alice.db.rpc("write_post", {
        target_id: id,
        content: content({ title: "Updated", status: "fulfilled" }),
      })
    ).error,
  );
  assert.equal(
    (await alice.db.from("posts").select("title,status").eq("id", id).single())
      .data.status,
    "fulfilled",
  );
});
test("comments are owned, editable, safely stored as text, and deletable", async () => {
  const id = await create();
  const c = await bob.db.rpc("write_comment", {
    target_post: id,
    comment_id: null,
    comment_body: "<script>alert(1)</script>",
  });
  assert.ifError(c.error);
  assert.ok(
    (
      await alice.db.rpc("write_comment", {
        target_post: id,
        comment_id: c.data,
        comment_body: "Forged",
      })
    ).error,
  );
  assert.ifError(
    (
      await bob.db.rpc("write_comment", {
        target_post: id,
        comment_id: c.data,
        comment_body: "Updated comment",
      })
    ).error,
  );
  assert.ok(
    (await alice.db.rpc("delete_comment", { target_id: c.data })).error,
  );
  assert.ifError(
    (await bob.db.rpc("delete_comment", { target_id: c.data })).error,
  );
  assert.equal(
    (await bob.db.from("comments").select("*").eq("id", c.data)).data.length,
    0,
  );
});
test("saved posts are personal, idempotent, and do not affect chronology", async () => {
  const id = await create();
  const created = (
    await alice.db.from("posts").select("created_at").eq("id", id).single()
  ).data.created_at;
  for (let i = 0; i < 2; i++)
    assert.ifError(
      (await bob.db.rpc("set_saved_post", { target_id: id, should_save: true }))
        .error,
    );
  assert.equal(
    (await bob.db.from("saved_posts").select("*").eq("post_id", id)).data
      .length,
    1,
  );
  assert.equal(
    (await alice.db.from("saved_posts").select("*").eq("post_id", id)).data
      .length,
    0,
  );
  assert.equal(
    (await alice.db.from("posts").select("created_at").eq("id", id).single())
      .data.created_at,
    created,
  );
  assert.ifError(
    (await bob.db.rpc("set_saved_post", { target_id: id, should_save: false }))
      .error,
  );
});
test("event posts atomically create their extension and cancelled events stay out of upcoming queries", async () => {
  const id = await create({
    post_type: "event",
    starts_at: "2030-01-01T01:00:00Z",
    ends_at: "2030-01-01T03:00:00Z",
    event_location: "The park",
    timezone: "Pacific/Auckland",
  });
  assert.equal(
    (
      await alice.db
        .from("events")
        .select("location")
        .eq("post_id", id)
        .single()
    ).data.location,
    "The park",
  );
  assert.ifError(
    (
      await alice.db.rpc("write_post", {
        target_id: id,
        content: content({
          post_type: "event",
          status: "cancelled",
          starts_at: "2030-01-01T01:00:00Z",
          event_location: "The park",
          timezone: "Pacific/Auckland",
        }),
      })
    ).error,
  );
  assert.equal(
    (await alice.db.from("events").select("status").eq("post_id", id).single())
      .data.status,
    "cancelled",
  );
  const invalid = await alice.db.rpc("write_post", {
    target_id: null,
    content: content({ post_type: "event" }),
  });
  assert.ok(invalid.error);
  const infinite = await alice.db.rpc("write_post", {
    target_id: null,
    content: content({
      post_type: "event",
      starts_at: "infinity",
      event_location: "Park",
      timezone: "Pacific/Auckland",
    }),
  });
  assert.ok(infinite.error, "Infinite dates cannot break event rendering");
});
test("feed uses full-text search, combined filters and stable chronological cursors", async () => {
  const one = await create({ title: `Pagination ${tag} first` });
  const two = await create({ title: `Pagination ${tag} second` });
  await service
    .from("posts")
    .update({ created_at: "2028-01-01T00:00:00Z" })
    .in("id", [one, two]);
  const a = await alice.db.rpc("noticeboard_feed", {
    search_text: `Pagination ${tag}`,
    category_filter: category,
    type_filter: "offer",
    status_filter: "open",
    page_size: 1,
  });
  assert.ifError(a.error);
  assert.equal(a.data.length, 1);
  const b = await alice.db.rpc("noticeboard_feed", {
    search_text: `Pagination ${tag}`,
    category_filter: category,
    type_filter: "offer",
    status_filter: "open",
    page_size: 1,
    before_time: a.data[0].created_at,
    before_id: a.data[0].id,
  });
  assert.ifError(b.error);
  assert.equal(b.data.length, 1);
  assert.notEqual(a.data[0].id, b.data[0].id);
  assert.equal(
    (
      await alice.db.rpc("noticeboard_feed", {
        search_text: `Pagination ${tag}`,
        type_filter: "request",
      })
    ).data.length,
    0,
  );
});
test("anonymous and revoked users cannot mutate posts, comments, saves or photos", async () => {
  const id = await create();
  for (const db of [make(), revoked.db]) {
    assert.ok(
      (await db.rpc("write_post", { target_id: null, content: content() }))
        .error,
    );
    assert.ok(
      (
        await db.rpc("write_comment", {
          target_post: id,
          comment_id: null,
          comment_body: "No",
        })
      ).error,
    );
    assert.ok(
      (await db.rpc("set_saved_post", { target_id: id, should_save: true }))
        .error,
    );
    assert.ok(
      (
        await db.rpc("attach_post_photo", {
          target_post: id,
          object_name: `${alice.id}/${id}/fake.webp`,
        })
      ).error,
    );
  }
});
test("only owner deletes a post; comments and saves are removed atomically", async () => {
  const id = await create();
  await bob.db.rpc("write_comment", {
    target_post: id,
    comment_id: null,
    comment_body: "Hello",
  });
  await bob.db.rpc("set_saved_post", { target_id: id, should_save: true });
  assert.ok((await bob.db.rpc("delete_post", { target_id: id })).error);
  assert.ifError((await alice.db.rpc("delete_post", { target_id: id })).error);
  assert.equal(
    (await alice.db.from("posts").select("*").eq("id", id)).data.length,
    0,
  );
  assert.equal(
    (await bob.db.from("comments").select("*").eq("post_id", id)).data.length,
    0,
  );
  assert.equal(
    (await bob.db.from("saved_posts").select("*").eq("post_id", id)).data
      .length,
    0,
  );
});
test("photos require validated storage, ownership and an atomic six-photo limit; deleted metadata blocks download", async () => {
  const post = await create();
  assert.ok(
    (
      await alice.db.storage
        .from("community-photos")
        .upload(`${alice.id}/${post}/direct.webp`, Buffer.from("bad"), {
          contentType: "image/webp",
        })
    ).error,
  );
  assert.ok(
    (
      await alice.db.rpc("attach_post_photo", {
        target_post: post,
        object_name: `${bob.id}/${post}/${crypto.randomUUID()}.webp`,
      })
    ).error,
  );
  const sharp = (await import("sharp")).default;
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#0B3D2E" },
  })
    .webp()
    .toBuffer();
  const paths = Array.from(
    { length: 7 },
    () => `${alice.id}/${post}/${crypto.randomUUID()}.webp`,
  );
  try {
    for (const path of paths)
      assert.ifError(
        (
          await service.storage
            .from("community-photos")
            .upload(path, bytes, { contentType: "image/webp" })
        ).error,
      );
    assert.ok(
      (await bob.db.storage.from("community-photos").download(paths[0])).error,
      "Unattached files are private",
    );
    const results = await Promise.all(
      paths.map((object_name) =>
        alice.db.rpc("attach_post_photo", { target_post: post, object_name }),
      ),
    );
    assert.equal(results.filter((r) => !r.error).length, 6);
    assert.equal(results.filter((r) => r.error).length, 1);
    const first = results.find((r) => !r.error).data;
    const path = (
      await service
        .from("post_photos")
        .select("object_path")
        .eq("id", first)
        .single()
    ).data.object_path;
    assert.ifError(
      (await bob.db.storage.from("community-photos").download(path)).error,
    );
    assert.ok(
      (await bob.db.rpc("remove_post_photo", { target_id: first })).error,
    );
    assert.ifError(
      (await alice.db.rpc("remove_post_photo", { target_id: first })).error,
    );
    assert.ok(
      (
        await alice.db.rpc("attach_post_photo", {
          target_post: post,
          object_name: path,
        })
      ).error,
      "Queued photos cannot be reattached",
    );
    assert.ok(
      (await bob.db.storage.from("community-photos").download(path)).error,
    );
    assert.ifError(
      (await alice.db.rpc("delete_post", { target_id: post })).error,
    );
    for (const path of paths)
      assert.ok(
        (await bob.db.storage.from("community-photos").download(path)).error,
      );
  } finally {
    await service.storage.from("community-photos").remove(paths);
    await service.from("photo_cleanup").delete().in("object_path", paths);
  }
});
test("the cleanup retry command removes queued bytes and is safe to repeat", async () => {
  const { execFileSync } = await import("node:child_process");
  const path = `cleanup-tests/${tag}.webp`;
  const sharp = (await import("sharp")).default;
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#0B3D2E" },
  })
    .webp()
    .toBuffer();
  assert.ifError(
    (
      await service.storage
        .from("community-photos")
        .upload(path, bytes, { contentType: "image/webp" })
    ).error,
  );
  assert.ifError(
    (await service.from("photo_cleanup").insert({ object_path: path })).error,
  );
  execFileSync(process.execPath, ["scripts/cleanup-photos.mjs"], {
    stdio: "pipe",
    timeout: 15000,
  });
  assert.equal(
    (await service.from("photo_cleanup").select("*").eq("object_path", path))
      .data.length,
    0,
  );
  assert.ok(
    (await service.storage.from("community-photos").download(path)).error,
  );
  execFileSync(process.execPath, ["scripts/cleanup-photos.mjs"], {
    stdio: "pipe",
    timeout: 15000,
  });
});
