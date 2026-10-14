-- Phase 4. All transport/partner mutations acquire the same advisory transaction
-- lock BEFORE membership, parent-post and ride locks. This deliberately serializes
-- the small private community's transport changes, including unlink/revocation.
-- RSVP mutations retain their parent-post locking protocol from Phase 3.
alter table public.ride_offers
 add column route text not null default '',
 add column timezone text not null default 'Pacific/Auckland',
 add column return_available boolean not null default false,
 add column return_departure_at timestamptz,
 add column contribution_amount numeric(10,2) check(contribution_amount>=0),
 add column contribution_currency text not null default 'NZD' check(contribution_currency ~ '^[A-Z]{3}$'),
 add column needs_reconfirmation boolean not null default false,
 add column created_at timestamptz not null default now(),
 add column updated_at timestamptz not null default now(),
 add constraint ride_finite_dates check((departure_at is null or isfinite(departure_at)) and (return_departure_at is null or isfinite(return_departure_at))),
 add constraint ride_return_order check(return_departure_at is null or (return_available and (departure_at is null or return_departure_at>departure_at)));
update public.ride_offers set return_available=true where length(coalesce(return_details,''))>0;
alter table public.ride_reservations add column status_reason text;
alter table public.partner_relationships drop constraint partner_relationships_status_check;
alter table public.partner_relationships add constraint partner_relationships_status_check check(status in ('pending','confirmed','declined','revoked'));
alter table public.partner_relationships add column created_at timestamptz not null default now(),add column responded_at timestamptz;
-- Deferred partner checks must see both private slots at commit, regardless of caller RLS.
alter function private.check_partner_slots() security definer;
create index rides_parent_date on public.ride_offers(post_id,created_at,id);
create index reservations_ride_status on public.ride_reservations(ride_id,status);
create index partner_recipient_status on public.partner_relationships(user_b,status);

create table public.transport_operations(
 actor_id uuid not null references public.profiles(id),
 operation_id uuid not null,
 request jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(actor_id,operation_id)
);
create table public.ride_reservation_history(
 id uuid primary key default gen_random_uuid(),
 reservation_id uuid not null references public.ride_reservations(id) on delete cascade,
 post_id uuid not null references public.posts(id),
 passenger_id uuid not null references public.profiles(id),
 actor_id uuid not null references public.profiles(id),
 previous_status text,
 new_status text not null,
 reason text,
 changed_at timestamptz not null default clock_timestamp()
);
alter table public.transport_operations enable row level security;
alter table public.ride_reservation_history enable row level security;
revoke all on public.transport_operations,public.ride_reservation_history from public,anon,authenticated;

create function private.transport_lock() returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_member() then raise exception 'Active membership required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(71404,1);
 -- Recheck after waiting; an administrator may just have revoked this account.
 perform 1 from public.memberships where user_id=auth.uid() and status='active' for share;
 if not found then raise exception 'Active membership required'; end if;
