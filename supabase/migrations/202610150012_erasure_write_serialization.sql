-- Legacy content mutations must finish before erasure, or recheck membership
-- after its commit. Match the transport -> membership -> parent lock order.
create or replace function public.write_comment(target_post uuid, comment_id uuid, comment_body text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; parent public.posts;
begin
 perform private.transport_lock();
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

create or replace function public.delete_comment(target_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.transport_lock();
 delete from public.comments where id=target_id and (author_id=auth.uid() or private.is_admin());
 if not found then raise exception 'Only the author or administrator can delete this comment'; end if;
end $$;

create or replace function public.set_saved_post(target_id uuid, should_save boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.transport_lock();
 perform 1 from public.posts where id=target_id for key share;
 if not found then raise exception 'Post unavailable'; end if;
 if should_save then insert into public.saved_posts(user_id,post_id) values(auth.uid(),target_id) on conflict do nothing;
 else delete from public.saved_posts where user_id=auth.uid() and post_id=target_id; end if;
end $$;

create or replace function public.attach_post_photo(target_post uuid, object_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; owner uuid;
begin
 perform private.transport_lock();
 select author_id into owner from public.posts where id=target_post for update;
 if owner is distinct from auth.uid() then raise exception 'Only the author can add photos'; end if;
 if object_name !~ ('^' || auth.uid()::text || '/' || target_post::text || '/[0-9a-f-]{36}\.webp$')
 or exists(select 1 from public.photo_cleanup where object_path=object_name)
 or not exists(select 1 from storage.objects where bucket_id='community-photos' and name=object_name)
 then raise exception 'Validated upload required'; end if;
 if (select count(*) from public.post_photos where post_id=target_post)>=6 then raise exception 'A post can have up to six photos'; end if;
 insert into public.post_photos(post_id,uploader_id,object_path,position) values(target_post,auth.uid(),object_name,(select coalesce(max(position)+1,0) from public.post_photos where post_id=target_post)) returning id into result;
 return result;
end $$;

create or replace function public.remove_post_photo(target_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare photo public.post_photos; owner uuid;
begin
 perform private.transport_lock();
 select * into photo from public.post_photos where id=target_id;
 select author_id into owner from public.posts where id=photo.post_id for update;
 if owner is distinct from auth.uid() then raise exception 'Only the author can remove photos'; end if;
 delete from public.post_photos where id=target_id;
 insert into public.photo_cleanup(object_path) values(photo.object_path) on conflict do nothing;
 return photo.object_path;
end $$;

create or replace function public.delete_post(target_id uuid) returns text[]
language plpgsql security definer set search_path='' as $$
declare parent public.posts; paths text[];
begin
 perform private.transport_lock();
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

-- CREATE OR REPLACE retains established ACLs; make the member-only contract
-- explicit without adding any direct table-write permission.
revoke all on function public.write_comment(uuid,uuid,text),public.delete_comment(uuid),public.set_saved_post(uuid,boolean),public.attach_post_photo(uuid,text),public.remove_post_photo(uuid),public.delete_post(uuid) from public,anon,authenticated;
grant execute on function public.write_comment(uuid,uuid,text),public.delete_comment(uuid),public.set_saved_post(uuid,boolean),public.attach_post_photo(uuid,text),public.remove_post_photo(uuid),public.delete_post(uuid) to authenticated;

-- Profile edits remain direct owner-checked updates. PostgreSQL rechecks a row
-- changed while UPDATE waited; the row trigger sees its latest erased_at and
-- rejects stale edits. Never take the transport lock after a profile row lock.
create function private.preserve_erased_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.erased_at is not null then raise exception 'Erased profiles cannot be changed'; end if;
 return new;
end $$;
revoke all on function private.preserve_erased_profile() from public,anon,authenticated;
create trigger preserve_erased_profile before update on public.profiles for each row execute function private.preserve_erased_profile();
