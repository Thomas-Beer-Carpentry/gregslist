# Gregslist architecture

PROJECT_BRIEF.md is the product source of truth. Next.js App Router handles SSR and server mutations; Supabase provides Auth, PostgreSQL and private Storage. Database RLS is authoritative. Privileged credentials are imported only through server-only modules. The root and administration pages require fresh authenticated identity and active database membership.

## Decisions

- One private community per deployment; multi-community support changes schema and RLS.
- Post type, category and ride capability are independent. Events extend posts one-to-one; rides attach to posts; reservations reference both ride and parent with a composite foreign key.
- Single active passenger reservation per post, not per journey leg. Return details are informational.
- One confirmed partner per user is represented by partner_participants with a unique user key. Phase 4 transactional linking functions maintain these records. Direct relationship and ride writes remain denied.
- All content is member-readable; emails/invitations are administrator-only; saved posts and notifications are owner-only; partner links are participant-only.
- Phase 5 invitations use a cryptographically random 256-bit application secret with only its SHA-256 hash stored, plus Supabase's separate single-use email verification. The application ledger enforces intended email, seven-day expiry, revocation and single redemption. Supabase email verification expires after one hour by default and can be requested again while a copy invitation remains valid.
- Email verification creates an authenticated session; activation locks the invitation and grants ordinary membership once. Copy invitations additionally require their secret, including for existing verified accounts. Email-delivered invitations retain the verified-email activation path. Existing suspended/removed memberships cannot self-reactivate or accept a replacement invitation.
- Public signup and anonymous auth are disabled. Only a server-side admin operation may issue invitation emails.
- Phase 4 ride writes use authenticated transactional RPCs, parent-post locking, capacity constraints and partner authority. Direct table writes remain denied.
- PostgreSQL timestamptz stores instants; event timezone defaults to Pacific/Auckland.
- Photos are private. Phase 2 accepts at most six JPEG/PNG/WebP files per post, 5 MB each, through a server route. Sharp validates real bytes, limits decoded pixels, resizes to 1920px, strips metadata and re-encodes WebP. Members have no direct Storage upload policy. Authenticated image requests check current membership and photo metadata; deleted/unattached objects are unreadable.
- Retention/account deletion, independently bookable return legs and multiple communities need an explicit design update before implementation.

## Milestones

1. Foundation: tokens, responsive shell, migrations, invite-only auth, RLS and negative security tests.
2. Noticeboard: ownership-safe CRUD, filters/search, comments, photos, saved posts, stable pagination.
3. Events: atomic RSVP capacity, dates and cancellation, upcoming sidebar.
4. Rides: exact checkbox, multiple offers, mutually confirmed partners, atomic booking/switching/cancellation, concurrency tests and required notifications.
5. Membership and administration: secure invitations, private directory/profile editing, audited access and role management, final-administrator concurrency protection.
6. Polish, security and launch: deferred to separate instructions.

The supplied Phase 5 brief is preserved in docs/phase-5-brief.md. This implementation stops after Phase 5; Phase 6 remains deferred.

No feature is complete until its security and critical workflow tests pass. Direct table mutations remain denied. Phase 2 exposes owner-checked PostgreSQL APIs for posts, comments, saved posts and photo metadata. Phase 3 adds transactional event attendance and lifecycle APIs. Phase 4 exposes ride/partner operations only through transactional APIs and invariants.

## Phase 2 decisions

- All seven post types are available. Type stays fixed after creation. Events have basic structured start/end, timezone and location fields so the sidebar can work; RSVP/capacity remains Phase 3. Ambiguous/nonexistent daylight-saving times are rejected rather than guessed.
- Offer/request/trip posts have optional availability and conditions; non-event posts have optional pickup/location text. Content is plain text and React-escaped.
- Search uses PostgreSQL English full-text search on title/description. Category, type and status filters combine; results always sort by immutable (created_at, id), newest first. Explicit Older posts pagination preserves filters. Saved state never changes order.
- Owners can edit/delete their posts and comments; administrators can delete posts/comments for moderation. Cancelled/archived posts close comments. Posts with existing RSVPs or ride offers reject generic edit/delete until coordinated lifecycle APIs are implemented.
- Deletion removes the post, comments, saved references, basic event row and photo metadata in one transaction. Photo bytes are removed synchronously afterward. Failures are persisted in a private cleanup queue, with an idempotent retry command. Queued/deleted objects cannot be downloaded or reattached. Production scheduling of retry cleanup is deployment work.
- No new public access, registration path, engagement ranking or external service was added.

