-- Erasure removes authored personal text without rewriting a completed event's historical lifecycle. Active arrangements still close atomically.
create or replace function public.prepare_account_erasure(target_user uuid) returns void language plpgsql security definer set search_path='' as $$
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
  update public.events set status=case when status='completed' then 'completed' else 'cancelled' end,location='Details removed' where post_id=parent;
  update public.posts set title='Deleted post',description='This content was removed by its author.',availability='',conditions='',location='',status=case when post_type='event' and status in ('completed','archived') then status when post_type='event' then 'cancelled' else 'archived' end,ride_coordination_enabled=false,updated_at=clock_timestamp() where id=parent;
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
