-- PostgreSQL requires enum additions to commit before using the new values.
alter type public.member_status add value if not exists 'suspended';
alter type public.member_status add value if not exists 'removed';
