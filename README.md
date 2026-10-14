# Gregslist

A private community noticeboard. [Master brief](PROJECT_BRIEF.md) · [Architecture](docs/architecture.md) · [Setup](docs/setup.md).

Phase 1 provides the design system, member shell, invitation-only authentication, membership administration and initial protected schema. Posts, events and ride workflows arrive in later phases.

```sh
npm ci
python scripts/prepare-vfs-images.py
npm run db:start
node scripts/local-env.mjs
node scripts/bootstrap-local.mjs
npm run dev
```

Requires Node.js 24 and Docker. Local credentials are generated into ignored files; see setup documentation. Do not deploy with local credentials.
