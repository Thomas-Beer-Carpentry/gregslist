-- Files queued for deletion cannot be reattached during asynchronous cleanup.
create or replace function public.attach_post_photo(target_post uuid, object_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; owner uuid;
begin
 if not private.is_member() then raise exception 'Active membership required'; end if;
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
revoke all on function public.attach_post_photo(uuid,text) from public,anon;
grant execute on function public.attach_post_photo(uuid,text) to authenticated;
alter table public.events add constraint finite_event_dates check(isfinite(starts_at) and (ends_at is null or isfinite(ends_at)));
