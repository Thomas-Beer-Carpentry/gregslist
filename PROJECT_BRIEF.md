# GREGSLIST — MASTER PROJECT BRIEF

Version: 1.0

## 1. Product vision

Build Gregslist, a private online community noticeboard inspired by Craigslist, but designed specifically for a group of friends.

Gregslist allows members to:
- Share events and organise social activities.
- Offer or request rides, items, favours, help, and recommendations.
- Coordinate trips and transport.
- Comment on posts and upload photos.
- See what's happening across the group in one central place.

The product should retain Craigslist's straightforward, practical usefulness while being substantially more polished, intuitive, and visually cohesive.

Gregslist is not a conventional social network. It should prioritise real-world coordination, useful information, and ease of use rather than engagement metrics or constant interaction.

### Product principles

- Practical rather than performative.
- Calm and understated rather than attention-grabbing.
- Chronological rather than algorithmically ranked.
- Private and community-focused.
- Easy to use on mobile and desktop.
- Secure, maintainable, and extensible.

## 2. Technology stack

Use the following stack unless inspection of an existing repository reveals a compelling reason to change it.

- Framework: Next.js with React and TypeScript.
- Backend and database: Supabase and PostgreSQL.
- Authentication: Supabase Auth.
- Image storage: Supabase Storage.
- Authorisation: Supabase Row Level Security (RLS).
- Styling: Tailwind CSS.
- UI components: shadcn/ui, customised to match Gregslist.
- Hosting: Vercel, subject to deployment requirements.
- Version control: Git.

Use secure server-side logic for sensitive operations, migrations for database changes, and automated tests for important workflows.

Never expose privileged Supabase credentials or other secrets in client-side code.

## 3. Brand identity and design system

Use the supplied five-colour palette exactly.

| Name | Hex | Intended use |
|---|---|---|
| Forest green | #0B3D2E | Primary brand, navigation, primary actions |
| Deep green | #145A3A | Secondary emphasis, hover and active states |
| Sage teal | #2F7D6B | Accents, links, selected filters |
| Warm sand | #CBBFA6 | Warm accents, subtle surfaces, dividers |
| Charcoal | #1B1F23 | Primary text and strong contrast |

Supporting neutrals:
- Main background: warm off-white, approximately #F6F4EE.
- Cards: white, #FFFFFF.
- Borders: subtle warm grey, approximately #E3E0D7.
- Secondary text: a readable muted neutral, validated for contrast.

The five brand colours must not be replaced or arbitrarily altered.

### Appearance

Use a light theme by default.

The visual identity should be natural, warm, modern, welcoming, and understated.

Use:
- Clean typography.
- Clear visual hierarchy.
- Consistent spacing and corner radii.
- Subtle borders and restrained shadows.
- Accessible contrast and visible keyboard focus.
- Consistent loading, error, success, disabled, and empty states.
- Reusable design tokens or CSS variables.

Avoid excessive gradients, bright colours, unnecessary animation, engagement-focused counters, and cluttered layouts.

Build a coherent design system before implementing the full application.

## 4. Authentication and private membership

Gregslist is an invite-only application. There must be no unrestricted public registration.

### Invitation rules

- Only administrators can issue invitations.
- Invitations should use secure, difficult-to-guess tokens.
- Invitations should be single-use by default, expire, and be revocable.
- Validate invitations on the server.
- Prevent reuse of redeemed invitations.
- Provide clear messages for invalid, expired, revoked, and already-used invitations.
- Record invitation status and relevant timestamps.

Administrators must be able to invite members, revoke invitations, manage membership, and remove access.

### User accounts

Support:
- Registration through a valid invitation.
- Login and logout.
- Password recovery.
- Display names.
- Optional profile photos.
- Account settings.
- Appropriate session management.

Enforce membership checks through server-side authorisation and Supabase RLS, not merely by hiding pages or buttons.

