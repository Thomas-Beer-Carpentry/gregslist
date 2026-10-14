# Phase 4 — ride coordination implementation and review

## A. Implementation summary

The detailed Phase 4 brief supplied in chat supplements PROJECT_BRIEF.md and governs this phase. Work is isolated on `feature/phase-4-ride-coordination`. Phases 1–3 are preserved; Phase 5 membership/administration and Phase 6 launch work are not included.

Implemented:

- Exact optional “People might need a ride for this” checkbox on all existing post types and events, persisted through the existing post RPC. There is no new post type or transport feed.
- Multiple driver offers, passenger capacity excluding the driver, pickup, route, optional departure/timezone, return availability/date/details, suggested contribution/currency/notes and passenger notes. Driver identity comes from Auth. Contributions are informational.
- Group-visible driver/passenger display names, seat counts, statuses and retained history; responsive cards, clear empty/unavailable states, confirmation/error feedback, offer/edit/withdraw controls and owner/admin controls.
- Automatically confirmed Just Me, Me and My Partner and My Partner Only bookings. Two-person booking and switching are atomic. Conflicts require the explicit Change Ride action; failed replacements retain existing seats. Individual switches never silently move another passenger.
- Mutually consented partner requests, accept/decline, exclusive linking, request cancellation and unlinking through account settings. Pending/declined requests do not confer booking authority.
- Passenger ownership, separate creation/modification actors, idempotent retries, stale-switch protection, capacity/uniqueness constraints and private audit records.
- Reservation cancellation, withdrawal/alternative arrangements, event/post lifecycle transitions, event transport-review flags, safe refusal to disable active/unresolved coordination, and integration with existing in-app updates.

No Phase 4 requirement is intentionally deferred. Return journeys share the existing informational-leg model; separate return inventory and payment processing are outside the brief.

## B. Files and migration

| Area                          | Files                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Additive migration            | `supabase/migrations/202610140005_ride_coordination.sql`                                                      |
| Database permission contracts | `supabase/tests/rides.sql`                                                                                    |
| Ride UI/backend               | `src/features/rides/{actions,model,coordination,ride-form,booking-form}`                                      |
| Partner UI/backend            | `src/app/settings/partner/page.tsx`, `src/features/partners/actions.ts`                                       |
| Existing integration          | Post form/actions/detail page, account settings, updates page, shell navigation, submit button and shared CSS |
| API/concurrency checks        | `tests/rides.test.mjs`                                                                                        |
| Browser checks                | `tests/e2e/rides.spec.ts`; existing event test navigation label updated from Event updates to Updates         |
| Documentation                 | README, AGENTS, architecture/setup and this report                                                            |

Existing dependencies, Auth, invitation flows, event/RSVP tables and storage configuration are reused. PROJECT_BRIEF.md is unchanged.

## C. Booking architecture

Reservations remain in the foundation `ride_reservations` table, linked to both their ride and parent by a composite foreign key. The existing partial unique index allows at most one Confirmed reservation per passenger/parent, across all rides. Cancelled/Needs Arrangement/Completed records do not occupy seats. Deferred database constraints reject overcapacity, active passengers on inactive offers and driver self-seats, including attempted privileged direct writes.

All transport mutations acquire advisory transaction lock `(71404,1)` before membership, parent-post and ride locks. Partner consent changes, post lifecycle edits and existing membership revocation use the same ordering. Existing RSVPs retain their membership/parent locks. This deliberately serializes transport changes across this small private community; throughput at substantially larger scale has not been load-tested.

`book_ride` resolves the selected passengers from Auth and active consent, checks eligibility and existing reservations, then checks the database count against capacity. `switch_ride` additionally compares submitted expected reservation IDs with current records. Capacity is secured before old records change. All selected passengers, old cancellations, new confirmations, audit records and notifications commit together. Any failure rolls back all changes.

The private idempotency ledger binds actor + operation UUID to the exact request and original successful result. Concurrent identical retries share a result; changed payload reuse fails. Different-key repeated same-ride bookings return the existing seat. Replaying a successful old key never resurrects a subsequently cancelled/switched reservation. Before showing a fresh confirmation, the UI checks current committed reservation state and explains stale replays.

## D. Partner permissions

Only an authenticated active recipient can accept or decline a request from the other participant. Accepting a link revokes conflicting pending requests without recording a decline on another recipient’s behalf. Acceptance allocates both unique participant slots transactionally. The existing deferred partner-slot check now uses security-definer execution with an empty search path so it can validate both private rows at commit; RLS visibility is unchanged.

Bookings belong to the actual passenger. The actor is stored separately. Passengers may cancel/switch their own records, including partner-created bookings. While an active consented link exists, the other member may manage partner bookings they created. Self-created partner bookings require that passenger's own action. Either participant can unlink; existing seats stay intact and delegated permissions end immediately. Renewed mutual consent between the same accounts again permits management of actor-created reservations under the same rules. Administrators retain explicit ride-edit/withdraw and reservation-cancel powers, not arbitrary partner-booking powers.

