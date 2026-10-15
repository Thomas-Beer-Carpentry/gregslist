begin;
create extension if not exists pgtap with schema extensions;
select plan(27);
select ok(not has_function_privilege('authenticated','public.prepare_account_erasure(uuid)','execute'),'A member cannot choose an erasure target directly');
select ok(not has_function_privilege('anon','public.prepare_account_erasure(uuid)','execute'),'Anonymous callers cannot erase accounts');
select ok(has_function_privilege('service_role','public.prepare_account_erasure(uuid)','execute'),'Reauthenticated server can prepare erasure');
select ok(not has_function_privilege('authenticated','public.purge_expired_erasure_history()','execute'),'Retention purge is server only');
select ok(not has_table_privilege('authenticated','public.account_erasure_jobs','select'),'Erasure jobs remain private');
insert into auth.users(id,email,email_confirmed_at) values
 ('66660000-0000-4000-8000-000000000001','privacy-admin@example.test',now()),
 ('66660000-0000-4000-8000-000000000002','privacy-owner@example.test',now()),
 ('66660000-0000-4000-8000-000000000003','privacy-other@example.test',now());
insert into public.profiles(id,display_name,bio) values
 ('66660000-0000-4000-8000-000000000001','Privacy administrator',''),
 ('66660000-0000-4000-8000-000000000002','Identifying owner','Identifying biography'),
 ('66660000-0000-4000-8000-000000000003','Unrelated member','Keep this profile');
insert into public.memberships(user_id,role) values
 ('66660000-0000-4000-8000-000000000001','admin'),
 ('66660000-0000-4000-8000-000000000002','member'),
 ('66660000-0000-4000-8000-000000000003','member');
insert into public.posts(id,author_id,category_id,post_type,title,description) values
 ('66660000-0000-4000-8000-000000000011','66660000-0000-4000-8000-000000000002',(select id from public.categories where name='General'),'discussion','Identifying title','Identifying text'),
 ('66660000-0000-4000-8000-000000000012','66660000-0000-4000-8000-000000000003',(select id from public.categories where name='General'),'discussion','Unrelated title','Keep this text');
insert into public.comments(post_id,author_id,body) values
 ('66660000-0000-4000-8000-000000000012','66660000-0000-4000-8000-000000000002','Remove my authored comment'),
 ('66660000-0000-4000-8000-000000000011','66660000-0000-4000-8000-000000000003','Retain my thread context until expiry');
insert into public.posts(id,author_id,category_id,post_type,title,description,status) values('66660000-0000-4000-8000-000000000013','66660000-0000-4000-8000-000000000002',(select id from public.categories where name='General'),'event','Past private event','Erase this text','completed');
insert into public.events(post_id,organiser_id,starts_at,location,status) values('66660000-0000-4000-8000-000000000013','66660000-0000-4000-8000-000000000002',now()-interval '1 year','Erase this location','completed');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select lives_ok($$select public.prepare_account_erasure('66660000-0000-4000-8000-000000000002')$$,'Server prepares only the verified target');
select is((select count(*)::integer from public.memberships where user_id='66660000-0000-4000-8000-000000000002'),0,'Access removed immediately');
select is((select display_name from public.profiles where id='66660000-0000-4000-8000-000000000002'),'Former member','Profile name is erased');
select is((select bio from public.profiles where id='66660000-0000-4000-8000-000000000002'),'','Biography erased');
select is((select title from public.posts where id='66660000-0000-4000-8000-000000000011'),'Deleted post','Authored title erased');
select is((select status from public.events where post_id='66660000-0000-4000-8000-000000000013'),'completed','Completed event history never becomes cancelled during erasure');
select is((select status from public.posts where id='66660000-0000-4000-8000-000000000013'),'completed','Completed parent lifecycle remains historically accurate');
select is((select count(*)::integer from public.comments where author_id='66660000-0000-4000-8000-000000000002'),0,'Authored comments erased');
select is((select description from public.posts where id='66660000-0000-4000-8000-000000000012'),'Keep this text','Unrelated member content is untouched');
select is((select count(*)::integer from public.comments where post_id='66660000-0000-4000-8000-000000000011'),1,'Other members retain thread context until expiry');
select is((select count(*)::integer from public.account_erasure_jobs where user_id='66660000-0000-4000-8000-000000000002'),1,'Retry/retention job recorded');
select lives_ok($$select public.prepare_account_erasure('66660000-0000-4000-8000-000000000002')$$,'Preparation retry is idempotent');
select is(public.purge_expired_erasure_history(),0,'History cannot purge before external cleanup and retention expiry');
delete from auth.users where id='66660000-0000-4000-8000-000000000002';
update public.account_erasure_jobs set auth_deleted_at=now(),storage_deleted_at=now() where user_id='66660000-0000-4000-8000-000000000002';
select is(public.purge_expired_erasure_history(),0,'Completed erasure retains history until its deadline');
update public.account_erasure_jobs set retention_due_at=now()-interval '1 day' where user_id='66660000-0000-4000-8000-000000000002';
select is(public.purge_expired_erasure_history(),1,'Only expired completed erasure history is purged');
select is((select count(*)::integer from public.profiles where id='66660000-0000-4000-8000-000000000002'),0,'Expired pseudonym removed');
select is((select count(*)::integer from public.posts where id='66660000-0000-4000-8000-000000000012'),1,'Unrelated posts survive retention purge');
update public.memberships set role='member' where role='admin' and user_id<>'66660000-0000-4000-8000-000000000001';
select throws_ok($$select public.prepare_account_erasure('66660000-0000-4000-8000-000000000001')$$,'P0001',null,'The final administrator cannot erase themselves');
select is((select status::text from public.memberships where user_id='66660000-0000-4000-8000-000000000001'),'active','Failed erasure preserves administrator access');
select throws_ok($$delete from auth.users where id='66660000-0000-4000-8000-000000000001'$$,'P0001',null,'Operator Auth deletion also protects the final administrator');
select lives_ok($$delete from auth.users where id='66660000-0000-4000-8000-000000000003'$$,'Operator deletion of an ordinary Auth account remains possible');
select is((select count(*)::integer from public.memberships where user_id='66660000-0000-4000-8000-000000000003'),0,'Deleted Auth identities cannot leave active stale memberships');
select * from finish();
rollback;