Unauthorised users must not be able to access private posts, comments, member information, or stored photos.

## 5. Homepage and navigation

Build a balanced noticeboard with three logical areas on desktop.

### Navigation

Include:
- Gregslist branding.
- Navigation to the main feed, events, and saved posts.
- Search.
- User profile and account menu.
- A clear Create Post action.

### Main feed

Display a chronological feed of recent posts, newest first.

Include:
- Category filters.
- Post-type filters.
- Search.
- Author and posting date.
- Relevant post-type labels and statuses.
- Clear links to post details.

Use pagination or a sensible load-more pattern rather than engagement-driven infinite scrolling.

Do not rank posts by popularity or add likes, follower counts, or algorithmic recommendations.

### Upcoming-events sidebar

Show a compact list of upcoming events with:
- Date and time.
- Event title.
- Relevant location information.
- A link to the event.

The sidebar should complement the feed without overpowering it.

On mobile, adapt the layout into a single-column experience with accessible navigation and a compact upcoming-events section.

## 6. Posts and categories

A post is the central content object. Post type, category, and optional capabilities must be modelled separately.

### Post types

Support:
- Event.
- Offer.
- Request.
- Trip.
- Recommendation.
- Announcement.
- Discussion.

Do not create a separate Ride post type for the core ride-sharing workflow.

### Initial categories

- Events & Social.
- Music & Concerts.
- Outdoors & Adventures.
- Trips & Travel.
- Transport & Rides.
- Items & Borrowing.
- Help & Favours.
- Food & Recommendations.
- General.

Categories should be extensible without duplicating logic throughout the application.

### Post creation

The creation form should adapt to the selected post type.

Every post should support:
- Title.
- Description.
- Author.
- Category.
- Post type.
- Creation and update timestamps.
- Optional photos.
- Comments.
- Relevant status.

Events should additionally support structured date, time, and location fields.

Include a checkbox labelled:

"People might need a ride for this"

When enabled, the post gains a ride-coordination section. The author does not need to be a driver.

The checkbox must be available in the main post creation form, with the capability persisted to the database.

Members should be able to create, edit, and delete their own posts, subject to appropriate permission checks.

## 7. Event functionality

Events should support:
- Event title and description.
- Start date and time.
- Optional end date and time.
- Location or meeting point.
- Optional photos.
- Organiser.
- RSVP status.
- Optional attendance capacity.
- Attendee list.
- Comments and updates.
- Cancellation and completion states.

Support Going, Maybe, and Not Going responses.

Prevent attendance limits from being exceeded. Keep attendee lists and counts accurate.

Cancelled and past events should remain appropriately accessible, but should not clutter the upcoming-events sidebar.

## 8. Ride-sharing functionality

### Core concept

Ride sharing is an optional capability attached to an existing post or event.

The workflow is:

1. A member creates an event or supported post.
2. The author ticks "People might need a ride for this".
3. The post displays a ride-coordination section.
4. Any authorised member can volunteer to drive.
5. The driver specifies passenger capacity and relevant journey details.
6. Other members select available seats.
7. Reservations are automatically confirmed when capacity is available.
8. Members can manage their own bookings, including bookings created on their behalf by an authorised partner.

Multiple drivers can offer separate rides for the same event.

### Offering a ride

A driver can specify:
- Associated post or event.
- Number of available passenger seats, excluding the driver.
- Departure time, if relevant.
- Pickup location or proposed route.
- Optional return-trip details.
- Optional cost-sharing information.
- Optional notes.

Drivers can edit their offer, update availability where safe, or withdraw it.

Do not require the post author to be a driver.

### Selecting a seat

Members can select available seats directly.

Bookings are automatically confirmed when the database can successfully reserve sufficient capacity.

For each ride, display:
- Driver's name.
- Pickup and route details.
- Departure time.
- Passenger capacity.
- Confirmed passenger list.
- Remaining available seats.

