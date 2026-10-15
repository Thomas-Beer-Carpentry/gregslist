# GREGSLIST — PHASE 6: POLISH, SECURITY & LAUNCH

## Complete Codex Implementation Brief

### Project context

Gregslist is a private, invite-only community noticeboard built using Next.js, React, TypeScript, Supabase, PostgreSQL, Tailwind CSS, and potentially shadcn/ui.

The application allows authorised members to:

- Create and browse community noticeboard posts.
- Organise events and manage RSVPs.
- Offer rides and book passenger seats.
- Link partner accounts through mutual consent.
- Communicate through existing discussions.
- View relevant member information.
- Join through administrator-issued invitations.
- Manage membership through administrator controls.

The project has six phases:

1. Foundation.
2. Core noticeboard.
3. Events and RSVPs.
4. Ride coordination.
5. Membership and administration.
6. Polish, security, and launch preparation.

**Your task is to complete Phase 6 without unnecessarily rebuilding or redesigning the application.**

Phases 4 and 5 have previously been specified, but their actual implementation and verification status must be established from the repository before proceeding.

Do not assume features are complete simply because implementation briefs exist.

---

# 1. Initial repository audit

Before making changes, inspect the entire existing application.

Review:

- Repository structure and dependencies.
- Database schema and migrations.
- Authentication and invitation flows.
- Membership roles and permissions.
- Posts and noticeboard functionality.
- Events and RSVPs.
- Ride offers and passenger reservations.
- Partner linking and consent.
- Administrative functionality.
- Existing notifications.
- Supabase RLS policies.
- Existing automated tests.
- Deployment configuration.
- Environment variables.
- Error handling and logging.

Produce an initial assessment identifying:

1. Fully implemented features.
2. Partially implemented features.
3. Missing functionality.
4. Known defects.
5. Security concerns.
6. Untested functionality.
7. Deployment blockers.

If Phase 4 or Phase 5 is materially incomplete or has unresolved critical security issues, **stop and report the blockers before proceeding**.

Do not conceal incomplete functionality behind cosmetic improvements.

# 2. Interface polish and consistency

Review the application on both mobile and desktop.

Improve consistency across:

- Main noticeboard.
- Category filters.
- Post creation and editing.
- Post detail pages.
- Event creation and editing.
- Event detail pages.
- RSVP controls.
- Ride coordination.
- Partner linking.
- Member directory.
- Invitation acceptance.
- Administration dashboard.
- Account settings.

### Design system

Maintain the established Gregslist light theme.

Use the exact palette:

- Forest green: `#0B3D2E`
- Deep green: `#145A3A`
- Sage teal: `#2F7D6B`
- Warm sand: `#CBBFA6`
- Charcoal: `#1B1F23`
- Warm off-white: `#F6F4EE`
- White cards.
- Warm-grey borders: `#E3E0D7`

The intended layout includes:

- Main noticeboard feed.
- Category filters.
- Upcoming-events sidebar on suitable screen sizes.

Ensure layouts adapt naturally to mobile.

### Polish requirements

- Consistent typography.
- Comfortable spacing.
- Consistent button styles.
- Clear navigation.
- Readable cards.
- Accessible colour contrast.
- Useful loading states.
- Helpful empty states.
- Clear validation messages.
- Consistent confirmation feedback.
- Responsive forms.
- Appropriate touch targets.
- No unnecessary animations.

Do not redesign the application or introduce a different visual direction.

# 3. Navigation and usability

Review the complete user journey.

A member should be able to:

1. Sign in.
2. Browse the noticeboard.
3. Filter posts.
4. Create and edit their own posts.
5. Find upcoming events.
6. RSVP.
7. Offer a ride.
8. Book or cancel passenger seats.
9. Manage partner linking.
10. View their profile.
11. Sign out.

Administrators should also be able to:

1. Invite new members.
2. Review invitations.
3. Manage members.
4. Manage administrative permissions.

Ensure users can easily find relevant functionality.

Avoid excessive menus or unnecessary steps.

Ensure browser back navigation and direct links work correctly.

# 4. Accessibility

Audit the application against WCAG 2.2 AA principles where practical.

Review:

- Keyboard navigation.
- Visible focus indicators.
- Screen-reader labels.
- Semantic HTML.
- Form labels and error associations.
- Colour contrast.
- Accessible modal dialogs.
- Accessible dropdown menus.
- Accessible date and time inputs.
- Touch target sizing.
- Responsive text scaling.
- Reduced-motion preferences.

Fix significant accessibility issues.

Do not rely solely on automated accessibility tests.

Include manual keyboard-navigation checks where possible.

# 5. Authentication and session security

Review Supabase authentication and session handling.

Verify:

- Only authorised members can access private community content.
- Public registration is disabled or securely restricted.
- Invitations are required for membership.
- Expired or revoked invitations cannot be redeemed.
- Suspended members cannot continue using protected functionality.
- Removed members cannot continue accessing private data.
- Session handling does not expose authentication tokens.
- Sign-out behaves correctly.
- Redirects cannot be abused.
- Authentication errors do not reveal unnecessary account information.

