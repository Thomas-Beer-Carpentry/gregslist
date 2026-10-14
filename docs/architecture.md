# Phase 1 architecture

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
- Photos are private, with authenticated member-only reads. Uploads are disabled until Phase 2 implements file validation and ownership.
- Retention/account deletion, independently bookable return legs and multiple communities need an explicit design update before implementation.

## Milestones

1. Foundation: tokens, responsive shell, migrations, invite-only auth, RLS and negative security tests.
2. Noticeboard: ownership-safe CRUD, filters/search, comments, photos, saved posts, stable pagination.
3. Events: atomic RSVP capacity, dates and cancellation, upcoming sidebar.
4. Rides: exact checkbox, multiple offers, mutually confirmed partners, atomic booking/switching/cancellation, concurrency tests and required notifications.
5. Reliability: remaining notifications and administration, moderation, accessibility, full browser journeys and deployment review.

No feature is complete until its security and critical workflow tests pass. Existing content tables intentionally have no client mutation permissions. Future migrations must add transactional APIs and invariants before enabling writes.
