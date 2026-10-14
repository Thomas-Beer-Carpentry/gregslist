# Phase 1 validation

Validated in the cloud development environment on 2026-10-14 using Node.js 24, Next.js 16, local Supabase and system Chromium. PROJECT_BRIEF.md remains unchanged.

| Requirement                | Fresh evidence                                                                                                                                                       | Result                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Repeatable dependencies    | npm ci                                                                                                                                                               | Passed                       |
| Clean schema installation  | npm run db:reset applied the final migration from scratch                                                                                                            | Passed                       |
| Reusable startup           | npm run db:start repeated against running services; bootstrap repeated with credentials preserved                                                                    | Passed                       |
| Runnable application       | npm run build; local login request; browser login renders protected shell                                                                                            | Passed                       |
| Type safety and formatting | npm run typecheck; npm run format:check                                                                                                                              | Passed                       |
| Invitation-only access     | Real Auth/API tests cover disabled public registration, pending accounts, concurrent redemption, reuse, expiry and revocation                                        | Passed                       |
| Authorisation              | Real API tests deny role escalation, unauthorised invitation actions and private reads after membership revocation                                                   | Passed                       |
| Private data and photos    | Populated fixtures verify private saved posts, notifications and partner records; storage tests verify anonymous, pending and revoked denial and active-member reads | Passed                       |
| Database permissions       | npm run db:test: 8 pgTAP checks                                                                                                                                      | 8 passed                     |
| Auth/API integration       | npm test                                                                                                                                                             | 13 passed                    |
| Browser workflows          | npm run test:e2e: anonymous redirects, mobile login/member layout, admin login, profile update, logout, email invitation, password setup, link reuse and recovery    | 3 passed                     |
| Brand contrast             | Primary button 12.20:1; muted text on background 5.80:1; accent text on white 4.92:1; main text 15.07:1                                                              | WCAG AA text contrast passed |
| Secret handling            | Privileged key absent from browser assets; privileged key and local admin password absent from nonignored source; local credentials/log files mode 600               | Passed                       |

Initial failures identified and corrected: writable npm cache, Docker vfs image extraction disk usage, outbound proxy injection into internal Docker requests, template read permissions, email-provider configuration, Supabase default anonymous function grants, and callback redirects using the server bind address. The browser test also corrected a test navigation race by waiting for completed sign-in before navigating.

The app and local Supabase services are running. Environment install_script and start_skill are saved as a draft; saving does not publish a snapshot. Review/save in Environment Settings and publish to retain this prepared environment.

## Scope limits

This is the foundation phase. Content tables are protected and intentionally read-only to members until later phases add their validated write APIs. Posts, event/RSVP UI, ride booking and partner-link workflows, uploads and remaining moderation/notifications are not implemented. No production service was configured, migration applied remotely, deployment performed, Git commit created or push made. Hosted Supabase Auth/SMTP and Vercel setup require separate deployment work documented in setup.md.
