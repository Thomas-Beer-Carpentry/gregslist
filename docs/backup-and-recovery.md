# Backup and recovery

Gregslist stores accounts in Supabase Auth, community records in PostgreSQL, and photo bytes in the private `community-photos` Storage bucket. Database backups and Storage file backups are separate responsibilities. Nothing in this document establishes that a hosted backup schedule, point-in-time recovery, Storage backup, or external recovery destination is configured.

## Before a controlled launch

A trusted operator should record the Supabase project and plan, available database-backup retention, whether point-in-time recovery is enabled, the last successful backup, and a tested recovery destination. Verify these in the hosted project's dashboard and current Supabase documentation; availability and retention depend on the project's plan and configuration. Set recovery-time and acceptable-data-loss targets with the community owner.

Choose an encrypted backup destination with restricted operator access. Database exports can include emails, password hashes, session data, invitation hashes, private posts, partner records and administrative history. Treat exports as privileged secrets. Never put them in Git, public artifacts, CI logs, chat, or a browser download route. Keep credentials outside command-line arguments and shell history, and use a protected credential mechanism or password prompt. Restrict filesystem permissions before creating backup files. Record backup identifiers, checksums, time, schema/migration version, operator and restore-test result without copying private content into the record.

## Database and Storage backups

Use verified Supabase-managed database backups/PITR where available. If an additional operator-controlled logical export is needed, follow the current Supabase CLI/database backup guidance and preserve schema, data, roles/grants, RLS policies, functions, constraints and migration history. Auth and Storage are Supabase-managed schemas: review the provider's supported export/restore procedure and ownership requirements before including them. A generic application-schema-only dump is insufficient to recover the whole service.

Back up Storage **object bytes** separately through a supported private Storage/S3 transfer. A database dump contains Storage metadata, not the photo files themselves. Preserve bucket settings, object keys and relevant metadata with the bytes; keep the backup private. Verify access and checksums in the recovery destination. Check any local cleanup queue before reconciliation: files removed from the database must not become readable merely because an older file backup contains them.

Back up deployment/environment configuration through an approved secrets manager or the hosting provider's protected configuration mechanisms. Record non-secret SMTP/template/redirect settings and exact migration versions. Rotation and restoration of signing keys or service credentials require a deliberate operator plan; copying a project to a different environment does not justify exposing or reusing its production secrets.

## Local rehearsal

Run `npm run test:migrations` after local Supabase is started and the current source is available. The script requires local Docker access. It reads only Auth/Storage **schema definitions** from the project's fixed local PostgreSQL container, creates two generated temporary databases, and applies every application migration in filename order. Each file commits separately, including the membership-status enum migration before its consumers.

The rehearsal runs the repository's database assertions against the clean schema, creates synthetic accounts/content/invitations/events/partners/rides, then exports and restores only that disposable dataset into the second database. It compares every row, history/audit value, relevant grants, RLS and private-bucket metadata, and retries actual protected operations and capacity violations after restore. Both temporary databases are removed even on ordinary failures. No existing Auth, Storage or community rows are copied, and no real backup file or credential is written or printed. If the process is forcibly killed or Docker disappears, an operator should list leftover databases with the strict `gregslist_phase6_clean_` / `gregslist_phase6_restore_` prefixes, confirm they belong to the rehearsal, and remove only those generated databases.

This proves the application migrations and PostgreSQL recovery path with synthetic data. It does not prove hosted PITR, hosted operational-role ownership, email delivery, Supabase Auth service configuration, real photo-byte recovery, or a production-scale recovery time. Keep those items separate in launch evidence.

## Restore procedure

1. Identify the incident and stop writes through a controlled maintenance/deployment procedure. Preserve the incident state and logs privately. Decide whether rollback, a corrective migration, selective repair, or full recovery best preserves valid newer changes.
2. Choose the intended recovery point and verify backup integrity, completeness, available Storage bytes and migration/application compatibility. Take an additional protected snapshot of the current state before a potentially destructive repair, where feasible.
3. Restore first into an isolated, non-production project/database using the provider's supported process. Never test a restore over the only live copy. Disable outgoing email/integrations and public access in that environment so restored account/session data cannot contact members or become exposed.
4. Restore database schemas/data/permissions and Storage bytes/metadata consistently. Configure environment-specific Auth URLs, exact redirect allowlists, private buckets, templates and SMTP deliberately. Do not enable public registration. Invalidate or rotate sessions/credentials when the incident or project boundary requires it.
5. Verify row counts and relevant histories; run database/RLS/concurrency checks, migration checks and representative browser journeys. Verify the final active administrator, member restrictions, invitation expiry/revocation, booking uniqueness/capacity, partner consent, private media, and required notifications. Use controlled test accounts; never replay member actions against production merely as a test.
6. Obtain the operator's explicit production-change approval for the concrete recovery/cutover. Document expected downtime and rollback point, apply the reviewed procedure, and verify access and critical journeys again. Retain the incident backup securely for the agreed retention period.

## Failed deployments and migrations

The application uses additive migrations and does not supply automatic destructive down migrations. Record which migration files actually committed. An enum extension and its consumers intentionally use separate transactions. If one file fails, PostgreSQL rolls back that file's transaction; earlier committed files remain. Inspect the resulting schema and migration ledger before retrying. Do not mark a failed migration as applied without verifying its effects.

Prefer a reviewed forward correction that preserves existing rows and historical reservations. A previous application release may be redeployed only after checking it is compatible with the current database and Auth configuration. If an incompatible change or damaged data requires backup recovery, follow the isolated restore procedure above rather than blindly dropping columns/tables or resetting the database. `npm run db:reset` is for disposable local development, never production recovery.

## Accidental administrator changes

Normal APIs and a deferred database constraint prevent the loss of the final active administrator. A remaining active administrator can correct another active member's role and reactivate a suspended member through the existing admin tools; those actions are audited. Reactivation deliberately does not revive closed events, rides, bookings or partner links. Removed membership is retained and terminal through application APIs; it must not be silently reactivated as a substitute for recovery.

If all trusted administrators are inaccessible despite intact records, a verified project owner must use the Supabase operator console or another protected database connection to inspect the situation. Authenticate the intended operator-controlled account through Supabase Auth first, confirm its identity, and repair the minimal profile/membership role/status needed to restore administration in one reviewed transaction. Use the existing account where appropriate; never create a public bootstrap endpoint or expose service credentials in a browser. Do not disable final-admin constraints or RLS. Preserve an operator incident record with the reason and affected identity; out-of-band SQL changes are not automatically recorded by the application admin RPC audit.

Recovery of access does not establish a right to erase or restore somebody's personal data. Follow the separately agreed deletion/retention policy, including the treatment of backups, and do not claim immediate erasure from historical backup copies.
