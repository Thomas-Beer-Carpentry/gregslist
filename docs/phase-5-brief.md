# GREGSLIST — PHASE 5: MEMBERSHIP & ADMINISTRATION

## Complete Codex Implementation Brief

### Project context

Gregslist is a private, invite-only community noticeboard built using Next.js, React, TypeScript, Supabase, Tailwind CSS, and potentially shadcn/ui.

The project is being developed in six phases:

1. Foundation — completed.
2. Core noticeboard — completed.
3. Events and RSVPs — previously implemented.
4. Ride coordination — implementation and verification must be confirmed.
5. Membership and administration — **implement in this phase**.
6. Polish, security, and launch — not yet started.

**Your task is to implement Phase 5 in the existing Gregslist repository.**

Do not rebuild the application, redesign existing functionality, or begin Phase 6.

---

# 1. Inspect the existing application

Before modifying anything, inspect:

- Existing Supabase authentication and registration flows.
- Current database schema and migrations.
- Member profiles and account settings.
- Existing administrator roles and permissions.
- Existing Row Level Security policies.
- Existing posts, events, RSVPs, and ride coordination.
- Existing invitation functionality, if any.
- Existing notification systems.
- Existing UI components and design conventions.
- Existing automated tests.

Identify what is already implemented and reuse it.

Do not create competing membership or authentication systems.

Confirm that Phase 4 has been completed and that no unresolved critical security issues remain. If it has not, stop and report the blockers before beginning Phase 5.

# 2. Private, invite-only membership

Gregslist must be a private community.

Only authorised members should be able to access community content.

### Membership rules

- Only administrators can invite new members.
- No public self-registration.
- No unrestricted account creation.
- New accounts must originate from a valid administrator-issued invitation.
- Invitation tokens must be single-use, expiring, and revocable.
- Unauthorised users must not access private posts, events, rides, passenger lists, or member information.
- Suspended or removed members must lose community access.

Enforce these requirements through the backend and database, not just frontend controls.

Do not rely on hiding the registration button.

# 3. Administrator roles

Implement or extend the existing administrator role system.

The initial roles are:

**Member**

Can use ordinary community features according to their existing permissions.

**Administrator**

Can additionally:

- Invite new members.
- View and manage invitations.
- View the member directory.
- Suspend and reactivate members.
- Remove members from the community.
- Manage administrator roles where authorised.
- Access administrative tools.

Do not introduce additional role tiers unless required by existing architecture.

### Administrator safeguards

- Ordinary members cannot grant themselves administrator access.
- Administrative permissions must be enforced server-side.
- Prevent administrators from accidentally removing the final active administrator.
- Prevent unauthorised role escalation.
- Preserve audit records of significant administrative actions.

# 4. Invitation system

Build an invitation workflow accessible only to administrators.

### Creating invitations

An administrator should be able to:

1. Open the administration area.
2. Select "Invite Member".
3. Enter the intended member's email address.
4. Generate a secure invitation.
5. Send the invitation through an existing email service, if configured.
6. Alternatively, copy a secure invitation link.

Each invitation should record:

- Intended email address.
- Inviting administrator.
- Creation timestamp.
- Expiration timestamp.
- Status.
- Redemption timestamp, if accepted.

### Invitation security

- Generate cryptographically secure, unpredictable tokens.
- Store only a secure hash of the token.
- Make invitations single-use.
- Apply an expiration period, defaulting to seven days.
- Allow administrators to revoke pending invitations.
- Prevent expired or revoked invitations from being redeemed.
- Bind redemption to the intended email address.
- Prevent token reuse, including simultaneous redemption attempts.
- Do not reveal invitation tokens through public logs or API responses.

### Invitation redemption

The invited person should be able to:

1. Open the invitation link.
2. See a welcoming invitation page.
3. Verify their email address.
4. Create or authenticate their account.
5. Accept the invitation.
6. Access Gregslist once membership is successfully activated.

Use the existing Supabase authentication system.

Do not introduce a separate password or authentication database.

The invitation redemption operation must be safe against retries and concurrent requests.

If an invited person already has an authenticated account, handle that situation securely without creating duplicate accounts.

# 5. Member directory

Create a member directory available only to authorised members.

Display appropriate public community information, such as:

