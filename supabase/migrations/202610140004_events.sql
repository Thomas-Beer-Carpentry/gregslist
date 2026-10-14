-- Phase 3: shared parent-post lock serializes RSVP, capacity and lifecycle changes.
alter table public.posts drop constraint posts_status_check;
alter table public.posts add constraint posts_status_check check(status in ('open','fulfilled','cancelled','completed','archived'));
-- Phase 2 allowed Fulfilled on events; preserve those records as Completed.
update public.posts set status='completed' where post_type='event' and status='fulfilled';
update public.events e set status='completed' from public.posts p where p.id=e.post_id and p.status='completed';
-- Flush consistency triggers from legacy conversion before altering the table.
set constraints public.post_event_consistency,public.event_post_consistency immediate;
alter table public.posts add constraint event_status_types check((status<>'completed' or post_type='event') and (post_type<>'event' or status<>'fulfilled'));
set constraints public.post_event_consistency,public.event_post_consistency deferred;
alter table public.event_rsvps add column created_at timestamptz not null default now();
alter table public.event_rsvps add column updated_at timestamptz not null default now();
alter table public.event_rsvps add column cancelled_at timestamptz;
alter table public.event_rsvps add column cancellation_reason text check(cancellation_reason in ('event_cancelled','membership_revoked'));
alter table public.event_rsvps add constraint cancellation_pair check((cancelled_at is null)=(cancellation_reason is null));
alter table public.notifications add column message text not null default '';
create index notifications_recipient_date on public.notifications(recipient_id,created_at desc,id desc);

create function private.going_count(target_event uuid) returns integer language sql stable security definer set search_path='' as $$
 select count(*)::integer from public.event_rsvps r join public.memberships m on m.user_id=r.user_id and m.status='active' where r.event_id=target_event and r.response='going' and r.cancelled_at is null;
$$;
revoke all on function private.going_count(uuid) from public,anon,authenticated;

create function public.set_event_rsvp(target_event uuid, chosen_response text) returns void
language plpgsql security definer set search_path='' as $$
declare parent public.posts; event public.events; occupied integer;
begin
 -- Membership lock prevents a revoked account from racing a fresh RSVP.
 perform 1 from public.memberships where user_id=auth.uid() and status='active' for share;
 if not found then raise exception 'Active membership required'; end if;
 if chosen_response is null or chosen_response not in ('going','maybe','not_going') then raise exception 'Invalid RSVP response'; end if;
 select * into parent from public.posts where id=target_event for update;
 select * into event from public.events where post_id=target_event for update;
 if event.post_id is null or parent.post_type<>'event' then raise exception 'Event unavailable'; end if;
 if parent.status<>'open' or event.status<>'scheduled' then raise exception 'RSVPs are closed for this event'; end if;
 if event.starts_at<=now() and chosen_response<>'not_going' then raise exception 'RSVPs are closed because this event has started'; end if;
 if chosen_response='going' and event.capacity is not null then
  select count(*) into occupied from public.event_rsvps r join public.memberships m on m.user_id=r.user_id and m.status='active'
  where r.event_id=target_event and r.response='going' and r.cancelled_at is null and r.user_id<>auth.uid();
  if occupied>=event.capacity then raise exception 'This event is full. Your previous response has been kept'; end if;
 end if;
 insert into public.event_rsvps(event_id,user_id,response) values(target_event,auth.uid(),chosen_response)
 on conflict(event_id,user_id) do update set response=excluded.response,updated_at=clock_timestamp(),cancelled_at=null,cancellation_reason=null;
end $$;

