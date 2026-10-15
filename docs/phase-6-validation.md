# Phase 6 — Implementation and launch readiness

Status: **Ready for limited testing only.** The website and native client source are implemented and locally exercised. Production configuration and signed installable iPhone/Android builds remain outstanding. This is not a claim that Gregslist is live or downloadable from a phone store.

## A. Initial audit

The checkout already contained working Next.js/React/TypeScript noticeboard, private photo pipeline, events/RSVPs, transactional ride coordination, mutually consented partners, invitation-only membership, directory/profile editing, administration and recipient-private notifications. Phase 4 and Phase 5 migrations, RLS, constraints, API/database tests and browser journeys existed; their substantive implementations were inspected rather than recreated. The Phase 5 validation record and fresh baseline 85/85 API tests supported continuing beyond the Phase 4/5 gate.

Gaps included no native application, no permanent personal-data deletion, no semantic lint command, missing partner-request notifications, incomplete accessibility/error associations, and no verified production target, SMTP delivery, backup plan or signed distribution. Existing hosted configuration and GitHub-hosted CI success could not be established. No critical Phase 4/5 booking or administration defect was found at the initial gate.

The complete supplied brief is saved in `docs/phase-6-brief.md`. The user's subsequent instructions explicitly add native clients for both platforms and immediate deletion, superseding the earlier exclusions. The selected policy has no undo window and preserves the proposed twelve-month minimum pseudonymised event/ride/admin history. `PROJECT_BRIEF.md` is preserved.

## B. Improvements made

- Preserved the exact light-theme palette. Improved narrow-screen forms, 44px controls, text scaling, reduced motion, readable contrast, image dimensions, empty/error feedback and focusable page landmarks. Form errors are associated with inputs and focus moves to failed controls. Skip navigation and browser-back journeys are exercised with actual keyboard input.
- Added nonce-based production CSP, HttpOnly session cookies, HTTPS Secure cookies/HSTS, private no-store responses, no-index headers and robots exclusion. Existing private database/Storage rules remain enforced.
- Added native Bearer endpoints for existing validated photos, administrator email invitations and password-verified own-account deletion. Invalid explicit Bearer credentials cannot fall back to cookies. Cookie photo uploads retain Origin checks.
- Added immediate account erasure, exact-path photo cleanup, honest pending responses for provider failures, authenticated maintenance retries and twelve-month history expiry. Final-admin safeguards and unrelated members' data remain protected.
- Added partner-request/acceptance/decline/unlink notifications to the existing in-app system. No new messaging platform or push service was introduced.
- Implemented an independent Expo/React Native client: sign-in/session handling, feed/filter/search/save/pagination, posts/events/comments, RSVP, private photos, rides/partners, directory/profile, notifications, invitations/member administration and deletion. It reuses backend transactions and has no service credential or replacement booking engine.
- Native sessions use byte-bounded atomic Keychain/Keystore storage. Private screens hide while inactive and until foreground authority verification finishes. Generated upload JPEGs are deleted in `finally`; cleanup failures are disclosed. Signed-out/revoked users lose private screen state. Actual OS snapshot and filesystem behavior still need device validation.
- Added semantic linting with Oxlint without downgrading the root TypeScript 7 toolchain. The independent Expo application uses its SDK-compatible TypeScript version.
- Added production Auth configuration/read-only readiness tools, CI checks, migration/restore rehearsal, backup/recovery and deployment instructions. Existing pagination/search/lookup indexes were retained; no measured performance issue justified a replacement architecture or speculative caching. Nonce-based pages render dynamically; private content is not statically cached.

## C. Significant files and migrations

