-- Phase 2: transactional, owner-checked noticeboard writes. No direct content writes.
alter table public.posts add column availability text not null default '' check(length(availability)<=300);
alter table public.posts add column conditions text not null default '' check(length(conditions)<=1000);
alter table public.posts add column location text not null default '' check(length(location)<=300);
alter table public.posts add constraint description_length check(length(description) between 1 and 20000);
alter table public.posts add column search_document tsvector generated always as (to_tsvector('english',coalesce(title,'') || ' ' || coalesce(description,''))) stored;
create index posts_search on public.posts using gin(search_document);
create index comments_post_date on public.comments(post_id,created_at,id);
create index upcoming_event_date on public.events(starts_at) where status='scheduled';
alter table public.comments add column updated_at timestamptz not null default now();
create table public.photo_cleanup(object_path text primary key, enqueued_at timestamptz not null default now());
alter table public.photo_cleanup enable row level security;
revoke all on public.photo_cleanup from public,anon,authenticated;
grant all on public.photo_cleanup to service_role;

create function public.write_post(target_id uuid, content jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare
 actor uuid := auth.uid(); result uuid; existing public.posts;
 kind text := content->>'post_type'; state text := coalesce(content->>'status','open');
 category uuid := (content->>'category_id')::uuid;
 start_time timestamptz; end_time timestamptz; zone text;
begin
 if not private.is_member() then raise exception 'Active membership required'; end if;
 if jsonb_typeof(content)<>'object' or jsonb_typeof(content->'title')<>'string' or jsonb_typeof(content->'description')<>'string' or length(trim(content->>'title')) not between 1 and 160 or length(trim(content->>'description')) not between 1 and 20000 then raise exception 'Title and description are required'; end if;
 if kind is null or kind not in ('event','offer','request','trip','recommendation','announcement','discussion') then raise exception 'Invalid post type'; end if;
 if state not in ('open','fulfilled','cancelled','archived') or (kind='event' and state='fulfilled') then raise exception 'Invalid status'; end if;
 if target_id is not null then
  select * into existing from public.posts where id=target_id for update;
  if not found or existing.author_id<>actor then raise exception 'Only the author can edit this post'; end if;
  if kind<>existing.post_type then raise exception 'Post type cannot be changed'; end if;
  if exists(select 1 from public.ride_offers where post_id=target_id) or exists(select 1 from public.event_rsvps where event_id=target_id) then raise exception 'Posts with attendance or ride arrangements require a coordinated update'; end if;
 end if;
 if category is null or not exists(select 1 from public.categories where id=category and (active or id=existing.category_id)) then raise exception 'Choose an active category'; end if;
 if kind='event' then
  start_time := (content->>'starts_at')::timestamptz;
  end_time := nullif(content->>'ends_at','')::timestamptz;
  zone := coalesce(content->>'timezone','Pacific/Auckland');
  if start_time is null or length(trim(coalesce(content->>'event_location',''))) not between 1 and 300 or not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) or (end_time is not null and end_time<=start_time) then raise exception 'Valid event dates, timezone and location are required'; end if;
 end if;
 if target_id is null then
  insert into public.posts(author_id,category_id,post_type,title,description,status,availability,conditions,location)
  values(actor,category,kind,trim(content->>'title'),trim(content->>'description'),state,coalesce(content->>'availability',''),coalesce(content->>'conditions',''),coalesce(content->>'location','')) returning id into result;
 else
  result := target_id;
  update public.posts set category_id=category,title=trim(content->>'title'),description=trim(content->>'description'),status=state,availability=coalesce(content->>'availability',''),conditions=coalesce(content->>'conditions',''),location=coalesce(content->>'location',''),updated_at=clock_timestamp() where id=result;
 end if;
 if kind='event' then
  insert into public.events(post_id,organiser_id,starts_at,ends_at,timezone,location,status)
  values(result,actor,start_time,end_time,zone,trim(content->>'event_location'),case when state='cancelled' then 'cancelled' else 'scheduled' end)
  on conflict(post_id) do update set starts_at=excluded.starts_at,ends_at=excluded.ends_at,timezone=excluded.timezone,location=excluded.location,status=excluded.status;
 end if;
 return result;
end $$;

