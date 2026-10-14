# Gregslist

A private community noticeboard. [Master brief](PROJECT_BRIEF.md) · [Architecture](docs/architecture.md) · [Setup](docs/setup.md).

Phases 1–3 provide the private chronological noticeboard, seven post types, search and filters, owner-managed content, private photos and saved posts. Events include capacity-safe RSVPs, member-visible attendee lists, cancellation/completion/archiving and private in-app event updates. Invitation-only membership remains enforced. Ride coordination is Phase 4. See [Phase 3 validation](docs/phase-3-validation.md).

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