## E. Lifecycle handling

- **Cancellation:** records remain Cancelled; capacity is released; affected passengers/drivers receive relevant existing-system updates.
- **Switching:** checks the destination first and preserves all old seats on failure. Both means an explicit atomic group action; Self or Partner changes only that selected passenger. Old records remain as history.
- **Withdrawal:** retains the ride, blocks new bookings and marks confirmed reservations Needs Arrangement. Passengers are told to arrange alternative transport. Replacement booking resolves outstanding Needs Arrangement records.
- **Event cancellation:** the existing event transaction also cancels active rides and outstanding reservations. Reopening never revives old transport.
- **Event changes:** driver departure information stays intact; changed event time/date/timezone/location flags open rides for review and notifies active drivers/passengers. Saving the ride clears its flag. Events without rides retain their previous notification wording.
- **Other closed parents:** explicit confirmation closes associated rides; completion/fulfilment/archiving preserve completed transport history. Outstanding unarranged records close without consuming capacity.
- **Disabling:** refused while an Open offer or Confirmed/Needs Arrangement reservation exists. Users must withdraw/resolve these first. Inactive transport history remains visible after disabling.
- **Revocation:** extends the existing membership API only: revoke partner authority, withdraw driving, cancel the revoked passenger's active reservations and notify affected members. No Phase 5 administration UI is added.

New offers/bookings require an enabled Open parent; events must also be future and Scheduled, and departed rides close booking. RSVP and transport seats remain separate. Posts with ride history cannot be hard deleted.

## F. Security

Existing member-only ride/reservation read RLS and participant-only relationship RLS remain in force. No direct member table writes or Storage policies are opened. New operations explicitly authenticate and authorise, use restricted function grants and an empty SQL search path, and derive actors from Auth. Partner target IDs and reservation IDs do not serve as proof of authority. The operation and audit tables have RLS and no member grants; private helper execution is withheld.

The ride UI displays names and statuses, not emails/authentication identifiers or unrelated account data. Existing privileged credentials remain server-only. A source/browser-asset scan found no local service credential or administrator password.

## G. Verification evidence

| Check                     | Executed result                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                | 65 passed: 30 ride/partner checks plus all 35 Phase 1–3 checks                                                                    |
| `npm run db:test`         | 38 passed across four database security-contract files                                                                            |
| `npm run test:e2e`        | 15 browser journeys passed: four ride/partner workflows plus all 11 existing journeys                                             |
| `npm run typecheck`       | Passed                                                                                                                            |
| `npm run format:check`    | Passed                                                                                                                            |
| `npm run build`           | Passed production compilation                                                                                                     |
| `git diff --check`        | Passed                                                                                                                            |
| Exact migration rehearsal | Passed against a Phase 3 schema with legacy ride/return/reservation fixtures, followed by complete rollback                       |
| Desktop/mobile inspection | Inspected Chromium screenshots; mobile overflow assertion passed                                                                  |
| Linting                   | No lint command or semantic lint configuration exists in this repository; Prettier formatting and TypeScript checks ran as listed |

Database-backed tests include last-seat competition, pair versus single booking, one passenger racing different rides, simultaneous conflicting partner acceptances, booking during withdrawal/event cancellation, unlinking during booking, capacity reduction during booking, concurrent same-key retries and direct constraint bypass attempts. They also test consent forgery, non-member privacy, ownership/admin powers, stale switch rejection, pair/individual/partner-only switching, failed replacements, histories, disabled/closed parents, review flags, membership revocation and unlinking without seat loss. Browser tests exercise a cancelled booking's old-key replay without falsely confirming a new seat.

The new API suite was first run before its operations existed and failed for those missing operations. Testing then exposed and fixed deferred partner checks under RLS, checkbox reset after failed actions, an ambiguous browser alert selector, and unnecessary changes to event-only notification wording. No failing assertion was removed and no security policy weakened.

## H. Outstanding work and configuration

- No new service, secret, background job, SMTP delivery or manual ride-specific configuration is required locally.
- The additive migration is applied to the local development database. A hosted database still needs deliberate migration application and deployment under separate authorisation; neither was performed.
- Semantic linting is unavailable because the repository has no configured lint tool/script. Cross-browser/device testing beyond local Chromium and production-scale contention testing were not performed.
- Idempotency/audit retention and account deletion remain existing future design work; no automatic deletion is introduced. The audit begins with Phase 4 and does not invent transitions for old records.
- No known Phase 4 functional or security failure remains in the executed checks. Phase 5 and Phase 6 remain outside this change.

## I. Final status

**Implemented and verified** against the local PostgreSQL/Supabase/Chromium environment and the checks above. Ready for independent review on the feature branch; no merge or production deployment is part of this phase.
