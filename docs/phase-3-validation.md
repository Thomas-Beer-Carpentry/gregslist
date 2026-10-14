# Phase 3: events

The complete master brief remains the source of truth. This phase extends the existing event form, private noticeboard and upcoming sidebar; ride booking and partner linking remain Phase 4.

## Implemented and acceptance evidence

- Structured event creation/editing with optional positive attendance capacity, start/end/timezone/location, and existing photos/comments. Browser checks cover successful edits and preserving form fields after rejected capacity changes.
- Going, Maybe and Not Going responses; Going alone consumes capacity, including an organiser who chooses Going. Member-visible display-name lists and counts exclude cancelled responses/revoked memberships. No email addresses are exposed.
- Identity-bound transactional RSVPs serialize with event edits on the parent post. Real concurrent API calls demonstrate exactly one last-place winner, safe capacity reduction against a new RSVP, cancellation against a new RSVP, and membership revocation against a repeat RSVP. Failed changes preserve the previous response/event content.
- Confirmed cancellation atomically clears active attendance, related rides and reservations, while preserving response history. Reopening requires fresh RSVPs. Completion is terminal; archive preserves history and closes responses. Events with response history cannot be hard deleted. Past/cancelled/completed/archived events remain accessible and leave the upcoming sidebar.
- Restrained recipient-only in-app event updates, with mark-read. Tests cover relevant participant/driver/passenger delivery, unchanged-save deduplication, and denial of another recipient's mark-read request.
- Anonymous access, non-owner edits, invalid responses, and direct capacity/response/notification mutation bypasses remain denied. Existing invitation, noticeboard, photo, comment and saved-post regressions still pass.

## Verification

| Command | Result |
| --- | --- |
| `npm test` | 35 passed: 12 event integration/concurrency checks plus 23 existing checks |
| `npm run db:test` | 24 passed: database permission/security contracts |
| `npm run test:e2e` | 11 browser journeys passed, including four event workflows and mobile attendance layout |
| `npm run build` | Passed |
| `npm run typecheck` | Passed |
| `npm run format:check` | Passed |
| `git diff --check` | Passed |
| Full migration compatibility check | Passed in a rolled-back local transaction with a legacy Fulfilled event; content retained and both statuses converted |

Tests use real local PostgreSQL/Supabase Auth and Chromium. Event API checks initially failed because the transactional RPCs did not exist, then passed after implementation. A full browser run exposed a test synchronization race: the second member navigated before the organiser’s reopen save completed. The test now waits for the saved Scheduled state before checking the other member’s RSVP controls. The migration was applied additively to the local environment; no development data reset, production migration or deployment was performed. The legacy-data rehearsal caught PostgreSQL deferred consistency triggers pending before a constraint alteration; the migration now flushes those triggers before altering the constraint, then restores their deferred mode.

## Defaults and limits

See architecture.md for attendance visibility, lifecycle, notification and retention assumptions. Cancellation history retains the latest response and cancellation metadata, not every past response transition. There is no waitlist or automatic organiser RSVP. Going/Maybe close when an event starts; members can still withdraw from a scheduled event afterward. Cancelled/completed/archived events close all responses. Member restoration does not restore a cancelled RSVP.

General edits to posts with ride arrangements remain blocked until Phase 4 implements the coordinated ride workflow; event cancellation already supports its required atomic cancellation bridge. The targeted event updates do not complete Phase 5 comment/ride notifications, preferences, administration, or deployment work.