Passenger lists must be visible to all authorised group members, including members who have not booked that ride.

Only authorised members may access these details. Do not expose passenger information publicly.

### Partner bookings

Members may select a seat:
- For themselves.
- For themselves and their partner, consuming two passenger seats.
- On behalf of their partner, consuming one passenger seat.

A partner must be associated with the member through an explicit account-linking process with appropriate confirmation.

Do not allow arbitrary users to modify another member's bookings.

When a member books for their partner:
- The passenger reservation belongs to the partner's account.
- The system records who created or modified the reservation.
- The partner can see their own reservation.
- The partner can change their own ride selection or withdraw.
- The system must not create duplicate active reservations for the same person and event.

A partner relationship is optional and must not be required to use the rest of Gregslist.

### Seat allocation and concurrency

Implement capacity enforcement through atomic database operations, transactions, or equivalent concurrency-safe logic.

Never rely solely on frontend seat counts.

Enforce:
- No more active passenger reservations than the driver's declared capacity.
- No duplicate active reservation for the same passenger and event.
- Correct capacity when passengers cancel or switch rides.
- Safe handling of simultaneous booking attempts.
- Correct handling of driver withdrawal and event cancellation.

When switching rides, avoid releasing the existing seat until the new booking can be secured, where practical. If the switch fails, preserve the existing booking and explain the outcome.

If a driver withdraws, mark affected reservations as requiring new arrangements and notify the affected members through the notification system.

If an event is cancelled, mark related rides and reservations as cancelled.

If ride coordination is disabled after reservations exist, require an explicit, safe transition. Never silently discard active bookings.

### Ride interface

Integrate ride coordination into the relevant post detail page, near the post content and comments.

When no rides exist, display a simple prompt inviting members to offer a ride.

When rides exist, display compact ride cards grouped by driver, with availability and pickup details.

Keep the workflow simple and consistent with the main Gregslist design system.

## 9. Offers, requests, and community resources

Members can offer or request:
- Items to borrow or give away.
- Equipment and tools.
- Help and favours.
- Transport.
- Accommodation.
- Skills and services.
- Tickets and shared activities.
- Recommendations and other useful resources.

Support relevant details such as availability, conditions, pickup location, and fulfilment status.

Allow members to express interest through comments or an appropriate structured action.

Support statuses such as Open, Fulfilled, Cancelled, and Archived where relevant.

## 10. Comments, photos, and saved posts

### Comments

- Members can comment on authorised posts.
- Display the author and timestamp.
- Authors can manage their own comments.
- Administrators can moderate inappropriate content.
- Validate and safely render user-submitted content.

### Photos

- Support multiple photos per post.
- Validate file types and sizes.
- Store photos in Supabase Storage.
- Enforce private-group access rules.
- Provide previews, upload progress, and error feedback.
- Avoid unnecessarily large uploads.

### Saved posts

- Allow members to save and unsave posts.
- Provide a dedicated saved-posts view.
- Saving a post must not affect feed ranking.

## 11. Notifications and content lifecycle

Provide restrained in-app notifications for:
- Comments on a member's posts.
- Relevant event updates or cancellations.
- Ride bookings and changes.
- Driver withdrawal.
- Important reservation changes.

Avoid excessive notifications. Allow users to configure preferences where appropriate.

Email and push notifications are optional future enhancements, not prerequisites for the first release.

Support clear lifecycle states for posts, events, and rides.

Archive expired or completed content sensibly. Where useful, allow authors to renew outdated offers.

## 12. Database architecture and security

Design the schema before implementing feature-specific UI.

Potential entities include:
- Profiles.
- Invitations.
- Posts.
- Categories.
- Post photos.
- Comments.
- Saved posts.
- Events.
- Event RSVPs.
- Ride offers.
- Ride reservations.
- Partner relationships.
- Notifications.

Use appropriate foreign keys, unique constraints, indexes, timestamps, and deletion behaviour.

