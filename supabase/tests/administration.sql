begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

select ok(not has_table_privilege('authenticated','public.memberships','update'),'Membership states and roles require authorised APIs');
select ok(not has_table_privilege('authenticated','public.memberships','insert'),'A member cannot manufacture membership approval');
select ok(not has_table_privilege('authenticated','public.admin_audit','insert'),'Audit entries cannot be forged');
select ok(not has_table_privilege('authenticated','public.admin_audit','update'),'Audit entries cannot be rewritten');
select ok(not has_table_privilege('authenticated','public.admin_audit','delete'),'Audit entries cannot be removed by application accounts');
select ok((select relrowsecurity from pg_class where oid='public.admin_audit'::regclass),'Administrative history enforces RLS');
select ok(has_column_privilege('authenticated','public.profiles','bio','update'),'Members can edit their short biography through owner RLS');
select ok(not has_column_privilege('authenticated','public.profiles','id','update'),'Profile identity is protected');
select ok(not has_function_privilege('anon','public.create_member_invitation(text,text)','execute'),'Anonymous accounts cannot generate invitation secrets');
select ok(not has_function_privilege('anon','public.accept_member_invitation(uuid,text)','execute'),'Invitation redemption requires authenticated email ownership');
select ok(not has_function_privilege('anon','public.set_member_status(uuid,text)','execute'),'Anonymous accounts cannot manage membership');
select ok(not has_function_privilege('anon','public.set_member_role(uuid,text)','execute'),'Anonymous accounts cannot manage administrators');
select ok(not has_function_privilege('anon','public.member_directory(text)','execute'),'Member directory is private');
select ok(not has_function_privilege('anon','public.admin_members(text)','execute'),'Administrator member search is private');
select ok(not has_function_privilege('authenticated','public.invitation_verification(uuid,text,text)','execute'),'Mail-verification details are service-only');
select ok(has_function_privilege('service_role','public.invitation_verification(uuid,text,text)','execute'),'Server Auth mail adapter can verify invitations');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.set_member_status(uuid,text)'::regprocedure),'Status management has controlled security-definer execution');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.set_member_role(uuid,text)'::regprocedure),'Role management has controlled security-definer execution');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.accept_member_invitation(uuid,text)'::regprocedure),'Redemption has controlled security-definer execution');
select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='invitations' and column_name='token_hash'),'Invitation storage records hashes');
select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='invitations' and column_name in('token','raw_token')),'Invitation storage has no plaintext token column');
select ok(not has_column_privilege('authenticated','public.invitations','token_hash','select'),'Even administrator application JWTs cannot query invitation hashes');
select ok(has_column_privilege('service_role','public.invitations','token_hash','select'),'Server verification can access stored hashes');

-- All fixture creation and temporary role changes stay inside this transaction.
-- Existing accounts are never committed in a modified state.
insert into auth.users(id,email,email_confirmed_at) values
 ('55550000-0000-4000-8000-000000000001','phase5-final-admin-a@example.test',now()),
 ('55550000-0000-4000-8000-000000000002','phase5-final-admin-b@example.test',now()),
 ('55550000-0000-4000-8000-000000000003','phase5-unverified@example.test',null);
insert into public.profiles(id,display_name) values
 ('55550000-0000-4000-8000-000000000001','Rollback administrator A'),
 ('55550000-0000-4000-8000-000000000002','Rollback administrator B');
insert into public.memberships(user_id,role) values
 ('55550000-0000-4000-8000-000000000001','admin'),
 ('55550000-0000-4000-8000-000000000002','admin');
update public.memberships set role='member' where role='admin' and user_id not in('55550000-0000-4000-8000-000000000001','55550000-0000-4000-8000-000000000002');
select set_config('request.jwt.claims','{"sub":"55550000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','55550000-0000-4000-8000-000000000001',true);
set local role authenticated;
select lives_ok($$select public.set_member_role('55550000-0000-4000-8000-000000000002','member')$$,'An administrator may demote another while one active administrator remains');
select throws_ok($$select public.set_member_role('55550000-0000-4000-8000-000000000001','member')$$,'P0001',null,'Final administrator cannot self-demote');
select throws_ok($$select public.set_member_status('55550000-0000-4000-8000-000000000001','suspended')$$,'P0001',null,'Final administrator cannot be suspended');
select throws_ok($$select public.set_member_status('55550000-0000-4000-8000-000000000001','removed')$$,'P0001',null,'Final administrator cannot be removed');
reset role;
select is((select count(*)::integer from public.memberships where status='active' and role='admin'),1,'All failed final-administrator operations preserve the last administrator');
select is((select count(*)::integer from public.admin_audit where action='administrator_revoked' and target_member_id='55550000-0000-4000-8000-000000000002'),1,'Successful role change has one audit entry');
select throws_ok($$update public.memberships set role='member' where user_id='55550000-0000-4000-8000-000000000001'; set constraints all immediate$$,'P0001',null,'Deferred constraint also protects the last administrator from privileged direct demotion');
select throws_ok($$update public.memberships set status='suspended' where user_id='55550000-0000-4000-8000-000000000001'; set constraints all immediate$$,'P0001',null,'Deferred constraint also protects the last administrator from privileged direct suspension');
select throws_ok($$delete from public.memberships where user_id='55550000-0000-4000-8000-000000000001'; set constraints all immediate$$,'P0001',null,'Deferred constraint also protects the last administrator from privileged membership deletion');
-- Auth ordinarily withholds sessions from unconfirmed email/password accounts;
-- this direct authenticated-claim check independently proves the backend guard.
create temporary table unverified_invitation as select public.create_member_invitation('phase5-unverified@example.test','copy') as invitation;
grant select on unverified_invitation to authenticated;
select set_config('request.jwt.claims','{"sub":"55550000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','55550000-0000-4000-8000-000000000003',true);
set local role authenticated;
select throws_ok($$select public.accept_member_invitation((select (invitation->>'id')::uuid from unverified_invitation),(select invitation->>'token' from unverified_invitation))$$,'P0001',null,'Unverified intended email cannot redeem an otherwise valid token');
reset role;
select * from finish();
rollback;