- Display name.
- Profile picture, if supported.
- Optional short biography.
- Membership status where appropriate.

Do not expose:

- Private email addresses.
- Authentication identifiers.
- Password information.
- Invitation tokens.
- Administrative audit details.
- Unrelated personal information.

Administrators may have access to additional membership management information through protected administration pages.

The directory should be searchable by member name.

# 6. Member profiles

Allow members to manage their own basic profile information.

Supported fields may include:

- Display name.
- Profile picture.
- Optional short biography.

Reuse existing profile fields and functionality.

Do not add unnecessary social networking features.

Members should not be able to modify:

- Their own administrator status.
- Their membership approval status.
- Another member's profile.
- Internal administrative fields.

Ensure profile updates are validated and authorised.

# 7. Membership administration

Create an administration dashboard.

Administrators should be able to:

- View current members.
- Search members.
- View pending invitations.
- Revoke invitations.
- Suspend members.
- Reactivate suspended members.
- Remove members.
- Review relevant administrative history.

### Suspension

Suspended members must lose access to protected community functionality.

Suspension should not silently delete their historical posts, events, ride offers, or reservations.

Where a suspended member has active responsibilities, such as driving an upcoming ride or organising an event, provide a clear and consistent handling policy.

Do not leave active bookings or events in misleading states.

### Removal

Removing a member must revoke their community access.

Preserve necessary historical records and referential integrity.

Do not indiscriminately delete related posts, events, bookings, or audit records.

Prevent removal of the final active administrator.

Define clear differences between suspension, removal, and account deletion.

Do not implement permanent personal-data deletion without first identifying the applicable data-retention and privacy requirements.

# 8. Administrator management

Allow appropriately authorised administrators to grant or revoke administrator status.

Requirements:

- Only existing authorised administrators may manage administrator roles.
- Ordinary members cannot elevate their own permissions.
- Role changes must be validated on the backend.
- Prevent removal or demotion of the final active administrator.
- Record who made each role change and when.
- Apply permission changes immediately to subsequent protected operations.

Use the existing role system where possible.

If no initial administrator exists, provide a secure, documented bootstrap procedure.

Never allow the public registration process to create an administrator automatically.

# 9. Administrative audit trail

Record important administrative actions.

Examples:

- Invitation created.
- Invitation revoked.
- Invitation redeemed.
- Member suspended.
- Member reactivated.
- Member removed.
- Administrator granted.
- Administrator revoked.

Each audit entry should contain:

- Action type.
- Acting administrator.
- Target member or invitation.
- Timestamp.
- Appropriate non-sensitive details.

Audit entries must not contain raw invitation tokens, passwords, or secrets.

Ordinary members must not be able to read or modify administrative audit records.

Protect audit records against unauthorised alteration.

# 10. Notifications and email

Reuse any existing notification infrastructure.

Invitation emails should be clear, friendly, and include:

- Gregslist invitation context.
- Secure invitation link.
- Expiration information.
- Basic instructions.

If no email service is configured, provide a secure copy-link workflow for administrators.

Do not introduce an unnecessary third-party messaging platform.

Never expose privileged email service credentials in client-side code.

# 11. Database design

Extend the existing Supabase schema through safe migrations.

The implementation may require:

- Membership status fields.
- Invitation records.
- Administrator role records or extensions.
- Administrative audit records.
- Appropriate supporting indexes and constraints.

These are conceptual requirements, not mandatory table names.

Reuse the existing schema where possible.

### Database expectations

- Enforce valid membership states.
- Enforce invitation uniqueness and redemption rules.
- Enforce administrative permissions.
- Preserve referential integrity.
- Use secure transactional operations.
- Prevent concurrent invitation redemption.
- Prevent the final administrator from being removed or demoted, including concurrent administrative actions.
- Protect privileged role fields from unauthorised writes.

Do not run destructive production migrations without explicit approval.

# 12. Row Level Security

Review and strengthen RLS across the entire application.

This includes:

- Posts.
- Events.
- RSVPs.
- Ride offers.
- Ride reservations.
- Partner relationships.
- Member profiles.
- Invitations.
- Administrator roles.
- Audit records.

Ensure suspended, removed, and unauthorised accounts cannot continue accessing protected data.

Do not assume that an authenticated Supabase user is automatically an authorised Gregslist member.