## Phase 3 decisions

- Optional capacity is a positive integer; blank means unlimited. Only active members with an uncancelled Going response consume places, including the organiser if they RSVP. Maybe and Not Going consume none. The organiser is not automatically attending. There is no waitlist.
- RSVP identity comes from Auth, never a submitted user ID. A membership share lock precedes the parent-post lock; RSVP changes, capacity changes and cancellation serialize on that parent. A failed change preserves the existing response and all event fields. Capacity cannot be reduced below current Going attendance. Revoking membership cancels attendance; later restoration requires a new RSVP.
- Active members can see display names and all responses. Emails are not included. This group-visible attendance is a privacy assumption; changing it requires coordinated RLS/API/UI changes. Cancelled responses retain their original values and timestamps in the database, but are excluded from active lists. Members see their own cancelled response. This is not a full audit ledger of every previous change.
- Going/Maybe close at the start instant; a scheduled event still allows withdrawal afterward. Cancelled, completed and archived events close all responses. Existing event instants/timezones and daylight-saving validation remain intact.
- Cancellation requires an explicit confirmation. It cancels active attendance, related open rides and active reservations transactionally. Reopening starts fresh attendance and does not restore rides. Completed is terminal; create a new event to repeat it. Future scheduled events must be cancelled or completed before archiving; past scheduled events archive as completed. Historical events remain accessible and leave the upcoming sidebar.
- Events with RSVP history cannot be hard deleted; cancel/archive them instead. A later retention/account-deletion policy must explicitly address this history. The additive migration maps legacy event Fulfilled statuses to Completed without deleting content.
- Meaningful event changes notify current Going/Maybe members, excluding the editor. Cancellation also notifies affected drivers/passengers. Reopening notifies previously event-cancelled Going/Maybe respondents. Repeating unchanged saves creates no notification. Notifications are recipient-only, in-app, latest 50, with idempotent mark-read; broader notification preferences remain later work.
- Phase 3 initially blocked general edits with ride arrangements. Phase 4 now coordinates those edits, flags event transport changes and implements the ride/partner APIs described below.

## Phase 4 transaction contract

- All seven post types may enable the exact checkbox “People might need a ride for this”. The post stays central; there is no Ride post type or ride feed. `ride_offers.post_id` always references the parent post, and the composite reservation foreign key enforces agreement between ride and parent. Event extension records remain one-to-one with posts.
- Ride details extend the foundation table: route, timezone, optional departure, return availability/date/details, numeric contribution with a three-letter currency (NZD by default), notes, review flag and timestamps. Capacity excludes the driver. Multiple offers, including multiple drivers, are supported. No payment integration or independently bookable return leg is introduced.
- The existing partial unique index guarantees one Confirmed reservation per passenger/post across all rides. Deferred constraints additionally reject overcapacity, confirmed passengers on inactive rides and driver self-seats. Direct mutations remain denied; RPCs derive the driver and booking actor from Auth.
- To make booking, unlinking, withdrawal, post changes and revocation mutually consistent, transport mutations acquire advisory transaction lock `(71404, 1)` first, then membership share, parent-post and ride locks. Phase 3 RSVPs continue their membership/parent-lock protocol. This intentionally serializes transport writes across this small private community. A larger deployment should measure contention before replacing this with finer locks; every participant in the protocol must change together.
- Booking resolves Self, Both or Partner against the current consented relationship. Existing reservations on another ride are rejected by booking; only the explicit Switch operation moves them. The target capacity is checked before cancelling old records. Both passengers are checked and committed in the same transaction; a failure rolls back all changes. Switching includes the expected reservation IDs, so a stale command cannot move a newer booking. Mixed switches may keep/add a selected passenger while moving the other, with the same atomic guarantee.
- The private `transport_operations` ledger is keyed by actor and operation UUID and binds each successful booking/switch/offer save to its exact payload and result. Same-key retries return the recorded result, different payload reuse fails, and old keys never resurrect cancelled/switched seats. Unchanged same-ride bookings also return existing reservations without duplicate notifications. The UI reads current committed reservation state before displaying a fresh confirmation from a replay.
- Reservations keep passenger, creator and last actor separately. Switches create new records and retain old records as Cancelled. A private operator-only audit table records subsequent status/actor changes. Pre-Phase-4 records retain their existing metadata; historical transitions are not invented. No automatic retention/purge policy is added.