create function public.event_attendance(target_event uuid) returns table(user_id uuid,display_name text,response text,updated_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_member() then raise exception 'Active membership required'; end if;
 if not exists(select 1 from public.events where post_id=target_event) then raise exception 'Event unavailable'; end if;
 return query select r.user_id,p.display_name,r.response,r.updated_at from public.event_rsvps r
 join public.memberships m on m.user_id=r.user_id and m.status='active'
 join public.profiles p on p.id=r.user_id
 where r.event_id=target_event and r.cancelled_at is null order by r.created_at,r.user_id;
end $$;

create or replace function public.write_post(target_id uuid, content jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare
 actor uuid := auth.uid(); result uuid; existing public.posts; old_event public.events;
 kind text := content->>'post_type'; state text := coalesce(content->>'status','open');
 category uuid := (content->>'category_id')::uuid;
 start_time timestamptz; end_time timestamptz; zone text; limit_seats integer; lifecycle text;
 notice_kind text; recipients uuid[]; event_changed boolean := false;
begin
 if not private.is_member() then raise exception 'Active membership required'; end if;
 if jsonb_typeof(content)<>'object' or jsonb_typeof(content->'title')<>'string' or jsonb_typeof(content->'description')<>'string' or length(trim(content->>'title')) not between 1 and 160 or length(trim(content->>'description')) not between 1 and 20000 then raise exception 'Title and description are required'; end if;
 if kind is null or kind not in ('event','offer','request','trip','recommendation','announcement','discussion') then raise exception 'Invalid post type'; end if;
 if state not in ('open','fulfilled','cancelled','completed','archived') or (kind='event' and state='fulfilled') or (kind<>'event' and state='completed') then raise exception 'Invalid status'; end if;
 if target_id is not null then
  select * into existing from public.posts where id=target_id for update;
  if not found or existing.author_id<>actor then raise exception 'Only the author can edit this post'; end if;
  if kind<>existing.post_type then raise exception 'Post type cannot be changed'; end if;
  if kind='event' then select * into old_event from public.events where post_id=target_id for update; end if;
  if exists(select 1 from public.ride_offers where post_id=target_id) and not(kind='event' and state='cancelled') then raise exception 'Posts with ride arrangements require a coordinated update'; end if;
 end if;
 if category is null or not exists(select 1 from public.categories where id=category and (active or id=existing.category_id)) then raise exception 'Choose an active category'; end if;
 if kind='event' then
  start_time := (content->>'starts_at')::timestamptz;
  end_time := nullif(content->>'ends_at','')::timestamptz;
  zone := coalesce(content->>'timezone','Pacific/Auckland');
  limit_seats := case when content ? 'capacity' then nullif(content->>'capacity','')::integer else old_event.capacity end;
  if limit_seats is not null and limit_seats<1 then raise exception 'Capacity must be a positive whole number or unlimited'; end if;
  if start_time is null or not isfinite(start_time) or (end_time is not null and not isfinite(end_time)) or length(trim(coalesce(content->>'event_location',''))) not between 1 and 300 or not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) or (end_time is not null and end_time<=start_time) then raise exception 'Valid event dates, timezone and location are required'; end if;
  if old_event.status='completed' and state not in ('completed','archived') then raise exception 'Completed events cannot be reopened; create a new event'; end if;
  if state='archived' and coalesce(old_event.status,'scheduled')='scheduled' and coalesce(end_time,start_time)>now() then raise exception 'Cancel or complete an upcoming event before archiving'; end if;
  lifecycle := case state when 'open' then 'scheduled' when 'cancelled' then 'cancelled' when 'completed' then 'completed' else case when old_event.status='cancelled' then 'cancelled' else 'completed' end end;
  if state='cancelled' and target_id is not null and existing.status<>'cancelled' and not coalesce((content->>'confirm_cancel')::boolean,false) then raise exception 'Confirm event cancellation before saving'; end if;
  if target_id is not null and lifecycle<>'cancelled' and limit_seats is not null and limit_seats<private.going_count(target_id) then raise exception 'Capacity cannot be lower than the number already Going'; end if;
  if target_id is not null then
   event_changed := row(existing.title,existing.description,existing.status,old_event.starts_at,old_event.ends_at,old_event.timezone,old_event.location,old_event.capacity)
    is distinct from row(trim(content->>'title'),trim(content->>'description'),state,start_time,end_time,zone,trim(content->>'event_location'),limit_seats);
   if event_changed then
    select coalesce(array_agg(distinct recipient),array[]::uuid[]) into recipients from (
     select r.user_id as recipient from public.event_rsvps r join public.memberships m on m.user_id=r.user_id and m.status='active'
     where r.event_id=target_id and r.response in ('going','maybe') and (r.cancelled_at is null or (old_event.status='cancelled' and lifecycle='scheduled' and r.cancellation_reason='event_cancelled'))
     union
     select r.passenger_id from public.ride_reservations r join public.memberships m on m.user_id=r.passenger_id and m.status='active' where r.post_id=target_id and r.status in ('confirmed','needs_arrangement') and lifecycle='cancelled'
     union
     select r.driver_id from public.ride_offers r join public.memberships m on m.user_id=r.driver_id and m.status='active' where r.post_id=target_id and r.status='open' and lifecycle='cancelled'
    ) affected where recipient<>actor;
    notice_kind := case when state='cancelled' and existing.status<>'cancelled' then 'event_cancelled' when state='archived' then 'event_archived' when lifecycle='completed' and old_event.status<>'completed' then 'event_completed' when old_event.status='cancelled' and lifecycle='scheduled' then 'event_reopened' else 'event_updated' end;
   end if;
  end if;
 end if;
 if target_id is null then
  insert into public.posts(author_id,category_id,post_type,title,description,status,availability,conditions,location)
  values(actor,category,kind,trim(content->>'title'),trim(content->>'description'),state,coalesce(content->>'availability',''),coalesce(content->>'conditions',''),coalesce(content->>'location','')) returning id into result;
 else
  result := target_id;
  update public.posts set category_id=category,title=trim(content->>'title'),description=trim(content->>'description'),status=state,availability=coalesce(content->>'availability',''),conditions=coalesce(content->>'conditions',''),location=coalesce(content->>'location',''),updated_at=clock_timestamp() where id=result;
 end if;
 if kind='event' then
  insert into public.events(post_id,organiser_id,starts_at,ends_at,timezone,location,capacity,status)
  values(result,actor,start_time,end_time,zone,trim(content->>'event_location'),limit_seats,lifecycle)
  on conflict(post_id) do update set starts_at=excluded.starts_at,ends_at=excluded.ends_at,timezone=excluded.timezone,location=excluded.location,capacity=excluded.capacity,status=excluded.status;
  if lifecycle='cancelled' then
   update public.event_rsvps set cancelled_at=clock_timestamp(),cancellation_reason='event_cancelled',updated_at=clock_timestamp() where event_id=result and cancelled_at is null;
   update public.ride_offers set status='cancelled' where post_id=result and status='open';
   update public.ride_reservations set status='cancelled',modified_by=actor,updated_at=clock_timestamp() where post_id=result and status in ('confirmed','needs_arrangement');
  end if;
  if event_changed and cardinality(recipients)>0 then
   insert into public.notifications(recipient_id,kind,post_id,message)
   select recipient,notice_kind,result,
    (case notice_kind when 'event_cancelled' then 'Event cancelled: ' when 'event_completed' then 'Event completed: ' when 'event_archived' then 'Event archived: ' when 'event_reopened' then 'Event reopened — please RSVP again: ' else 'Event updated: ' end) || trim(content->>'title')
   from unnest(recipients) recipient;
  end if;
 end if;
 return result;
end $$;

create function public.read_notification(target_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_member() then raise exception 'Active membership required'; end if;
 update public.notifications set read_at=coalesce(read_at,now()) where id=target_id and recipient_id=auth.uid();
 if not found then raise exception 'Notification unavailable'; end if;
end $$;
create or replace function public.revoke_membership(target_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'Administrator access required'; end if;
 if target_user=auth.uid() then raise exception 'Cannot revoke your own access'; end if;
 update public.memberships set status='revoked',revoked_at=now() where user_id=target_user;
 update public.event_rsvps set cancelled_at=clock_timestamp(),cancellation_reason='membership_revoked',updated_at=clock_timestamp() where user_id=target_user and cancelled_at is null;
end $$;
revoke all on function public.set_event_rsvp(uuid,text),public.event_attendance(uuid),public.read_notification(uuid) from public,anon,authenticated;
grant execute on function public.set_event_rsvp(uuid,text),public.event_attendance(uuid),public.read_notification(uuid) to authenticated;
