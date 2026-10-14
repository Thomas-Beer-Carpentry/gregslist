# Gregslist architecture

PROJECT_BRIEF.md is the product source of truth. Next.js App Router handles SSR and server mutations; Supabase provides Auth, PostgreSQL and private Storage. Database RLS is authoritative. Privileged credentials are imported only through server-only modules. The root and administration pages require fresh authenticated identity and active database membership.

## Decisions

- One private community per deployment; multi-community support changes schema and RLS.
- Post type, category and ride capability are independent. Events extend posts one-to-one; rides attach to posts; reservations reference both ride and parent with a composite foreign key.
- Single active passenger reservation per post, not per journey leg. Return details are informational.
- One confirmed partner per user is represented by partner_participants with a unique user key. Later transactional linking functions must maintain these records. No relationship or ride writes are granted in Phase 1.
- All content is member-readable; emails/invitations are administrator-only; saved posts and notifications are owner-only; partner links are participant-only.
- Invitations use Supabase Auth's cryptographic, single-use email tokens (hashes managed in auth.users). The application invitation ledger adds email binding, seven-day expiry, revocation and redemption. Auth email tokens expire after one hour by default: the earlier deadline applies.
- Email verification creates an authenticated session; activation locks the invitation and grants membership once. Existing or revoked memberships cannot self-reactivate.
- Public signup and anonymous auth are disabled. Only a server-side admin operation may issue invitation emails.
- All ride writes are withheld until Phase 4 implements parent-post locking, transactional capacity enforcement and partner authority. Current tables are a foundation, not completed ride functionality.
- PostgreSQL timestamptz stores instants; event timezone defaults to Pacific/Auckland.
- Photos are private. Phase 2 accepts at most six JPEG/PNG/WebP files per post, 5 MB each, through a server route. Sharp validates real bytes, limits decoded pixels, resizes to 1920px, strips metadata and re-encodes WebP. Members have no direct Storage upload policy. Authenticated image requests check current membership and photo metadata; deleted/unattached objects are unreadable.
- Retention/account deletion, independently bookable return legs and multiple communities need an explicit design update before implementation.

## Milestones

1. Foundation: tokens, responsive shell, migrations, invite-only auth, RLS and negative security tests.
2. Noticeboard: ownership-safe CRUD, filters/search, comments, photos, saved posts, stable pagination.
3. Events: atomic RSVP capacity, dates and cancellation, upcoming sidebar.
4. Rides: exact checkbox, multiple offers, mutually confirmed partners, atomic booking/switching/cancellation, concurrency tests and required notifications.
5. Reliability: remaining notifications and administration, moderation, accessibility, full browser journeys and deployment review.

No feature is complete until its security and critical workflow tests pass. Direct table mutations remain denied. Phase 2 exposes owner-checked PostgreSQL APIs for posts, comments, saved posts and photo metadata. Future RSVP/ride/partner migrations must add transactional APIs and invariants before enabling their writes.

## Phase 2 decisions

- All seven post types are available. Type stays fixed after creation. Events have basic structured start/end, timezone and location fields so the sidebar can work; RSVP/capacity remains Phase 3. Ambiguous/nonexistent daylight-saving times are rejected rather than guessed.
- Offer/request/trip posts have optional availability and conditions; non-event posts have optional pickup/location text. Content is plain text and React-escaped.
- Search uses PostgreSQL English full-text search on title/description. Category, type and status filters combine; results always sort by immutable (created_at, id), newest first. Explicit Older posts pagination preserves filters. Saved state never changes order.
- Owners can edit/delete their posts and comments; administrators can delete posts/comments for moderation. Cancelled/archived posts close comments. Posts with existing RSVPs or ride offers reject generic edit/delete until coordinated lifecycle APIs are implemented.
- Deletion removes the post, comments, saved references, basic event row and photo metadata in one transaction. Photo bytes are removed synchronously afterward. Failures are persisted in a private cleanup queue, with an idempotent retry command. Queued/deleted objects cannot be downloaded or reattached. Production scheduling of retry cleanup is deployment work.
- No new public access, registration path, engagement ranking or external service was added.
