import { test } from "node:test";
import assert from "node:assert/strict";
import {
  productionTarget,
  desiredAuthConfig,
  configureProduction,
  authConfigurationIssues,
  productionEnvironment,
} from "../scripts/production-configure.mjs";
import { deploymentEnvironmentIssues } from "../scripts/production-check.mjs";
const env = {
  SUPABASE_PROJECT_REF: "a".repeat(20),
  NEXT_PUBLIC_SITE_URL: "https://community.example.org",
  SMTP_HOST: "smtp.provider.example.org",
  SMTP_PORT: "587",
  SMTP_USER: "synthetic-user",
  SMTP_PASSWORD: "synthetic-test-password",
  SMTP_SENDER_EMAIL: "community@example.org",
  SMTP_SENDER_NAME: "Gregslist",
};
test("production target rejects local, insecure and credential-bearing origins", () => {
  for (const value of [
    "http://example.org",
    "https://localhost",
    "https://name.invalid",
    "https://user:password@example.org",
    "https://example.org/path",
    "https://example.org/#token=value",
  ])
    assert.throws(() =>
      productionTarget({ ...env, NEXT_PUBLIC_SITE_URL: value }),
    );
  assert.throws(() =>
    productionTarget({ ...env, SUPABASE_PROJECT_REF: "wrong" }),
  );
  assert.deepEqual(productionTarget(env).redirects, [
    "https://community.example.org/auth/confirm",
    "https://community.example.org/auth/callback",
    "https://community.example.org/settings/password",
  ]);
});
test("production configuration does not override local development environment variables", () => {
  const normalized = productionEnvironment({
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    GREGSLIST_PRODUCTION_SITE_URL: env.NEXT_PUBLIC_SITE_URL,
  });
  assert.equal(normalized.NEXT_PUBLIC_SITE_URL, env.NEXT_PUBLIC_SITE_URL);
  assert.equal(
    productionEnvironment({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000" })
      .NEXT_PUBLIC_SITE_URL,
    "http://localhost:3000",
  );
});
test("hosted Auth settings preserve invite-only verified email and disable external providers", async () => {
  const target = productionTarget(env);
  const patch = await desiredAuthConfig(env, target, {
    external_google_enabled: true,
  });
  assert.equal(patch.disable_signup, true);
  assert.equal(patch.mailer_autoconfirm, false);
  assert.equal(patch.external_anonymous_users_enabled, false);
  assert.equal(patch.external_google_enabled, false);
  assert.equal(patch.external_email_enabled, true);
  assert.equal(patch.password_min_length, 12);
  assert.ok(
    patch.mailer_templates_invite_content.includes("/auth/confirm#token_hash="),
  );
  assert.deepEqual(await authConfigurationIssues(patch, target), []);
});
test("hosted configuration defaults to a plan without writes, messages or secret output", async () => {
  let calls = 0;
  const result = await configureProduction(env, [], {
    fetchImpl: async () => {
      calls++;
      throw new Error();
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.applied, false);
  assert.ok(!JSON.stringify(result).includes(env.SMTP_PASSWORD));
  assert.ok(!JSON.stringify(result).includes(env.SMTP_USER));
});
test("hosted writes require both exact target confirmations", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    throw new Error();
  };
  await assert.rejects(
    configureProduction(
      { ...env, SUPABASE_ACCESS_TOKEN: "synthetic-token" },
      ["--apply"],
      { fetchImpl },
    ),
  );
  assert.equal(calls, 0);
});
test("a confirmed configuration is written once and checked by reading settings back", async () => {
  let config = { external_google_enabled: true };
  const methods = [];
  const fetchImpl = async (url, options) => {
    assert.equal(new URL(url).origin, "https://api.supabase.com");
    assert.equal(options.redirect, "error");
    methods.push(options.method);
    if (options.method === "PATCH") config = JSON.parse(options.body);
    return new Response(JSON.stringify(config), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const result = await configureProduction(
    { ...env, SUPABASE_ACCESS_TOKEN: "synthetic-token" },
    [
      "--apply",
      "--project-ref",
      env.SUPABASE_PROJECT_REF,
      "--site-origin",
      env.NEXT_PUBLIC_SITE_URL,
    ],
    { fetchImpl },
  );
  assert.deepEqual(methods, ["GET", "PATCH", "GET"]);
  assert.equal(result.applied, true);
  assert.ok(!JSON.stringify(result).includes(env.SMTP_PASSWORD));
});
test("production preflight rejects privileged browser keys and mismatched project identity", () => {
  const target = productionTarget(env);
  const valid = {
    ...env,
    NEXT_PUBLIC_SUPABASE_URL: `https://${env.SUPABASE_PROJECT_REF}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"a".repeat(40)}`,
    SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${"b".repeat(40)}`,
  };
  assert.deepEqual(deploymentEnvironmentIssues(valid, target), []);
  assert.ok(
    deploymentEnvironmentIssues(
      {
        ...valid,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: valid.SUPABASE_SERVICE_ROLE_KEY,
      },
      target,
    ).length,
  );
  assert.ok(
    deploymentEnvironmentIssues(
      {
        ...valid,
        NEXT_PUBLIC_SUPABASE_URL: "https://another-project.supabase.co",
      },
      target,
    ).length,
  );
});
