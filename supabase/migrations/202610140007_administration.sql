-- Phase 5 extends the existing identity and membership model. Administrative
-- writes share Phase 4's lock so suspension, partner consent and transport cannot
-- race. No content, identities or historical bookings are deleted.
alter table public.profiles add column bio text not null default '' check(length(bio)<=300);
alter table public.profiles add constraint profile_name_nonblank check(length(trim(display_name))>0) not valid;
grant update(bio) on public.profiles to authenticated;
alter table public.memberships add column status_changed_at timestamptz, add column role_changed_at timestamptz;
alter table public.invitations add column token_hash text check(token_hash ~ '^[0-9a-f]{64}$'), add column delivery text not null default 'email' check(delivery in ('email','copy'));
-- Legacy email invitations keep working. Only newly issued copy links require
-- their application token in addition to Supabase's verified email identity.
revoke select on public.invitations from authenticated;
grant select(id,email,issued_by,created_at,expires_at,revoked_at,redeemed_at,redeemed_by,delivery) on public.invitations to authenticated;

create table public.admin_audit(
 id uuid primary key default gen_random_uuid(),
 action text not null check(action in ('invitation_created','invitation_revoked','invitation_redeemed','member_suspended','member_reactivated','member_removed','administrator_granted','administrator_revoked')),
 actor_id uuid references public.profiles(id) on delete set null,
 administrator_id uuid references public.profiles(id) on delete set null,
 target_member_id uuid references public.profiles(id) on delete set null,
 target_invitation_id uuid references public.invitations(id) on delete set null,
 actor_name text,
 target_name text,
 details jsonb not null default '{}' check(jsonb_typeof(details)='object'),
 created_at timestamptz not null default clock_timestamp()
);
create index admin_history_date on public.admin_audit(created_at desc,id desc);
create index admin_history_member on public.admin_audit(target_member_id,created_at);
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from public,anon,authenticated;
grant select on public.admin_audit to authenticated;
create policy admin_history_read on public.admin_audit for select to authenticated using(private.is_admin());

create function private.admin_lock() returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.transport_lock();
 -- Checking AFTER the lock is essential: another admin may have demoted us.
 if not private.is_admin() then raise exception 'Administrator access required'; end if;
end $$;
create function private.admin_record(event_action text, member_id uuid default null, invitation_id uuid default null, safe_details jsonb default '{}', issuer uuid default null) returns void language sql security definer set search_path='' as $$
 insert into public.admin_audit(action,actor_id,administrator_id,target_member_id,target_invitation_id,actor_name,target_name,details)
 select event_action,auth.uid(),coalesce(issuer,auth.uid()),member_id,invitation_id,
 (select display_name from public.profiles where id=auth.uid()),
 (select display_name from public.profiles where id=member_id),safe_details;
$$;
create function private.protect_last_admin() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.role='admin' and old.status='active' and (tg_op='DELETE' or new.role<>'admin' or new.status<>'active') then
  perform pg_catalog.pg_advisory_xact_lock(71404,1);
  if not exists(select 1 from public.memberships where role='admin' and status='active') then
   raise exception 'The final active administrator cannot be removed, suspended or demoted';
  end if;
 end if;
 return null;
end $$;
create constraint trigger last_active_admin after update or delete on public.memberships deferrable initially deferred for each row execute function private.protect_last_admin();

create function public.member_directory(search_query text default '') returns table(display_name text,bio text,joined_at timestamptz) language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_member() then raise exception 'Active membership required'; end if;
 return query select p.display_name,p.bio,m.joined_at from public.profiles p join public.memberships m on m.user_id=p.id
 where m.status='active' and position(lower(left(trim(coalesce(search_query,'')),80)) in lower(p.display_name))>0 order by lower(p.display_name),p.id limit 100;
end $$;
create function public.admin_members(search_query text default '') returns table(user_id uuid,display_name text,bio text,email text,role public.member_role,status public.member_status,joined_at timestamptz,status_changed_at timestamptz) language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'Administrator access required'; end if;
 return query select m.user_id,p.display_name,p.bio,u.email::text,m.role,m.status,m.joined_at,m.status_changed_at
 from public.memberships m join public.profiles p on p.id=m.user_id join auth.users u on u.id=m.user_id
 where position(lower(left(trim(coalesce(search_query,'')),80)) in lower(p.display_name||' '||coalesce(u.email,'')))>0
 order by lower(p.display_name),p.id limit 100;
end $$;

