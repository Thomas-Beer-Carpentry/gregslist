# Phase 5 — Membership and administration

## A. Implementation summary

Implemented the supplied Phase 5 brief in the existing Next.js/Supabase application, preserving Phases 1–4 and the existing light-theme palette. The complete supplied brief is retained in `docs/phase-5-brief.md`; `PROJECT_BRIEF.md` is unchanged. Work is isolated on `feature/phase-5-membership-administration`, based on the completed Phase 4 branch.

The Phase 4 gate included source/RLS/locking review, fresh 65/65 API tests and 38/38 database assertions. No unresolved critical issue was found before Phase 5 work began.

Implemented administrator invitation creation by email or secure copy link, pending/history management and revocation; welcoming email-verification/acceptance screens; existing-account handling; private searchable directory; owner-only name/biography editing; administrative member search; suspension/reactivation/removal; role changes; last-active-administrator protection; and protected transactional audit history. Responsibility cleanup reuses existing event/RSVP/ride/partner/notification systems. No Phase 6 work, public registration, replacement authentication, external messaging platform or permanent data-deletion system is introduced.

## B. Files and migrations

- `supabase/migrations/202610140006_membership_states.sql`: additive Suspended/Removed enum values in a separate transaction.
- `supabase/migrations/202610140007_administration.sql`: biography validation/grants, status/role timestamps, invitation hashes/delivery, protected audit records, private directory/admin search, invitation/role/status RPCs, final-admin constraint and existing responsibility cleanup.
- `src/features/admin/{actions.ts,invitation-form.tsx,member-controls.tsx,admin.css}` and `src/app/admin/page.tsx`: admin forms, explicit effect confirmations, search, pending/history pagination and audit display.
- `src/app/members/page.tsx`, `src/app/settings/page.tsx`, `src/app/actions.ts`, `src/components/noticeboard-shell.tsx`: directory, own biography editing and navigation; redundant legacy admin action implementations are replaced by the feature actions.
- `src/app/invite/*`, `src/app/auth/confirm/*`, `src/app/auth/callback/route.ts`, `src/lib/invitations.ts`: copy/email verification, acceptance, account-preserving confirmation and legacy callback compatibility.
- `src/lib/auth.ts`, `src/app/access-denied/page.tsx`: fresh membership checks and private, helpful status/role denial screens.
- `supabase/config.toml`, `supabase/templates/{invite,recovery,magic-link}.html`: exact local redirects and fragment-based verification templates.
- `tests/membership.test.mjs`, `supabase/tests/administration.sql`, `scripts/test-admin-concurrency.mjs`, `tests/e2e/membership.spec.ts`: new API/database/concurrency/browser coverage. Existing foundation/security tests are adapted to safe invitation columns and explicit email confirmation.
- `package.json`, `.github/workflows/ci.yml`, `AGENTS.md`, `docs/{architecture,setup,phase-5-brief,phase-5-validation}.md`: verification command, safe CI bootstrap order and reusable setup/architecture documentation.

## C. Invitation security

An active administrator creates a 32-byte random secret, encoded as 64 hexadecimal characters. Only its SHA-256 hash is persisted; the protected creation response returns the raw secret once for delivery. Application JWTs cannot select the hash, including administrator JWTs. Invitations default to seven days, have intended email/issuer/timestamps/delivery, and use the existing pending-email uniqueness rule. Expired pending rows are retired before a new invitation is issued.

Copy links use `/invite#id=…&token=…`. Email templates use `/auth/confirm#token_hash=…&type=…`. Fragments are removed from the current browser-history entry when captured, and secrets are submitted in server-action bodies. The copy context is held only in an HttpOnly, SameSite=Lax cookie, Secure on HTTPS. No raw invitation database column or browser persistent storage is added. Email confirmation requires an explicit button, limiting accidental scanner consumption.

Supabase verifies the intended email; activation validates current Auth identity, hash when required, email, expiry, revocation and single use under the shared transaction lock and invitation row lock. Exactly one ordinary membership/audit redemption is created. Same-active-recipient copy retries are safe; retries cannot restore Suspended/Removed access. Pending copy invitations cannot use the email-only activation path. Existing verified accounts are reused; no duplicate account is created. A link for another signed-in account is rejected before replacing its session. Cross-browser verification retains the verified session and requires reopening the original copy invitation.

Email-delivered and legacy invitations retain the verified-email activation path using Supabase's separate hashed, single-use email credential. Membership invitation expiry and shorter Auth verification expiry remain distinct. Failed email delivery revokes the new invitation when the initiating administrator still has permission; otherwise the UI explicitly asks an administrator to review the pending record.

## D. Membership enforcement

The existing database membership row remains authoritative. Posts, events, RSVPs, rides, reservations, partner links, profiles, notifications and private photos already require current Active membership. Suspension/removal therefore deny subsequent protected operations even with an unexpired Auth JWT. A user can read their own membership status for access-denied help; this does not disclose community content.

Suspension is reversible. Removal, including legacy Revoked status, is terminal through application APIs; it retains the Auth account, profile and community history. Reactivation restores access and the recorded role only. An administrator may demote a suspended administrator before reactivation. Neither removal nor suspension implements personal-data deletion.

