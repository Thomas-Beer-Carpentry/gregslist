# Development and deployment

Use the existing checkout; cloud tasks already have isolation, so do not create a worktree unless requested. Node.js 24, npm and Docker are required. The committed npm lockfile pins dependencies. npm's cache lives at /tmp/gregslist-npm-cache in this cloud environment.

## Local startup

1. Run `npm ci` in /workspace/gregslist.
2. Run `python scripts/prepare-vfs-images.py` when Docker uses vfs, then `npm run db:start`.
3. Run `node scripts/local-env.mjs`. It preserves existing .env.local and copies only local Supabase credentials into it without printing them.
4. Run `node scripts/bootstrap-local.mjs` once. It creates a local administrator and saves a random password in ignored .local-admin.json. Read that file privately to sign in; do not send its contents to chat or commit it.
5. Run `npm run dev`. Make a local request to /login and sign in to confirm the member shell works.

Processes must restart in a new task. Dependencies, ignored local configuration and Docker volumes can persist; do not assume live servers persist. Stop only services started for this project with `npm run db:stop`. `npm run db:reset` destroys local database state: use only for disposable development data. Delete stale ignored local admin credentials after an intentional reset, then bootstrap again.

Supabase may need permission to write /home/agent/.supabase. Keep TLS and image verification enabled. The local email inbox is supplied by Supabase's mail service on port 54324. Invitation/recovery emails use committed templates that route token hashes through the server callback.

## Configuration

See .env.example. NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are browser-safe. SUPABASE_SERVICE_ROLE_KEY is privileged and server-only. NEXT_PUBLIC_SITE_URL is the canonical application origin. No production credentials belong in Git.

For hosted Supabase: apply migrations deliberately; disable public email signup and anonymous/unused providers; require email verification; set a 12-character password minimum; configure the site URL and exact redirect allowlist; install both email templates from supabase/templates, and configure production SMTP. Local config.toml does not automatically configure hosted Auth. Test invitation, recovery and revocation before deployment. Vercel deployment is a later explicit operation.

The first production administrator must be provisioned by a trusted operator: create a verified Auth account, then insert its profile and admin membership through an operator-controlled database connection. There is no public bootstrap endpoint. Local bootstrap script refuses non-loopback Auth URLs.

## Checks

- `npm run build`
- `npm run typecheck`
- `npm test` (real local Auth/API/database integration, disposable test users)
- Browser tests documented with the test configuration.

No production migrations, deployment, push or publication are performed by these scripts. Phase 2–4 content writes are intentionally denied until their transactional APIs exist.

`npm run db:test` runs the migration/security contract checks. `npm run test:e2e` uses /usr/bin/chromium by default (override CHROMIUM_PATH on other machines); run local bootstrap first. The tests cover private-route redirects, mobile overflow, sign-in, profile editing, admin access, logout, invitation email delivery/acceptance, token reuse denial and password recovery. Additional Auth/API tests exercise concurrent invitation redemption and storage privacy.

### Docker with the vfs driver

This cloud machine uses Docker vfs, which copies every image layer and can exhaust its disk while extracting the official Supabase PostgreSQL image. Before the first Supabase start, run `python scripts/prepare-vfs-images.py`. It downloads a checksum-verified crane release, resolves the official PostgreSQL and Storage images by digest, verifies their layers during export, and imports the same filesystem/runtime configuration as a single local layer. It never pushes derived images or disables verification. Other Docker drivers skip this step. The helper is pinned to the images used by the committed Supabase CLI version; update these pins together when upgrading the CLI.

The db scripts use an isolated ignored Docker client configuration under .cache/docker-local. This prevents default outbound proxy injection into local Supabase containers, where it breaks internal email-template fetches and loopback health checks. The Docker daemon still uses its configured registry/network path. This does not modify the machine’s existing Docker configuration. Template files must be world-readable (chmod 644 supabase/templates/*.html) for Kong’s unprivileged static file server.