| Area                       | Main paths                                                                                                                                                                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security/session           | `src/proxy.ts`, `next.config.ts`, `src/lib/supabase/{server,cookie-options}.ts`, `src/lib/api-auth.ts`, `src/app/robots.ts`                                                                                                                                             |
| UI/accessibility           | `src/app/globals.css`, layout/page landmarks, `src/features/posts/{post-form,photo-uploader}.tsx`, `src/features/rides/{ride-form,booking-form}.tsx`                                                                                                                    |
| Personal data              | `src/app/{privacy,account-deletion}/`, `src/features/privacy/erase.ts`, `src/lib/privacy-worker.mjs`, `src/app/api/maintenance/privacy/route.ts`                                                                                                                        |
| Native HTTP integration    | `src/app/api/mobile/`, existing photo routes, `src/lib/invitations.ts`                                                                                                                                                                                                  |
| Native application         | `mobile/App.tsx`, `mobile/features/{Transport,Administration}.tsx`, `mobile/lib/`, `mobile/app.config.ts`, `mobile/eas.json`, assets and independent lockfile                                                                                                           |
| Verification/tooling       | `tests/e2e/{accessibility,security}.spec.ts`, `tests/production-tooling.test.mjs`, `tests/rides.test.mjs`, `supabase/tests/privacy.sql`, `scripts/test-{migrations,privacy-concurrency}.mjs`, `scripts/production-{check,configure}.mjs`, `scripts/privacy-cleanup.mjs` |
| Release configuration/docs | `.github/workflows/`, `vercel.json`, `docs/{deployment,backup-and-recovery,production.env.example,setup,architecture}.md`, `mobile/README.md`                                                                                                                           |

Additive database migrations, applied locally only:

1. `202610150008_launch_notifications.sql`: existing recipient-private partner updates.
2. `202610150009_account_erasure.sql`: protected erasure jobs, generic historical profiles, immediate cleanup, Auth-aware authority and retention purge; existing membership cleanup is reused.
3. `202610150010_auth_identity_cleanup.sql`: operator Auth deletion cannot leave active memberships or bypass final-admin protection.
4. `202610150011_erasure_history_states.sql`: completed/archived event history remains terminal when authored text is erased.
5. `202610150012_erasure_write_serialization.sql`: serializes six legacy content mutations against erasure and prevents later edits to erased profiles.

All twelve repository migrations were tested in order and individually committed in disposable databases. No production migrations, resets or real-account erasures were executed.

## D. Security findings and data integrity

The independent review identified a **High** deletion race: old comment/photo writes could pass membership checks, wait behind erasure and then restore personal content. Direct profile updates had a corresponding stale-row race. A deterministic database rehearsal reproduced all three on migrations 001–011 and proved migration 012 rejects the same queued writes. Legacy content RPCs acquire the existing transport lock before permission/parent locks; the profile row trigger rejects edits to the latest erased row without reversing that lock order. Normal writes, ownership grants and unrelated records were tested after the fix.

Database authority remains current Active membership joined to an existing Auth account. Security-definer functions have controlled search paths and restricted grants. Erasure/retention RPCs and jobs are service-only, not accessible to ordinary members. Password reauthentication and server-derived identity prevent deletion of another account. Removing Auth also invalidates database membership authority even if a previous JWT has not expired. Erasure preserves minimal pseudonymised coordination/audit history while removing personal text/profile/contact fields and actor snapshots; ordinary suspension/removal retains its previous meaning.

Ride capacity, duplicate prevention, partner consent, passenger ownership, booking actor permissions, idempotency, switching and lifecycle behavior continue to use the existing serialized transactional RPCs, unique indexes and deferred capacity constraint. Two-seat reservations remain all-or-nothing. No direct content/ride/partner write grant was added, and no public signup or payment processing was introduced.

Web runtime dependency audit reports zero vulnerabilities. Native audit still fails with **35 affected High package paths, from two underlying advisories**: `braces@3.0.3` ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)) and `node-forge@1.4.0` ([GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)). The registry's latest versions remain affected and no fix is published. Source inspection places these in Metro/Expo build tooling; shipped-app exposure was not identified, but artifact exploitability is unverified. They remain a pre-release security limitation. Do not expose development tooling publicly or use untrusted project/signing inputs.

A separate Moderate `uuid` advisory was remediated with a scoped `xcode -> uuid@11.1.1` override. Actual Xcode project ID generation, file/group mutation and parse/write round trips passed with both the previous and patched versions, without changing Expo SDK/application versions. This removed all seven Moderate affected paths. No audit failure was hidden or force-fixed. Trusted service/database operators remain privileged by design. Search exclusion is an additional privacy control; authentication/RLS are the access boundary.

## E. Verification