Avoid circular or recursive RLS policies.

Use restricted server-side functions where necessary.

If using security-definer functions, apply controlled search paths, explicit identity checks, and restricted execution permissions.

Never expose Supabase service-role credentials to client-side code.

# 13. Interface and design

Follow the established Gregslist light-theme design system.

### Exact colours

- Forest green: `#0B3D2E`
- Deep green: `#145A3A`
- Sage teal: `#2F7D6B`
- Warm sand: `#CBBFA6`
- Charcoal: `#1B1F23`
- Warm off-white: `#F6F4EE`
- White cards
- Warm-grey borders: `#E3E0D7`

### Required screens

- Administration dashboard.
- Member directory.
- Member management.
- Invitation management.
- Invitation acceptance.
- Member profile editing.
- Appropriate access-denied screens.

Keep the interface clean, friendly, and practical.

Administrative functionality should be clearly separated from the ordinary noticeboard experience.

Do not introduce likes, follower counts, algorithmic feeds, or unrelated social features.

# 14. Testing requirements

Add automated tests covering:

### Invitations

- Administrators can create invitations.
- Ordinary members cannot create invitations.
- Unauthenticated users cannot create invitations.
- Valid invitations can be redeemed.
- Expired invitations fail.
- Revoked invitations fail.
- Redeemed invitations cannot be reused.
- Concurrent redemption cannot create duplicate memberships.
- Invitation email binding is enforced.
- Invitation tokens cannot be guessed or exposed through ordinary database access.

### Membership

- Uninvited users cannot register for community access.
- Unauthorised users cannot read community data.
- Suspended members lose access.
- Removed members lose access.
- Reactivated members regain appropriate access.
- Members cannot change their own roles.
- Members cannot edit another member's protected information.

### Administration

- Administrators can manage members.
- Ordinary members cannot access administrative operations.
- The final administrator cannot be removed or demoted.
- Concurrent administrative changes cannot bypass final-administrator protection.
- Audit records are created correctly.
- Audit records cannot be modified by ordinary members.

### Integration

Verify membership permissions across posts, events, RSVPs, rides, reservations, and partner linking.

Test using multiple authenticated accounts and direct database requests where appropriate.

Frontend-only tests are insufficient to prove access security.

# 15. Quality checks

Run all available:

- Automated tests.
- Database integration tests.
- RLS permission tests.
- TypeScript checks.
- Linting.
- Production build.

Fix regressions introduced by Phase 5.

Clearly distinguish tests that passed from tests that could not run.

If an external service, Supabase configuration, or production environment setting is required, document it.

# 16. Implementation boundaries

Do not:

- Begin Phase 6.
- Introduce public registration.
- Create a separate authentication database.
- Rebuild existing posts, events, or rides.
- Add unrelated social features.
- Expose member information publicly.
- Weaken RLS to simplify development.
- Delete historical records indiscriminately.
- Make destructive production changes without approval.
- Silently change agreed product requirements.

Keep the application runnable and preserve existing functionality.

# 17. Required completion report

When finished, provide:

### A. Implementation summary

Features implemented and features remaining.

### B. Files and migrations

Important files changed and database migrations added.

### C. Invitation security

Explain token generation, hashing, expiration, revocation, redemption, and email binding.

### D. Membership enforcement

Explain how unauthorised, suspended, and removed members are prevented from accessing the community.

### E. Administrator permissions

Explain how roles are protected and how the final-administrator safeguard works.

### F. Security

Summarise RLS policies, server-side checks, and unresolved risks.

### G. Testing

Report actual results for automated tests, integration tests, linting, TypeScript, and production build.

### H. Outstanding work

List unresolved issues, manual configuration, unverified functionality, and required decisions.

### I. Final status

Classify Phase 5 as:

- Implemented and verified.
- Implemented but not fully verified.
- Partially implemented.
- Blocked.

Do not claim successful completion without appropriate verification.

---

# FINAL INSTRUCTION

Implement Phase 5 — Membership and Administration in the existing Gregslist repository.

Inspect the existing application before making changes.

Preserve Phases 1–4.

Build secure administrator-only invitations, private membership enforcement, member management, administrator permissions, and administrative auditing.

Run available verification checks and report the results.

**Stop after Phase 5. Do not begin Phase 6 without further instruction.**