# Production and phone-app handover

The repository contains deployment configuration and operator tools; it has not been deployed to a verified production service. `gregslist.friend` is the preferred address, but its registration, ownership and DNS have not been verified. No hosted migration, SMTP configuration, real-mail delivery, signed phone binary or app-store release is implied by a successful local test. Public deployment requires explicit approval.

## Accounts and ownership

The operator needs a Supabase account/project for the private database, sign-in and photos; a Next.js hosting account such as Vercel; and an email provider that supplies authenticated SMTP. An initial hosting-provided HTTPS address can be used before purchasing a domain. The operator must also supply the community owner's name and a member-support contact for the privacy/support information before launch.

For downloadable phone apps, the publisher additionally needs an Expo/EAS project, Apple Developer/App Store Connect access and a Google Play Console account, with identifiers and signing credentials belonging to that publisher. These account connections cannot be created from a proposed domain name. Configure credentials through the relevant secure account settings; do not paste secrets into chat or commit them.

## Configuration

[production.env.example](production.env.example) lists the variables with empty credential fields. It is documentation, not deployable configuration. Copy it to ignored `.env.production.local` on a trusted operator machine when a private environment file is useful. Production scripts do not load that file automatically; the commands below use Node's explicit `--env-file` option.

| Location                        | Values                                                                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js host, build and runtime | `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                                                                                         |
| Next.js server secrets          | `SUPABASE_SERVICE_ROLE_KEY`, independent random `CRON_SECRET` of at least 32 characters                                                                                            |
| Trusted operator tooling        | `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`; production URL/public-key/service-key variables or their `GREGSLIST_PRODUCTION_*` overrides                                       |
| Auth configuration operator     | `SMTP_HOST`, `SMTP_PORT` (`465` or `587`), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SENDER_EMAIL`, `SMTP_SENDER_NAME`                                                                   |
| Native build                    | Three `EXPO_PUBLIC_*` values, real `GREGSLIST_IOS_BUNDLE_ID`, `GREGSLIST_ANDROID_PACKAGE`, `EXPO_OWNER`, `EAS_PROJECT_ID`; EAS/platform signing credentials in their secure stores |

The public Supabase key is a publishable/anon key. The service credential bypasses RLS and stays on trusted servers. SMTP credentials, the management token and `CRON_SECRET` never belong in `NEXT_PUBLIC_*`, `EXPO_PUBLIC_*` or a mobile bundle. Production aliases are understood only by the operator scripts, not by the deployed web application. Set the exact application names on the web host and rebuild when public variables change.

Cloud configuration drafts and network allowances do not supply real credentials or activate a deployment. If the cloud session uses proxy-bound secrets, give each secret only its intended host: the management token and SMTP password to `api.supabase.com`, Expo token to `api.expo.dev`, and the runtime service key to the exact selected project hostname. Do not copy proxy placeholders into a hosting dashboard; the actual deployment needs credentials configured in its own secret store. A project-specific service-key binding cannot be completed until that project is known.

## Hosted database migrations

First rehearse against disposable local data with `npm run test:migrations`, plus the documented database/API/concurrency checks. That rehearsal verifies synthetic clean/restored databases; it does not prove the production provider's backups or live upgrade state.

A trusted operator must confirm the intended project, review its migration history, take and verify an appropriate backup, then review every pending committed migration. Use the repository-pinned CLI. With the selected project reference and CLI authentication securely configured, a migration plan can be inspected with:

```sh
npx --no-install supabase db push --project-ref "$SUPABASE_PROJECT_REF" --skip-vault --dry-run
```

`--skip-vault` matters: this CLI otherwise updates Vault secrets before migrations, even though these changes are unrelated. Inspect the plan before a separately authorised application:

```sh
npx --no-install supabase db push --project-ref "$SUPABASE_PROJECT_REF" --skip-vault
```

Do not add `--include-seed`, reset a hosted database, discard migration history or run a destructive rollback. Preserve separate migration transactions, particularly the Phase 5 enum addition followed by its use. Apply all pending migrations in order, including the Phase 6 notification, erasure and subsequent security corrections. Local `npm run db:migrate` uses the local wrapper; it is not the hosted deployment procedure. Never use `bootstrap-local.mjs` against a hosted project. Provision the first verified administrator through a trusted operator-controlled Auth/database connection; no public bootstrap route exists.

## Hosted Auth, templates and email

Local `supabase/config.toml` and templates do not configure hosted Auth. The operator tool prepares the existing invitation-only policy, canonical HTTPS site origin, custom SMTP and all three committed templates: `invite.html`, `recovery.html`, `magic-link.html`. It disables public signup, anonymous/other external providers, requires email verification and a minimum twelve-character password. Verification links use a fragment and an explicit confirmation step. The exact redirect allowlist is the canonical origin plus `/auth/confirm`, `/auth/callback` and `/settings/password`; do not add broad wildcards.

Prepare and review the plan:

```sh
node --env-file=.env.production.local scripts/production-configure.mjs
```

Planning requires real target and SMTP values; with a management token it also reads current hosted settings. It sends no email and applies no migration. After explicit approval of the target/settings, use `--apply --project-ref <exact-project-reference> --site-origin <exact-https-origin>` with the same command. Both confirmation values must match the configured target. The tool patches Auth settings and reads them back; it does not deploy the website or certify SMTP delivery.

Before inviting real members, verify the sender/domain with the email provider, publish its required DNS authentication records and test actual invitation, new-account verification and recovery email delivery to external inboxes. Test expired/reused/revoked invitations and exact redirects on phones as well. A copied invitation avoids the administrator's invitation email but **new or unverified accounts still require verification email**. Do not disable verification to work around email configuration.

