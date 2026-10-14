import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("Local database required");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  options,
);
const administrator = JSON.parse(readFileSync(".local-admin.json", "utf8")) as {
  email: string;
  password: string;
};
const tag = randomBytes(6).toString("hex"),
  password = randomBytes(24).toString("base64url");
const people = ["Alice", "Bob", "Existing"].map((name) => ({
  id: "",
  name: `Community ${name} ${tag}`,
  email: `member-ui-${name.toLowerCase()}-${tag}@example.test`,
}));
const invitationEmails: string[] = [];

test.beforeAll(async () => {
  for (const person of people) {
    const { data, error } = await service.auth.admin.createUser({
      email: person.email,
      password,
      email_confirm: true,
    });
    expect(error).toBeNull();
    person.id = data.user!.id;
    if (person !== people[2]) {
      expect(
        (
          await service
            .from("profiles")
            .insert({ id: person.id, display_name: person.name })
        ).error,
      ).toBeNull();
      expect(
        (await service.from("memberships").insert({ user_id: person.id }))
          .error,
      ).toBeNull();
    }
  }
});
test.afterAll(async () => {
  const { data } = await service.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const created = data.users.filter((person) =>
    invitationEmails.includes(person.email || ""),
  );
  const ids = [
    ...new Set([
      ...people.map((person) => person.id),
      ...created.map((person) => person.id),
    ]),
  ].filter(Boolean);
  if (invitationEmails.length)
    await service.from("invitations").delete().in("email", invitationEmails);
  await service.from("notifications").delete().in("recipient_id", ids);
  await service.from("memberships").delete().in("user_id", ids);
  await service.from("profiles").delete().in("id", ids);
  for (const id of ids) await service.auth.admin.deleteUser(id);
});