end $$;
create function private.transport_replay(op uuid, payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.transport_operations;
begin
 if op is null then raise exception 'A booking operation key is required'; end if;
 select * into previous from public.transport_operations where actor_id=auth.uid() and operation_id=op;
 if found then
  if previous.request is distinct from payload then raise exception 'Operation key already used for a different request'; end if;
  return previous.result;
 end if;
 return null;
end $$;
create function private.transport_open(target_post uuid) returns void language plpgsql security definer set search_path='' as $$
declare parent public.posts; event public.events;
begin
 select * into parent from public.posts where id=target_post for update;
 if parent.id is null or not parent.ride_coordination_enabled or parent.status<>'open' then raise exception 'Ride coordination is closed for this post'; end if;
 if parent.post_type='event' then
  select * into event from public.events where post_id=target_post;
  if event.post_id is null or event.status<>'scheduled' or event.starts_at<=now() then raise exception 'Ride coordination is closed for this event'; end if;
 end if;
end $$;
create function private.transport_notice(recipients uuid[], target_post uuid, notice_kind text, notice text) returns void language sql security definer set search_path='' as $$
 insert into public.notifications(recipient_id,post_id,kind,message)
 select distinct m.user_id,target_post,notice_kind,notice from public.memberships m
 where m.user_id=any(recipients) and m.status='active' and m.user_id<>auth.uid();
$$;
create function private.audit_reservation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' or row(old.status,old.ride_id,old.modified_by) is distinct from row(new.status,new.ride_id,new.modified_by) then
  insert into public.ride_reservation_history(reservation_id,post_id,passenger_id,actor_id,previous_status,new_status,reason)
  values(new.id,new.post_id,new.passenger_id,coalesce(auth.uid(),new.modified_by),case when tg_op='INSERT' then null else old.status end,new.status,new.status_reason);
 end if;
 return new;
end $$;
create trigger reservation_audit after insert or update on public.ride_reservations for each row execute function private.audit_reservation();
-- Defense in depth for privileged operator writes as well as the public APIs.
create function private.check_ride_capacity() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid; ride public.ride_offers; occupied integer;
begin
 if tg_table_name='ride_offers' then target=coalesce(new.id,old.id); else target=coalesce(new.ride_id,old.ride_id); end if;
 select * into ride from public.ride_offers where id=target;
 if not found then return null; end if;
 perform 1 from public.posts where id=ride.post_id for update;
 select * into ride from public.ride_offers where id=target;
 select count(*) into occupied from public.ride_reservations where ride_id=target and status='confirmed';
 if occupied>ride.capacity then raise exception 'Ride passenger capacity exceeded'; end if;
 if occupied>0 and ride.status<>'open' then raise exception 'Inactive rides cannot have confirmed passengers'; end if;
 if exists(select 1 from public.ride_reservations where ride_id=target and status='confirmed' and passenger_id=ride.driver_id) then raise exception 'Drivers cannot reserve their own passenger seats'; end if;
 return null;
end $$;
create constraint trigger offer_capacity after insert or update on public.ride_offers deferrable initially deferred for each row execute function private.check_ride_capacity();
create constraint trigger reservation_capacity after insert or update on public.ride_reservations deferrable initially deferred for each row execute function private.check_ride_capacity();

create function public.partner_candidates() returns table(id uuid,display_name text) language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_member() then raise exception 'Active membership required'; end if;
 return query select p.id,p.display_name from public.profiles p join public.memberships m on m.user_id=p.id and m.status='active' where p.id<>auth.uid() order by p.display_name,p.id;
end $$;
create function public.request_partner(target_user uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 perform private.transport_lock();
 if target_user is null or target_user=auth.uid() then raise exception 'Choose another active member'; end if;
 if not exists(select 1 from public.memberships where user_id=target_user and status='active') then raise exception 'Choose another active member'; end if;
 if exists(select 1 from public.partner_participants where user_id in(auth.uid(),target_user)) then raise exception 'One of these accounts already has a partner'; end if;
 select id into result from public.partner_relationships where user_a=least(auth.uid(),target_user) and user_b=greatest(auth.uid(),target_user) and status='pending';
 if found then return result; end if;
 insert into public.partner_relationships(user_a,user_b,requested_by) values(least(auth.uid(),target_user),greatest(auth.uid(),target_user),auth.uid()) returning id into result;
 return result;
end $$;
create function public.respond_partner(target_relationship uuid, decision text) returns void language plpgsql security definer set search_path='' as $$
declare link public.partner_relationships;
begin
 perform private.transport_lock();
 select * into link from public.partner_relationships where id=target_relationship for update;
 if link.id is null or auth.uid() not in(link.user_a,link.user_b) or auth.uid()=link.requested_by then raise exception 'Only the recipient can respond to this request'; end if;
 if decision not in('accept','decline') or decision is null then raise exception 'Choose accept or decline'; end if;
 if link.status='confirmed' and decision='accept' then return; end if;
 if link.status='declined' and decision='decline' then return; end if;
 if link.status<>'pending' then raise exception 'This partner request is no longer pending'; end if;
 if decision='decline' then update public.partner_relationships set status='declined',responded_at=clock_timestamp() where id=link.id; return; end if;
 if (select count(*) from public.memberships where user_id in(link.user_a,link.user_b) and status='active')<>2 then raise exception 'Both partners must be active members'; end if;
 if exists(select 1 from public.partner_participants where user_id in(link.user_a,link.user_b)) then raise exception 'One of these accounts already has a partner'; end if;
 update public.partner_relationships set status='confirmed',confirmed_at=clock_timestamp(),responded_at=clock_timestamp() where id=link.id;
 insert into public.partner_participants(user_id,relationship_id) values(link.user_a,link.id),(link.user_b,link.id);
 -- Close conflicting requests without recording a decline on another recipient's behalf.
 update public.partner_relationships set status='revoked',revoked_at=clock_timestamp() where id<>link.id and status='pending' and (user_a in(link.user_a,link.user_b) or user_b in(link.user_a,link.user_b));
end $$;
create function public.unlink_partner(target_relationship uuid) returns void language plpgsql security definer set search_path='' as $$
declare link public.partner_relationships;
begin
 perform private.transport_lock();
 select * into link from public.partner_relationships where id=target_relationship for update;
 if link.id is null or auth.uid() not in(link.user_a,link.user_b) then raise exception 'Partner relationship unavailable'; end if;
 -- Either participant may end a confirmed relationship; only a sender may cancel a pending request.
 if link.status='pending' and link.requested_by<>auth.uid() then raise exception 'Decline this request instead'; end if;
 if link.status in('revoked','declined') then return; end if;
 delete from public.partner_participants where relationship_id=link.id;
 update public.partner_relationships set status='revoked',revoked_at=clock_timestamp() where id=link.id;
 -- Reservations are passenger-owned and deliberately left intact.
end $$;
create function private.linked_partner() returns uuid language sql stable security definer set search_path='' as $$
 select case when r.user_a=auth.uid() then r.user_b else r.user_a end from public.partner_relationships r
 join public.partner_participants s on s.relationship_id=r.id and s.user_id=auth.uid()
 join public.memberships a on a.user_id=r.user_a and a.status='active'
 join public.memberships b on b.user_id=r.user_b and b.status='active'
 where r.status='confirmed';
$$;

create function public.write_ride(target_id uuid,target_post uuid,content jsonb,operation_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare old public.ride_offers; result uuid; payload jsonb; cached jsonb; seats integer; departure timestamptz; return_time timestamptz; has_return boolean; amount numeric; zone text; affected uuid[];
begin
 perform private.transport_lock();
 payload:=jsonb_build_object('action','write_ride','id',target_id,'post',target_post,'content',content);
 cached:=private.transport_replay(operation_id,payload); if cached is not null then return (cached->>'id')::uuid; end if;
 perform private.transport_open(target_post);
 seats:=(content->>'capacity')::integer; departure:=nullif(content->>'departure_at','')::timestamptz; return_time:=nullif(content->>'return_departure_at','')::timestamptz; has_return:=coalesce((content->>'return_available')::boolean,false); amount:=nullif(content->>'contribution_amount','')::numeric; zone:=coalesce(content->>'timezone','Pacific/Auckland');
 if jsonb_typeof(content)<>'object' or seats is null or seats<1 or length(trim(coalesce(content->>'pickup',''))) not between 1 and 300 or length(coalesce(content->>'route',''))>1000 or length(coalesce(content->>'return_details',''))>1000 or length(coalesce(content->>'cost_notes',''))>500 or length(coalesce(content->>'notes',''))>2000 then raise exception 'Check ride capacity, pickup and detail lengths'; end if;
 if (departure is not null and not isfinite(departure)) or (return_time is not null and (not isfinite(return_time) or not has_return or (departure is not null and return_time<=departure))) or not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) or (amount is not null and (amount<0 or amount>99999999.99 or amount<>round(amount,2))) or coalesce(content->>'contribution_currency','NZD') !~ '^[A-Z]{3}$' then raise exception 'Check ride dates, timezone and contribution'; end if;
 if not has_return and length(coalesce(content->>'return_details',''))>0 then raise exception 'Enable return availability before adding return details'; end if;
 if target_id is not null then
  select * into old from public.ride_offers where id=target_id and post_id=target_post for update;
  if old.id is null or (old.driver_id<>auth.uid() and not private.is_admin()) then raise exception 'Only the driver or an administrator can edit this ride'; end if;
  if old.status<>'open' then raise exception 'Inactive rides cannot be edited; offer a new ride'; end if;
  if seats<(select count(*) from public.ride_reservations where ride_id=old.id and status='confirmed') then raise exception 'Capacity cannot be lower than confirmed passenger count'; end if;
  result:=old.id;
  update public.ride_offers set capacity=seats,pickup=trim(content->>'pickup'),route=coalesce(content->>'route',''),departure_at=departure,timezone=zone,return_available=has_return,return_departure_at=return_time,return_details=coalesce(content->>'return_details',''),contribution_amount=amount,contribution_currency=coalesce(content->>'contribution_currency','NZD'),cost_notes=coalesce(content->>'cost_notes',''),notes=coalesce(content->>'notes',''),needs_reconfirmation=false,updated_at=clock_timestamp() where id=result;
  if row(old.capacity,old.pickup,old.route,old.departure_at,old.timezone,old.return_available,old.return_departure_at,coalesce(old.return_details,''),old.contribution_amount,old.contribution_currency,coalesce(old.cost_notes,''),coalesce(old.notes,''),old.needs_reconfirmation) is distinct from row(seats,trim(content->>'pickup'),coalesce(content->>'route',''),departure,zone,has_return,return_time,coalesce(content->>'return_details',''),amount,coalesce(content->>'contribution_currency','NZD'),coalesce(content->>'cost_notes',''),coalesce(content->>'notes',''),false) then
   select array_agg(passenger_id) into affected from public.ride_reservations where ride_id=result and status='confirmed';
   perform private.transport_notice(affected||array[old.driver_id],target_post,'ride_updated','Ride details updated. Please check your transport plans.');
  end if;
 else
  insert into public.ride_offers(post_id,driver_id,capacity,pickup,route,departure_at,timezone,return_available,return_departure_at,return_details,contribution_amount,contribution_currency,cost_notes,notes)
  values(target_post,auth.uid(),seats,trim(content->>'pickup'),coalesce(content->>'route',''),departure,zone,has_return,return_time,coalesce(content->>'return_details',''),amount,coalesce(content->>'contribution_currency','NZD'),coalesce(content->>'cost_notes',''),coalesce(content->>'notes','')) returning id into result;
 end if;
 insert into public.transport_operations(actor_id,operation_id,request,result) values(auth.uid(),operation_id,payload,jsonb_build_object('id',result));
 return result;
end $$;

create function private.reserve_ride(target_ride uuid,booking_mode text,operation_id uuid,switching boolean,expected_reservations uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare ride public.ride_offers; partner uuid; passengers uuid[]; payload jsonb; cached jsonb; old public.ride_reservations; person uuid; occupied integer; needed integer; result_ids uuid[]:=array[]::uuid[]; new_id uuid; current_ids uuid[]; affected_drivers uuid[]:=array[]::uuid[]; changed boolean:=false;
begin
 perform private.transport_lock();
 payload:=jsonb_build_object('action',case when switching then 'switch' else 'book' end,'ride',target_ride,'mode',booking_mode,'expected',expected_reservations);
 cached:=private.transport_replay(operation_id,payload); if cached is not null then return cached; end if;
 if booking_mode is null or booking_mode not in('self','both','partner') then raise exception 'Choose a valid booking option'; end if;
 partner:=private.linked_partner();
 if booking_mode<>'self' and partner is null then raise exception 'An active mutually confirmed partner is required'; end if;
 passengers:=case booking_mode when 'self' then array[auth.uid()] when 'both' then array[auth.uid(),partner] else array[partner] end;
 if (select count(*) from public.memberships where user_id=any(passengers) and status='active')<>cardinality(passengers) then raise exception 'All passengers must be active members'; end if;
 select * into ride from public.ride_offers where id=target_ride;
 if ride.id is null then raise exception 'Ride unavailable'; end if;
 perform private.transport_open(ride.post_id);
 select * into ride from public.ride_offers where id=target_ride for update;
 if ride.status<>'open' or (ride.departure_at is not null and ride.departure_at<=now()) then raise exception 'This ride is no longer available'; end if;
 if ride.driver_id=any(passengers) then raise exception 'Drivers cannot reserve their own passenger seats'; end if;
 if switching then
  select array_agg(id order by id) into current_ids from public.ride_reservations where post_id=ride.post_id and passenger_id=any(passengers) and status in('confirmed','needs_arrangement');
  if coalesce(cardinality(current_ids),0)=0 or current_ids is distinct from (select array_agg(x order by x) from unnest(expected_reservations) x) then raise exception 'Booking changed. Refresh before switching'; end if;
 end if;
 foreach person in array passengers loop
  select * into old from public.ride_reservations where post_id=ride.post_id and passenger_id=person and status='confirmed';
  if old.id is not null and old.ride_id<>ride.id and not switching then raise exception 'A passenger already has another ride. Use Change ride'; end if;
  if switching and person<>auth.uid() and exists(select 1 from public.ride_reservations where post_id=ride.post_id and passenger_id=person and status in('confirmed','needs_arrangement') and ride_id<>ride.id and created_by<>auth.uid()) then raise exception 'Your partner must manage the booking they created themselves'; end if;
 end loop;
 select count(*) into occupied from public.ride_reservations where ride_id=ride.id and status='confirmed';
 select count(*) into needed from unnest(passengers) p where not exists(select 1 from public.ride_reservations r where r.ride_id=ride.id and r.passenger_id=p and r.status='confirmed');
 if occupied+needed>ride.capacity then raise exception 'Not enough seats. Existing reservations have been kept'; end if;
 -- Capacity has been secured under the shared lock. Only now change old records.
 foreach person in array passengers loop
  select * into old from public.ride_reservations where post_id=ride.post_id and passenger_id=person and status='confirmed';
  if old.id is not null and old.ride_id=ride.id then result_ids:=array_append(result_ids,old.id); continue; end if;
  select affected_drivers||coalesce(array_agg(distinct o.driver_id),array[]::uuid[]) into affected_drivers from public.ride_reservations r join public.ride_offers o on o.id=r.ride_id where r.post_id=ride.post_id and r.passenger_id=person and r.status in('confirmed','needs_arrangement');
  update public.ride_reservations set status='cancelled',status_reason=case when switching then 'switched' else 'replacement_booked' end,modified_by=auth.uid(),updated_at=clock_timestamp() where post_id=ride.post_id and passenger_id=person and status in('confirmed','needs_arrangement');
  insert into public.ride_reservations(ride_id,post_id,passenger_id,created_by,modified_by,status_reason) values(ride.id,ride.post_id,person,auth.uid(),auth.uid(),case when switching then 'switched' else 'booked' end) returning id into new_id;
  result_ids:=array_append(result_ids,new_id); changed:=true;
 end loop;
 if changed then perform private.transport_notice(passengers||array[ride.driver_id]||affected_drivers,ride.post_id,case when switching then 'ride_switched' else 'ride_booked' end,case when switching then 'Ride booking changed. Check the passenger list and your transport details.' else 'Ride booking confirmed. Check the passenger list and your transport details.' end); end if;
 cached:=jsonb_build_object('status','confirmed','ride_id',ride.id,'reservation_ids',result_ids);
 insert into public.transport_operations(actor_id,operation_id,request,result) values(auth.uid(),operation_id,payload,cached);
 return cached;
end $$;
create function public.book_ride(target_ride uuid,booking_mode text,operation_id uuid) returns jsonb language sql security definer set search_path='' as $$ select private.reserve_ride(target_ride,booking_mode,operation_id,false,null); $$;
create function public.switch_ride(target_ride uuid,booking_mode text,operation_id uuid,expected_reservations uuid[]) returns jsonb language sql security definer set search_path='' as $$ select private.reserve_ride(target_ride,booking_mode,operation_id,true,expected_reservations); $$;
create function public.cancel_ride_reservation(target_reservation uuid) returns void language plpgsql security definer set search_path='' as $$
declare reservation public.ride_reservations; driver uuid;
begin
 perform private.transport_lock();
 select * into reservation from public.ride_reservations where id=target_reservation;
 if reservation.id is null then raise exception 'Reservation unavailable'; end if;
 perform 1 from public.posts where id=reservation.post_id for update;
 if reservation.passenger_id<>auth.uid() and not private.is_admin() and not(reservation.passenger_id=coalesce(private.linked_partner(),'00000000-0000-0000-0000-000000000000'::uuid) and reservation.created_by=auth.uid()) then raise exception 'Only the passenger or their authorised booking actor can cancel'; end if;
 if reservation.status='cancelled' then return; end if;
 if reservation.status='completed' then raise exception 'Completed reservations are historical'; end if;
 update public.ride_reservations set status='cancelled',status_reason='passenger_cancelled',modified_by=auth.uid(),updated_at=clock_timestamp() where id=reservation.id;
 select driver_id into driver from public.ride_offers where id=reservation.ride_id;
 perform private.transport_notice(array[driver,reservation.passenger_id],reservation.post_id,'ride_booking_cancelled','A passenger reservation was cancelled. Seat availability has been updated.');
end $$;
create function public.withdraw_ride(target_ride uuid) returns void language plpgsql security definer set search_path='' as $$
declare ride public.ride_offers; affected uuid[];
begin
 perform private.transport_lock();
 select * into ride from public.ride_offers where id=target_ride;
 if ride.id is null or (ride.driver_id<>auth.uid() and not private.is_admin()) then raise exception 'Only the driver or an administrator can withdraw this ride'; end if;
 perform 1 from public.posts where id=ride.post_id for update;
 if ride.status='withdrawn' then return; end if;
 if ride.status<>'open' then raise exception 'This ride is already closed'; end if;
 select array_agg(passenger_id) into affected from public.ride_reservations where ride_id=ride.id and status='confirmed';
 update public.ride_offers set status='withdrawn',updated_at=clock_timestamp() where id=ride.id;
 update public.ride_reservations set status='needs_arrangement',status_reason='driver_withdrawn',modified_by=auth.uid(),updated_at=clock_timestamp() where ride_id=ride.id and status='confirmed';
 perform private.transport_notice(affected||array[ride.driver_id],ride.post_id,'ride_withdrawn','Ride withdrawn. Please arrange alternative transport.');
end $$;

create or replace function public.write_post(target_id uuid, content jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare
 actor uuid := auth.uid(); result uuid; existing public.posts; old_event public.events;
 kind text := content->>'post_type'; state text := coalesce(content->>'status','open');
 category uuid := (content->>'category_id')::uuid;
 start_time timestamptz; end_time timestamptz; zone text; limit_seats integer; lifecycle text;
 ride_enabled boolean; review_transport boolean:=false; transport_recipients uuid[];
 notice_kind text; recipients uuid[]; event_changed boolean := false;
begin
 perform private.transport_lock();
 if jsonb_typeof(content)<>'object' or jsonb_typeof(content->'title')<>'string' or jsonb_typeof(content->'description')<>'string' or length(trim(content->>'title')) not between 1 and 160 or length(trim(content->>'description')) not between 1 and 20000 then raise exception 'Title and description are required'; end if;
 if kind is null or kind not in ('event','offer','request','trip','recommendation','announcement','discussion') then raise exception 'Invalid post type'; end if;
 if state not in ('open','fulfilled','cancelled','completed','archived') or (kind='event' and state='fulfilled') or (kind<>'event' and state='completed') then raise exception 'Invalid status'; end if;
 if target_id is not null then
  select * into existing from public.posts where id=target_id for update;
  if not found or existing.author_id<>actor then raise exception 'Only the author can edit this post'; end if;
  if kind<>existing.post_type then raise exception 'Post type cannot be changed'; end if;
  if kind='event' then select * into old_event from public.events where post_id=target_id for update; end if;

 end if;
 ride_enabled:=case when content ? 'ride_coordination_enabled' then coalesce((content->>'ride_coordination_enabled')::boolean,false) else coalesce(existing.ride_coordination_enabled,false) end;
 if target_id is not null then
  if not ride_enabled and existing.ride_coordination_enabled and (exists(select 1 from public.ride_offers where post_id=target_id and status='open') or exists(select 1 from public.ride_reservations where post_id=target_id and status in('confirmed','needs_arrangement'))) then raise exception 'Withdraw active rides and resolve outstanding reservations before disabling coordination'; end if;
  if state<>'open' and state is distinct from existing.status and (exists(select 1 from public.ride_offers where post_id=target_id and status='open') or exists(select 1 from public.ride_reservations where post_id=target_id and status in('confirmed','needs_arrangement'))) and not coalesce((content->>'confirm_transport_close')::boolean,false) and not(kind='event' and state='cancelled' and coalesce((content->>'confirm_cancel')::boolean,false)) then raise exception 'Confirm closing the associated ride arrangements before saving'; end if;
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
   review_transport:=(row(old_event.starts_at,old_event.ends_at,old_event.timezone,old_event.location) is distinct from row(start_time,end_time,zone,trim(content->>'event_location'))) and exists(select 1 from public.ride_offers where post_id=target_id and status='open');
   event_changed := row(existing.title,existing.description,existing.status,old_event.starts_at,old_event.ends_at,old_event.timezone,old_event.location,old_event.capacity)
    is distinct from row(trim(content->>'title'),trim(content->>'description'),state,start_time,end_time,zone,trim(content->>'event_location'),limit_seats);
   if event_changed then
    select coalesce(array_agg(distinct recipient),array[]::uuid[]) into recipients from (
     select r.user_id as recipient from public.event_rsvps r join public.memberships m on m.user_id=r.user_id and m.status='active'
     where r.event_id=target_id and r.response in ('going','maybe') and (r.cancelled_at is null or (old_event.status='cancelled' and lifecycle='scheduled' and r.cancellation_reason='event_cancelled'))
     union
     select r.passenger_id from public.ride_reservations r join public.memberships m on m.user_id=r.passenger_id and m.status='active' where r.post_id=target_id and r.status in ('confirmed','needs_arrangement')
     union
     select r.driver_id from public.ride_offers r join public.memberships m on m.user_id=r.driver_id and m.status='active' where r.post_id=target_id and r.status='open'
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
   update public.ride_offers set status='cancelled',updated_at=clock_timestamp() where post_id=result and status='open';
   update public.ride_reservations set status='cancelled',status_reason='event_cancelled',modified_by=actor,updated_at=clock_timestamp() where post_id=result and status in ('confirmed','needs_arrangement');
  end if;
  if event_changed and cardinality(recipients)>0 then
   insert into public.notifications(recipient_id,kind,post_id,message)
   select recipient,notice_kind,result,
    (case notice_kind when 'event_cancelled' then 'Event cancelled: ' when 'event_completed' then 'Event completed: ' when 'event_archived' then 'Event archived: ' when 'event_reopened' then 'Event reopened — please RSVP again: ' else case when review_transport then 'Event updated — check transport arrangements: ' else 'Event updated: ' end end) || trim(content->>'title')
   from unnest(recipients) recipient;
  end if;
 end if;
 update public.posts set ride_coordination_enabled=ride_enabled where id=result;
 if review_transport and state='open' then
  update public.ride_offers set needs_reconfirmation=true,updated_at=clock_timestamp() where post_id=result and status='open';
 end if;
 if state<>'open' then
  select array_agg(distinct recipient) into transport_recipients from (
   select driver_id as recipient from public.ride_offers where post_id=result and status='open'
   union select passenger_id from public.ride_reservations where post_id=result and status in('confirmed','needs_arrangement')
  ) affected;
  update public.ride_offers set status=case when state='cancelled' then 'cancelled' else 'completed' end,updated_at=clock_timestamp() where post_id=result and status='open';
  update public.ride_reservations set status=case when state='cancelled' then 'cancelled' when status='confirmed' then 'completed' else 'cancelled' end,status_reason=case when state='cancelled' then 'post_cancelled' else 'post_closed' end,modified_by=actor,updated_at=clock_timestamp() where post_id=result and status in('confirmed','needs_arrangement');
  if kind<>'event' then perform private.transport_notice(transport_recipients,result,case when state='cancelled' then 'ride_cancelled' else 'ride_completed' end,'The associated post is closed. Check your transport arrangements.'); end if;
 end if;
 return result;
end $$;

-- Membership revocation is integrated with transport without adding Phase 5 UI.
create or replace function public.revoke_membership(target_user uuid) returns void language plpgsql security definer set search_path='' as $$
declare parent uuid; ride public.ride_offers; affected uuid[]; link_id uuid;
begin
 if not private.is_admin() then raise exception 'Administrator access required'; end if;
 perform private.transport_lock();
 if target_user=auth.uid() then raise exception 'Cannot revoke your own access'; end if;
 update public.memberships set status='revoked',revoked_at=now() where user_id=target_user;
 update public.event_rsvps set cancelled_at=clock_timestamp(),cancellation_reason='membership_revoked',updated_at=clock_timestamp() where user_id=target_user and cancelled_at is null;
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
end $$;

revoke all on function private.transport_lock(),private.transport_replay(uuid,jsonb),private.transport_open(uuid),private.transport_notice(uuid[],uuid,text,text),private.audit_reservation(),private.check_ride_capacity(),private.linked_partner(),private.reserve_ride(uuid,text,uuid,boolean,uuid[]) from public,anon,authenticated;
revoke all on function public.partner_candidates(),public.request_partner(uuid),public.respond_partner(uuid,text),public.unlink_partner(uuid),public.write_ride(uuid,uuid,jsonb,uuid),public.book_ride(uuid,text,uuid),public.switch_ride(uuid,text,uuid,uuid[]),public.cancel_ride_reservation(uuid),public.withdraw_ride(uuid) from public,anon,authenticated;
grant execute on function public.partner_candidates(),public.request_partner(uuid),public.respond_partner(uuid,text),public.unlink_partner(uuid),public.write_ride(uuid,uuid,jsonb,uuid),public.book_ride(uuid,text,uuid),public.switch_ride(uuid,text,uuid,uuid[]),public.cancel_ride_reservation(uuid),public.withdraw_ride(uuid) to authenticated;
