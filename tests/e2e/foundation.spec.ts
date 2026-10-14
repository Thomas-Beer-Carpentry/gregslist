import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const credentials = JSON.parse(readFileSync(".local-admin.json", "utf8"));
test("anonymous private routes redirect to sign in; login is accessible on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
  const callback = await page.request.get("/auth/callback?type=invalid", {
    maxRedirects: 0,
  });
  expect(new URL(callback.headers().location).origin).toBe(
    "http://localhost:3000",
  );
});
test("administrator can sign in, edit a display name and sign out", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little closer together." }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await expect(
    page.getByRole("link", { name: "Create post", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("link", { name: "Account settings" }).click();
  await page.getByLabel("Display name").fill("Greg");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("status")).toContainText("saved");
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Community administration" }),
  ).toBeVisible();
  await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("administrator email invitation, acceptance, password setup and recovery work end to end", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(90000);
  process.loadEnvFile(".env.local");
  const { createClient } = await import("@supabase/supabase-js");
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const email = `browser-${Date.now()}@example.test`;
  const password = "Local-browser-test-password-123!";
  const invited = await browser.newPage();
  async function emailLink(subject: string) {
    let id: string | undefined;
    await expect
      .poll(
        async () => {
          const response = await request.get(
            "http://127.0.0.1:54324/api/v1/messages",
          );
          const body = await response.json();
          const found = body.messages?.find(
            (m: { Subject: string; To: { Address: string }[] }) =>
              m.Subject.includes(subject) &&
              m.To.some((to) => to.Address === email),
          );
          id = found?.ID;
          return Boolean(id);
        },
        { timeout: 20000 },
      )
      .toBeTruthy();
    const content = await (
      await request.get(`http://127.0.0.1:54324/api/v1/message/${id}`)
    ).json();
    const link = content.HTML.match(
      /href="([^"]+\/auth\/callback[^\"]*)"/i,
    )?.[1]?.replaceAll("&amp;", "&");
    expect(link).toBeTruthy();
    return link!;
  }
  try {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(credentials.email);
    await page
      .getByLabel("Password", { exact: true })
      .fill(credentials.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "A little closer together." }),
    ).toBeVisible();
    await page.goto("/admin");
    await page.getByLabel("Their email address").fill(email);
    await page
      .getByRole("button", { name: "Send invitation", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Invitation sent");
    const link = await emailLink("invitation");
    await invited.goto(link);
    await expect(
      invited.getByRole("heading", { name: "Choose your password." }),
    ).toBeVisible();
    await invited.getByLabel("New password").fill(password);
    await invited.getByRole("button", { name: "Save password" }).click();
    await expect(
      invited.getByRole("heading", { name: "A little closer together." }),
    ).toBeVisible();
    await invited.getByRole("button", { name: "Sign out" }).click();
    await invited.goto(link);
    await expect(invited.getByRole("status")).toContainText("already used");
    await invited.goto("/recover");
    await invited.getByLabel("Email", { exact: true }).fill(email);
    await invited.getByRole("button", { name: "Send recovery link" }).click();
    await expect(invited.getByRole("status")).toContainText(
      "If an account exists",
    );
    await invited.goto(await emailLink("Reset"));
    await expect(
      invited.getByRole("heading", { name: "Choose your password." }),
    ).toBeVisible();
    await invited.getByLabel("New password").fill(password + "new");
    await invited.getByRole("button", { name: "Save password" }).click();
    await expect(
      invited.getByRole("heading", { name: "A little closer together." }),
    ).toBeVisible();
  } finally {
    await invited.close();
    const { data } = await service.auth.admin.listUsers();
    const user = data.users.find((u) => u.email === email);
    await service.from("invitations").delete().eq("email", email);
    if (user) {
      await service.from("memberships").delete().eq("user_id", user.id);
      await service.from("profiles").delete().eq("id", user.id);
      await service.auth.admin.deleteUser(user.id);
    }
  }
});