Keep general post data separate from event-specific and ride-specific data where doing so improves data integrity.

Define and test RLS policies for all relevant tables and storage resources.

Test that users cannot read or modify information they are not authorised to access.

Implement critical ride-booking operations in secure database or server-side logic with proper concurrency control.

Use database migrations and document all required environment variables.

## 13. Administration

Administrators should be able to:
- Create and revoke invitations.
- Manage members.
- Remove inappropriate posts and comments.
- Manage categories.
- Review reported content.
- Revoke membership.

Enforce administrator permissions on the server and database, not only in the interface.

## 14. Implementation phases

### Phase 1: Foundation and design system
- Inspect the repository and existing configuration.
- Set up or verify Next.js, TypeScript, Tailwind CSS, and Supabase.
- Establish environment-variable handling.
- Design the database schema and migrations.
- Implement authentication, invitation-only registration, and RLS.
- Implement the design system using the exact five-colour palette.
- Build responsive navigation and reusable UI components.

### Phase 2: Core noticeboard
- Implement the homepage and chronological feed.
- Add the upcoming-events sidebar.
- Implement categories, post types, search, and filters.
- Implement post creation, editing, and deletion.
- Add comments, photo uploads, and saved posts.
- Add statuses and empty/error/loading states.

### Phase 3: Events
- Implement event creation and editing.
- Add RSVPs and attendance capacity limits.
- Connect upcoming events to the homepage sidebar.
- Handle event updates, cancellations, and archiving.

### Phase 4: Ride sharing
- Implement the optional post-level ride checkbox.
- Implement multiple driver offers per post.
- Implement automatic seat booking.
- Implement partner account linking and bookings on behalf of a partner.
- Implement capacity-safe booking, cancellation, and ride switching.
- Add group-visible passenger lists.
- Test simultaneous bookings and failure scenarios.

### Phase 5: Polish and reliability
- Add in-app notifications.
- Complete administrator tools.
- Improve accessibility and mobile usability.
- Test security and access controls.
- Add automated tests for critical user workflows.
- Document setup, migrations, configuration, and deployment.

## 15. Acceptance criteria

The first complete release must satisfy the following:

- Registration requires a valid invitation created by an administrator.
- Private content is inaccessible to unauthorised users.
- Members can create, edit, and delete their own posts.
- Feed filters and search work correctly.
- Upcoming events appear in the homepage sidebar.
- Event RSVPs respect capacity limits.
- Any supported post can optionally enable ride coordination.
- Multiple members can offer rides for the same post.
- Members can automatically reserve available seats.
- Passenger lists are visible to all authorised group members.
- Partner bookings are authorised and correctly attributed.
- No ride exceeds its passenger capacity, even under simultaneous booking attempts.
- Duplicate active passenger reservations are prevented.
- Cancellation and ride-switching behaviour preserve data integrity.
- Photo uploads and private storage access are secure.
- Critical workflows have automated tests.
- The interface is responsive and follows the Gregslist design system.
- The repository includes clear setup and deployment documentation.

## 16. Instructions to Codex

Treat this brief as the source of truth for product requirements.

First inspect the existing repository. Do not overwrite working code or configuration without understanding it.

Before substantial implementation, propose:
1. Application architecture and directory structure.
2. Database schema and relationships.
3. Authentication and invitation flow.
4. RLS and storage security policies.
5. Homepage layout and reusable components.
6. Ride-booking transaction design.
7. Test strategy and implementation milestones.

Identify unresolved technical ambiguities before committing to decisions that affect data structure, privacy, or user workflows.

Implement in small phases. Verify each phase before proceeding, and keep the application runnable throughout development.

Prefer maintainable, straightforward solutions over unnecessary abstractions. Do not introduce public registration, engagement-focused social features, unrelated services, or unrequested functionality.

Do not claim a feature is complete until its critical workflow and security requirements have been tested.