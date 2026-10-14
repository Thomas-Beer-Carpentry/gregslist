import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
process.loadEnvFile(".env.local");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  options,
);
const hostDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  options,
);
const tag = randomBytes(6).toString("hex"),
  password = randomBytes(24).toString("base64url");
const people = [
  { id: "", email: `event-host-${tag}@example.test`, name: "Event host" },
  { id: "", email: `event-alice-${tag}@example.test`, name: "Event Alice" },
  { id: "", email: `event-bob-${tag}@example.test`, name: "Event Bob" },
];
const posts: string[] = [];
test.beforeAll(async () => {
  for (const p of people) {
    const { data, error } = await service.auth.admin.createUser({
      email: p.email,
      password,
      email_confirm: true,
    });
    expect(error).toBeNull();
    p.id = data.user!.id;
    expect(
      (
        await service
          .from("profiles")
          .insert({ id: p.id, display_name: p.name })
      ).error,
    ).toBeNull();
    expect(
      (await service.from("memberships").insert({ user_id: p.id })).error,
    ).toBeNull();
  }
  expect(
    (await hostDb.auth.signInWithPassword({ email: people[0].email, password }))
      .error,
  ).toBeNull();
});
test.afterAll(async () => {
  await service.from("notifications").delete().in("post_id", posts);
  await service.from("event_rsvps").delete().in("event_id", posts);
  for (const id of posts) await hostDb.rpc("delete_post", { target_id: id });
  for (const p of people) {
    await service.from("memberships").delete().eq("user_id", p.id);
    await service.from("profiles").delete().eq("id", p.id);
    await service.auth.admin.deleteUser(p.id);
  }
});
async function login(page: Page, index = 0) {
  await page.goto("http://localhost:3000/login");
  await page.getByLabel("Email", { exact: true }).fill(people[index].email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little closer together." }),
  ).toBeVisible();
}
async function createEvent(
  page: Page,
  title: string,
  capacity: string,
  date = "2035-01-15T18:00",
) {
  await page.goto("/posts/new");
  await page.getByLabel("Post type", { exact: true }).selectOption("event");
  await page
    .getByLabel("Category", { exact: true })
    .selectOption({ label: "Events & Social" });
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page
    .getByLabel("Description", { exact: true })
    .fill("A private event with our friends.");
  await page.getByLabel("Starts", { exact: true }).fill(date);
  await page
    .getByLabel("Event location or meeting point")
    .fill("The old park gate");
  await page.getByLabel("Attendance capacity (optional)").fill(capacity);
  await page.getByRole("button", { name: "Publish post" }).click();
  await expect(page.getByRole("status")).toContainText("Post saved");
  const id = new URL(page.url()).pathname.split("/")[2];
  posts.push(id);
  return id;
}
async function respond(page: Page, response: string) {
  await page
    .locator(".rsvp-form")
    .getByRole("button", { name: response, exact: true })
    .click();
}

test("members see accurate attendee lists and a full event preserves Maybe until a place is freed", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  await login(page);
  const title = `One place ${tag}`;
  const id = await createEvent(page, title, "1");
  const a = await browser.newPage(),
    b = await browser.newPage();
  try {
    await login(a, 1);
    await a.goto(`http://localhost:3000/posts/${id}`);
    await respond(a, "Going");
    await expect(a.locator(".rsvp-form [role=status]")).toContainText("Going");
    await expect(a.locator(".attendance-count")).toContainText("1 Going");
    await expect(a.locator(".attendee-columns")).toContainText("Event Alice");
    await login(b, 2);
    await b.goto(`http://localhost:3000/posts/${id}`);
    await respond(b, "Maybe");
    await expect(b.locator(".rsvp-form [role=status]")).toContainText("Maybe");
    await respond(b, "Going");
    await expect(b.locator(".rsvp-form [role=alert]")).toContainText("full");
    await expect(
      b
        .locator(".rsvp-form")
        .getByRole("button", { name: "Maybe", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(b.locator(".attendance-count")).toContainText("1 Going");
    await respond(a, "Not Going");
    await expect(a.locator(".attendance-count")).toContainText("0 Going");
    await respond(b, "Going");
    await expect(b.locator(".rsvp-form [role=status]")).toContainText("Going");
    await expect(b.locator(".attendance-count")).toContainText("1 Going");
    await page.reload();
    await expect(page.locator(".attendee-columns")).toContainText("Event Bob");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  } finally {
    await a.close();
    await b.close();
  }
});

test("organiser edits cannot evict attendees and private updates can be marked read", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  await login(page);
  const title = `Capacity changes ${tag}`;
  const id = await createEvent(page, title, "2");
  for (const p of people.slice(1)) {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      options,
    );
    await db.auth.signInWithPassword({ email: p.email, password });
    expect(
      (
        await db.rpc("set_event_rsvp", {
          target_event: id,
          chosen_response: "going",
        })
      ).error,
    ).toBeNull();
  }
  await page.getByRole("link", { name: "Edit post", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill(title + " updated");
  await page.getByLabel("Attendance capacity (optional)").fill("1");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".post-form [role=alert]")).toContainText(
    "Capacity cannot be lower",
  );
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    title + " updated",
  );
  expect(
    (await service.from("events").select("capacity").eq("post_id", id).single())
      .data!.capacity,
  ).toBe(2);
  await page.getByLabel("Attendance capacity (optional)").fill("3");
  await page
    .getByLabel("Event location or meeting point")
    .fill("The new park gate");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".attendance-count")).toContainText("2 Going");
  await expect(page.locator(".event-details")).toContainText(
    "The new park gate",
  );
  const a = await browser.newPage();
  try {
    await login(a, 1);
    await a.getByRole("link", { name: "Event updates", exact: true }).click();
    const notice = a
      .locator(".event-update")
      .filter({ hasText: `Event updated: ${title} updated` });
    await expect(notice).toBeVisible();
    await notice.getByRole("button", { name: "Mark as read" }).click();
    await expect(
      a
        .locator(".event-update")
        .filter({ hasText: `Event updated: ${title} updated` })
        .locator(".badge"),
    ).toHaveText("Read");
  } finally {
    await a.close();
  }
});

