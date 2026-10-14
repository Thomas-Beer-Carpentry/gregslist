# Phase 2: core noticeboard

The Gregslist master brief remains the source of truth. This phase implements the noticeboard while retaining invitation-only membership and the exact brand palette.

## Implemented

- Newest-first feed with stable `(created_at, id)` cursor pagination; combined category, type, status and English full-text search filters.
- Seven post types, extensible categories, owner-only creation/editing and confirmed deletion. Authors and posting timestamps are derived by the database; type stays fixed after creation.
- Offer/request/trip availability and conditions, optional pickup/location, and visible lifecycle statuses.
- Basic structured event start/end, IANA timezone and location, with an upcoming sidebar that excludes cancelled, archived and past events. Event attendance and capacity remain Phase 3.
- Plain-text, React-escaped comments with author/timestamps, own-comment editing/deletion and administrator deletion. Archived/cancelled posts close comments.
- Personal saved/unsaved posts and a filtered saved-posts view; saves do not affect chronology.
- Up to six private photos per post. Uploads validate signatures and real decodable JPEG/PNG/WebP bytes, cap input at 5 MB and 20 million pixels, resize to 1920px, strip metadata and re-encode WebP. Previews, upload progress and actionable errors are present.
- Photo delivery checks current membership and sends private/no-store responses. Browsers cannot write directly to Storage. Removing metadata immediately denies downloads; storage deletion retries use a private persistent queue. Queued objects cannot be reattached.
- Responsive navigation and feed/detail/form layouts; empty, loading, error and status feedback. Form values survive server validation failures.

## Fresh verification

| Check                     | Result                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`           | Passed                                                                                                                          |
| `npm run typecheck`       | Passed                                                                                                                          |
| `npm run format:check`    | Passed                                                                                                                          |
| `npm test`                | 23 passed: foundation and noticeboard Auth/API/storage tests                                                                    |
| `npm run db:test`         | 16 passed: database permission/security contracts                                                                               |
| `npm run test:e2e`        | 7 passed: authentication, noticeboard CRUD/comments/saves/filters, events, private photos and pagination                        |
| Focused event/date checks | Passed: invalid end dates, field preservation, daylight-saving gaps, timezone round trip, cancellation and past-event exclusion |
| Focused photo checks      | Passed: real decoding, resize/metadata removal, spoofed and oversized files, CSRF origin, ownership, revocation and removal     |
| Local migrations          | Applied additively; repeating db:migrate applies nothing and preserves existing data                                            |
| Cleanup retry             | Queued bytes removed; command safe to repeat                                                                                    |
| Visual review             | Desktop and mobile inspected using temporary fixtures; fixtures removed afterward                                               |

Tests use real local Supabase, PostgreSQL and Chromium. Noticeboard API tests were first run before their RPCs existed and failed for the missing functions. Testing found and repaired uncontrolled form resets after validation. Review added protections against reattaching queued files and non-finite event dates. No assertions were removed or authentication/RLS protections weakened.

## Limits and next phase

RSVPs, attendance capacity, ride offers/bookings, partner linking, full notifications and remaining moderation tools are later phases. Generic post updates/deletion refuse existing attendance or ride arrangements until coordinated lifecycle APIs exist. Hosted deployment, production cleanup scheduling and external Auth/SMTP configuration remain deployment work. No cloud-environment publication is needed for the GitHub workflow.
