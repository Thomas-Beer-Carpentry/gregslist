# Gregslist

A private community noticeboard. [Master brief](PROJECT_BRIEF.md) · [Architecture](docs/architecture.md) · [Setup](docs/setup.md).

Phase 2 adds the chronological noticeboard, seven post types, search and filters, owner-managed posts and comments, private photos, saved posts and an upcoming-events sidebar. Invitation-only membership remains enforced. Basic event dates and locations are supported; RSVPs/capacity and ride coordination remain later phases.

```sh
npm ci
python scripts/prepare-vfs-images.py
npm run db:start
npm run db:migrate
node scripts/local-env.mjs
node scripts/bootstrap-local.mjs
npm run dev
```

Requires Node.js 24 and Docker. Local credentials are generated into ignored files; see setup documentation. Do not deploy with local credentials.