## Phase 4 partner and lifecycle rules

- Requests are private to their two participants. Only the authenticated recipient may accept/decline. A request alone grants no booking power. Confirmation fills both exclusive participant slots in the same transaction; the existing deferred slot constraint now runs as a security definer to see both private rows at commit. It retains its empty search path and restricted execution. Concurrent conflicting acceptances cannot allocate a member twice.
- Either partner may unlink. Existing reservations remain intact. Delegated cancellation/switching immediately ends; passengers retain their own controls. While linked, the actor may switch/cancel partner reservations they created; a reservation the passenger created themselves must be managed by that passenger. Administrators retain explicit ride-edit, withdrawal and reservation-cancellation powers. No general account access is delegated.
- Cancelled reservations release capacity. A withdrawn ride remains as history, and its Confirmed reservations become Needs Arrangement and notify affected passengers through the existing updates system. A replacement booking resolves previous Needs Arrangement records. Drivers cannot reduce capacity below current Confirmed passengers.
- New rides/bookings require enabled coordination and an Open parent. Events additionally require Scheduled and a future start. A departed ride cannot accept new bookings. Cancellation/withdrawal remain possible after departure. A driver may book only their partner on their own ride; neither Self nor Both can include the driver as a passenger.
- Event cancellation atomically cancels active rides and outstanding reservations. Ordinary-post cancellation does the same with an explicit transport-close confirmation. Completion/fulfilment/archiving close open rides and mark confirmed reservations Completed; outstanding Needs Arrangement records close as Cancelled. Reopening never revives transport records. Posts with ride history cannot be hard deleted.
- Event time/date/timezone/location changes keep driver-provided departure details intact, flag Open rides for review, and notify active drivers/passengers as well as RSVP respondents. A driver saving their offer clears the flag and notifies affected passengers. Event RSVP and transport booking remain separate; booking a ride does not silently RSVP.
- Disabling coordination is refused while any Open ride or Confirmed/Needs Arrangement reservation remains. The UI explains that these must be withdrawn/resolved first. Closed transport history stays member-readable after disabling. No records are silently discarded.
- Passenger display names and statuses remain visible to all active members. Emails, authentication identifiers and unrelated profile details are not displayed in the ride UI. Ride/partner controls use existing server-side membership checks and RLS; privileged credentials stay server-only. The private operation/audit tables have RLS and no member grants. Partner candidate discovery returns active member display names only, with internal references needed for requesting consent.

## Phase 5 membership and administration

