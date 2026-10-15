-- Explicitly requested immediate erasure. Retain only scrubbed arrangement and
-- audit records for at most twelve months; account deletion is not suspension.
-- Auth identity is checked explicitly in RLS so a deleted Auth user's old JWT
-- cannot regain access even after privileged operator deletion.
create or replace function private.is_member() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m join auth.users u on u.id=m.user_id where m.user_id=(select auth.uid()) and m.status='active');
$$;
create or replace function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m join auth.users u on u.id=m.user_id where m.user_id=(select auth.uid()) and m.status='active' and m.role='admin');
$$;
-- Profiles of erased accounts must outlive Auth until references expire. They
-- contain only a former-member label and an unlinkable-to-login pseudonym.
alter table public.profiles drop constraint profiles_id_fkey;
alter table public.profiles add column erased_at timestamptz;
create table private.erasure_actor(user_id uuid primary key references public.profiles(id));
insert into public.profiles(id,display_name) values(gen_random_uuid(),'Former member');
insert into private.erasure_actor select id from public.profiles where display_name='Former member' and not exists(select 1 from auth.users where auth.users.id=public.profiles.id) order by created_at desc limit 1;
revoke all on private.erasure_actor from public,anon,authenticated;
create table public.account_erasure_jobs(
 user_id uuid primary key references public.profiles(id) on delete cascade,
 erased_at timestamptz not null default clock_timestamp(),
 retention_due_at timestamptz not null default now()+interval '12 months',
 photo_paths text[] not null default '{}',
 auth_deleted_at timestamptz,
 storage_deleted_at timestamptz,
 last_error text check(last_error in ('auth_delete_retry','storage_delete_retry'))
);
alter table public.account_erasure_jobs enable row level security;
revoke all on public.account_erasure_jobs from public,anon,authenticated;
grant all on public.account_erasure_jobs to service_role;
create index erasure_cleanup_due on public.account_erasure_jobs(retention_due_at);
create or replace function private.transport_notice(recipients uuid[], target_post uuid, notice_kind text, notice text) returns void language sql security definer set search_path='' as $$
 insert into public.notifications(recipient_id,post_id,kind,message)
 select distinct m.user_id,target_post,notice_kind,notice from public.memberships m
 where m.user_id=any(recipients) and m.status='active' and m.user_id is distinct from auth.uid();