create function public.create_member_invitation(target_email text,delivery text default 'copy') returns jsonb language plpgsql security definer set search_path='' as $$
declare normalized text:=lower(trim(target_email)); secret text; invitation public.invitations;
begin
 perform private.admin_lock();
 if normalized is null or length(normalized)>254 or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address'; end if;
 if delivery is null or delivery not in ('email','copy') then raise exception 'Invalid invitation delivery'; end if;
 if exists(select 1 from auth.users u join public.memberships m on m.user_id=u.id where lower(u.email)=normalized) then raise exception 'Membership already exists; manage access instead'; end if;
 update public.invitations set revoked_at=clock_timestamp() where lower(email)=normalized and redeemed_at is null and revoked_at is null and expires_at<=now();
 secret:=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.invitations(email,issued_by,token_hash,delivery) values(normalized,auth.uid(),encode(extensions.digest(secret,'sha256'),'hex'),delivery) returning * into invitation;
 perform private.admin_record('invitation_created',null,invitation.id,jsonb_build_object('email',normalized,'delivery',delivery));
 -- Only this administrator-only operation returns the new secret, once.
 return jsonb_build_object('id',invitation.id,'token',secret,'expires_at',invitation.expires_at);
end $$;
create or replace function public.issue_invitation(target_email text) returns uuid language plpgsql security definer set search_path='' as $$
begin return (public.create_member_invitation(target_email,'email')->>'id')::uuid; end $$;
create or replace function public.revoke_invitation(invitation_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare invitation public.invitations;
begin
 perform private.admin_lock();
 select * into invitation from public.invitations where id=invitation_id for update;
 if invitation.id is null then raise exception 'Invitation not found'; end if;
 if invitation.redeemed_at is not null then raise exception 'Invitation already accepted'; end if;
 if invitation.revoked_at is not null then return; end if;
 update public.invitations set revoked_at=clock_timestamp() where id=invitation.id;
 perform private.admin_record('invitation_revoked',null,invitation.id,jsonb_build_object('email',invitation.email));
end $$;

-- The helper is never callable by a client. Both activation paths lock the same
-- invitation and membership namespace; identity comes from auth.uid(), not input.
create function private.redeem_invitation(invitation public.invitations,account auth.users) returns void language plpgsql security definer set search_path='' as $$
begin
 if account.id is null or account.email_confirmed_at is null or lower(account.email) is distinct from lower(invitation.email) then raise exception 'Verify the intended email address before accepting'; end if;
 if invitation.id is null then raise exception 'Invitation invalid'; end if;
 if invitation.revoked_at is not null then raise exception 'Invitation revoked'; end if;
 if invitation.redeemed_at is not null then raise exception 'Invitation already used'; end if;
 if invitation.expires_at<=now() then raise exception 'Invitation expired'; end if;
 if exists(select 1 from public.memberships where user_id=account.id) then raise exception 'Membership already exists; contact an administrator'; end if;
 insert into public.profiles(id,display_name) values(account.id,left(coalesce(nullif(trim(account.raw_user_meta_data->>'display_name'),''),split_part(account.email,'@',1)),80)) on conflict(id) do nothing;
 insert into public.memberships(user_id) values(account.id);
 update public.invitations set redeemed_at=clock_timestamp(),redeemed_by=account.id where id=invitation.id;
 perform private.admin_record('invitation_redeemed',account.id,invitation.id,jsonb_build_object('email',invitation.email),invitation.issued_by);
end $$;
create function public.accept_member_invitation(target_invitation uuid,raw_token text) returns void language plpgsql security definer set search_path='' as $$
declare invitation public.invitations; account auth.users;
begin
 if auth.uid() is null then raise exception 'Sign in and verify your email first'; end if;
 perform pg_catalog.pg_advisory_xact_lock(71404,1);
 select * into account from auth.users where id=auth.uid();
 select * into invitation from public.invitations where id=target_invitation for update;
 if raw_token is null or length(raw_token)<>64 or invitation.token_hash is null or invitation.token_hash<>encode(extensions.digest(raw_token,'sha256'),'hex') then raise exception 'Invitation invalid'; end if;
 if invitation.redeemed_by=auth.uid() and invitation.redeemed_at is not null and account.email_confirmed_at is not null and lower(account.email)=lower(invitation.email) and private.is_member() then return; end if;
 perform private.redeem_invitation(invitation,account);
end $$;
create or replace function public.activate_membership() returns void language plpgsql security definer set search_path='' as $$
declare invitation public.invitations; account auth.users;
begin
 if auth.uid() is null then raise exception 'Verified invitation required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(71404,1);
 select * into account from auth.users where id=auth.uid();
 select * into invitation from public.invitations where lower(email)=lower(account.email) and delivery='email' order by created_at desc limit 1 for update;
 perform private.redeem_invitation(invitation,account);
end $$;
-- Server-only mail initiation validates the copy secret without exposing auth
-- account existence to browsers or permitting an unverified membership.
create function public.invitation_verification(target_invitation uuid,raw_token text,intended_email text) returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation public.invitations; account auth.users;
begin
 select * into invitation from public.invitations where id=target_invitation;
 if invitation.id is null or raw_token is null or length(raw_token)<>64 or invitation.token_hash is null or invitation.token_hash<>encode(extensions.digest(raw_token,'sha256'),'hex') or lower(trim(intended_email)) is distinct from lower(invitation.email) or invitation.revoked_at is not null or invitation.redeemed_at is not null or invitation.expires_at<=now() then raise exception 'Invitation invalid, expired or unavailable'; end if;
 select * into account from auth.users where lower(email)=lower(invitation.email);
 if exists(select 1 from public.memberships where user_id=account.id) then raise exception 'Membership already exists; contact an administrator'; end if;
 return jsonb_build_object('email',invitation.email,'account_exists',account.id is not null,'account_confirmed',account.email_confirmed_at is not null);
end $$;

create function public.set_member_role(target_user uuid,new_role text) returns void language plpgsql security definer set search_path='' as $$
declare previous public.memberships;
begin
 perform private.admin_lock();
 if new_role is null or new_role not in ('member','admin') then raise exception 'Invalid member role'; end if;
 select * into previous from public.memberships where user_id=target_user for update;
 if previous.user_id is null then raise exception 'Member not found'; end if;
 if previous.role::text=new_role then return; end if;
 if new_role='admin' and previous.status<>'active' then raise exception 'Only active members can become administrators'; end if;
 if previous.role='admin' and previous.status='active' and not exists(select 1 from public.memberships where status='active' and role='admin' and user_id<>target_user) then raise exception 'The final active administrator cannot be demoted'; end if;
 update public.memberships set role=new_role::public.member_role,role_changed_at=clock_timestamp() where user_id=target_user;
 perform private.admin_record(case when new_role='admin' then 'administrator_granted' else 'administrator_revoked' end,target_user,null,jsonb_build_object('previous_role',previous.role,'role',new_role));
end $$;

create function public.set_member_status(target_user uuid,new_status text) returns void language plpgsql security definer set search_path='' as $$
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
  update public.ride_reservations set status='cancelled',status_reason='event_cancelled',modified_by=auth.uid(),updated_at=clock_timestamp() where post_id=parent and status in ('confirmed','needs_arrangement');
  perform private.transport_notice(affected,parent,'event_cancelled','Event cancelled because the organiser is no longer available. Please check your plans and transport.');
 end loop;

 -- Preserve Phase 4's driver, passenger and consent lifecycle.
 for parent in select distinct post_id from (select post_id from public.ride_offers where driver_id=target_user and status='open' union select post_id from public.ride_reservations where passenger_id=target_user and status in('confirmed','needs_arrangement')) q order by post_id loop
  perform 1 from public.posts where id=parent for update;
  for ride in select * from public.ride_offers where post_id=parent and driver_id=target_user and status='open' loop
   select array_agg(passenger_id) into affected from public.ride_reservations where ride_id=ride.id and status='confirmed';
   update public.ride_offers set status='withdrawn',updated_at=clock_timestamp() where id=ride.id;
   update public.ride_reservations set status='needs_arrangement',status_reason='driver_membership_revoked',modified_by=auth.uid(),updated_at=clock_timestamp() where ride_id=ride.id and status='confirmed';
   perform private.transport_notice(affected,parent,'ride_withdrawn','Ride unavailable. Please arrange alternative transport.');
  end loop;
  select array_agg(distinct o.driver_id) into affected from public.ride_reservations r join public.ride_offers o on o.id=r.ride_id where r.post_id=parent and r.passenger_id=target_user and r.status='confirmed';
  update public.ride_reservations set status='cancelled',status_reason='passenger_membership_revoked',modified_by=auth.uid(),updated_at=clock_timestamp() where post_id=parent and passenger_id=target_user and status in('confirmed','needs_arrangement');
  perform private.transport_notice(affected,parent,'ride_booking_cancelled','A passenger reservation was cancelled. Seat availability has been updated.');
 end loop;
 for link_id in select id from public.partner_relationships where target_user in(user_a,user_b) and status in('pending','confirmed') loop
  delete from public.partner_participants where relationship_id=link_id;
  update public.partner_relationships set status='revoked',revoked_at=clock_timestamp() where id=link_id;
 end loop;
 perform private.admin_record(case when new_status='suspended' then 'member_suspended' else 'member_removed' end,target_user,null,jsonb_build_object('previous_status',previous.status,'status',new_status));
end $$;
create or replace function public.revoke_membership(target_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin perform public.set_member_status(target_user,'removed'); end $$;

revoke all on function private.admin_lock(),private.admin_record(text,uuid,uuid,jsonb,uuid),private.protect_last_admin(),private.redeem_invitation(public.invitations,auth.users) from public,anon,authenticated;
revoke all on function public.member_directory(text),public.admin_members(text),public.create_member_invitation(text,text),public.accept_member_invitation(uuid,text),public.set_member_role(uuid,text),public.set_member_status(uuid,text) from public,anon,authenticated;
grant execute on function public.member_directory(text),public.admin_members(text),public.create_member_invitation(text,text),public.accept_member_invitation(uuid,text),public.set_member_role(uuid,text),public.set_member_status(uuid,text) to authenticated;
revoke all on function public.invitation_verification(uuid,text,text) from public,anon,authenticated;
grant execute on function public.invitation_verification(uuid,text,text) to service_role;