Verify access rules through backend/database enforcement, not only frontend redirects.

Test what happens when membership permissions change during an existing session.

# 6. Database and RLS security audit

Conduct a thorough Supabase security review.

Inspect every relevant table and function.

Review access controls for:

- Members and profiles.
- Posts and categories.
- Events and RSVPs.
- Ride offers.
- Ride reservations.
- Partner relationships.
- Invitations.
- Administrator roles.
- Audit logs.
- Notifications.
- Storage objects.

### Security requirements

- Unauthorised users cannot read private community data.
- Ordinary members cannot modify another member's protected records.
- Members cannot grant themselves administrator permissions.
- Drivers cannot alter another driver's rides.
- Booking actors cannot forge partner consent.
- Passenger reservations cannot bypass capacity constraints.
- Suspended and removed members lose access.
- Invitation tokens cannot be read from the database by ordinary users.
- Administrative audit records cannot be altered by ordinary members.
- RLS is enabled and appropriately configured.
- Privileged functions have restricted execution permissions.

Inspect any security-definer functions for unsafe search paths, missing authorisation checks, and excessive privileges.

Do not weaken RLS to resolve frontend issues.

# 7. Ride-booking reliability audit

Ride coordination contains the most sensitive transactional logic in the application.

Verify:

- Multiple drivers can offer rides for one post or event.
- Passenger lists are visible to authorised members.
- One active reservation per passenger per post or event is enforced.
- Drivers cannot book themselves.
- Partner consent is required.
- Two-seat bookings are atomic.
- Capacity is enforced inside database transactions.
- Simultaneous booking attempts cannot overbook.
- Duplicate submissions do not create duplicate reservations.
- Cancelled bookings release capacity.
- Ride switching preserves the original reservation if the replacement fails.
- Driver withdrawal updates affected bookings.
- Event cancellation prevents new bookings.
- Event changes do not leave misleading transport information.

Use real database-backed concurrency tests where possible.

Do not claim concurrency safety from frontend tests alone.

# 8. Error handling and reliability

Review how the application handles:

- Failed network requests.
- Expired sessions.
- Database errors.
- Duplicate submissions.
- Slow connections.
- Failed image uploads.
- Invalid forms.
- Missing or deleted content.
- Booking conflicts.
- Invitation redemption errors.

Requirements:

- Display understandable error messages.
- Avoid exposing internal database details to users.
- Prevent duplicate actions while requests are pending.
- Preserve unsaved user input where practical.
- Avoid misleading success messages.
- Provide useful retry options.
- Ensure failed operations do not leave inconsistent records.

Use appropriate server-side logging without exposing secrets or unnecessary personal information.

# 9. Performance optimisation

Review application performance without introducing unnecessary complexity.

Focus on:

- Initial page loading.
- Noticeboard feed performance.
- Event listing performance.
- Image loading.
- Database query efficiency.
- Appropriate pagination.
- Avoiding unnecessary repeated queries.
- Reducing oversized client-side bundles.
- Minimising unnecessary component re-renders.

Check database indexes for common filtering and lookup operations.

Avoid premature optimisation.

Prioritise measurable performance problems.

# 10. Image uploads and storage

Audit existing media functionality.

Verify:

- Only authorised members can upload media.
- Storage policies prevent unauthorised access.
- File size limits are enforced.
- Allowed file types are validated.
- Unsupported or unsafe files are rejected.
- Images display correctly on mobile and desktop.
- Multiple images work where supported.
- Image deletion follows appropriate ownership rules.
- Private community images are not accidentally exposed through public storage buckets.

Use private buckets and appropriately authorised access where needed.

Do not expose privileged storage credentials in client code.

# 11. Data integrity and migrations

Review all database migrations.

Verify:

- Migrations run in the intended order.
- Constraints are appropriate.
- Foreign keys are valid.
- Indexes support common queries.
- Reservation uniqueness rules are enforced.
- Invitation redemption is atomic.
- Administrative role safeguards work.
- Existing data is preserved.
- Schema changes are documented.

Test migrations against a clean database and, where practical, a representative non-production dataset.

Do not reset or destructively modify production data.

Document backup and recovery procedures before launch.

# 12. Privacy and member information

Gregslist is a private community, so privacy is a core requirement.

Review all places where member information appears.

Ensure:

- Members see only appropriate community profile information.
- Passenger lists contain only information needed for coordination.
- Email addresses are not unnecessarily exposed.
- Authentication identifiers are not displayed.
- Partner relationships are not publicly exposed without an established reason.
- Administrative records remain private.
- Sensitive information is not included in client logs.
- Private content is not accidentally indexed by search engines.

Add appropriate no-index controls to private application routes.

Document the application's actual data handling and retention behaviour.

Do not invent legal compliance claims.

# 13. Notifications

Review any existing in-app notifications.

Where supported, ensure notifications work for relevant events such as:

- Event cancellation.
- Significant event changes.
- Ride withdrawal.
- Passenger booking changes.
- Partner-link requests.
- Membership invitation or status changes.

Do not build a new notification platform if one does not already exist.