Checks used the real local Supabase Auth/PostgreSQL/Storage services and disposable authenticated fixtures. The final browser run used `next start` after the final production build. All application source was frozen before that build or, for the independent native client, its final types/tests/exports. Database suites that modify fixtures run sequentially. Migration/concurrency rehearsals use isolated generated databases and synthetic records, not production or existing member data.

| Command                                           | Actual result                                                                                                                                                                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run db:migrate`                              | Applied migration 012 locally; earlier Phase 6 migrations also applied locally                                                                                                                                                      |
| `npm run db:test`                                 | Passed: 98 assertions across 6 files                                                                                                                                                                                                |
| `npm run test:admin-concurrency`                  | Passed: 5 isolated administrator races                                                                                                                                                                                              |
| `npm run test:privacy-concurrency`                | Passed: 3 pre-fix races reproduced, all 3 rejected after correction; normal mutations/ACLs/unrelated records preserved                                                                                                              |
| `npm run test:migrations`                         | Passed: 12 clean migrations; 98 assertions on clean and restored databases; all synthetic rows across 58 tables and security settings preserved                                                                                     |
| `npm test`                                        | Passed: 93/93 API/tooling tests, no skipped tests                                                                                                                                                                                   |
| `PLAYWRIGHT_PRODUCTION=1 npm run test:e2e`        | Passed: 35/35 against the final production build, including 5 accessibility and 9 security checks; no skipped tests                                                                                                                 |
| `npm run typecheck`                               | Passed                                                                                                                                                                                                                              |
| `npm run lint`                                    | Passed, Oxlint                                                                                                                                                                                                                      |
| `npm run format:check`                            | Passed after formatting the added notification assertions                                                                                                                                                                           |
| `npm run build`                                   | Passed                                                                                                                                                                                                                              |
| `npm run mobile:typecheck`, `npm run mobile:test` | Passed: independent native types and 13/13 tests, no skipped tests                                                                                                                                                                  |
| `EXPO_OFFLINE=1 npm run mobile:export`            | Passed: iOS and Android JavaScript/Hermes assets; not native binaries                                                                                                                                                               |
| `npm audit --omit=dev` in root                    | Passed: zero reported production dependency vulnerabilities                                                                                                                                                                         |
| `npm audit --omit=dev` in `mobile/`               | Failed (exit 1): 35 High affected paths from two unpatched tooling advisories; zero Moderate/Critical                                                                                                                               |
| `GitHub Actions`                                  | Passed: [run 38674063275](https://github.com/Thomas-Beer-Carpentry/gregslist/actions/runs/38674063275) on implementation commit `a4357ac2421aa0d11081c6eaedda4aa5c6461895`; all workflow steps, including browser checks, succeeded |
| `npm run production:check`                        | Exited 1 as expected: no hosted `SUPABASE_PROJECT_REF`; hosted verification did not run                                                                                                                                             |
| `git diff --check`                                | Passed                                                                                                                                                                                                                              |

Test counts above come from the completed local runner outputs. GitHub's run/job API independently confirms success for every hosted workflow stage on the same implementation commit. Hosted log download was blocked at the Actions log-storage hostname, so hosted counts were not independently extracted from those logs. The read-only production-readiness workflow remains unrun without its production configuration.

The API tests include actual simultaneous ride bookings, pair-versus-single competition, conflicting parent reservations, partner acceptance conflicts, withdrawal/cancellation races, invitation redemption and membership revocation. The new notification assertions check recipient isolation and no duplicate acceptance notice. The privacy database checks include retention gates, final-admin/operator safeguards, unrelated-content preservation and completed-event history.

The final 35/35 passing browser suite includes the existing post/event/ride/invitation/admin journeys, plus five accessibility/keyboard/responsive checks and nine security/deletion/API checks. The focused security suite also passed 9/9 and focused accessibility suite passed 5/5. Earlier test iterations caught loading/selector assumptions and an invalid PNG fixture; those tests were corrected, with product focus fixes preserved.

Not verified: real iPhone/Android native compilation and execution, physical-device gestures/VoiceOver/TalkBack/OS snapshots/photo permissions, signed APK/IPA, store review, online Expo compatibility metadata, hosted SMTP/external delivery, live production journeys, provider backup/log expiry and the separately configured hosted production-readiness workflow. Offline Expo checks use the bundled SDK map and do not certify online compatibility. Automated axe/keyboard checks are not a complete WCAG certification.

## F. Deployment readiness

`docs/deployment.md` provides the precise operator procedure; `docs/production.env.example` contains empty credential fields. The preferred address `gregslist.friend` is unregistered/unverified here. A real Supabase project, HTTPS host, SMTP provider, owner/support contact and secure credentials are required. A hosting-generated HTTPS address can be used before buying a domain.

The Auth tool plans by default; applying settings requires an exact project/origin confirmation. It configures the three committed templates, restricted redirects, custom SMTP and verified invitation-only accounts. It does not migrate, deploy or certify email delivery. Copied invitations still require email ownership verification for new/unverified accounts. Verification must not be disabled to compensate for missing SMTP.

The hourly privacy scheduler needs an independent `CRON_SECRET`, a compatible hosting plan and monitoring. Provider failures stay queued and reported as pending. A real backup/restore process must preserve Storage bytes separately, establish verified backup/log expiry and reapply later erasures before restored member access. No external erasure ledger or production recovery schedule is verified.

Cloud install/start instructions and missing configuration requirements were saved as an environment draft. That draft does not activate credentials or publish the environment. The user must review/save the configuration in environment settings and publish it for future environment reuse. Project-specific secret routing requires the actual hostname. No secret values belong in chat, Git or a native bundle.

For native distribution the publisher needs a real Expo project, owned application identifiers, Apple/Google accounts and signing credentials. The committed EAS profiles distinguish Android internal APK, iOS registered-device builds and store builds. JavaScript exports are not installable binaries; general iPhone distribution requires TestFlight/App Store or valid device provisioning. Submission remains a separate publication action.

## G. Outstanding issues

Launch checklist (checked application behavior means verified locally):

- [x] Core noticeboard works.
- [x] Events and RSVPs work.
- [x] Ride coordination works.
- [x] Partner bookings work.
- [x] Invitations work with the local inbox; external delivery is a separate gate.
- [x] Membership restrictions work.
- [x] Administrator controls work.
- [x] RLS security checks passed in the tested scope.
- [x] Database concurrency checks passed.
- [x] Private media protection checks passed.
- [x] Responsive browser usability checked at phone, tablet and desktop widths.
- [x] Accessibility reviewed with axe, keyboard input and source inspection.
- [x] Production build passes.
- [x] Environment configuration documented.
- [x] Database migrations rehearsed and ready for operator review.
- [x] Backup and recovery documented and synthetic PostgreSQL restore rehearsed.
- [x] No known Critical application-security issue remains in the tested scope.
- [ ] No unresolved launch-blocking gates remain.
- [x] Standard GitHub-hosted CI passed on the published implementation commit.
- [ ] Hosted configuration, maintenance, mail delivery and backups verified.
- [ ] Signed native builds and physical iPhone/Android validation completed.

**Critical / launch-blocking prerequisites:** no verified production hosting/database target, required runtime secrets, SMTP delivery, hosted migrations, monitored privacy scheduler, backup/log retention and restore-erasure procedure, or owner/support details. These are external configuration gates, not reported as completed code. No signed phone download is available without publisher accounts/configuration/signing.

**High:** two unpatched native build-tool advisories remain, as detailed in section D; resolve or obtain a documented upstream security assessment before native publication. Live authenticated production/security checks, the protected production-readiness workflow and physical-device/native compilation evidence remain required before controlled launch. Standard GitHub-hosted CI passed on the implementation commit. No unresolved High application-authorisation defect is known after the deletion race fix, within the tested scope.

**Medium:** broader manual screen-reader/device accessibility, production-scale performance/load and provider recovery timing are unverified. Provider-level backup/Storage restoration still needs an actual rehearsal. Native first-password/recovery uses the trusted website; universal links, push notifications and offline private content are intentionally absent.

**Low:** final store artwork/listing/support text and publisher-owned release metadata require review. No new product feature is needed to continue local testing.

## H. Final assessment

**Ready for limited testing only.** The tested repository can support controlled local/review testing. It is not yet a production service or a downloadable signed phone release. Complete the external launch gates, resolve/assess native tooling advisories, validate actual devices and record hosted evidence before a controlled launch. No further phase or public deployment was begun.
