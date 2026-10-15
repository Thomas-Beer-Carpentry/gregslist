-- The profile/Auth FK is deliberately separated for retained erased profiles.
-- Preserve the former FK's access guarantee for operator-side Auth deletion as
-- well: stale JWTs cannot inherit an active membership without an Auth identity.
create function private.auth_identity_cleanup() returns trigger language plpgsql security definer set search_path='' as $$
declare member public.memberships; system_actor uuid;
begin
 perform pg_catalog.pg_advisory_xact_lock(71404,1);
 select * into member from public.memberships where user_id=old.id for update;
 if member.user_id is null then return old; end if;
 if member.role='admin' and member.status='active' and not exists(select 1 from public.memberships where user_id<>old.id and status='active' and role='admin') then raise exception 'The final active administrator cannot be deleted'; end if;
 select user_id into system_actor from private.erasure_actor;
 update public.memberships set status='removed',revoked_at=clock_timestamp(),status_changed_at=clock_timestamp() where user_id=old.id;
 perform private.close_member_arrangements(old.id,system_actor);
 delete from public.memberships where user_id=old.id;
 return old;
end $$;
revoke all on function private.auth_identity_cleanup() from public,anon,authenticated;
create trigger identity_membership_cleanup before delete on auth.users for each row execute function private.auth_identity_cleanup();
