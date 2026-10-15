import { test } from "node:test";
import assert from "node:assert/strict";
import {
  publicHttpsUrl,
  isPublishableKey,
  trustedWebUrl,
  friendlyError,
} from "../lib/security.ts";
import {
  createSecureStorage,
  type SecretStore,
} from "../lib/secure-storage.ts";
import { eventInstant, positiveCapacity } from "../lib/content.ts";

function memory() {
  const data = new Map<string, string>();
  let fail = "";
  const store: SecretStore = {
    getItemAsync: async (key) => data.get(key) ?? null,
    setItemAsync: async (key, value) => {
      if (key.includes(fail) && fail) throw new Error("Device storage failure");
      assert.ok(Buffer.byteLength(value) <= 2048);
      data.set(key, value);
    },
    deleteItemAsync: async (key) => {
      data.delete(key);
    },
  };
  let version = 0;
  return {
    data,
    storage: createSecureStorage(store, () => `version-${++version}`),
    failOn: (value: string) => {
      fail = value;
    },
  };
}
test("native configuration accepts only public canonical HTTPS origins", () => {
  assert.equal(
    publicHttpsUrl("https://community.example.org"),
    "https://community.example.org",
  );
  for (const value of [
    "http://community.example.org",
    "https://user:password@example.org",
    "https://localhost",
    "https://127.0.0.1",
    "https://172.16.0.1",
    "https://[::1]",
    "https://name.invalid",
    "https://example.org/path",
    "https://example.org/?secret=x",
    "https://example.org/#token=x",
  ])
    assert.equal(publicHttpsUrl(value), null);
});
test("native configuration rejects privileged and malformed Supabase keys", () => {
  assert.equal(isPublishableKey(`sb_publishable_${"a".repeat(40)}`), true);
  assert.equal(isPublishableKey(`sb_secret_${"a".repeat(40)}`), false);
  const jwt = (role: string) =>
    `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
  assert.equal(isPublishableKey(jwt("anon")), true);
  assert.equal(isPublishableKey(jwt("service_role")), false);
  assert.equal(isPublishableKey("YOUR_PUBLIC_KEY"), false);
});
test("browser handoffs cannot escape the configured community origin or approved paths", () => {
  assert.equal(
    trustedWebUrl("https://community.example.org", "/privacy"),
    "https://community.example.org/privacy",
  );
  for (const value of [
    "https://evil.example.org",
    "//evil.example.org",
    "/settings/password",
    "/invite/../../other",
    "/invite-suffix",
    "/photos/private",
  ])
    assert.throws(() => trustedWebUrl("https://community.example.org", value));
});
test("internal database errors are not shown as native feedback", () => {
  assert.equal(
    friendlyError("Not enough seats. Existing reservations have been kept"),
    "Not enough seats. Existing reservations have been kept",
  );
  assert.ok(
    !friendlyError("relation private.secret_table does not exist").includes(
      "secret_table",
    ),
  );
});
test("device storage supports sessions larger than one Keychain value", async () => {
  const { storage } = memory();
  const value = "session".repeat(1500);
  await storage.setItem("session-key", value);
  assert.equal(await storage.getItem("session-key"), value);
});
test("native storage chunks Unicode by bytes without corrupting a session", async () => {
  const { storage, data } = memory();
  const value = "🌳木".repeat(1800);
  await storage.setItem("unicode", value);
  assert.equal(await storage.getItem("unicode"), value);
  assert.ok(
    [...data.values()].every((part) => Buffer.byteLength(part) <= 2048),
  );
});
test("a failed chunk write leaves the previously committed session usable", async () => {
  const { storage, failOn } = memory();
  await storage.setItem("session", "old-session");
  failOn("version-2.1");
  await assert.rejects(storage.setItem("session", "new".repeat(2000)));
  assert.equal(await storage.getItem("session"), "old-session");
});
test("a failed manifest commit cannot replace a complete session", async () => {
  const { storage, failOn } = memory();
  await storage.setItem("session", "old-session");
  failOn(".manifest");
  await assert.rejects(storage.setItem("session", "replacement"));
  assert.equal(await storage.getItem("session"), "old-session");
});
test("concurrent session writes commit in order and logout removes committed chunks", async () => {
  const { storage, data } = memory();
  await Promise.all([
    storage.setItem("session", "first"),
    storage.setItem("session", "second"),
  ]);
  assert.equal(await storage.getItem("session"), "second");
  await storage.removeItem("session");
  assert.equal(await storage.getItem("session"), null);
  assert.equal(data.size, 0);
});
test("corrupt or missing Keychain chunks fail closed", async () => {
  const { storage, data } = memory();
  await storage.setItem("session", "x".repeat(2000));
  data.delete("session.version-1.1");
  assert.equal(await storage.getItem("session"), null);
  data.set("session.manifest", "corrupt");
  assert.equal(await storage.getItem("session"), null);
});
test("oversized sessions cannot overwrite an existing committed session", async () => {
  const { storage } = memory();
  await storage.setItem("session", "old");
  await assert.rejects(storage.setItem("session", "x".repeat(100000)));
  assert.equal(await storage.getItem("session"), "old");
});
test("event input resolves timezone instants and rejects daylight-saving gaps and folds", () => {
  assert.equal(
    eventInstant("2027-01-01T12:00", "Pacific/Auckland"),
    "2026-12-31T23:00:00Z",
  );
  assert.throws(() => eventInstant("2027-09-26T02:30", "Pacific/Auckland"));
  assert.throws(() => eventInstant("2027-04-04T02:30", "Pacific/Auckland"));
  assert.throws(() => eventInstant("2027-01-01", "Pacific/Auckland"));
});
test("event capacities require valid positive integers or explicit unlimited", () => {
  assert.equal(positiveCapacity(""), null);
  assert.equal(positiveCapacity("2"), 2);
  for (const value of ["0", "-1", "1.5", "NaN", "1e3", "999999999999"])
    assert.throws(() => positiveCapacity(value));
});