If required notification functionality is unavailable, document the limitation clearly.

# 14. Mobile experience

Gregslist should work comfortably on Android, iPhone, tablets, and desktop browsers.

Review:

- Responsive layout.
- Navigation.
- Forms.
- Date and time controls.
- Image galleries.
- Post creation.
- Event RSVP.
- Ride booking.
- Member administration.

Test common viewport sizes.

Ensure interactive controls are usable without hovering.

Do not build a native Android or iOS application in this phase.

# 15. Automated testing

Review and improve existing test coverage.

Include tests for:

### Authentication and membership

- Valid sign-in.
- Unauthorised access.
- Invitation redemption.
- Suspended members.
- Administrator permissions.

### Noticeboard

- Creating posts.
- Editing and deleting posts.
- Category filtering.
- Post ownership.
- Image access.

### Events

- Creating events.
- RSVP changes.
- Capacity handling.
- Event cancellation.

### Ride coordination

- Ride creation.
- Booking capacity.
- Partner bookings.
- Atomic reservations.
- Concurrent booking attempts.
- Cancellation.
- Ride switching.
- Driver withdrawal.

### Administration

- Creating invitations.
- Revoking invitations.
- Managing members.
- Preventing role escalation.
- Preserving the final administrator.

### End-to-end flows

Where the test environment supports it, test representative journeys from sign-in through normal community use.

Use actual database integration tests for critical security and transactional behaviour.

# 16. Production configuration

Prepare the application for deployment.

Inspect existing deployment configuration before making changes.

If Vercel is already used, preserve the existing setup.

If deployment is not configured, prepare a suitable deployment configuration and document the steps.

Verify:

- Production environment variables are documented.
- Secrets are never committed to Git.
- Supabase URLs and keys are configured correctly.
- Service-role credentials remain server-only.
- Authentication redirect URLs are correct.
- Production database migrations are documented.
- Storage configuration is appropriate.
- Error handling works in production mode.
- The production build succeeds.

Do not deploy publicly without explicit approval.

# 17. Backups and recovery

Document a practical recovery procedure.

Include:

- Database backup approach.
- Supabase backup availability and limitations.
- Storage backup considerations.
- Migration recovery.
- Restoring from backup.
- Recovering from an accidental administrative change.
- Handling failed deployments.

Do not claim backups are configured unless verified.

# 18. Documentation

Create or update project documentation covering:

- Local development setup.
- Required environment variables.
- Supabase configuration.
- Database migrations.
- Running tests.
- Production build.
- Deployment procedure.
- Administrator bootstrap.
- Invitation workflow.
- Common troubleshooting steps.
- Backup and recovery.
- Known limitations.

Keep documentation consistent with the actual implementation.

# 19. Final quality checks

Run all available:

- Linting.
- TypeScript checks.
- Automated tests.
- Database integration tests.
- RLS permission tests.
- Concurrency tests.
- Accessibility checks.
- Production build.

Fix regressions introduced by Phase 6.

Report the exact commands executed and their results.

Do not describe skipped or unavailable tests as passed.

# 20. Launch readiness checklist

Produce a final checklist covering:

- [ ] Core noticeboard works.
- [ ] Events and RSVPs work.
- [ ] Ride coordination works.
- [ ] Partner bookings work.
- [ ] Invitations work.
- [ ] Membership restrictions work.
- [ ] Administrator controls work.
- [ ] RLS security verified.
- [ ] Database concurrency verified.
- [ ] Private media protected.
- [ ] Mobile usability checked.
- [ ] Accessibility reviewed.
- [ ] Production build passes.
- [ ] Environment configuration documented.
- [ ] Database migrations ready.
- [ ] Backup and recovery documented.
- [ ] No critical security issues remain.
- [ ] No unresolved launch-blocking defects remain.

Do not mark an item complete without evidence.

# 21. Required completion report

When finished, provide:

### A. Initial audit

What existed before Phase 6 and what was incomplete.

### B. Improvements made

List the UI, accessibility, reliability, performance, and security improvements.

### C. Files changed

Summarise significant changes and database migrations.

### D. Security findings

Describe vulnerabilities identified, fixes applied, and unresolved concerns.

### E. Testing results

Report actual results for all tests, linting, TypeScript checks, and production build.

### F. Deployment readiness

Identify required configuration, deployment steps, and manual actions.

### G. Outstanding issues

Separate issues into:

- Critical — blocks launch.
- High — should be fixed before launch.
- Medium — can be scheduled for improvement.
- Low — minor polish.

### H. Final assessment

Classify the application as:

- Ready for controlled launch.
- Ready for limited testing only.
- Not ready for launch.

Explain the evidence supporting the classification.

---

# FINAL INSTRUCTION

Complete Phase 6 — Polish, Security & Launch Preparation in the existing Gregslist repository.

Inspect the application before making changes.

Preserve all agreed product requirements and working functionality.

Prioritise security, data integrity, reliability, accessibility, and mobile usability.

Do not introduce unrelated features.

Do not deploy publicly without explicit approval.

Provide a complete implementation and launch-readiness report.

**Stop after Phase 6 and await further instructions.**