$$;
create function private.close_member_arrangements(target_user uuid,change_actor uuid) returns void language plpgsql security definer set search_path='' as $$
declare parent uuid; ride public.ride_offers; affected uuid[]; link_id uuid;
begin
 update public.event_rsvps set cancelled_at=clock_timestamp(),cancellation_reason='membership_revoked',updated_at=clock_timestamp() where user_id=target_user and cancelled_at is null;

 -- Responsibility policy: cancel upcoming/ongoing scheduled events, preserving
 -- their details, RSVPs, rides and reservation history. Past events stay intact.
 for parent in select e.post_id from public.events e join public.posts p on p.id=e.post_id
  where e.organiser_id=target_user and e.status='scheduled' and p.status='open' and coalesce(e.ends_at,e.starts_at)>now() order by e.post_id loop
  perform 1 from public.posts where id=parent for update;
  select array_agg(distinct recipient) into affected from (
   select user_id as recipient from public.event_rsvps where event_id=parent and cancelled_at is null and response in ('going','maybe')
   union select driver_id from public.ride_offers where post_id=parent and status='open'
   union select passenger_id from public.ride_reservations where post_id=parent and status in ('confirmed','needs_arrangement')
  ) recipients;
  update public.posts set status='cancelled',updated_at=clock_timestamp() where id=parent;
  update public.events set status='cancelled' where post_id=parent;
  update public.event_rsvps set cancelled_at=clock_timestamp(),cancellation_reason='event_cancelled',updated_at=clock_timestamp() where event_id=parent and cancelled_at is null;
  update public.ride_offers set status='cancelled',updated_at=clock_timestamp() where post_id=parent and status='open';
  update public.ride_reservations set status='cancelled',status_reason='event_cancelled',modified_by=change_actor,updated_at=clock_timestamp() where post_id=parent and status in ('confirmed','needs_arrangement');
  perform private.transport_notice(affected,parent,'event_cancelled','Event cancelled because the organiser is no longer available. Please check your plans and transport.');
 end loop;

 -- Preserve Phase 4's driver, passenger and consent lifecycle.
 for parent in select distinct post_id from (select post_id from public.ride_offers where driver_id=target_user and status='open' union select post_id from public.ride_reservations where passenger_id=target_user and status in('confirmed','needs_arrangement')) q order by post_id loop
  perform 1 from public.posts where id=parent for update;
  for ride in select * from public.ride_offers where post_id=parent and driver_id=target_user and status='open' loop
   select array_agg(passenger_id) into affected from public.ride_reservations where ride_id=ride.id and status='confirmed';
   update public.ride_offers set status='withdrawn',updated_at=clock_timestamp() where id=ride.id;
   update public.ride_reservations set status='needs_arrangement',status_reason='driver_membership_revoked',modified_by=change_actor,updated_at=clock_timestamp() where ride_id=ride.id and status='confirmed';
   perform private.transport_notice(affected,parent,'ride_withdrawn','Ride unavailable. Please arrange alternative transport.');
  end loop;
  select array_agg(distinct o.driver_id) into affected from public.ride_reservations r join public.ride_offers o on o.id=r.ride_id where r.post_id=parent and r.passenger_id=target_user and r.status='confirmed';
  update public.ride_reservations set status='cancelled',status_reason='passenger_membership_revoked',modified_by=change_actor,updated_at=clock_timestamp() where post_id=parent and passenger_id=target_user and status in('confirmed','needs_arrangement');
  perform private.transport_notice(affected,parent,'ride_booking_cancelled','A passenger reservation was cancelled. Seat availability has been updated.');
 end loop;
 for link_id in select id from public.partner_relationships where target_user in(user_a,user_b) and status in('pending','confirmed') loop
  delete from public.partner_participants where relationship_id=link_id;
  update public.partner_relationships set status='revoked',revoked_at=clock_timestamp() where id=link_id;
 end loop;
end $$;
create or replace function public.set_member_status(target_user uuid,new_status text) returns void language plpgsql security definer set search_path='' as $$
declare previous public.memberships; parent uuid; ride public.ride_offers; affected uuid[]; link_id uuid;
begin
 perform private.admin_lock();
 if new_status is null or new_status not in ('active','suspended','removed') then raise exception 'Invalid membership status'; end if;
 select * into previous from public.memberships where user_id=target_user for update;
 if previous.user_id is null then raise exception 'Member not found'; end if;
 if previous.status::text=new_status then return; end if;
 if previous.status in ('removed','revoked') then raise exception 'Removed membership cannot be reactivated; history is retained'; end if;
 if new_status='active' then
  if previous.status<>'suspended' then raise exception 'Only suspended members can be reactivated'; end if;
  update public.memberships set status='active',revoked_at=null,status_changed_at=clock_timestamp() where user_id=target_user;
  perform private.admin_record('member_reactivated',target_user,null,jsonb_build_object('previous_status',previous.status));
  return;
 end if;
 if previous.role='admin' and previous.status='active' and not exists(select 1 from public.memberships where role='admin' and status='active' and user_id<>target_user) then raise exception 'The final active administrator cannot be removed or suspended'; end if;
 if target_user=auth.uid() then raise exception 'Ask another administrator to change your community access'; end if;
 -- Deny access before cleanup; all changes become visible together at commit.
 update public.memberships set status=new_status::public.member_status,revoked_at=clock_timestamp(),status_changed_at=clock_timestamp() where user_id=target_user;
 perform private.close_member_arrangements(target_user,auth.uid());
 perform private.admin_record(case when new_status='suspended' then 'member_suspended' else 'member_removed' end,target_user,null,jsonb_build_object('previous_status',previous.status,'status',new_status));
end $$;