test("cancellation, reopening, completion and archiving preserve history and close attendance safely", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  await login(page);
  const title = `Lifecycle ${tag}`;
  const id = await createEvent(page, title, "2");
  const a = await browser.newPage(),
    b = await browser.newPage();
  try {
    await login(a, 1);
    await a.goto(`http://localhost:3000/posts/${id}`);
    await respond(a, "Going");
    await expect(a.locator(".attendance-count")).toContainText("1 Going");
    await page.getByRole("link", { name: "Edit post", exact: true }).click();
    await page.getByLabel("Status", { exact: true }).selectOption("cancelled");
    await page
      .getByLabel("Cancel this event and its attendance.", { exact: false })
      .check();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator(".attendance-count")).toContainText("0 Going");
    await expect(
      page
        .locator(".rsvp-form")
        .getByRole("button", { name: "Going", exact: true }),
    ).toBeDisabled();
    await a.reload();
    await expect(a.locator(".attendance")).toContainText(
      "Your previous Going response was cancelled",
    );
    await a.getByRole("link", { name: "Event updates", exact: true }).click();
    await expect(
      a.getByRole("heading", {
        name: `Event cancelled: ${title}`,
        exact: true,
      }),
    ).toBeVisible();
    await login(b, 2);
    await b.getByRole("link", { name: "Event updates", exact: true }).click();
    await expect(
      b.getByRole("heading", {
        name: `Event cancelled: ${title}`,
        exact: true,
      }),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "Edit post", exact: true }).click();
    await page.getByLabel("Status", { exact: true }).selectOption("open");
    await expect(
      page.getByText("Reopening starts fresh attendance."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator(".detail .badge").last()).toHaveText("Scheduled");
    await a.goto(`http://localhost:3000/posts/${id}`);
    await expect(a.locator(".attendance-count")).toContainText("0 Going");
    await expect(
      a
        .locator(".rsvp-form")
        .getByRole("button", { name: "Going", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await respond(a, "Going");
    await expect(a.locator(".attendance-count")).toContainText("1 Going");
    await page.getByRole("link", { name: "Edit post", exact: true }).click();
    await page.getByLabel("Status", { exact: true }).selectOption("completed");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator(".detail .badge").last()).toHaveText("Completed");
    await expect(
      page
        .locator(".rsvp-form")
        .getByRole("button", { name: "Going", exact: true }),
    ).toBeDisabled();
    await page.getByRole("link", { name: "Edit post", exact: true }).click();
    await expect(
      page.getByLabel("Status", { exact: true }).locator("option[value=open]"),
    ).toHaveCount(0);
    await page.getByLabel("Status", { exact: true }).selectOption("archived");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator(".detail .badge").last()).toHaveText("Archived");
    await expect(page.locator(".attendee-columns")).toContainText(
      "Event Alice",
    );
    await expect(
      page.locator(".upcoming").getByRole("link", { name: title, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("RSVP history is retained.", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("Delete this post", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await a.close();
    await b.close();
  }
});

test("past events remain accessible, close new RSVPs and can be archived", async ({
  page,
}) => {
  await login(page);
  const title = `Past plans ${tag}`;
  const id = await createEvent(page, title, "", "2020-01-15T18:00");
  await expect(page.locator(".attendance")).toContainText(
    "This event has started",
  );
  await expect(
    page
      .locator(".rsvp-form")
      .getByRole("button", { name: "Going", exact: true }),
  ).toBeDisabled();
  await expect(
    page.locator(".upcoming").getByRole("link", { name: title, exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Edit post", exact: true }).click();
  await page.getByLabel("Status", { exact: true }).selectOption("archived");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".detail .badge").last()).toHaveText("Archived");
  await page.goto(`/posts/${id}`);
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
});
