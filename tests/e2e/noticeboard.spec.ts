import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
process.loadEnvFile(".env.local");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  options,
);
const ownerDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  options,
);
const tag = randomBytes(6).toString("hex"),
  password = randomBytes(24).toString("base64url");
const owner = { id: "", email: `browser-owner-${tag}@example.test` },
  viewer = { id: "", email: `browser-viewer-${tag}@example.test` };
const postIds: string[] = [];
test.beforeAll(async () => {
  for (const person of [owner, viewer]) {
    const { data, error } = await service.auth.admin.createUser({
      email: person.email,
      password,
      email_confirm: true,
    });
    expect(error).toBeNull();
    person.id = data.user!.id;
    expect(
      (
        await service.from("profiles").insert({
          id: person.id,
          display_name: person === owner ? "Test owner" : "Test viewer",
        })
      ).error,
    ).toBeNull();
    expect(
      (await service.from("memberships").insert({ user_id: person.id })).error,
    ).toBeNull();
  }
  expect(
    (await ownerDb.auth.signInWithPassword({ email: owner.email, password }))
      .error,
  ).toBeNull();
});
test.afterAll(async () => {
  for (const id of postIds) {
    const { data: photos } = await service
      .from("post_photos")
      .select("object_path")
      .eq("post_id", id);
    const paths = photos?.map((p) => p.object_path) || [];
    await ownerDb.rpc("delete_post", { target_id: id });
    if (paths.length) {
      await service.storage.from("community-photos").remove(paths);
      await service.from("photo_cleanup").delete().in("object_path", paths);
    }
  }
  for (const person of [owner, viewer]) {
    await service.from("memberships").delete().eq("user_id", person.id);
    await service.from("profiles").delete().eq("id", person.id);
    await service.auth.admin.deleteUser(person.id);
  }
});
async function signIn(page: Page, email = owner.email) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little closer together." }),
  ).toBeVisible();
}
async function newPost(
  page: Page,
  type = "discussion",
  title = `Noticeboard ${tag}`,
) {
  await page.goto("/posts/new");
  await page.getByLabel("Post type", { exact: true }).selectOption(type);
  await page
    .getByLabel("Category", { exact: true })
    .selectOption({ label: "General" });
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page
    .getByLabel("Description", { exact: true })
    .fill("A useful thing for our community.");
}
async function publish(page: Page) {
  await page.getByRole("button", { name: "Publish post", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Post saved");
  const id = new URL(page.url()).pathname.split("/")[2];
  postIds.push(id);
  return id;
}

test("posts, filters, comments, saved posts, editing and deletion work for an ordinary member", async ({
  page,
}) => {
  test.setTimeout(90000);
  await signIn(page);
  const title = `Borrow tools ${tag}`;
  await newPost(page, "offer", title);
  await page.getByLabel("Availability (optional)").fill("This weekend");
  await page
    .getByLabel("Conditions or useful details (optional)")
    .fill("Bring it back on Sunday");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Useful drill <script>window.noticeboardUnsafe=true</script>");
  const id = await publish(page);
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".post-body").first()).toContainText("<script>");
  expect(await page.evaluate(() => "noticeboardUnsafe" in window)).toBeFalsy();
  await page.getByRole("button", { name: "Save post", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unsave post" })).toBeVisible();
  await page.getByRole("link", { name: "Saved posts", exact: true }).click();
  await expect(
    page.getByRole("link", { name: title, exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: title, exact: true }).click();
  await page.getByRole("button", { name: "Unsave post" }).click();
  await page
    .getByLabel("Add a comment", { exact: true })
    .fill("Can I borrow it?");
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect(page.locator(".comment .post-body")).toHaveText(
    "Can I borrow it?",
  );
  await page.getByText("Edit comment", { exact: true }).click();
  await page
    .getByLabel("Your comment", { exact: true })
    .fill("I can collect it Saturday.");
  await page.getByRole("button", { name: "Save comment", exact: true }).click();
  await expect(page.locator(".comment .post-body")).toHaveText(
    "I can collect it Saturday.",
  );
  await page
    .getByRole("button", { name: "Delete comment", exact: true })
    .click();
  await expect(
    page.getByText("No comments yet. Start the conversation."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Edit post", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill(title + " updated");
  await page.getByLabel("Status", { exact: true }).selectOption("fulfilled");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: title + " updated", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".detail .badge").last()).toHaveText("Fulfilled");
  await page.goto("/");
  await page.getByLabel("Search posts", { exact: true }).fill(tag);
  await page.getByLabel("Post type", { exact: true }).selectOption("offer");
  await page.getByLabel("Status", { exact: true }).selectOption("fulfilled");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByRole("link", { name: title + " updated", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Post type", { exact: true }).selectOption("request");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByRole("heading", { name: "No matching posts." }),
  ).toBeVisible();
  await page.goto(`/posts/${id}`);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByText("Delete this post", { exact: true }).click();
  await page.getByLabel("I understand and want to delete this post").check();
  await page.getByRole("button", { name: "Delete post permanently" }).click();
  await expect(page.getByRole("status")).toContainText("Post deleted");
  await page.goto(`/posts/${id}`);
  await expect(
    page.getByRole("heading", { name: "That page isn’t available." }),
  ).toBeVisible();
});

test("event forms preserve timezone, reject invalid dates and populate the upcoming sidebar", async ({
  page,
}) => {
  test.setTimeout(60000);
  await signIn(page);
  const title = `Park picnic ${tag}`;
  await newPost(page, "event", title);
  await page.getByLabel("Starts", { exact: true }).fill("2030-01-15T18:00");
  await page.getByLabel("Ends (optional)").fill("2030-01-15T17:00");
  await page
    .getByLabel("Event location or meeting point")
    .fill("The park gates");
  await page.getByRole("button", { name: "Publish post" }).click();
  await expect(page.locator(".post-form [role=alert]")).toContainText(
    "end must be after",
  );
  await page.getByLabel("Starts", { exact: true }).fill("2030-09-29T02:30");
  await page.getByRole("button", { name: "Publish post" }).click();
  await expect(page.locator(".post-form [role=alert]")).toContainText(
    "daylight saving",
  );
  await page.getByLabel("Title", { exact: true }).evaluate((el) => {
    if (!(el as HTMLInputElement).value)
      throw new Error("Validation discarded the title");
  });
  await page.getByLabel("Starts", { exact: true }).fill("2030-01-15T18:00");
  await page.getByLabel("Ends (optional)").fill("2030-01-15T20:00");
  const id = await publish(page);
  await expect(page.locator(".event-details")).toContainText("The park gates");
  await expect(
    page.locator(".upcoming").getByRole("link", { name: title, exact: true }),
  ).toBeVisible();
  expect(
    (
      await service
        .from("events")
        .select("starts_at,timezone")
        .eq("post_id", id)
        .single()
    ).data?.starts_at,
  ).toBe("2030-01-15T05:00:00+00:00");
  await page.getByRole("link", { name: "Edit post", exact: true }).click();
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue(
    "2030-01-15T18:00",
  );
  await page.getByLabel("Status", { exact: true }).selectOption("cancelled");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText("Comments are closed on this cancelled post."),
  ).toBeVisible();
  await expect(
    page.locator(".upcoming").getByRole("link", { name: title, exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Edit post", exact: true }).click();
  await page.getByLabel("Starts", { exact: true }).fill("2020-01-15T18:00");
  await page.getByLabel("Ends (optional)").fill("2020-01-15T20:00");
  await page.getByLabel("Status", { exact: true }).selectOption("open");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".upcoming").getByRole("link", { name: title, exact: true }),
  ).toHaveCount(0);
});

test("private photos validate real bytes, strip metadata and enforce ownership and revocation", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(90000);
  await signIn(page);
  const title = `Garden photos ${tag}`;
  await newPost(page, "discussion", title);
  const id = await publish(page);
  const bytes = await sharp({
    create: { width: 2400, height: 1200, channels: 3, background: "#2F7D6B" },
  })
    .jpeg()
    .withMetadata()
    .toBuffer();
  await page.getByLabel("Add a photo", { exact: true }).setInputFiles({
    name: "garden.jpg",
    mimeType: "image/jpeg",
    buffer: bytes,
  });
  await expect(page.getByAltText("Selected photo preview")).toBeVisible();
  await page.getByRole("button", { name: "Upload photo", exact: true }).click();
  await expect(page.getByText("Photo added.", { exact: true })).toBeVisible();
  await expect(page.locator(".photo-grid img")).toHaveCount(1);
  const src = (await page.locator(".photo-grid img").getAttribute("src"))!;
  const response = await page.request.get(src);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const metadata = await sharp(await response.body()).metadata();
  expect(metadata.format).toBe("webp");
  expect(metadata.width).toBeLessThanOrEqual(1920);
  expect(metadata.exif).toBeUndefined();
  expect((await request.get(src)).status()).toBe(401);
  const spoof = await page.request.post(`/api/posts/${id}/photos`, {
    headers: { Origin: "http://localhost:3000" },
    multipart: {
      photo: {
        name: "fake.png",
        mimeType: "image/png",
        buffer: Buffer.from("<script>bad image</script>"),
      },
    },
  });
  expect(spoof.status()).toBe(400);
  const large = await page.request.post(`/api/posts/${id}/photos`, {
    headers: { Origin: "http://localhost:3000" },
    multipart: {
      photo: {
        name: "large.png",
        mimeType: "image/png",
        buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
      },
    },
  });
  expect(large.status()).toBe(413);
  expect(
    (
      await page.request.post(`/api/posts/${id}/photos`, {
        headers: { Origin: "https://example.com" },
      })
    ).status(),
  ).toBe(403);
  const other = await browser.newPage();
  try {
    await signIn(other, viewer.email);
    await other.goto(`/posts/${id}`);
    await expect(
      other.getByRole("link", { name: "Edit post", exact: true }),
    ).toHaveCount(0);
    await expect(other.getByLabel("Add a photo", { exact: true })).toHaveCount(
      0,
    );
    expect(
      (await other.request.get("http://localhost:3000" + src)).status(),
    ).toBe(200);
    expect(
      (
        await other.request.post(
          `http://localhost:3000/api/posts/${id}/photos`,
          { headers: { Origin: "http://localhost:3000" } },
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await service
          .from("memberships")
          .update({ status: "revoked" })
          .eq("user_id", viewer.id)
      ).error,
    ).toBeNull();
    expect(
      (await other.request.get("http://localhost:3000" + src)).status(),
    ).toBe(401);
  } finally {
    await other.close();
  }
  await page.getByRole("button", { name: "Remove photo 1" }).click();
  await expect(page.locator(".photo-grid img")).toHaveCount(0);
  expect((await page.request.get(src)).status()).toBe(404);
});

test("feed pagination preserves filters and has no duplicate posts when newer content arrives", async ({
  page,
}) => {
  test.setTimeout(90000);
  const { data: category } = await service
    .from("categories")
    .select("id")
    .eq("name", "General")
    .single();
  for (let i = 0; i < 22; i++) {
    const result = await ownerDb.rpc("write_post", {
      target_id: null,
      content: {
        post_type: "offer",
        category_id: category!.id,
        title: `Paging ${tag} ${i}`,
        description: "Pagination fixture",
        status: "open",
      },
    });
    expect(result.error).toBeNull();
    postIds.push(result.data);
  }
  await signIn(page);
  await page.goto(
    `/?q=Paging+${tag}&type=offer&status=open&category=${category!.id}`,
  );
  await expect(page.locator(".post-card")).toHaveCount(20);
  const firstPage = await page
    .locator(".post-card h2 a")
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  const latest = await ownerDb.rpc("write_post", {
    target_id: null,
    content: {
      post_type: "offer",
      category_id: category!.id,
      title: `Paging ${tag} newest`,
      description: "Arrived after first page",
      status: "open",
    },
  });
  expect(latest.error).toBeNull();
  postIds.push(latest.data);
  await page.getByRole("link", { name: "Older posts", exact: true }).click();
  await expect(page.locator(".post-card")).toHaveCount(2);
  const secondPage = await page
    .locator(".post-card h2 a")
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  expect(secondPage.some((href) => firstPage.includes(href))).toBeFalsy();
  expect(secondPage).not.toContain(`/posts/${latest.data}`);
  const u = new URL(page.url());
  expect(u.searchParams.get("type")).toBe("offer");
  expect(u.searchParams.get("category")).toBe(category!.id);
  expect(u.searchParams.get("q")).toBe(`Paging ${tag}`);
});