revoke all on function private.close_member_arrangements(uuid,uuid) from public,anon,authenticated;

-- Server-only: the HTTP operation reauthenticates the caller's password and
-- derives this ID from verified Auth, never from a request field.
create function public.prepare_account_erasure(target_user uuid) returns void language plpgsql security definer set search_path='' as $$
declare account auth.users; system_actor uuid; parent uuid; recipients uuid[]; invite_ids uuid[]; photo_paths text[];
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server-only erasure operation'; end if;
 perform pg_catalog.pg_advisory_xact_lock(71404,1);
 if exists(select 1 from public.account_erasure_jobs where user_id=target_user) then return; end if;
 select * into account from auth.users where id=target_user;
 if account.id is null then raise exception 'Account unavailable'; end if;
 perform 1 from public.memberships where user_id=target_user for update;
 if exists(select 1 from public.memberships where user_id=target_user and status='active' and role='admin') and not exists(select 1 from public.memberships where user_id<>target_user and status='active' and role='admin') then raise exception 'Transfer administrator responsibilities before deleting the final administrator'; end if;
 select user_id into system_actor from private.erasure_actor;
 insert into public.profiles(id,display_name) values(target_user,'Former member') on conflict(id) do nothing;
 update public.memberships set status='removed',revoked_at=clock_timestamp(),status_changed_at=clock_timestamp() where user_id=target_user;
 perform private.close_member_arrangements(target_user,system_actor);
 for parent in select id from public.posts where author_id=target_user order by id loop
  perform 1 from public.posts where id=parent for update;
  select array_agg(distinct person) into recipients from (
   select driver_id person from public.ride_offers where post_id=parent and status='open'
   union select passenger_id from public.ride_reservations where post_id=parent and status in ('confirmed','needs_arrangement')
   union select user_id from public.event_rsvps where event_id=parent and cancelled_at is null and response in ('going','maybe')
  ) affected;
  update public.ride_offers set status='cancelled',updated_at=clock_timestamp() where post_id=parent and status='open';
  update public.ride_reservations set status='cancelled',status_reason='author_account_deleted',modified_by=system_actor,updated_at=clock_timestamp() where post_id=parent and status in ('confirmed','needs_arrangement');
  update public.event_rsvps set cancelled_at=clock_timestamp(),cancellation_reason='event_cancelled',updated_at=clock_timestamp() where event_id=parent and cancelled_at is null;
  update public.events set status='cancelled',location='Details removed' where post_id=parent;
  update public.posts set title='Deleted post',description='This content was removed by its author.',availability='',conditions='',location='',status=case when post_type='event' then 'cancelled' else 'archived' end,ride_coordination_enabled=false,updated_at=clock_timestamp() where id=parent;
  update public.notifications set message='Associated content was removed by its author.',kind='content_removed' where post_id=parent;
  perform private.transport_notice(recipients,parent,'content_removed','Associated content was removed by its author. Active arrangements have been cancelled; check your plans.');
 end loop;
 select array_agg(object_path) into photo_paths from public.post_photos where uploader_id=target_user or post_id in(select id from public.posts where author_id=target_user);
 insert into public.photo_cleanup(object_path) select unnest(photo_paths) on conflict do nothing;
 delete from public.post_photos where uploader_id=target_user or post_id in(select id from public.posts where author_id=target_user);
 delete from public.comments where author_id=target_user;
 delete from public.saved_posts where user_id=target_user;
 delete from public.notifications where recipient_id=target_user;
 delete from public.event_rsvps where user_id=target_user;
 delete from public.partner_participants where relationship_id in(select id from public.partner_relationships where target_user in(user_a,user_b));
 delete from public.partner_relationships where target_user in(user_a,user_b);
 update public.ride_offers set pickup='Details removed',route='',return_details=null,return_available=false,return_departure_at=null,cost_notes=null,notes=null,contribution_amount=null where driver_id=target_user;
 update public.ride_reservations set created_by=case when created_by=target_user then system_actor else created_by end,modified_by=case when modified_by=target_user then system_actor else modified_by end where created_by=target_user or modified_by=target_user;
 update public.ride_reservation_history set actor_id=system_actor where actor_id=target_user;
 delete from public.transport_operations where actor_id=target_user or position(target_user::text in request::text)>0 or position(target_user::text in result::text)>0;
 select array_agg(id) into invite_ids from public.invitations where redeemed_by=target_user or lower(email)=lower(account.email);
 update public.invitations set email='erased-'||id::text||'@deleted.invalid',token_hash=null,revoked_at=coalesce(revoked_at,clock_timestamp()) where id=any(invite_ids);
 update public.admin_audit set actor_name=case when actor_id=target_user then 'Former member' else actor_name end,target_name=case when target_member_id=target_user then 'Former member' else target_name end,details=case when target_member_id=target_user or target_invitation_id=any(invite_ids) then details-'email' else details end where actor_id=target_user or administrator_id=target_user or target_member_id=target_user or target_invitation_id=any(invite_ids);
 update public.profiles set display_name='Former member',bio='',avatar_path=null,erased_at=clock_timestamp() where id=target_user;
 delete from public.memberships where user_id=target_user;
 insert into public.account_erasure_jobs(user_id,photo_paths) values(target_user,coalesce(photo_paths,'{}'));
 insert into public.admin_audit(action,actor_id,target_member_id,actor_name,target_name,details) values('member_removed',target_user,target_user,'Former member','Former member',jsonb_build_object('reason','account_erasure','retention_months',12));
