import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
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
const people = ["Host", "Driver", "Alice", "Bob"].map((name) => ({
  id: "",
  name: `Ride ${name} ${tag}`,
  email: `ride-ui-${name}-${tag}@example.test`,
  db: createClient(
    url,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    options,
  ),
}));
const posts: string[] = [];
let category: string;
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
    expect(
      (await p.db.auth.signInWithPassword({ email: p.email, password })).error,
    ).toBeNull();
  }
  category = (
    await service
      .from("categories")
      .select("id")
      .eq("name", "Events & Social")
      .single()
  ).data!.id;
});
test.afterAll(async () => {
  const ids = people.map((p) => p.id);
  await service.from("transport_operations").delete().in("actor_id", ids);
  await service.from("notifications").delete().in("recipient_id", ids);
  await service.from("ride_reservations").delete().in("post_id", posts);
  await service.from("ride_offers").delete().in("post_id", posts);
  await service.from("event_rsvps").delete().in("event_id", posts);
  for (const id of posts)
    await people[0].db.rpc("delete_post", { target_id: id });
  await service.from("partner_participants").delete().in("user_id", ids);
  const rel = await service
    .from("partner_relationships")
    .select("id")
    .in("user_a", ids);
  await service
    .from("partner_relationships")
    .delete()
    .in(
      "id",
      (rel.data || []).map((r) => r.id),
    );
  await service.from("memberships").delete().in("user_id", ids);
  await service.from("profiles").delete().in("id", ids);
  for (const id of ids) await service.auth.admin.deleteUser(id);
});
async function login(page: Page, index: number) {
  await page.goto("http://localhost:3000/login");
  await page.getByLabel("Email", { exact: true }).fill(people[index].email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little closer together." }),
  ).toBeVisible();
}
async function createPost(extra: Record<string, unknown> = {}) {
  const result = await people[0].db.rpc("write_post", {
    target_id: null,
    content: {
      title: `Ride plans ${tag}`,
      description: "Meet our friends",
      category_id: category,
      post_type: "trip",
      status: "open",
      ride_coordination_enabled: true,
      ...extra,
    },
  });
  expect(result.error).toBeNull();
  posts.push(result.data);
  return result.data as string;
}
async function offer(postId: string, capacity: number, pickup: string) {
  const r = await people[1].db.rpc("write_ride", {
    target_id: null,
    target_post: postId,
    content: { pickup, capacity, departure_at: "2035-01-15T03:00:00Z" },
    operation_id: randomUUID(),
  });
  expect(r.error).toBeNull();
  return r.data as string;
}
async function book(index: number, rideId: string) {
  expect(
    (
      await people[index].db.rpc("book_ride", {
        target_ride: rideId,
        booking_mode: "self",
        operation_id: randomUUID(),
      })
    ).error,
  ).toBeNull();
}
async function active(postId: string) {
  return (
    await service
      .from("ride_reservations")
      .select("id,ride_id,passenger_id,created_by")
      .eq("post_id", postId)
      .eq("status", "confirmed")
  ).data!;
}
const card = (page: Page, id: string) => page.locator(`[data-ride-id="${id}"]`);
test("post checkbox, rich ride offer and member-visible passenger lists work on desktop and mobile", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  await login(page, 0);
  await page.goto("/posts/new");
  await page.getByLabel("Post type", { exact: true }).selectOption("trip");
  await page
    .getByLabel("Category", { exact: true })
    .selectOption({ label: "Trips & Travel" });
  await page.getByLabel("Title", { exact: true }).fill(`Carpool ${tag}`);
  await page
    .getByLabel("Description", { exact: true })
    .fill("An ordinary post with rides");
  await page
    .getByLabel("People might need a ride for this", { exact: true })
    .check();
  await page.getByRole("button", { name: "Publish post" }).click();
  await expect(page.getByRole("status")).toContainText("Post saved");
  const id = new URL(page.url()).pathname.split("/")[2];
  posts.push(id);
  await expect(
    page.getByRole("heading", { name: "Ride coordination", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No rides offered yet.", { exact: false }),
  ).toBeVisible();
  const driverPage = await browser.newPage(),
    a = await browser.newPage();
  try {
    await login(driverPage, 1);
    await driverPage.goto(`http://localhost:3000/posts/${id}`);
    await driverPage.locator(".offer-ride > summary").click();
    const form = driverPage.locator(".offer-ride form");
    await form
      .getByLabel("Pickup location", { exact: true })
      .fill("Station entrance");
    await form.getByLabel("Passenger seats (excluding driver)").fill("1");
    await form
      .getByLabel("Departure (optional)", { exact: true })
      .fill("2035-01-15T16:00");
    await form
      .getByLabel("Route or extra pickup details (optional)")
      .fill("Via the coast");
    await form.getByLabel("Return trip available").check();
    await form
      .getByLabel("Return departure (optional)")
      .fill("2035-01-15T23:00");
    await form
      .getByLabel("Return pickup or drop-off details")
      .fill("Drop off at the station");
    await form.getByLabel("Suggested contribution (optional)").fill("12.50");
    await form
      .getByLabel("Passenger notes (optional)")
      .fill("Room for one backpack");
    await form
      .getByRole("button", { name: "Offer a Ride", exact: true })
      .click();
    await expect(driverPage.getByRole("status")).toContainText("Ride saved");
    const rideId = await driverPage
      .locator(".ride-card")
      .first()
      .getAttribute("data-ride-id");
    await expect(card(driverPage, rideId!)).toContainText("NZD 12.50");
    await expect(card(driverPage, rideId!)).toContainText("Via the coast");
    await expect(card(driverPage, rideId!)).toContainText(
      "Return trip available",
    );
    await login(a, 2);
    await a.goto(`http://localhost:3000/posts/${id}`);
    const originalKey = await card(a, rideId!)
      .locator('input[name="operation_id"]')
      .inputValue();
    await card(a, rideId!)
      .getByRole("button", { name: "Book seats", exact: true })
      .click();
    await expect(a.getByRole("status")).toContainText("Booking confirmed");
    await page.reload();
    await expect(
      card(page, rideId!).locator(".passenger-list").first(),
    ).toContainText(people[2].name);
    await expect(card(page, rideId!).locator(".seat-count")).toContainText(
      "0 available",
    );
    await expect(card(page, rideId!).locator(".ride-management")).toHaveCount(
      0,
    );
    await expect(page.locator("#rides")).not.toContainText(people[2].email);
    await expect(page.locator("#rides")).not.toContainText(people[2].id);
    await page.screenshot({
      path: "/tmp/gregslist-phase4-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: "/tmp/gregslist-phase4-mobile.png",
      fullPage: true,
    });
    await a
      .getByRole("button", { name: "Cancel my reservation", exact: true })
      .click();
    await expect(a.getByRole("status")).toContainText("Reservation cancelled");
    await card(a, rideId!)
      .locator('input[name="operation_id"]')
      .evaluate((input, key) => {
        (input as HTMLInputElement).value = key;
      }, originalKey);
    await card(a, rideId!)
      .getByRole("button", { name: "Book seats", exact: true })
      .click();
    await expect(card(a, rideId!).getByRole("alert")).toContainText(
      "already processed",
    );
    expect((await active(id)).length).toBe(0);
  } finally {
    await driverPage.close();
    await a.close();
  }
});
test("mutual partner consent, atomic pair booking and switching, individual ownership and unlinking work", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const id = await createPost(),
    r1 = await offer(id, 2, "First car"),
    r2 = await offer(id, 1, "Small car"),
    r3 = await offer(id, 2, "Replacement car");
  await login(page, 2);
  await page.goto("/settings/partner");
  await page
    .getByLabel("Community member", { exact: true })
    .selectOption(people[3].id);
  await page.getByRole("button", { name: "Send partner request" }).click();
  await expect(page.getByRole("status")).toContainText("Partner request sent");
  const b = await browser.newPage();
  try {
    await login(b, 3);
    await b.goto("http://localhost:3000/settings/partner");
    const incoming = b
      .locator(".partner-request")
      .filter({ hasText: people[2].name });
    await incoming
      .getByRole("button", { name: "Accept request", exact: true })
      .click();
    await expect(b.getByRole("status")).toContainText("Partner link confirmed");
    await page.goto(`/posts/${id}`);
    await card(page, r1).getByLabel("Who needs a seat?").selectOption("both");
    await card(page, r1).getByRole("button", { name: "Book seats" }).click();
    await expect(page.getByRole("status")).toContainText("Booking confirmed");
    expect((await active(id)).length).toBe(2);
    await b.goto(`http://localhost:3000/posts/${id}`);
    await expect(
      b.getByRole("region", { name: "Your transport" }),
    ).toContainText("You");
    await card(page, r2).getByLabel("Who needs a seat?").selectOption("both");
    await card(page, r2)
      .getByRole("button", { name: "Switch both passengers" })
      .click();
    await expect(card(page, r2).getByRole("alert")).toContainText(
      "Existing reservations have been kept",
    );
    expect((await active(id)).every((r) => r.ride_id === r1)).toBe(true);
    await card(page, r3).getByLabel("Who needs a seat?").selectOption("both");
    await card(page, r3)
      .getByRole("button", { name: "Switch both passengers" })
      .click();
    await expect(page.getByRole("status")).toContainText("Ride changed");
    expect((await active(id)).every((r) => r.ride_id === r3)).toBe(true);
    await b.reload();
    await card(b, r2)
      .getByRole("button", { name: "Change ride", exact: true })
      .click();
    await expect(b.getByRole("status")).toContainText("Ride changed");
    expect(
      (await active(id)).find((r) => r.passenger_id === people[3].id)!.ride_id,
    ).toBe(r2);
    expect(
      (await active(id)).find((r) => r.passenger_id === people[2].id)!.ride_id,
    ).toBe(r3);
    await page.reload();
    await card(page, r1).getByLabel("Who needs a seat?").selectOption("both");
    await expect(
      card(page, r1).getByRole("button", { name: "Switch both passengers" }),
    ).toBeDisabled();
    await page.goto("/settings/partner");
    await page.getByRole("button", { name: "Unlink partner" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Existing reservations are unchanged",
    );
    expect((await active(id)).length).toBe(2);
    await b.reload();
    await b
      .getByRole("button", { name: "Cancel my reservation", exact: true })
      .click();
    await expect(b.getByRole("status")).toContainText("Reservation cancelled");
    expect((await active(id)).length).toBe(1);
  } finally {
    await b.close();
  }
});
test("capacity edits, event-change review, withdrawal notices and safe disabling preserve transport history", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const id = await createPost({
      post_type: "event",
      starts_at: "2035-01-15T05:00:00Z",
      event_location: "Old park",
      timezone: "Pacific/Auckland",
    }),
    r = await offer(id, 2, "Park gates");
  await book(2, r);
  await book(3, r);
  await login(page, 1);
  await page.goto(`/posts/${id}`);
  await card(page, r)
    .locator(".ride-management > details > summary")
    .filter({ hasText: "Edit ride" })
    .click();
  const edit = card(page, r).locator(".ride-form");
  await edit.getByLabel("Passenger seats (excluding driver)").fill("1");
  await edit
    .getByLabel("Pickup location", { exact: true })
    .fill("Do not lose this");
  await edit.getByRole("button", { name: "Save ride" }).click();
  await expect(edit.getByRole("alert")).toContainText(
    "Capacity cannot be lower",
  );
  await expect(edit.getByLabel("Pickup location", { exact: true })).toHaveValue(
    "Do not lose this",
  );
  const host = await browser.newPage(),
    a = await browser.newPage();
  try {
    await login(host, 0);
    await host.goto(`http://localhost:3000/posts/${id}/edit`);
    await host.getByLabel("Starts", { exact: true }).fill("2035-01-16T18:00");
    await host.getByLabel("Event location or meeting point").fill("New beach");
    await host.getByRole("button", { name: "Save changes" }).click();
    await expect(host.getByRole("status")).toContainText("Post saved");
    await page.reload();
    await expect(card(page, r)).toContainText("The driver needs to review");
    await expect(card(page, r)).toContainText("15 Jan 2035");
    await card(page, r).getByText("Edit ride", { exact: true }).click();
    await card(page, r).getByRole("button", { name: "Save ride" }).click();
    await expect(page.getByRole("status")).toContainText("Ride saved");
    await expect(card(page, r)).not.toContainText("The driver needs to review");
    await card(page, r).getByText("Withdraw ride", { exact: true }).click();
    await card(page, r)
      .getByLabel(
        "Withdraw this ride. Passengers will need alternative transport.",
      )
      .check();
    await card(page, r)
      .getByRole("button", { name: "Confirm withdrawal" })
      .click();
    await expect(page.getByRole("status")).toContainText("Ride withdrawn");
    await expect(
      card(page, r).getByRole("button", { name: "Book seats" }),
    ).toHaveCount(0);
    await login(a, 2);
    await a.goto(`http://localhost:3000/posts/${id}`);
    await expect(
      a.getByRole("region", { name: "Your transport" }),
    ).toContainText("Alternative transport needed");
    await a.getByRole("link", { name: "Updates", exact: true }).click();
    await expect(
      a.getByRole("heading", {
        name: "Ride withdrawn. Please arrange alternative transport.",
        exact: true,
      }),
    ).toBeVisible();
    await host.goto(`http://localhost:3000/posts/${id}/edit`);
    await host
      .getByLabel("People might need a ride for this", { exact: true })
      .uncheck();
    await host.getByRole("button", { name: "Save changes" }).click();
    await expect(host.locator(".post-form").getByRole("alert")).toContainText(
      "resolve outstanding reservations",
    );
    await expect(
      host.getByLabel("People might need a ride for this", { exact: true }),
    ).not.toBeChecked();
    for (const index of [2, 3]) {
      const reservation = (
        await service
          .from("ride_reservations")
          .select("id")
          .eq("post_id", id)
          .eq("passenger_id", people[index].id)
          .eq("status", "needs_arrangement")
          .single()
      ).data!;
      expect(
        (
          await people[index].db.rpc("cancel_ride_reservation", {
            target_reservation: reservation.id,
          })
        ).error,
      ).toBeNull();
    }
    await host.getByRole("button", { name: "Save changes" }).click();
    await expect(host.getByRole("status")).toContainText("Post saved");
    await expect(host.locator("#rides")).toContainText("history is retained");
    await expect(card(host, r)).toContainText("Withdrawn");
  } finally {
    await host.close();
    await a.close();
  }
});
test("event cancellation visibly closes rides and retains passenger history", async ({
  page,
}) => {
  test.setTimeout(90000);
  const id = await createPost({
      post_type: "event",
      starts_at: "2035-01-15T05:00:00Z",
      event_location: "Park",
    }),
    r = await offer(id, 1, "Meeting point");
  await book(2, r);
  await login(page, 0);
  await page.goto(`/posts/${id}/edit`);
  await page.getByLabel("Status", { exact: true }).selectOption("cancelled");
  await page
    .getByLabel("Cancel this event and its attendance.", { exact: false })
    .check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Post saved");
  await expect(card(page, r)).toContainText("Cancelled");
  await expect(card(page, r).locator(".seat-count")).toContainText(
    "Unavailable",
  );
  await expect(
    card(page, r).getByRole("button", { name: "Book seats" }),
  ).toHaveCount(0);
  await card(page, r).getByText("Passenger history", { exact: true }).click();
  await expect(card(page, r).locator(".passenger-list")).toContainText(
    people[2].name,
  );
  expect((await active(id)).length).toBe(0);
});
