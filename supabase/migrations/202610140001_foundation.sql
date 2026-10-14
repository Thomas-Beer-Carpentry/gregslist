create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create type public.member_role as enum ('member','admin');
create type public.member_status as enum ('active','revoked');
create table public.profiles (id uuid primary key references auth.users(id), display_name text not null check(length(display_name) between 1 and 80), avatar_path text, created_at timestamptz not null default now());
create table public.memberships (user_id uuid primary key references public.profiles(id), role public.member_role not null default 'member', status public.member_status not null default 'active', joined_at timestamptz not null default now(), revoked_at timestamptz);
create table public.invitations (id uuid primary key default gen_random_uuid(), email text not null, issued_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '7 days', revoked_at timestamptz, redeemed_at timestamptz, redeemed_by uuid references public.profiles(id), check(expires_at > created_at));
create unique index pending_invitation_email on public.invitations(lower(email)) where redeemed_at is null and revoked_at is null;
create function private.is_member() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.memberships where user_id=(select auth.uid()) and status='active') $$;
create function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.memberships where user_id=(select auth.uid()) and status='active' and role='admin') $$;
revoke all on function private.is_member(), private.is_admin() from public, anon;
grant execute on function private.is_member(), private.is_admin() to authenticated;
create table public.categories(id uuid primary key default gen_random_uuid(), name text not null unique, active boolean not null default true);
insert into public.categories(name) values ('Events & Social'),('Music & Concerts'),('Outdoors & Adventures'),('Trips & Travel'),('Transport & Rides'),('Items & Borrowing'),('Help & Favours'),('Food & Recommendations'),('General');
create table public.posts(id uuid primary key default gen_random_uuid(), author_id uuid not null references public.profiles(id), category_id uuid not null references public.categories(id), post_type text not null check(post_type in ('event','offer','request','trip','recommendation','announcement','discussion')), title text not null check(length(title) between 1 and 160), description text not null, status text not null default 'open' check(status in ('open','fulfilled','cancelled','archived')), ride_coordination_enabled boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index posts_chronological on public.posts(created_at desc,id desc);
create table public.events(post_id uuid primary key references public.posts(id), organiser_id uuid not null references public.profiles(id), starts_at timestamptz not null, ends_at timestamptz, timezone text not null default 'Pacific/Auckland', location text not null, capacity integer check(capacity>0), status text not null default 'scheduled' check(status in ('scheduled','cancelled','completed')), check(ends_at is null or ends_at>starts_at));
create table public.event_rsvps(event_id uuid references public.events(post_id), user_id uuid references public.profiles(id), response text not null check(response in ('going','maybe','not_going')), primary key(event_id,user_id));
create table public.ride_offers(id uuid primary key default gen_random_uuid(), post_id uuid not null references public.posts(id), driver_id uuid not null references public.profiles(id), capacity integer not null check(capacity>0), departure_at timestamptz, pickup text not null, return_details text, cost_notes text, notes text, status text not null default 'open' check(status in ('open','withdrawn','cancelled','completed')), unique(id,post_id));
create table public.ride_reservations(id uuid primary key default gen_random_uuid(), ride_id uuid not null, post_id uuid not null, passenger_id uuid not null references public.profiles(id), status text not null default 'confirmed' check(status in ('confirmed','cancelled','needs_arrangement','completed')), created_by uuid not null references public.profiles(id), modified_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), foreign key(ride_id,post_id) references public.ride_offers(id,post_id));
create unique index one_confirmed_seat_per_post on public.ride_reservations(post_id,passenger_id) where status='confirmed';
create table public.partner_relationships(id uuid primary key default gen_random_uuid(), user_a uuid not null references public.profiles(id), user_b uuid not null references public.profiles(id), requested_by uuid not null references public.profiles(id), status text not null default 'pending' check(status in ('pending','confirmed','revoked')), confirmed_at timestamptz, revoked_at timestamptz, check(user_a<user_b), check(requested_by in(user_a,user_b)));
-- One confirmed partner per account enforced through a normalized participant table.
create table public.partner_participants(user_id uuid primary key references public.profiles(id), relationship_id uuid not null references public.partner_relationships(id));
create table public.comments(id uuid primary key default gen_random_uuid(), post_id uuid not null references public.posts(id), author_id uuid not null references public.profiles(id), body text not null check(length(body) between 1 and 10000), created_at timestamptz not null default now());
create table public.post_photos(id uuid primary key default gen_random_uuid(), post_id uuid not null references public.posts(id), uploader_id uuid not null references public.profiles(id), object_path text not null unique, position integer not null default 0);
create table public.saved_posts(user_id uuid references public.profiles(id),post_id uuid references public.posts(id),primary key(user_id,post_id));
create table public.notifications(id uuid primary key default gen_random_uuid(), recipient_id uuid not null references public.profiles(id), kind text not null, post_id uuid references public.posts(id), created_at timestamptz not null default now(), read_at timestamptz);
-- Foundation is deliberately read-only for content. Later phases add writes only
-- alongside their lifecycle, concurrency and ownership functions.
do $$ declare t text; begin foreach t in array array['profiles','memberships','invitations','categories','posts','events','event_rsvps','ride_offers','ride_reservations','partner_relationships','partner_participants','comments','post_photos','saved_posts','notifications'] loop execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from anon, authenticated',t); execute format('grant select on public.%I to authenticated',t); end loop; end $$;
create policy member_profiles on public.profiles for select to authenticated using(private.is_member());
create policy own_membership on public.memberships for select to authenticated using(user_id=auth.uid() or private.is_admin());
create policy admin_invites on public.invitations for select to authenticated using(private.is_admin());
do $$ declare t text; begin foreach t in array array['categories','posts','events','event_rsvps','ride_offers','ride_reservations','comments','post_photos'] loop execute format('create policy member_read on public.%I for select to authenticated using(private.is_member())',t); end loop; end $$;
create policy partner_read on public.partner_relationships for select to authenticated using(private.is_member() and auth.uid() in(user_a,user_b));
create policy own_partner_slot on public.partner_participants for select to authenticated using(private.is_member() and user_id=auth.uid());
create policy own_saved on public.saved_posts for select to authenticated using(private.is_member() and user_id=auth.uid());
create policy own_notifications on public.notifications for select to authenticated using(private.is_member() and recipient_id=auth.uid());
grant update(display_name,avatar_path) on public.profiles to authenticated;
create policy update_own_profile on public.profiles for update to authenticated using(private.is_member() and id=auth.uid()) with check(private.is_member() and id=auth.uid());
create function public.issue_invitation(target_email text) returns uuid language plpgsql security definer set search_path='' as $$ declare result uuid; begin if not private.is_admin() then raise exception 'Administrator access required'; end if; if target_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email'; end if; update public.invitations set revoked_at=now() where lower(email)=lower(trim(target_email)) and redeemed_at is null and revoked_at is null and expires_at<=now(); insert into public.invitations(email,issued_by) values(lower(trim(target_email)),auth.uid()) returning id into result; return result; end $$;
create function public.revoke_invitation(invitation_id uuid) returns void language plpgsql security definer set search_path='' as $$ begin if not private.is_admin() then raise exception 'Administrator access required'; end if; update public.invitations set revoked_at=now() where id=invitation_id and redeemed_at is null; end $$;
create function public.activate_membership() returns void language plpgsql security definer set search_path='' as $$ declare inv public.invitations; account auth.users; begin
 select * into account from auth.users where id=auth.uid();
 if account.id is null or account.email_confirmed_at is null or account.invited_at is null then raise exception 'Verified invitation required'; end if;
 if exists(select 1 from public.memberships where user_id=account.id) then raise exception 'Membership already exists; contact an administrator'; end if;
 select * into inv from public.invitations where lower(email)=lower(account.email) order by created_at desc limit 1 for update;
 if inv.id is null then raise exception 'Invitation invalid'; end if;
 if inv.revoked_at is not null then raise exception 'Invitation revoked'; end if;
 if inv.redeemed_at is not null then raise exception 'Invitation already used'; end if;
 if inv.expires_at<=now() then raise exception 'Invitation expired'; end if;
 insert into public.profiles(id,display_name) values(account.id,coalesce(nullif(account.raw_user_meta_data->>'display_name',''),split_part(account.email,'@',1))) on conflict(id) do nothing;
 insert into public.memberships(user_id) values(account.id);
 update public.invitations set redeemed_at=now(),redeemed_by=account.id where id=inv.id;
 end $$;