create function public.write_comment(target_post uuid, comment_id uuid, comment_body text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; parent public.posts;
begin
 if not private.is_member() then raise exception 'Active membership required'; end if;
 select * into parent from public.posts where id=target_post for update;
 if not found then raise exception 'Post unavailable'; end if;
 if length(trim(comment_body)) not between 1 and 10000 or comment_body is null then raise exception 'Comment must contain 1 to 10000 characters'; end if;
 if parent.status in ('archived','cancelled') then raise exception 'Comments are closed on this post'; end if;
 if comment_id is null then
  insert into public.comments(post_id,author_id,body) values(target_post,auth.uid(),trim(comment_body)) returning id into result;
 else
  update public.comments set body=trim(comment_body),updated_at=clock_timestamp() where id=comment_id and post_id=target_post and author_id=auth.uid() returning id into result;
  if result is null then raise exception 'Only the author can edit this comment'; end if;
 end if;
 return result;
end $$;
create function public.delete_comment(target_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not private.is_member() then raise exception 'Active membership required'; end if;
 delete from public.comments where id=target_id and (author_id=auth.uid() or private.is_admin());
 if not found then raise exception 'Only the author or administrator can delete this comment'; end if;
end $$;
create function public.set_saved_post(target_id uuid, should_save boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not private.is_member() then raise exception 'Active membership required'; end if;
 perform 1 from public.posts where id=target_id for key share;
 if not found then raise exception 'Post unavailable'; end if;
 if should_save then insert into public.saved_posts(user_id,post_id) values(auth.uid(),target_id) on conflict do nothing;
 else delete from public.saved_posts where user_id=auth.uid() and post_id=target_id; end if;
end $$;

create function public.attach_post_photo(target_post uuid, object_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; owner uuid;
begin
 if not private.is_member() then raise exception 'Active membership required'; end if;
 select author_id into owner from public.posts where id=target_post for update;
 if owner is distinct from auth.uid() then raise exception 'Only the author can add photos'; end if;
 if object_name !~ ('^' || auth.uid()::text || '/' || target_post::text || '/[0-9a-f-]{36}\.webp$') or not exists(select 1 from storage.objects where bucket_id='community-photos' and name=object_name) then raise exception 'Validated upload required'; end if;
 if (select count(*) from public.post_photos where post_id=target_post)>=6 then raise exception 'A post can have up to six photos'; end if;
 insert into public.post_photos(post_id,uploader_id,object_path,position) values(target_post,auth.uid(),object_name,(select coalesce(max(position)+1,0) from public.post_photos where post_id=target_post)) returning id into result;
 return result;
end $$;
create function public.remove_post_photo(target_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare photo public.post_photos; owner uuid;
begin
 if not private.is_member() then raise exception 'Active membership required'; end if;
 select * into photo from public.post_photos where id=target_id;
 select author_id into owner from public.posts where id=photo.post_id for update;
 if owner is distinct from auth.uid() then raise exception 'Only the author can remove photos'; end if;
 delete from public.post_photos where id=target_id;
 insert into public.photo_cleanup(object_path) values(photo.object_path) on conflict do nothing;
 return photo.object_path;
end $$;
create function public.delete_post(target_id uuid) returns text[]
language plpgsql security definer set search_path='' as $$
declare parent public.posts; paths text[];
begin
 if not private.is_member() then raise exception 'Active membership required'; end if;
 select * into parent from public.posts where id=target_id for update;
 if not found or (parent.author_id<>auth.uid() and not private.is_admin()) then raise exception 'Only the author or administrator can delete this post'; end if;
 if exists(select 1 from public.ride_offers where post_id=target_id) or exists(select 1 from public.event_rsvps where event_id=target_id) then raise exception 'Cancel existing attendance or ride arrangements before deleting'; end if;
 select coalesce(array_agg(object_path),array[]::text[]) into paths from public.post_photos where post_id=target_id;
 insert into public.photo_cleanup(object_path) select unnest(paths) on conflict do nothing;
 delete from public.post_photos where post_id=target_id;
 delete from public.comments where post_id=target_id;
 delete from public.saved_posts where post_id=target_id;
 delete from public.notifications where post_id=target_id;
 delete from public.events where post_id=target_id;
 delete from public.posts where id=target_id;
 return paths;
end $$;

create function public.noticeboard_feed(search_text text default '', category_filter uuid default null, type_filter text default null, status_filter text default null, saved_only boolean default false, before_time timestamptz default null, before_id uuid default null, page_size integer default 20)
returns setof public.posts language sql stable security invoker set search_path='' as $$
 select p.* from public.posts p
 where (coalesce(search_text,'')='' or p.search_document @@ websearch_to_tsquery('english',left(search_text,200)))
 and (category_filter is null or p.category_id=category_filter)
 and (type_filter is null or p.post_type=type_filter)
 and (status_filter is null or p.status=status_filter)
 and (not saved_only or exists(select 1 from public.saved_posts s where s.post_id=p.id and s.user_id=auth.uid()))
 and (before_time is null or before_id is null or (p.created_at,p.id)<(before_time,before_id))
 order by p.created_at desc,p.id desc limit greatest(1,least(coalesce(page_size,20),50));
$$;
-- An unattached or deleted photo can never be downloaded, even by an active member.
drop policy private_photos on storage.objects;
create policy private_photos on storage.objects for select to authenticated using(bucket_id='community-photos' and private.is_member() and exists(select 1 from public.post_photos p where p.object_path=name));
-- All bytes enter through the validated server upload route. No browser INSERT policy.
revoke all on function public.write_post(uuid,jsonb),public.write_comment(uuid,uuid,text),public.delete_comment(uuid),public.set_saved_post(uuid,boolean),public.attach_post_photo(uuid,text),public.remove_post_photo(uuid),public.delete_post(uuid),public.noticeboard_feed(text,uuid,text,text,boolean,timestamptz,uuid,integer) from public,anon,authenticated;
grant execute on function public.write_post(uuid,jsonb),public.write_comment(uuid,uuid,text),public.delete_comment(uuid),public.set_saved_post(uuid,boolean),public.attach_post_photo(uuid,text),public.remove_post_photo(uuid),public.delete_post(uuid),public.noticeboard_feed(text,uuid,text,text,boolean,timestamptz,uuid,integer) to authenticated;
