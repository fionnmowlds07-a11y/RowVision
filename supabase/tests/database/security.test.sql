begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'admin@example.com');
update public.profiles set is_admin = true where id = '00000000-0000-0000-0000-00000000000c';

insert into public.clips (id, user_id, boat_class, side, seat) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', '8+', 'bow', 3),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', '1x', 'scull', 1);
insert into public.jobs (id, clip_id, user_id) values
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b');
insert into public.results (clip_id, user_id, code_version, summary) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'v', '{}');
insert into public.approved_emails (email) values ('a@example.com');
insert into storage.objects (bucket_id, name) values
  ('working', '00000000-0000-0000-0000-00000000000a/clip.mp4'),
  ('working', '00000000-0000-0000-0000-00000000000b/clip.mp4'),
  ('training', '00000000-0000-0000-0000-00000000000b/kept.mp4');

select is(
  (select count(*)::int from pg_tables t join pg_class c on c.relname = t.tablename
     and c.relnamespace = 'public'::regnamespace
   where t.schemaname = 'public' and not c.relrowsecurity),
  0, 'every public table has row-level security');
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and column_name ~ '^(age|dob|date_of_birth|birth_date|birthday)$'),
  0, 'no date of birth is stored');
select is((select count(*)::int from public.profiles), 3, 'a new user gets a profile');

-- Athlete A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select is((select count(*)::int from public.clips), 1, 'an athlete sees only their own clip');
select is((select count(*)::int from public.jobs), 0, 'an athlete cannot see another job');
select is((select count(*)::int from public.results), 0, 'an athlete cannot see another result');
select is((select count(*)::int from public.profiles), 1, 'an athlete sees only their own profile');
select is((select count(*)::int from public.approved_emails), 0, 'an athlete cannot read the email list');
select is((select count(*)::int from storage.objects), 1, 'an athlete sees only their own files');
select is((select count(*)::int from storage.objects where bucket_id = 'training'), 0, 'an athlete cannot see training files');

select throws_ok($$ update public.profiles set is_admin = true $$, '42501', null, 'an athlete cannot make themselves admin');
select throws_ok($$ update public.jobs set state = 'done' $$, '42501', null, 'an athlete cannot change a job state');
select throws_ok($$ update public.clips set working_path = 'x' $$, '42501', null, 'an athlete cannot set the working copy');
select throws_ok($$ insert into public.results (clip_id, user_id, code_version, summary) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'v', '{}') $$, '42501', null, 'an athlete cannot write a result');
select throws_ok($$ insert into public.approved_emails (email) values ('x@example.com') $$, '42501', null, 'an athlete cannot approve an email');
select throws_ok($$ insert into public.clips (user_id, boat_class, side, seat) values ('00000000-0000-0000-0000-00000000000b', '8+', 'bow', 1) $$, '42501', null, 'an athlete cannot add a clip for someone else');
select throws_ok($$ insert into public.feedback (clip_id, user_id, kind) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000a', 'other') $$, '42501', null, 'an athlete cannot report on another clip');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('uploads', '00000000-0000-0000-0000-00000000000b/x.mp4') $$, '42501', null, 'an athlete cannot upload into another folder');

select lives_ok($$ update public.clips set note = 'hello' $$, 'an athlete can change their own note');
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('uploads', '00000000-0000-0000-0000-00000000000a/x.mp4') $$, 'an athlete can upload into their own folder');

update public.clips set note = 'hijack' where id = '00000000-0000-0000-0000-0000000000b1';
delete from public.clips where id = '00000000-0000-0000-0000-0000000000b1';
reset role;
select is((select note from public.clips where id = '00000000-0000-0000-0000-0000000000b1'), null, 'another clip was not changed or deleted');

-- Signed out
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select * from public.clips $$, '42501', null, 'signed-out visitors cannot read clips');
select is((select count(*)::int from storage.objects), 0, 'signed-out visitors see no files');
reset role;

-- Admin
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is((select count(*)::int from public.clips), 2, 'the admin sees every clip');
select is((select count(*)::int from public.results), 1, 'the admin sees every result');
select is((select count(*)::int from storage.objects), 4, 'the admin sees every file');
select lives_ok($$ insert into public.approved_emails (email) values ('new@example.com') $$, 'the admin can approve an email');
select lives_ok($$ insert into public.admin_access_log (admin_id, clip_id, action) values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000b1', 'opened') $$, 'the admin can log a view');
select throws_ok($$ delete from public.admin_access_log $$, '42501', null, 'the access log cannot be deleted');
reset role;

select is(public.hook_approved_email('{"user":{"email":"A@Example.com"}}'), '{}'::jsonb, 'an approved email can join, whatever its case');
select is(public.hook_approved_email('{"user":{"email":"stranger@example.com"}}') -> 'error' ->> 'message', 'not_approved', 'an unapproved email is turned away');
delete from public.approved_emails where email = 'a@example.com';
select isnt((select banned_until from auth.users where email = 'a@example.com'), null, 'removing an email stops that account');
select ok(isfinite((select banned_until from auth.users where email = 'a@example.com')), 'the ban date is one that Auth can read');
insert into public.approved_emails (email) values ('a@example.com');
select is((select banned_until from auth.users where email = 'a@example.com'), null, 'approving it again restores the account');

select * from finish();
rollback;
