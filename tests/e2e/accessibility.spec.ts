import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";

process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("Local accessibility test database required");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  options,
);
const tag = randomBytes(6).toString("hex");
const password = randomBytes(24).toString("base64url");
const people = ["Member", "Driver", "Passenger"].map((name) => ({
  id: "",
  name: `Accessibility ${name} ${tag}`,
  email: `accessibility-${name.toLowerCase()}-${tag}@example.test`,
  db: createClient(
    url,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    options,
  ),
}));
let postId = "";
let rideId = "";

test.beforeAll(async () => {
  for (const person of people) {
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
          display_name: person.name,
        })
      ).error,
    ).toBeNull();
    expect(
      (await service.from("memberships").insert({ user_id: person.id })).error,
    ).toBeNull();
    expect(
      (
        await person.db.auth.signInWithPassword({
          email: person.email,
          password,
        })
      ).error,
    ).toBeNull();
  }
  const category = await service
    .from("categories")
    .select("id")
    .eq("name", "General")
    .single();
  expect(category.error).toBeNull();
  const post = await people[0].db.rpc("write_post", {
    target_id: null,
    content: {
      title: `Accessible journey ${tag}`,
      description: "A shared journey for accessibility checks.",
      category_id: category.data!.id,
      post_type: "trip",
      status: "open",
      ride_coordination_enabled: true,
    },
  });
  expect(post.error).toBeNull();
  postId = post.data;
  const ride = await people[1].db.rpc("write_ride", {
    target_id: null,
    target_post: postId,
    content: { pickup: "Community hall", capacity: 1 },
    operation_id: randomUUID(),
  });
  expect(ride.error).toBeNull();
  rideId = ride.data;
  expect(
    (
      await people[2].db.rpc("book_ride", {
        target_ride: rideId,
        booking_mode: "self",
        operation_id: randomUUID(),
      })
    ).error,
  ).toBeNull();
});

test.afterAll(async () => {
  const ids = people.map((person) => person.id).filter(Boolean);
  await service.from("transport_operations").delete().in("actor_id", ids);
  await service.from("notifications").delete().in("recipient_id", ids);
  if (postId) {
    await service.from("ride_reservations").delete().eq("post_id", postId);
    await service.from("ride_offers").delete().eq("post_id", postId);
    await people[0].db.rpc("delete_post", { target_id: postId });
  }
  await service.from("memberships").delete().in("user_id", ids);
  await service.from("profiles").delete().in("id", ids);
  for (const id of ids) await service.auth.admin.deleteUser(id);
});

async function signIn(page: Page, administrator = false) {
  const credentials = administrator
    ? JSON.parse(readFileSync(".local-admin.json", "utf8"))
    : { email: people[0].email, password };
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little closer together." }),
  ).toBeVisible();
}

async function checkAccessibility(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  // Keep private rendered HTML and account details out of failure reports.
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

async function noHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBeTruthy();
}

test("public invitation and authentication pages pass automated accessibility checks", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 320, height: 844 });
  for (const route of ["/login", "/recover", "/invite", "/auth/confirm"]) {
    await page.goto(route);
    await expect(page.getByRole("main")).toBeVisible();
    await noHorizontalOverflow(page);
    await checkAccessibility(page);
  }
});

test("community and administration pages pass desktop and mobile accessibility checks", async ({
  page,
}) => {
  test.setTimeout(180000);
  await signIn(page);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      "/",
      "/events",
      "/members",
      "/settings",
      "/settings/partner",
      "/posts/new",
      `/posts/${postId}`,
    ]) {
      await page.goto(route);
      await expect(page.getByRole("main")).toBeVisible();
      await noHorizontalOverflow(page);
      await checkAccessibility(page);
    }
  }
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page, true);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "Community administration" }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
    await checkAccessibility(page);
  }
});

test("keyboard navigation skips the sidebar and keeps a visible focus indicator", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A little closer together." }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  expect(
    await skip.evaluate((element) => getComputedStyle(element).outlineWidth),
  ).toBe("3px");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Search posts", { exact: true })).toBeFocused();
  await page.keyboard.type("keyboard journey");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/q=keyboard\+journey/);
  await expect(
    page.getByRole("heading", { name: "No matching posts." }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).not.toHaveURL(/[?&]q=/);
  await expect(
    page.getByRole("heading", { name: "A little closer together." }),
  ).toBeVisible();
  // Browsers may restore the draft input value on Back. The URL and rendered
  // results, rather than an autofill policy, determine the applied filter.
  await expect(
    page.getByRole("heading", { name: "No matching posts." }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: `Accessible journey ${tag}`,
      exact: true,
    }),
  ).toBeVisible();
});

