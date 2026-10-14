# Gregslist

A private community noticeboard. [Master brief](PROJECT_BRIEF.md) · [Architecture](docs/architecture.md) · [Setup](docs/setup.md).

Phases 1–4 provide the private chronological noticeboard, seven post types, search and filters, owner-managed content, private photos and saved posts. Events include capacity-safe RSVPs, member-visible attendee lists, cancellation/completion/archiving and private in-app event updates. Invitation-only membership remains enforced. Phase 4 adds optional ride offers, automatic seat reservations, mutually consented partner bookings, atomic switching, withdrawal and lifecycle handling. See [Phase 4 implementation and validation](docs/phase-4-validation.md).

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