- There are still only Member and Administrator roles and one community. Authorisation reads current database membership rather than trusting cached JWT role metadata. All private content/Storage policies already require Active membership; authenticated suspension/removal is therefore effective on the next request without waiting for JWT expiry. An account can read its own status to display access-denied help.
- Suspended means reversible access loss; Removed (and legacy Revoked) means terminal community removal through application APIs, with Auth account and historical records retained. Neither is account or personal-data deletion. Reactivation restores the recorded role and access only, never old arrangements; an administrator can demote a suspended administrator before reactivation. Permanent deletion/retention policy remains a separate product/privacy decision.
- Suspending/removing a member cancels their active RSVPs and passenger reservations, withdraws their open driving offers, marks affected passengers Needs Arrangement, revokes pending/active partner links, and cancels their upcoming/ongoing open scheduled events plus associated rides/reservations. Past event history remains. Existing recipient-only notifications tell affected active members about cancellations and withdrawn driving. These effects and access changes commit together under the Phase 4 transaction lock.
- Role and access mutations acquire advisory lock `(71404,1)` before membership rows, recheck the caller's active administrator authority after waiting, and refuse loss of the final active administrator. A deferred database constraint provides additional protection against privileged direct updates/deletes. There is no public bootstrap; a trusted operator provisions the first verified administrator.
- Invitations have Email or Copy delivery. Only the protected creation operation returns a new raw secret, once, to the creating administrator. Even administrator application JWTs cannot query the hash column. Copy secrets and new email verification hashes use URL fragments, are removed from the current history entry on opening, and are submitted in server-action bodies. Copy email-verification context is held in a seven-day HttpOnly, SameSite=Lax cookie (Secure on HTTPS), never in a raw-token database field or browser persistent storage. No third-party analytics are introduced. Legacy callback URLs remain supported and excluded from Next development request logging; infrastructure access-log policy for legacy links is an operator responsibility.
- Redemption binds Auth's confirmed current email to the ledger and locks the invitation. Only ordinary membership is created. Safe same-recipient retries return without another redemption/audit; they never revive inactive membership. An email link for a different signed-in account is rejected before replacing cookies. New/unverified accounts still need working Supabase email delivery; copy delivery replaces administrator outbound delivery, not email ownership verification.
- Administrative audit entries are generated inside the same transaction, include the true actor and inviting administrator for redemption, and contain safe state/email metadata and name snapshots. Application users, including administrators, cannot insert/update/delete audit entries directly. Only active administrators can read history. Trusted service/operator database access remains privileged. Audit foreign keys use SET NULL for controlled operator deletion without deleting history; no such deletion workflow is exposed.
- The member directory exposes only active names, biographies and join timestamps, with name search (up to 100 results). Existing profile IDs remain necessary internally for authorship/RSVP/partner APIs but are not rendered by directory cards. Profiles support owner-only validated names and optional 300-character biographies. Avatar upload was not previously implemented and is not added. Admin member search includes protected emails; pending invitations and history have separate paginated views, and audit history shows the latest 50 entries.

# Phase 6 and phone-app scope decisions

The complete Phase 6 brief is retained in `docs/phase-6-brief.md`. Subsequent
explicit user instructions add a genuine React Native application for **both
iPhone and Android** and permanent personal-account deletion. Those instructions
supersede the brief's native-app exclusion and earlier phases' deletion exclusion.
The user selected immediate deletion, with no undo window, from the proposed
policy; its remaining twelve-month minimum pseudonymised-history retention is
preserved. `PROJECT_BRIEF.md` remains the original product reference.

The Next.js application and Supabase database remain authoritative. `mobile/`
is an independent Expo client with its own SDK-compatible lockfile and TypeScript
version; root TypeScript remains unchanged. Both clients use the same protected
post/event/ride/partner/admin RPCs. Native private photos, emailed invitations and
own-account deletion use explicitly validated Bearer HTTP endpoints. A Bearer
failure never falls back to a browser cookie. Web sessions use HttpOnly cookies;
native sessions use chunked, atomic Keychain/Keystore storage. Public signup stays
disabled. Initial email verification/recovery uses the trusted website.

Erasure requires a fresh password check and server-derived account identity.
The service-only database transaction immediately removes membership and visible
personal content, closes arrangements, and records exact Storage paths in an
RLS-protected job. Auth/Storage operations are retried after transient failure;
the response distinguishes finished from pending cleanup. Minimum history uses
a generic profile for up to twelve months and is purged only after provider
cleanup completes. Provider backups/security logs require separately verified expiry;
their deletion is not implied by the application transaction. Erased profiles
cannot be edited. Legacy content writers now use the same transport advisory
lock before membership/parent locks, preventing queued writes from resurrecting
personal data after erasure.

The existing in-app notification table also handles partner request outcomes.
No push-notification service, offline content store, payments or extra social
features are added. See `docs/deployment.md`, `docs/backup-and-recovery.md` and
`mobile/README.md` for production/signing prerequisites. JavaScript export success
does not establish a signed installable phone app or physical-device validation.
