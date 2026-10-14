# Development and deployment

Use the existing checkout; cloud tasks already have isolation, so do not create a worktree unless requested. Node.js 24, npm and Docker are required. The committed npm lockfile pins dependencies. npm's cache lives at /tmp/gregslist-npm-cache in this cloud environment.

## Local startup

1. Run `npm ci` in /workspace/gregslist.
2. Run `python scripts/prepare-vfs-images.py` when Docker uses vfs, then `npm run db:start`.
3. Run `npm run db:migrate` to apply pending local migrations without resetting data, then `node scripts/local-env.mjs`. It preserves existing .env.local and copies only local Supabase credentials into it without printing them.
4. Run `node scripts/bootstrap-local.mjs` once. It creates a local administrator and saves a random password in ignored .local-admin.json. Read that file privately to sign in; do not send its contents to chat or commit it.
5. Run `npm run dev`. Make a local request to /login and sign in to confirm the member shell works.

Processes must restart in a new task. Dependencies, ignored local configuration and Docker volumes can persist; do not assume live servers persist. Stop only services started for this project with `npm run db:stop`. `npm run db:reset` destroys local database state: use only for disposable development data. Delete stale ignored local admin credentials after an intentional reset, then bootstrap again.

Supabase may need permission to write /home/agent/.supabase. Keep TLS and image verification enabled. The local email inbox is supplied by Supabase's mail service on port 54324. Invitation/recovery emails use committed templates with fragment-based verification links and an explicit confirmation step.

## Configuration

See .env.example. NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are browser-safe. SUPABASE_SERVICE_ROLE_KEY is privileged and server-only. NEXT_PUBLIC_SITE_URL is the canonical application origin. No production credentials belong in Git.

For hosted Supabase: apply migrations deliberately; disable public email signup and anonymous/unused providers; require email verification; set a 12-character password minimum; configure the site URL and exact redirect allowlist; install all three email templates from supabase/templates, and configure production SMTP. Local config.toml does not automatically configure hosted Auth. Test invitation, recovery and revocation before deployment. Vercel deployment is a later explicit operation.

The first production administrator must be provisioned by a trusted operator: create a verified Auth account, then insert its profile and admin membership through an operator-controlled database connection. There is no public bootstrap endpoint. Local bootstrap script refuses non-loopback Auth URLs.

## Checks

- `npm run build`
- `npm run typecheck`
- `npm test` (real local Auth/API/database integration, disposable test users)
- Browser tests documented with the test configuration.

No production migrations, deployment, push or publication are performed by these scripts. Direct table writes remain denied. Phase 2 noticeboard mutations use owner-checked RPCs; Phase 3 RSVP changes use the capacity-safe set_event_rsvp RPC. Direct RSVP, ride and partner table writes remain denied. Phase 4 adds authenticated transactional ride/partner RPCs.

`npm run db:test` runs the migration/security contract checks. `npm run test:e2e` uses /usr/bin/chromium by default (override CHROMIUM_PATH on other machines); run local bootstrap first. The tests cover private-route redirects, mobile overflow, sign-in, profile editing, admin access, logout, invitation email delivery/acceptance, token reuse denial and password recovery. Additional Auth/API tests exercise concurrent invitation redemption and storage privacy.

### Docker with the vfs driver

This cloud machine uses Docker vfs, which copies every image layer and can exhaust its disk while extracting the official Supabase PostgreSQL image. Before the first Supabase start, run `python scripts/prepare-vfs-images.py`. It downloads a checksum-verified crane release, resolves the official PostgreSQL and Storage images by digest, verifies their layers during export, and imports the same filesystem/runtime configuration as a single local layer. It never pushes derived images or disables verification. Other Docker drivers skip this step. The helper is pinned to the images used by the committed Supabase CLI version; update these pins together when upgrading the CLI.

