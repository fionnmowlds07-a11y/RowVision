begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com');
insert into public.clips (id, user_id, boat_class, side, seat, working_path, video_expires_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', '8+', 'bow', 3, 'a/w.mp4', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a', '8+', 'bow', 3, 'a/x.mp4', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000000a', '8+', 'bow', 3, 'a/y.mp4', now() + interval '1 day');
insert into public.jobs (clip_id, user_id, state) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'done');
insert into public.results (clip_id, user_id, code_version, summary, frames_path) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'v', '{}', 'a/f.json');
insert into public.training_clips (clip_id, path) values ('00000000-0000-0000-0000-0000000000a2', 't/x.mp4');
insert into public.worker_status (worker_id, version) values ('w', 'v2');

select is((select count(*)::int from public.expired_clips()), 1, 'only unkept clips past their date expire');
select is((select frames[1] from public.expired_clips()), 'a/f.json', 'expiry lists the frame data too');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is(public.current_version(), 'v2', 'athletes can see the current version');
select throws_ok($$ select * from public.expired_clips() $$, '42501', null, 'athletes cannot list expired clips');
select lives_ok($$ select public.rerun_clip('00000000-0000-0000-0000-0000000000a1', '4-', 'stroke', 2) $$, 'a clip can be rerun with a new setup');
select is((select boat_class from public.clips where id = '00000000-0000-0000-0000-0000000000a1'), '4-', 'the new setup is saved');
select throws_ok($$ select public.rerun_clip('00000000-0000-0000-0000-0000000000a1', '4-', 'stroke', 2) $$, 'P0001', 'already_running', 'a clip cannot run twice at once');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select throws_ok($$ select public.rerun_clip('00000000-0000-0000-0000-0000000000a3', '8+', 'bow', 3) $$, 'P0001', 'no_video', 'an athlete cannot rerun another clip');
reset role;

update public.clips set video_deleted_at = now() where id = '00000000-0000-0000-0000-0000000000a3';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select throws_ok($$ select public.rerun_clip('00000000-0000-0000-0000-0000000000a3', '8+', 'bow', 3) $$, 'P0001', 'no_video', 'a deleted video cannot be rerun');
reset role;

select * from finish();
rollback;