test("core forms reflow across phone, tablet and desktop sizes with larger text and usable controls", async ({
  page,
}) => {
  test.setTimeout(120000);
  await signIn(page);
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/posts/new");
    await page.getByLabel("Post type", { exact: true }).selectOption("event");
    await noHorizontalOverflow(page);
    const controls = await page
      .locator(
        "button:visible, a.button:visible, nav a:visible, summary:visible",
      )
      .evaluateAll((elements) =>
        elements.map((element) => ({
          height: element.getBoundingClientRect().height,
          width: element.getBoundingClientRect().width,
        })),
      );
    expect(controls.length).toBeGreaterThan(5);
    expect(
      controls.every((control) => control.height >= 44 && control.width >= 44),
    ).toBeTruthy();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  await noHorizontalOverflow(page);
  await expect(page.getByLabel("Starts", { exact: true })).toBeVisible();
  const palette = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return [
      "--forest",
      "--deep-green",
      "--sage-teal",
      "--warm-sand",
      "--charcoal",
      "--background",
      "--surface",
      "--border",
    ].map((token) =>
      styles
        .getPropertyValue(token)
        .trim()
        .toUpperCase()
        .replace(/^#([A-F0-9])([A-F0-9])([A-F0-9])$/, "#$1$1$2$2$3$3"),
    );
  });
  expect(palette).toEqual([
    "#0B3D2E",
    "#145A3A",
    "#2F7D6B",
    "#CBBFA6",
    "#1B1F23",
    "#F6F4EE",
    "#FFFFFF",
    "#E3E0D7",
  ]);
});

test("failed post, ride and capacity submissions focus associated errors and preserve input", async ({
  page,
}) => {
  test.setTimeout(90000);
  await signIn(page);
  await page.goto("/posts/new");
  await page
    .getByLabel("Category", { exact: true })
    .selectOption({ label: "General" });
  await page.getByLabel("Title", { exact: true }).fill("   ");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Keep my draft after validation.");
  await page
    .getByLabel("People might need a ride for this", { exact: true })
    .check();
  await page.getByRole("button", { name: "Publish post", exact: true }).click();
  const postError = page.locator(".post-form").getByRole("alert");
  await expect(postError).toHaveText("Add a title.");
  await expect(postError).toBeFocused();
  await expect(page.getByLabel("Title", { exact: true })).toHaveAttribute(
    "aria-describedby",
    (await postError.getAttribute("id"))!,
  );
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
    "Keep my draft after validation.",
  );
  await expect(
    page.getByLabel("People might need a ride for this", { exact: true }),
  ).toBeChecked();

  await page.goto(`/posts/${postId}`);
  await page.locator(".offer-ride > summary").click();
  const form = page.locator(".offer-ride .ride-form");
  await form.getByLabel("Pickup location", { exact: true }).fill("   ");
  await form
    .getByLabel("Passenger notes (optional)")
    .fill("Keep my ride notes.");
  await form.getByRole("button", { name: "Offer a Ride", exact: true }).click();
  const rideError = form.getByRole("alert");
  await expect(rideError).toBeFocused();
  await expect(
    form.getByLabel("Pickup location", { exact: true }),
  ).toHaveAttribute("aria-describedby", (await rideError.getAttribute("id"))!);
  await expect(form.getByLabel("Passenger notes (optional)")).toHaveValue(
    "Keep my ride notes.",
  );

  const booking = page.locator(`[data-ride-id="${rideId}"] .booking-form`);
  await booking
    .getByRole("button", { name: "Book seats", exact: true })
    .click();
  const bookingError = booking.getByRole("alert");
  await expect(bookingError).toContainText("Not enough seats");
  await expect(bookingError).toBeFocused();
  await expect(booking.getByLabel("Who needs a seat?")).toHaveAttribute(
    "aria-describedby",
    (await bookingError.getAttribute("id"))!,
  );
  await expect(booking.getByLabel("Who needs a seat?")).toHaveValue("self");
});