## Website release and checks

Build with Node 24 and the committed lockfile using `npm ci`, `npm run build` and `npm run typecheck`. `vercel.json` identifies Next.js and schedules hourly privacy maintenance. Configure host build/runtime values before building, then make a reviewable preview. Inspect the actual preview, production target and migration plan before approving a public release. Do not connect a feature branch to an automatic public production deployment without that approval.

With the real site configured, run:

```sh
node --env-file=.env.production.local scripts/production-check.mjs
```

This check reads hosted Auth configuration, migration-version metadata and private Storage settings; probes anonymous read denial; and checks the sign-in page's security/no-store headers. It never applies migrations, deletes data, deploys or sends messages. A passing result still requires signed-in production journeys, real-mail deliverability, backup/restore verification, maintenance monitoring and device testing. The command fails when required configuration or verification is missing.

The standard GitHub workflow runs local Supabase, API/database/concurrency/migration tests, web checks and native JavaScript checks. The separate manually dispatched read-only readiness workflow reads the repository's protected `production` environment variables/secrets. A workflow file is not evidence that GitHub-hosted CI passed: check the actual run and logs after publication. Protect production secrets and environment access; do not enable a deployment workflow as part of this handover.

## Immediate deletion and maintenance

Account deletion has no undo period. After fresh password verification, its database transaction ends membership access, scrubs profile/contact/authored content and closes active arrangements. Auth-account and exact photo-object removal follow immediately. If either provider operation fails, a private retry job remains and the response reports incomplete cleanup. Minimal pseudonymised event/ride/admin history is scheduled for expiry after twelve months; expiry is gated on completed Auth/Storage removal. Unrelated members' content is retained. Suspension/removal are separate administrative actions and do not themselves erase an account.

The authenticated `/api/maintenance/privacy` route retries account and ordinary-photo cleanup and purges due history. Configure an independent `CRON_SECRET` and a scheduler that sends `Authorization: Bearer <secret>` hourly; Vercel supplies this header for its configured cron when the secret is set. Confirm the selected hosting plan supports the committed hourly schedule and sufficient execution time. Missing/short secrets produce HTTP 503; incorrect authentication produces 401. Restrict access to scheduler configuration and monitor failures and pending-job counts. No scheduler is verified merely because `vercel.json` exists.

For a trusted operator retry, use a private file with the exact application URL/service-key names:

```sh
GREGSLIST_ENV_FILE=.env.production.local npm run privacy:cleanup
```

This command **performs queued deletions and retention purges** against the configured database. It does not understand the `GREGSLIST_PRODUCTION_*` aliases; confirm the target privately before running it. Its output is counts, not private object paths. Do not use local `.env.local` accidentally as a production target or copy private logs into public CI output. Run and monitor repeated batches until the pending queue is empty; provider failure must remain visible rather than be reported as completed erasure.

## Backups, recovery and failed releases

Before launch, record the actual Supabase/hosting plan, backup frequency, retention, restore method, available point-in-time recovery, provider security-log retention and the person responsible. Verify these with the provider; none is currently certified. Database backups do not establish that private Storage objects are backed up. Plan and test a separate encrypted, access-controlled Storage backup/restore procedure where needed; avoid public buckets, public backup links and unbounded private log retention.

Rehearse restoration into an isolated project with synthetic data before relying on it. Check schema/migration history, Auth identity consistency, Storage metadata/object integrity, RLS/grants, final-admin protection, partner consent and reservation capacity/uniqueness. Keep public/member access disabled throughout recovery. Establish how erasure requests completed after the backup will be obtained from an approved, access-controlled deletion record and reapplied, including Auth/Storage removal, **before** restoring access. The repository has a local restore rehearsal; it does not yet provide a verified production backup schedule or external deletion ledger. Define and test that procedure with the provider and minimise its retained identifiers.

Immediate application deletion does not instantly remove provider-managed backups or security logs. Their verified expiry and restoration-erasure procedures must be reflected in the public privacy information. Do not claim immediate physical deletion of those copies or legal compliance from these tools.

For a failed website release, revert to a known compatible build while preserving the database, or restrict access while investigating. Prefer a reviewed forward database correction; do not drop tables or restore an old backup over newer member data as an automatic rollback. If a restore is necessary, use the recovery procedure above and recheck erasure requests before reopening access.

## iPhone and Android release

See [mobile/README.md](../mobile/README.md) for configuration, native security boundaries and EAS commands. The React Native client is implemented separately from the website. `npm run mobile:export` produces JavaScript/assets, **not** a downloadable signed APK or IPA.

After connecting the publisher's real project, public service values, owned identifiers and signing credentials, review Android's internal APK and iPhone's registered-device/TestFlight build on physical devices. Verify sign-in/revocation, photo permissions, Keychain/Keystore storage, rides/partner bookings, deletion, accessibility and store privacy/support disclosures. iPhones require TestFlight, the App Store or valid registered-device provisioning; an arbitrary downloadable IPA is insufficient. Store submission is a separate approved publication action. No signed binaries, store approvals or physical-device test results are established by this repository's local checks.

## Remaining launch gates

- Verified hosting/Supabase target and domain ownership; owner/support details.
- Reviewed hosted migrations, provider backups/log retention, tested recovery and restore-erasure procedure.
- Configured SMTP/templates/redirects and successful external verification/recovery delivery.
- Configured hourly maintenance, authenticated execution and monitored retries/expiry.
- Fresh hosted CI and signed-in production/security checks.
- Signed native builds, physical iPhone/Android testing and approved distribution.

Until those gates have evidence, the appropriate status is **ready for limited testing only**, not a publicly launched service or an available phone-store download.