In the same transaction, suspension/removal cancels the member's active RSVPs and passenger reservations, withdraws open driving offers, marks affected passengers Needs Arrangement, revokes pending/confirmed partner links, and cancels upcoming/ongoing open scheduled events they organise plus associated active transport. Existing in-app notifications inform affected active members. Past events and all relevant historical rows remain. Reactivation never silently revives old arrangements. Admin controls explain these effects and require explicit confirmation before suspension/removal.

Directory responses contain only active members' display names, biographies and join timestamps; names are searchable, up to 100 matches. Emails/account identifiers are not rendered in directory cards. Admin search exposes protected email/access fields only to active administrators. Profile names and optional 300-character biographies are validated; ownership RLS and column grants prevent identity, other-profile, role or status edits. Avatar upload was not previously supported and is not added.

## E. Administrator permissions

Only active database administrators may invite or change roles/access. All such mutations use Phase 4 advisory transaction lock `(71404,1)` before membership locks and recheck administrator authority after waiting. Concurrent demotion cannot leave a queued operation with stale privileges. Promotions require an active member; public invitation activation always grants Member.

Public role/status operations refuse removal, suspension or demotion of the final active administrator. A deferred database constraint also rejects privileged direct loss of the final administrator. Ordinary users have no membership write grants. Self-demotion is allowed only while another active administrator remains; another administrator must perform one's suspension/removal. Secure trusted-operator bootstrap is documented and has no public endpoint. CI/local verification bootstraps before disposable API administrators are cleaned up.

## F. Security

RLS is preserved across existing community tables. New audit reads require active administrator status; no application user may insert, update or delete audit rows directly. Administrative actions and audit entries commit together. Audit records retain true actor, relevant administrator, target, time, safe state metadata and name snapshots, without token/password material. Foreign keys SET NULL on controlled operator deletion, retaining history; no account-deletion application workflow is provided.

All new security-definer functions use an empty controlled search path, explicit identity/permission checks and restricted execution grants. The email/account-verification adapter is service-role-only and server-only. Raw table writes cannot bypass role, status, invitation or transport rules. A separate read-only security review found no remaining critical issue after correcting the cross-account confirmation path, invitation pagination and CI bootstrap order.

Trusted database/service-role operators retain privileged access by design. Hosted Auth configuration and real email deliverability are not established by local tests. Legacy query-token callbacks remain compatible and are excluded from Next development request logging; operators must manage infrastructure access logs for any old links. New emails use fragments.

## G. Verification

Verification used the existing local Supabase services and actual authenticated accounts. Database migrations were applied locally without resetting data. The production build was served with `npm run start` for browser verification; source files did not change after that build.

| Command | Result |
| --- | --- |
| `npm test` | 85/85 passed, including the strengthened inactive-invitation retry check |
| `npm run db:test` | 71/71 passed (33 administration, 38 existing) |
| `npm run test:admin-concurrency` | 5/5 passed |
| `npm run test:e2e` | 21/21 passed against the production build |
| `npm run typecheck` | Passed |
| `npm run format:check` | Passed |
| `npm run build` | Passed |
| `git diff --check` | Passed |

API checks include invitation entropy/hash persistence, role/anonymous denials, confirmed-email binding, wrong/expired/revoked secrets, concurrent redemption and safe retries, service-only verification, directory privacy, own-profile permissions, status/role audits, suspension/removal/reactivation across content/Storage/transport/partners, organiser cleanup and suspension racing a booking/partner acceptance.

Rollback pgTAP assertions additionally test unverified-email claims, grants/RLS/search paths, final-admin API rejection and direct privileged final-admin demotion/suspension/deletion rejection. The isolated administrator concurrency helper copies schema definitions only into a generated temporary local database, preserves object ACLs, omits operational future-object default privileges, creates synthetic accounts and drops that database afterward. It proves simultaneous self-demotions, cross-demotions, cross-removals, cross-suspensions and a deterministically queued promotion denied after the caller is demoted. The original bootstrap administrator is not modified.

Browser coverage adds directory/bio/privacy/admin denial, role/access controls and history, new-member copy email proof, existing verified-account reuse, cross-browser context recovery and wrong-account session preservation. Existing foundation/post/event/ride browser workflows remain included. The initial full browser run had 17 passes and four assertion failures: three selectors also matched Next's route announcer; one mail finder compared a normalised email case-sensitively. Those test assertions were corrected before the final full rerun.

No semantic lint command/ESLint configuration exists in this repository. Prettier is the available formatting check; its success is not reported as semantic linting. No tests are silently skipped.

## H. Outstanding work and configuration

- Hosted migrations have not been applied. An operator must review/apply enum migration 006, then administration migration 007 in separate transactions; do not reset existing data.
- Hosted Auth requires all three templates, canonical HTTPS site URL/exact redirects, SMTP/email verification, public signup disabled and existing security settings retained. Local inbox delivery was exercised; real external mail deliverability, production settings and GitHub-hosted CI execution remain unverified here.
- Copy-link delivery does not bypass email ownership verification: new/unverified accounts still require working Supabase email delivery; existing verified authenticated accounts can accept directly without sending email.
- No permanent account/personal-data deletion or retention policy is introduced. Removal retains history and is terminal in application APIs; suspension is the reversible option. Multiple communities, avatar uploads, notification preferences and Phase 6 remain outside this implementation.

## I. Final status

**Implemented and verified in the local development environment.** All final checks above passed; no incomplete Phase 5 feature or failing test remains. Hosted configuration, real external deliverability and GitHub-hosted CI are unverified here as listed above. Phase 6 has not begun. No production deployment or production migration is performed.
