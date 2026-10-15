import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  authConfigurationIssues,
  managementRequest,
  productionTarget,
  productionEnvironment,
} from "./production-configure.mjs";

export function deploymentEnvironmentIssues(env, target) {
  const issues = [];
  if (
    env.NEXT_PUBLIC_SUPABASE_URL !== `https://${target.projectRef}.supabase.co`
  )
    issues.push("Hosted Supabase URL does not match the selected project.");
  const publishable = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!publishable) issues.push("Browser-safe Supabase key is missing.");
  if (!service) issues.push("Server-only Supabase credential is missing.");
  for (const [name, value] of Object.entries(env)) {
    if (
      name.startsWith("NEXT_PUBLIC_") &&
      (/SERVICE|SECRET|TOKEN|PASSWORD|SMTP/.test(name) ||
        (service && value === service))
    )
      issues.push(
        "A privileged credential may be exposed through a browser environment variable.",
      );
  }
  for (const [key, role] of [
    [publishable, "anon"],
    [service, "service_role"],
  ]) {
    if (!key) continue;
    if (key.startsWith(role === "anon" ? "sb_publishable_" : "sb_secret_")) {
      if (!/^[A-Za-z0-9_-]+$/.test(key) || key.length < 30)
        issues.push(
          `The ${role === "anon" ? "browser" : "server"} credential is malformed.`,
        );
      continue;
    }
    let payload;
    try {
      if (key.split(".").length !== 3) throw new Error();
      payload = JSON.parse(
        Buffer.from(key.split(".")[1], "base64url").toString("utf8"),
      );
    } catch {
      issues.push(
        `The ${role === "anon" ? "browser" : "server"} credential format is invalid.`,
      );
      continue;
    }
    if (
      payload.role !== role ||
      payload.ref !== target.projectRef ||
      !Number.isFinite(payload.exp) ||
      payload.exp * 1000 <= Date.now()
    )
      issues.push(
        `The ${role === "anon" ? "browser" : "server"} credential role, project or expiry is invalid.`,
      );
  }
  return [...new Set(issues)];
}

async function hostedFetch(url, key, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error(
      "Hosted API request failed; check network access and credentials.",
    );
  }
  return response;
}

export async function checkProduction(env, options = {}) {
  env = productionEnvironment(env);
  const { fetchImpl = fetch } = options;
  const target = productionTarget(env);
  const issues = deploymentEnvironmentIssues(env, target);
  const checks = [];
  if (issues.length) return { issues, checks };
  checks.push(
    "Deployment variable formats and selected project agree; no credentials printed.",
  );
  const publicSettings = await hostedFetch(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    fetchImpl,
  );
  if (!publicSettings.ok)
    issues.push("The browser publishable key was not accepted by hosted Auth.");
  else checks.push("Hosted Auth accepts the configured browser-safe key.");
  try {
    const web = await fetchImpl(`${target.siteOrigin}/login`, {
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (
      !web.ok ||
      !web.headers.get("x-robots-tag")?.includes("noindex") ||
      !web.headers
        .get("content-security-policy")
        ?.includes("frame-ancestors 'none'") ||
      !web.headers.get("cache-control")?.includes("no-store")
    )
      issues.push(
        "The deployed sign-in page or its private security headers could not be verified.",
      );
    else
      checks.push(
        "The deployed sign-in page responds with private caching, no-index and CSP protections.",
      );
  } catch {
    issues.push("The production website could not be reached securely.");
  }
  if (!env.SUPABASE_ACCESS_TOKEN) {
    issues.push(
      "SUPABASE_ACCESS_TOKEN is missing; hosted Auth and migration state cannot be verified.",
    );
  } else {
    const auth = await managementRequest(
      target,
      env.SUPABASE_ACCESS_TOKEN,
      "config/auth",
      { fetchImpl },
    );
    const authIssues = await authConfigurationIssues(auth, target);
    issues.push(...authIssues);
    if (!authIssues.length)
      checks.push(
        "Hosted Auth restrictions, redirects, SMTP metadata and templates match.",
      );
    const expectedVersions = (
      await readdir(new URL("../supabase/migrations/", import.meta.url))
    )
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
      .map((name) => name.split("_")[0]);
    // This is a fixed metadata-only query inside a read-only transaction. It
    // never applies a migration or returns application data.
    const migrations = await managementRequest(
      target,
      env.SUPABASE_ACCESS_TOKEN,
      "database/query",
      {
        fetchImpl,
        method: "POST",
        body: {
          query:
            "begin read only; select version from supabase_migrations.schema_migrations order by version; rollback;",
        },
      },
    );
    if (!Array.isArray(migrations)) {
      issues.push("Hosted migration history response could not be verified.");
    } else {
      const installed = new Set(migrations.map((row) => String(row.version)));
      const missing = expectedVersions.filter(
        (version) => !installed.has(version),
      );
      if (missing.length)
        issues.push(
          `${missing.length} committed migration(s) are not recorded in the hosted database.`,
        );
      else
        checks.push(
          `All ${expectedVersions.length} committed migrations are recorded in hosted history.`,
        );
    }
  }
  const bucketsResponse = await hostedFetch(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/bucket`,
    env.SUPABASE_SERVICE_ROLE_KEY,
    fetchImpl,
  );
  if (!bucketsResponse.ok) {
    issues.push(
      `Hosted Storage verification failed (HTTP ${bucketsResponse.status}).`,
    );
  } else {
    let buckets;
    try {
      buckets = await bucketsResponse.json();
    } catch {
      buckets = null;
    }
    const bucket =
      Array.isArray(buckets) &&
      buckets.find((item) => item.id === "community-photos");
    if (
      !bucket ||
      bucket.public !== false ||
      !(
        Number(bucket.file_size_limit) > 0 &&
        Number(bucket.file_size_limit) <= 5242880
      ) ||
      JSON.stringify([...(bucket.allowed_mime_types ?? [])].sort()) !==
        JSON.stringify(["image/jpeg", "image/png", "image/webp"].sort())
    )
      issues.push(
        "Community photo bucket is missing, public or has unsafe upload limits.",
      );
    else
      checks.push(
        "Hosted community-photo bucket is private with the required file limits.",
      );
  }
  for (const table of [
    "profiles",
    "posts",
    "ride_offers",
    "ride_reservations",
    "invitations",
    "notifications",
  ]) {
    const response = await hostedFetch(
      `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`,
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      fetchImpl,
    );
    if ([401, 403].includes(response.status)) continue;
    let rows;
    try {
      rows = await response.json();
    } catch {
      rows = null;
    }
    if (!response.ok || !Array.isArray(rows) || rows.length)
      issues.push(
        `Unauthenticated privacy probe did not confirm denial for ${table}.`,
      );
  }
  if (!issues.some((issue) => issue.startsWith("Unauthenticated")))
    checks.push(
      "Unauthenticated read probes returned no private community records.",
    );
  return { issues, checks };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 2)
      throw new Error("This read-only check accepts no command arguments.");
    const result = await checkProduction(process.env);
    for (const line of result.checks) console.log(`PASS: ${line}`);
    for (const line of result.issues) console.error(`BLOCKED: ${line}`);
    console.log(
      "Not verified: external email deliverability, signed-in production journeys, backups and hosted CI.",
    );
    if (result.issues.length) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