The db scripts use an isolated ignored Docker client configuration under .cache/docker-local. This prevents default outbound proxy injection into local Supabase containers, where it breaks internal email-template fetches and loopback health checks. The Docker daemon still uses its configured registry/network path. This does not modify the machine’s existing Docker configuration. Template files must be world-readable (chmod 644 supabase/templates/*.html) for Kong’s unprivileged static file server.

## Noticeboard photos and cleanup

Uploads use the existing server-only Supabase credential. No additional external service or credential is required. Each post accepts up to six still JPEG, PNG or WebP files, 5 MB per file; uploaded photos are validated and re-encoded to WebP, resized and stripped of EXIF/location metadata. Members cannot bypass this through direct Storage writes. Photo routes require current membership and use private, no-store responses.

Deleting a photo/post immediately removes member access. Storage removal follows the database transaction; if it fails, a private photo_cleanup record persists. Run `npm run photos:cleanup` to retry up to 100 queued objects; repeat until the queue is empty. Production should schedule this retry as part of deployment. Do not print private object paths.

Phases 2–5 have additive migrations; use npm run db:migrate on an existing checkout. Do not reset existing development data to apply updates.

## Event updates

Apply migration 202610140004_events.sql locally with `npm run db:migrate`. It adds RSVP cancellation history and timestamps, Completed event status, and private event-update messages. Legacy event Fulfilled statuses become Completed. No extra environment variables or notification provider are needed. Event updates are available to their recipients at `/notifications`; email/push delivery is not enabled.

## Ride coordination (Phase 4)

Run `npm run db:migrate` on an existing local checkout to apply `202610140005_ride_coordination.sql`. Do not reset existing data. The migration extends ride/partner tables, adds private idempotency/audit records and capacity constraints, and integrates existing post/event/revocation operations. Legacy return details are retained and marked as available. It does not require new environment variables, providers, payments, email delivery or background workers.

Ride coordination is optional in the post form. Partner linking is under Account settings → Manage linked partner. Relevant ride notifications appear in the existing `/notifications` screen, now labelled Updates. Dates default to Pacific/Auckland and contribution currency defaults to NZD; both are configurable per offer. Return details are informational, not separate seat inventory.

Hosted migration/deployment remains a separate explicitly authorised operation. This phase only applies migrations to the local development database. Existing production Auth/site/SMTP configuration requirements remain unchanged.

## Membership and administration (Phase 5)

Apply `202610140006_membership_states.sql` then `202610140007_administration.sql` with `npm run db:migrate`. Keep these as separate migration transactions: PostgreSQL must commit the added status enum values before they are used. Both are additive; do not reset existing data. Legacy Revoked members remain inactive and legacy email invitations remain redeemable under their existing expiry/revocation rules.

For local Auth template/config changes, stop and start this project's Supabase services using the wrapper scripts (volumes are retained), then confirm `/login` and the local inbox on port 54324 work. Keep `supabase/templates/*.html` world-readable. New links open `/auth/confirm` with credentials in fragments and require an explicit verification button; old `/auth/callback` links remain compatible. Never paste or print credential-bearing URLs.

For hosted Auth, manually install all three templates (invite, recovery, magic_link), configure the canonical HTTPS site URL and exact `/auth/confirm`, legacy `/auth/callback`, and `/settings/password` redirect allowlist, and configure SMTP. Keep global public signup disabled, anonymous/unused providers disabled, email verification enabled and the password minimum at 12 characters. Local config does not change hosted settings. Copy-link generation and existing verified-user acceptance do not send email; a new or unverified account still requires Supabase verification email. No service key is exposed to the browser.

`/admin` provides invitations, access/role controls, member search and audit history; `/members` is the active-member directory. The controls explain responsibility cleanup before suspension/removal. Reactivation does not restore old events, reservations or links. Removal retains the Auth account and history and cannot be undone through the application; personal-data deletion and production retention remain undecided and are not implemented.

Run the trusted local bootstrap before API/browser tests so disposable administrators can be cleaned up without violating final-administrator protection. `npm run test:admin-concurrency` uses local Docker to clone schema definitions only into a generated temporary database, exercises simultaneous administrative changes with synthetic accounts, then drops that database. It never copies application data or changes the existing administrator. Hosted migrations, SMTP and real-mail deliverability require separate operator verification; no production operation is performed by Phase 5 scripts.