end $$;
revoke all on function public.prepare_account_erasure(uuid) from public,anon,authenticated;
grant execute on function public.prepare_account_erasure(uuid) to service_role;

-- Expiry applies only to completed, explicitly requested account erasures.
-- An unresolved Storage/Auth failure prevents history purge and remains queued.
create function public.purge_expired_erasure_history() returns integer language plpgsql security definer set search_path='' as $$
declare target uuid; parent_ids uuid[]; ride_ids uuid[]; invite_ids uuid[]; purged integer:=0;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server-only retention operation'; end if;
 perform pg_catalog.pg_advisory_xact_lock(71404,1);
 for target in select user_id from public.account_erasure_jobs where retention_due_at<=now() and auth_deleted_at is not null and storage_deleted_at is not null order by user_id for update loop
  select array_agg(id) into parent_ids from public.posts where author_id=target;
  select array_agg(id) into ride_ids from public.ride_offers where driver_id=target or post_id=any(parent_ids);
  select array_agg(id) into invite_ids from public.invitations where issued_by=target or redeemed_by=target;
  delete from public.ride_reservation_history where passenger_id=target or actor_id=target or post_id=any(parent_ids) or reservation_id in(select id from public.ride_reservations where ride_id=any(ride_ids));
  delete from public.ride_reservations where passenger_id=target or ride_id=any(ride_ids) or post_id=any(parent_ids);
  delete from public.ride_offers where id=any(ride_ids);
  delete from public.event_rsvps where user_id=target or event_id=any(parent_ids);
  delete from public.comments where author_id=target or post_id=any(parent_ids);
  delete from public.saved_posts where user_id=target or post_id=any(parent_ids);
  delete from public.notifications where recipient_id=target or post_id=any(parent_ids);
  delete from public.post_photos where uploader_id=target or post_id=any(parent_ids);
  delete from public.events where organiser_id=target or post_id=any(parent_ids);
  delete from public.posts where id=any(parent_ids);
  delete from public.admin_audit where actor_id=target or administrator_id=target or target_member_id=target or target_invitation_id=any(invite_ids);
  delete from public.invitations where id=any(invite_ids);
  delete from public.transport_operations where actor_id=target or position(target::text in request::text)>0 or position(target::text in result::text)>0;
  delete from public.memberships where user_id=target;
  delete from public.profiles where id=target;
  purged:=purged+1;
 end loop;
 return purged;
end $$;
revoke all on function public.purge_expired_erasure_history() from public,anon,authenticated;
grant execute on function public.purge_expired_erasure_history() to service_role;
