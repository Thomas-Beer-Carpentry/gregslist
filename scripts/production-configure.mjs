import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const managementOrigin = "https://api.supabase.com";
const templateFiles = {
  mailer_templates_invite_content: "invite.html",
  mailer_templates_recovery_content: "recovery.html",
  mailer_templates_magic_link_content: "magic-link.html",
};
export function productionEnvironment(env) {
  return {
    ...env,
    NEXT_PUBLIC_SITE_URL:
      env.GREGSLIST_PRODUCTION_SITE_URL || env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SUPABASE_URL:
      env.GREGSLIST_PRODUCTION_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      env.GREGSLIST_PRODUCTION_PUBLISHABLE_KEY ||
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY:
      env.GREGSLIST_PRODUCTION_SERVICE_ROLE_KEY ||
      env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

export function productionTarget(env) {
  const projectRef = env.SUPABASE_PROJECT_REF;
  if (!/^[a-z]{20}$/.test(projectRef ?? ""))
    throw new Error(
      "SUPABASE_PROJECT_REF must identify the intended hosted project.",
    );
  let site;
  try {
    site = new URL(env.NEXT_PUBLIC_SITE_URL);
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL must be a canonical HTTPS origin.");
  }
  if (
    site.protocol !== "https:" ||
    site.username ||
    site.password ||
    site.pathname !== "/" ||
    site.search ||
    site.hash ||
    !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(site.hostname) ||
    /(^|\.)(localhost|local|test|invalid|example|internal)$/i.test(
      site.hostname,
    )
  )
    throw new Error(
      "NEXT_PUBLIC_SITE_URL must be a public HTTPS origin without a path.",
    );
  const siteOrigin = site.origin;
  return {
    projectRef,
    siteOrigin,
    redirects: [
      `${siteOrigin}/auth/confirm`,
      `${siteOrigin}/auth/callback`,
      `${siteOrigin}/settings/password`,
    ],
  };
}

export async function managementRequest(target, token, path, options = {}) {
  if (!token)
    throw new Error(
      "SUPABASE_ACCESS_TOKEN is required for hosted verification.",
    );
  const { fetchImpl = fetch, method = "GET", body } = options;
  let response;
  try {
    response = await fetchImpl(
      `${managementOrigin}/v1/projects/${target.projectRef}/${path}`,
      {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
  } catch {
    throw new Error(
      "Hosted management request failed; check network access and credentials.",
    );
  }
  if (!response.ok)
    throw new Error(
      `Hosted management request failed (HTTP ${response.status}).`,
    );
  try {
    return await response.json();
  } catch {
    throw new Error("Hosted management returned an unreadable response.");
  }
}

export async function desiredAuthConfig(env, target, current = {}) {
  const required = [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_SENDER_EMAIL",
    "SMTP_SENDER_NAME",
  ];
  if (required.some((name) => !env[name]?.trim()))
    throw new Error(
      "All documented SMTP settings are required; values are never printed.",
    );
  if (
    !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(env.SMTP_HOST) ||
    /(^|\.)(localhost|local|test|invalid|internal)$/i.test(env.SMTP_HOST) ||
    !["465", "587"].includes(env.SMTP_PORT) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.SMTP_SENDER_EMAIL) ||
    /[\r\n]/.test(env.SMTP_SENDER_NAME)
  )
    throw new Error(
      "SMTP settings must use a valid sender and a TLS-capable submission endpoint.",
    );
  const patch = {
    site_url: target.siteOrigin,
    uri_allow_list: target.redirects.join(","),
    disable_signup: true,
    external_email_enabled: true,
    external_anonymous_users_enabled: false,
    mailer_autoconfirm: false,
    password_min_length: 12,
    smtp_host: env.SMTP_HOST,
    smtp_port: env.SMTP_PORT,
    smtp_user: env.SMTP_USER,
    smtp_pass: env.SMTP_PASSWORD,
    smtp_admin_email: env.SMTP_SENDER_EMAIL,
    smtp_sender_name: env.SMTP_SENDER_NAME,
  };
  // The application supports email/password only. Disable every configured
  // external provider, including providers introduced by hosted Auth upgrades.
  for (const key of Object.keys(current)) {
    if (/^external_.+_enabled$/.test(key) && key !== "external_email_enabled")
      patch[key] = false;
  }
  for (const [key, name] of Object.entries(templateFiles)) {
    patch[key] = await readFile(
      new URL(`../supabase/templates/${name}`, import.meta.url),
      "utf8",
    );
  }
  return patch;
}

export async function authConfigurationIssues(current, target, expected) {
  const issues = [];
  if (current.disable_signup !== true)
    issues.push("Public registration is not disabled.");
  if (current.external_email_enabled !== true)
    issues.push("Email authentication is not enabled.");
  if (current.external_anonymous_users_enabled !== false)
    issues.push("Anonymous authentication is not confirmed disabled.");
  if (current.mailer_autoconfirm !== false)
    issues.push("Email verification is not required.");
  if (!(Number(current.password_min_length) >= 12))
    issues.push("Password minimum is below twelve characters.");
  if (current.site_url !== target.siteOrigin)
    issues.push("Canonical Auth origin differs.");
  const redirects = String(current.uri_allow_list ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .sort();
  if (
    JSON.stringify(redirects) !== JSON.stringify([...target.redirects].sort())
  )
    issues.push("Auth redirects differ from the exact approved allowlist.");
  if (
    Object.entries(current).some(
      ([key, value]) =>
        /^external_.+_enabled$/.test(key) &&
        key !== "external_email_enabled" &&
        value === true,
    )
  )
    issues.push("An unsupported external authentication provider is enabled.");
  if (
    !current.smtp_host ||
    !["465", "587"].includes(String(current.smtp_port)) ||
    !current.smtp_admin_email ||
    !current.smtp_user ||
    !current.smtp_sender_name
  )
    issues.push("Custom SMTP configuration is incomplete.");
  for (const [key, name] of Object.entries(templateFiles)) {
    const template = await readFile(
      new URL(`../supabase/templates/${name}`, import.meta.url),
      "utf8",
    );
    if (current[key] !== template)
      issues.push(`Hosted ${name} differs from the committed template.`);
  }
  if (expected) {
    // Management APIs may redact the stored SMTP password. Authentication and
    // deliverability require a real end-to-end email test; do not claim otherwise.
    for (const key of [
      "smtp_host",
      "smtp_port",
      "smtp_user",
      "smtp_admin_email",
      "smtp_sender_name",
    ]) {
      if (String(current[key]) !== String(expected[key]))
        issues.push(`Hosted ${key} differs from the requested configuration.`);
    }
  }
  return issues;
}

export async function configureProduction(env, args = [], options = {}) {
  env = productionEnvironment(env);
  const { fetchImpl = fetch } = options;
  const target = productionTarget(env);
  const allowed = new Set(["--apply", "--project-ref", "--site-origin"]);
  for (let index = 0; index < args.length; index++) {
    if (!allowed.has(args[index]))
      throw new Error("Unrecognised configuration argument.");
    if (args[index] !== "--apply") index++;
  }
  const apply = args.includes("--apply");
  if (apply) {
    if (
      args[args.indexOf("--project-ref") + 1] !== target.projectRef ||
      args[args.indexOf("--site-origin") + 1] !== target.siteOrigin ||
      !args.includes("--project-ref") ||
      !args.includes("--site-origin")
    )
      throw new Error(
        "Applying Auth settings requires both exact target confirmation arguments.",
      );
    if (!env.SUPABASE_ACCESS_TOKEN)
      throw new Error(
        "SUPABASE_ACCESS_TOKEN is required to apply hosted Auth settings.",
      );
  }
  const current = env.SUPABASE_ACCESS_TOKEN
    ? await managementRequest(
        target,
        env.SUPABASE_ACCESS_TOKEN,
        "config/auth",
        { fetchImpl },
      )
    : {};
  const patch = await desiredAuthConfig(env, target, current);
  const summary = [
    "Plan: canonical HTTPS origin and three exact authentication redirects.",
    "Plan: invitation-only email authentication, required verification and twelve-character passwords.",
    "Plan: custom SMTP and the three committed fragment-based email templates.",
    "No database migrations, deployment, messages or data deletion are performed.",
  ];
  if (!apply) return { applied: false, summary };
  await managementRequest(target, env.SUPABASE_ACCESS_TOKEN, "config/auth", {
    fetchImpl,
    method: "PATCH",
    body: patch,
  });
  const after = await managementRequest(
    target,
    env.SUPABASE_ACCESS_TOKEN,
    "config/auth",
    { fetchImpl },
  );
  const issues = await authConfigurationIssues(after, target, patch);
  if (issues.length)
    throw new Error(
      `Hosted settings changed but verification found: ${issues.join(" ")}`,
    );
  return {
    applied: true,
    summary: [
      ...summary,
      "Hosted Auth configuration was applied and read back successfully.",
      "External email delivery and invitation/recovery journeys remain unverified.",
    ],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await configureProduction(
      process.env,
      process.argv.slice(2),
    );
    for (const line of result.summary) console.log(line);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