create function public.revoke_membership(target_user uuid) returns void language plpgsql security definer set search_path='' as $$ begin if not private.is_admin() then raise exception 'Administrator access required'; end if; if target_user=auth.uid() then raise exception 'Cannot revoke your own access'; end if; update public.memberships set status='revoked',revoked_at=now() where user_id=target_user; end $$;
revoke all on function public.issue_invitation(text),public.revoke_invitation(uuid),public.activate_membership(),public.revoke_membership(uuid) from public, anon;
grant execute on function public.issue_invitation(text),public.revoke_invitation(uuid),public.activate_membership(),public.revoke_membership(uuid) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('community-photos','community-photos',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy private_photos on storage.objects for select to authenticated using(bucket_id='community-photos' and private.is_member());

-- Deferred constraints let future transactional APIs create extension rows together.
create function private.check_event_extension() returns trigger language plpgsql set search_path='' as $$
declare target uuid; kind text; has_event boolean;
begin
 if tg_table_name='posts' then target=coalesce(new.id,old.id); else target=coalesce(new.post_id,old.post_id); end if;
 select post_type into kind from public.posts where id=target;
 if not found then return null; end if;
 select exists(select 1 from public.events where post_id=target) into has_event;
 if (kind='event')<>has_event then raise exception 'Event posts require exactly one event extension'; end if;
 return null;
end $$;
create constraint trigger post_event_consistency after insert or update or delete on public.posts deferrable initially deferred for each row execute function private.check_event_extension();
create constraint trigger event_post_consistency after insert or update or delete on public.events deferrable initially deferred for each row execute function private.check_event_extension();
create unique index live_partner_pair on public.partner_relationships(user_a,user_b) where status in ('pending','confirmed');
create function private.check_partner_slots() returns trigger language plpgsql set search_path='' as $$
declare target uuid; link public.partner_relationships; slots integer; invalid integer;
begin
 if tg_table_name='partner_relationships' then target=coalesce(new.id,old.id); else target=coalesce(new.relationship_id,old.relationship_id); end if;
 select * into link from public.partner_relationships where id=target;
 if not found then return null; end if;
 select count(*),count(*) filter(where user_id not in(link.user_a,link.user_b)) into slots,invalid from public.partner_participants where relationship_id=target;
 if invalid>0 or (link.status='confirmed' and slots<>2) or (link.status<>'confirmed' and slots<>0) then raise exception 'Confirmed partners require exactly their two exclusive account slots'; end if;
 return null;
end $$;
create constraint trigger relationship_slots after insert or update or delete on public.partner_relationships deferrable initially deferred for each row execute function private.check_partner_slots();
create constraint trigger participant_slots after insert or update or delete on public.partner_participants deferrable initially deferred for each row execute function private.check_partner_slots();
revoke all on function private.check_event_extension(),private.check_partner_slots() from public, anon;
