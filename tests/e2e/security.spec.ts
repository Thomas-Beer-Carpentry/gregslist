import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("Local test database required");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  options,
);
const tag = randomBytes(6).toString("hex"),
  password = randomBytes(24).toString("base64url");
const people = [
  "owner",
  "other",
  "administrator",
  "nonmember",
  "removed",
  "webdelete",
].map((name) => ({
  name,
  id: "",
  email: `security-ui-${name}-${tag}@example.test`,
  token: "",
  db: createClient(
    url,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    options,
  ),
}));
let postId = "",
  otherPost = "",
  photoId = "",
  rideId = "";
let png: Buffer;
const legacyPath = `legacy-erasure-fixture/${tag}.webp`;
test.beforeAll(async () => {
  // Six real Auth accounts, password hashes and media/booking fixtures share
  // one local service; allow setup separately from individual UI assertions.
  test.setTimeout(90000);
  png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#0B3D2E" },
  })
    .png()
    .toBuffer();
  for (const person of people) {
    const result = await service.auth.admin.createUser({
      email: person.email,
      password,
      email_confirm: true,
    });
    expect(result.error).toBeNull();
    person.id = result.data.user!.id;
    if (person.name !== "nonmember") {
      expect(
        (
          await service.from("profiles").insert({
            id: person.id,
            display_name: `Security ${person.name}`,
            bio: "Private profile content",
          })
        ).error,
      ).toBeNull();
      expect(
        (
          await service.from("memberships").insert({
            user_id: person.id,
            role: person.name === "administrator" ? "admin" : "member",
            status: person.name === "removed" ? "removed" : "active",
          })
        ).error,
      ).toBeNull();
    }
    const signed = await person.db.auth.signInWithPassword({
      email: person.email,
      password,
    });
    expect(signed.error).toBeNull();
    person.token = signed.data.session!.access_token;
  }
  const category = (
    await service.from("categories").select("id").eq("name", "General").single()
  ).data!.id;
  for (const person of people.slice(0, 2)) {
    const result = await person.db.rpc("write_post", {
      target_id: null,
      content: {
        post_type: "discussion",
        title: `Private ${person.name} text ${tag}`,
        description: "Remove only the deleting account's own text.",
        category_id: category,
        ride_coordination_enabled: true,
      },
    });
    expect(result.error).toBeNull();
    if (person.name === "owner") postId = result.data;
    else otherPost = result.data;
  }
  const ride = await people[1].db.rpc("write_ride", {
    target_id: null,
    target_post: postId,
    content: { pickup: "A pickup to close safely", capacity: 2 },
    operation_id: randomUUID(),
  });
  expect(ride.error).toBeNull();
  rideId = ride.data;
  expect(
    (
      await people[0].db.rpc("book_ride", {
        target_ride: rideId,
        booking_mode: "self",
        operation_id: randomUUID(),
      })
    ).error,
  ).toBeNull();
  expect(
    (
      await service.storage
        .from("community-photos")
        .upload(legacyPath, await sharp(png).webp().toBuffer(), {
          contentType: "image/webp",
        })
    ).error,
  ).toBeNull();
  const photo = await service
    .from("post_photos")
    .insert({
      post_id: postId,
      uploader_id: people[0].id,
      object_path: legacyPath,
    })
    .select("id")
    .single();
  expect(photo.error).toBeNull();
  photoId = photo.data!.id;
});
test.afterAll(async () => {
  const ids = people.map((person) => person.id),
    posts = [postId, otherPost].filter(Boolean);
  await service.from("admin_audit").delete().in("actor_id", ids);
  await service.from("account_erasure_jobs").delete().in("user_id", ids);
  await service.from("transport_operations").delete().in("actor_id", ids);
  await service.from("ride_reservation_history").delete().in("post_id", posts);
  await service.from("ride_reservations").delete().in("post_id", posts);
  await service.from("ride_offers").delete().in("post_id", posts);
  await service.from("notifications").delete().in("recipient_id", ids);
  await service.from("comments").delete().in("post_id", posts);
  await service.from("post_photos").delete().in("post_id", posts);
  await service.from("saved_posts").delete().in("post_id", posts);
  await service.from("posts").delete().in("id", posts);
  await service.from("invitations").delete().in("issued_by", ids);
  await service.from("memberships").delete().in("user_id", ids);
  await service.from("profiles").delete().in("id", ids);
  await service.storage.from("community-photos").remove([legacyPath]);
  for (const person of people) await service.auth.admin.deleteUser(person.id);
});
test("private response headers use per-response script nonces and deny indexing", async ({
  request,
}) => {
  const first = await request.get("/login"),
    second = await request.get("/login");
  const policy = first.headers()["content-security-policy"];
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(
    policy.split(";").find((value) => value.trim().startsWith("script-src")),
  ).not.toContain("'unsafe-inline'");
  expect(policy).not.toBe(second.headers()["content-security-policy"]);
  expect(first.headers()["x-robots-tag"]).toContain("noindex");
  expect(first.headers()["cache-control"]).toContain("no-store");
  expect(await (await request.get("/robots.txt")).text()).toContain(
    "Disallow: /",
  );
});
test("web Auth cookies are HttpOnly and signing out removes private access", async ({
  page,
  context,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(people[5].email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("http://localhost:3000/");
  const cookies = (await context.cookies()).filter((cookie) =>
    cookie.name.startsWith("sb-"),
  );
  expect(cookies.length > 0).toBe(true);
  expect(
    cookies.every((cookie) => cookie.httpOnly && cookie.sameSite === "Lax"),
  ).toBe(true);
  expect(await page.evaluate(() => document.cookie.includes("sb-"))).toBe(
    false,
  );
  const invalid = await page.request.post(`/api/posts/${postId}/photos`, {
    headers: {
      authorization: "Bearer invalid",
      origin: "http://localhost:3000",
    },
  });
  expect(invalid.status()).toBe(401);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});
test("native bearer media requests preserve membership, ownership and file validation", async ({
  request,
}) => {
  expect((await request.get(`/photos/${photoId}`)).status()).toBe(401);
  expect(
    (
      await request.get(`/photos/${photoId}`, {
        headers: { authorization: `Bearer ${people[3].token}` },
      })
    ).status(),
  ).toBe(401);
  const valid = await request.get(`/photos/${photoId}`, {
    headers: { authorization: `Bearer ${people[1].token}` },
  });
  expect(valid.status()).toBe(200);
  expect(valid.headers()["cache-control"]).toContain("no-store");
  const denied = await request.post(`/api/posts/${postId}/photos`, {
    headers: { authorization: `Bearer ${people[1].token}` },
    multipart: {
      photo: { name: "photo.png", mimeType: "image/png", buffer: png },
    },
  });
  expect(denied.status()).toBe(403);
  const bad = await request.post(`/api/posts/${postId}/photos`, {
    headers: { authorization: `Bearer ${people[0].token}` },
    multipart: {
      photo: {
        name: "unsafe.png",
        mimeType: "image/png",
        buffer: Buffer.from("<svg><script>alert(1)</script></svg>"),
      },
    },
  });
  expect(bad.status()).toBe(400);
  const good = await request.post(`/api/posts/${postId}/photos`, {
    headers: { authorization: `Bearer ${people[0].token}` },
    multipart: {
      photo: { name: "photo.png", mimeType: "image/png", buffer: png },
    },
  });
  expect(good.status()).toBe(201);
});
test("native email invitations require a current administrator and reveal no token", async ({
  request,
}) => {
  expect(
    (
      await request.post("/api/mobile/invitations", {
        data: { email: `native-${tag}@example.test` },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post("/api/mobile/invitations", {
        headers: { authorization: `Bearer ${people[0].token}` },
        data: { email: `native-${tag}@example.test` },
      })
    ).status(),
  ).toBe(403);
  const result = await request.post("/api/mobile/invitations", {
    headers: { authorization: `Bearer ${people[2].token}` },
    data: { email: `native-${tag}@example.test` },
  });
  expect(result.status()).toBe(201);
  const body = await result.json();
  expect(Boolean(body.token || body.token_hash)).toBe(false);
});
test("account deletion verifies the password and rejects an injected target ID", async ({
  request,
}) => {
  const headers = { authorization: `Bearer ${people[0].token}` };
  expect(
    (
      await request.post("/api/mobile/account-deletion", {
        headers,
        data: { password: "wrong-password", confirmation: "DELETE" },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.post("/api/mobile/account-deletion", {
        headers,
        data: { password, confirmation: "DELETE", user_id: people[1].id },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await service
        .from("memberships")
        .select("user_id")
        .eq("user_id", people[0].id)
    ).data,
  ).toHaveLength(1);
});
test("immediate deletion removes Auth, authored content and even legacy media paths without harming unrelated data", async ({
  request,
}) => {
  const result = await request.post("/api/mobile/account-deletion", {
    headers: { authorization: `Bearer ${people[0].token}` },
    data: { password, confirmation: "DELETE" },
  });
  expect(result.status()).toBe(200);
  expect(
    Boolean((await service.auth.admin.getUserById(people[0].id)).error),
  ).toBe(true);
  expect(
    (
      await service
        .from("memberships")
        .select("user_id")
        .eq("user_id", people[0].id)
    ).data,
  ).toHaveLength(0);
  expect(
    (
      await service
        .from("profiles")
        .select("display_name,bio")
        .eq("id", people[0].id)
        .single()
    ).data,
  ).toEqual({ display_name: "Former member", bio: "" });
  expect(
    (await service.from("posts").select("title").eq("id", postId).single())
      .data!.title,
  ).toBe("Deleted post");
  expect(
    (await service.from("posts").select("title").eq("id", otherPost).single())
      .data!.title,
  ).toContain("Private other");
  expect(
    (
      await service
        .from("ride_offers")
        .select("status")
        .eq("id", rideId)
        .single()
    ).data!.status,
  ).toBe("cancelled");
  expect(
    Boolean(
      (await service.storage.from("community-photos").download(legacyPath))
        .error,
    ),
  ).toBe(true);
  expect(
    (
      await request.get(`/photos/${photoId}`, {
        headers: { authorization: `Bearer ${people[1].token}` },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.get(`/photos/${photoId}`, {
        headers: { authorization: `Bearer ${people[0].token}` },
      })
    ).status(),
  ).toBe(401);
});
test("removed members retain the right to delete their own account", async ({
  request,
}) => {
  const result = await request.post("/api/mobile/account-deletion", {
    headers: { authorization: `Bearer ${people[4].token}` },
    data: { password, confirmation: "DELETE" },
  });
  expect(result.status()).toBe(200);
});
test("maintenance cannot be invoked without its separate secret", async ({
  request,
}) => {
  expect([401, 503]).toContain(
    (await request.get("/api/maintenance/privacy")).status(),
  );
  expect([401, 503]).toContain(
    (
      await request.get("/api/maintenance/privacy", {
        headers: { authorization: "Bearer not-the-maintenance-secret" },
      })
    ).status(),
  );
});

test("the web deletion form requires confirmation and completes after password verification", async ({
  page,
}) => {
  const person = people.find((person) => person.name === "webdelete")!;
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(person.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("http://localhost:3000/");
  await page.goto("/account-deletion");
  await page
    .getByLabel("Current password", { exact: true })
    .fill("wrong-password");
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Delete my account permanently" })
    .click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "No data was deleted",
  );
  await page.getByLabel("Current password", { exact: true }).fill(password);
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Delete my account permanently" })
    .click();
  await expect(page).toHaveURL(/\/login\?message=/);
  await expect(page.getByRole("status")).toContainText("have been deleted");
  expect(Boolean((await service.auth.admin.getUserById(person.id)).error)).toBe(
    true,
  );
});