async function login(
  page: Page,
  email: string,
  accountPassword = password,
  member = true,
) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(accountPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(
    member ? /localhost:3000\/$/ : /\/access-denied/,
  );
}
async function loginAdmin(page: Page) {
  await login(page, administrator.email, administrator.password);
}
async function copyInvitation(page: Page, email: string) {
  invitationEmails.push(email);
  await page.goto("/admin");
  await page.getByLabel("Their email address").fill(email);
  await page.getByRole("radio", { name: "Generate a link to copy" }).check();
  await page
    .getByRole("button", { name: "Generate invitation link", exact: true })
    .click();
  const field = page.getByLabel("Secure invitation link", { exact: true });
  await expect(field).toBeVisible();
  const link = await field.inputValue();
  expect(new URL(link).pathname).toBe("/invite");
  expect(
    new URLSearchParams(new URL(link).hash.slice(1)).get("token")?.length,
  ).toBe(64);
  return link;
}
async function emailLink(
  request: APIRequestContext,
  email: string,
  subject = "invitation",
) {
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        const body = await (
          await request.get("http://127.0.0.1:54324/api/v1/messages")
        ).json();
        const found = body.messages?.find(
          (message: { Subject: string; To: { Address: string }[] }) =>
            message.Subject.toLowerCase().includes(subject.toLowerCase()) &&
            message.To.some(
              (recipient) =>
                recipient.Address.toLowerCase() === email.toLowerCase(),
            ),
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
    /href="([^"]+\/auth\/confirm[^"]*)"/i,
  )?.[1]?.replaceAll("&amp;", "&");
  expect(Boolean(link)).toBeTruthy();
  return link as string;
}
async function openCopy(page: Page, link: string) {
  await page.goto(link);
  await expect(page.getByLabel("Your invited email address")).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe("");
}
async function requestVerification(page: Page, email: string) {
  await page.getByLabel("Your invited email address").fill(email);
  await page
    .getByRole("button", { name: "Send verification email", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Check your email");
}

test("member directory and biography editing are private and searchable", async ({
  page,
}) => {
  await login(page, people[0].email);
  await page.goto("/settings");
  await page
    .getByLabel("A little about you")
    .fill("I enjoy helping with community garden days.");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("saved");
  await page
    .getByRole("link", { name: "Meet your community", exact: true })
    .click();
  await page.getByLabel("Search members by name").fill(people[0].name);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const cards = page.locator(".directory-card");
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("community garden");
  await expect(cards).not.toContainText(people[0].email);
  await expect(cards).not.toContainText(people[0].id);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/access-denied/);
  await expect(
    page.getByText("This area requires administrator access."),
  ).toBeVisible();
});

test("administrators manage roles, suspend, reactivate and remove access with retained history", async ({
  page,
  browser,
}) => {
  await loginAdmin(page);
  const member = await browser.newPage();
  try {
    await login(member, people[1].email);
    async function memberCard() {
      await page.goto("/admin");
      await page
        .getByLabel("Search members", { exact: true })
        .fill(people[1].name);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      const card = page.getByRole("article", {
        name: `Member ${people[1].name}`,
        exact: true,
      });
      await expect(card).toBeVisible();
      await card.locator("summary").click();
      return card;
    }
    let card = await memberCard();
    let form = card.locator("form").filter({
      has: page.getByRole("button", {
        name: "Make administrator",
        exact: true,
      }),
    });
    await form.getByRole("checkbox").check();
    await form
      .getByRole("button", { name: "Make administrator", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("role updated");
    await member.goto("/admin");
    await expect(
      member.getByRole("heading", {
        name: "Community administration",
        exact: true,
      }),
    ).toBeVisible();
    card = await memberCard();
    form = card.locator("form").filter({
      has: page.getByRole("button", {
        name: "Remove administrator role",
        exact: true,
      }),
    });
    await form.getByRole("checkbox").check();
    await form
      .getByRole("button", { name: "Remove administrator role", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("role updated");
    await member.reload();
    await expect(member).toHaveURL(/\/access-denied/);
    card = await memberCard();
    form = card.locator("form").filter({
      has: page.getByRole("button", { name: "Suspend member", exact: true }),
    });
    await form.getByRole("checkbox").check();
    await form
      .getByRole("button", { name: "Suspend member", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("access changed");
    await member.goto("/");
    await expect(member).toHaveURL(/\/access-denied/);
    await expect(
      member.getByText(/Your community access is suspended/),
    ).toBeVisible();
    card = await memberCard();
    await card
      .getByRole("button", { name: "Reactivate member", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("access restored");
    await member.goto("/");
    await expect(
      member.getByRole("heading", { name: "A little closer together." }),
    ).toBeVisible();
    card = await memberCard();
    form = card.locator("form").filter({
      has: page.getByRole("button", { name: "Remove member", exact: true }),
    });
    await form.getByRole("checkbox").check();
    await form
      .getByRole("button", { name: "Remove member", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("history is retained");
    await member.goto("/");
    await expect(
      member.getByText(/Your community access has been removed/),
    ).toBeVisible();
    await expect(page.locator("#history")).toContainText("Member suspended");
    await expect(page.locator("#history")).toContainText("Member reactivated");
    await expect(page.locator("#history")).toContainText("Member removed");
    expect(
      (await service.from("profiles").select("id").eq("id", people[1].id)).data,
    ).toHaveLength(1);
  } finally {
    await member.close();
  }
});

test("copy invitation verifies the bound email before activating a new member", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(90000);
  await loginAdmin(page);
  const email = `copy-new-${tag}@example.test`,
    link = await copyInvitation(page, email);
  const invited = await browser.newPage();
  try {
    await openCopy(invited, link);
    await invited
      .getByLabel("Your invited email address")
      .fill(`wrong-${tag}@example.test`);
    await invited
      .getByRole("button", { name: "Send verification email", exact: true })
      .click();
    await expect(invited.locator("main").getByRole("alert")).toContainText(
      "unavailable for that email",
    );
    await requestVerification(invited, email);
    const verificationLink = await emailLink(request, email);
    await invited.goto(verificationLink);
    await expect(
      invited.getByRole("button", { name: "Verify email", exact: true }),
    ).toBeVisible();
    await expect.poll(() => new URL(invited.url()).hash).toBe("");
    await invited
      .getByRole("button", { name: "Verify email", exact: true })
      .click();
    await expect(
      invited.getByRole("heading", { name: "Choose your password." }),
    ).toBeVisible();
    await invited.getByLabel("New password").fill(password);
    await invited
      .getByRole("button", { name: "Save password", exact: true })
      .click();
    await expect(
      invited.getByRole("heading", { name: "A little closer together." }),
    ).toBeVisible();
    // Retrying the same already-accepted link cannot duplicate membership.
    await openCopy(invited, link);
    await invited
      .getByRole("button", { name: "Accept invitation", exact: true })
      .click();
    await expect(
      invited.getByRole("heading", { name: "A little closer together." }),
    ).toBeVisible();
    const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
    const account = data.users.find((user) => user.email === email)!;
    expect(
      (
        await service
          .from("memberships")
          .select("user_id")
          .eq("user_id", account.id)
      ).data,
    ).toHaveLength(1);
  } finally {
    await invited.close();
  }
});

test("copy invitation reuses an existing verified account through email authentication", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(90000);
  await loginAdmin(page);
  const existing = people[2],
    link = await copyInvitation(page, existing.email);
  const invited = await browser.newPage();
  try {
    await openCopy(invited, link);
    await requestVerification(invited, existing.email);
    const verificationLink = await emailLink(request, existing.email);
    expect(
      new URLSearchParams(new URL(verificationLink).hash.slice(1)).get("type"),
    ).toBe("email");
    await invited.goto(verificationLink);
    await invited
      .getByRole("button", { name: "Verify email", exact: true })
      .click();
    await expect(
      invited.getByRole("heading", { name: "Choose your password." }),
    ).toBeVisible();
    expect(
      (
        await service
          .from("memberships")
          .select("user_id")
          .eq("user_id", existing.id)
      ).data,
    ).toHaveLength(1);
    const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
    expect(
      data.users.filter((user) => user.email === existing.email),
    ).toHaveLength(1);
  } finally {
    await invited.close();
  }
});

test("cross-browser verification keeps the email session but requires the original copy invitation", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(90000);
  await loginAdmin(page);
  const email = `copy-cross-browser-${tag}@example.test`,
    link = await copyInvitation(page, email);
  const first = await browser.newPage(),
    second = await browser.newPage();
  try {
    await openCopy(first, link);
    await requestVerification(first, email);
    await second.goto(await emailLink(request, email));
    await second
      .getByRole("button", { name: "Verify email", exact: true })
      .click();
    await expect(second).toHaveURL(/\/invite\?message=/);
    await expect(second.getByRole("status")).toContainText(
      "Reopen your original invitation link",
    );
    const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
    const account = data.users.find((user) => user.email === email)!;
    expect(
      (
        await service
          .from("memberships")
          .select("user_id")
          .eq("user_id", account.id)
      ).data,
    ).toHaveLength(0);
    await openCopy(second, link);
    await second
      .getByRole("button", { name: "Accept invitation", exact: true })
      .click();
    await expect(
      second.getByRole("heading", { name: "A little closer together." }),
    ).toBeVisible();
  } finally {
    await first.close();
    await second.close();
  }
});

test("email confirmation cannot replace an unrelated signed-in account or activate its invitation", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(90000);
  await loginAdmin(page);
  const email = `copy-wrong-account-${tag}@example.test`,
    link = await copyInvitation(page, email);
  const guest = await browser.newPage(),
    wrong = await browser.newPage();
  try {
    await openCopy(guest, link);
    await requestVerification(guest, email);
    const verificationLink = await emailLink(request, email);
    await login(wrong, people[0].email);
    await wrong.goto(verificationLink);
    await wrong
      .getByRole("button", { name: "Verify email", exact: true })
      .click();
    await expect(wrong.locator("main").getByRole("alert")).toContainText(
      "different account",
    );
    await wrong.goto("/settings");
    await expect(wrong.getByLabel("Display name")).toHaveValue(people[0].name);
    const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
    const account = data.users.find((user) => user.email === email)!;
    expect(
      (
        await service
          .from("memberships")
          .select("user_id")
          .eq("user_id", account.id)
      ).data,
    ).toHaveLength(0);
  } finally {
    await guest.close();
    await wrong.close();
  }
});
