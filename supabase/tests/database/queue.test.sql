begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com');
insert into public.clips (id, user_id, boat_class, side, seat) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', '1x', 'scull', 1),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a', '1x', 'scull', 1),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000000a', '1x', 'scull', 1),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', '1x', 'scull', 1);
insert into public.jobs (clip_id, user_id, state, queued_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'queued', now() - interval '3 minutes'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a', 'queued', now() - interval '2 minutes'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000000a', 'queued', now() - interval '90 seconds'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'queued', now() - interval '1 minute');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is(public.queue_position('00000000-0000-0000-0000-0000000000b1'), 2, 'a first clip waits only behind other first clips');
select is(public.queue_position('00000000-0000-0000-0000-0000000000a2'), null, 'an athlete cannot see the place of another clip');
reset role;

select is((with claimed as materialized (select public.claim_job('w1', 60) as id) select j.clip_id from public.jobs j join claimed c on c.id = j.id), '00000000-0000-0000-0000-0000000000a1', 'the oldest first clip goes first');
select is((with claimed as materialized (select public.claim_job('w2', 60) as id) select j.clip_id from public.jobs j join claimed c on c.id = j.id), '00000000-0000-0000-0000-0000000000b1', 'another athlete''s first clip beats a second clip');
select is((with claimed as materialized (select public.claim_job('w3', 60) as id) select j.clip_id from public.jobs j join claimed c on c.id = j.id), '00000000-0000-0000-0000-0000000000a2', 'then second clips run');
select is((select state::text from public.jobs where clip_id = '00000000-0000-0000-0000-0000000000a1'), 'running', 'a claimed job is running');
select is((select attempts from public.jobs where clip_id = '00000000-0000-0000-0000-0000000000a1'), 1, 'a claim counts as an attempt');

update public.jobs set locked_until = now() - interval '1 second' where clip_id = '00000000-0000-0000-0000-0000000000a1';
select is(public.release_expired_jobs(2), 1, 'a job with a dead worker is released');
select is((select state::text from public.jobs where clip_id = '00000000-0000-0000-0000-0000000000a1'), 'queued', 'it goes back in the queue');

update public.jobs set attempts = 2, state = 'running', locked_until = now() - interval '1 second' where clip_id = '00000000-0000-0000-0000-0000000000a1';
select is(public.release_expired_jobs(2), 1, 'a second failure is released too');
select is((select state::text from public.jobs where clip_id = '00000000-0000-0000-0000-0000000000a1'), 'failed', 'after a retry it fails');

set local role authenticated;
select throws_ok($$ select public.claim_job('x', 60) $$, '42501', null, 'an athlete cannot claim a job');
select throws_ok($$ update public.jobs set cancel_requested = true $$, '42501', null, 'jobs change only through their functions');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select public.cancel_job('00000000-0000-0000-0000-0000000000a3');
select is((select state::text from public.jobs where clip_id = '00000000-0000-0000-0000-0000000000a3'), 'cancelled', 'a waiting job cancels at once');
select public.cancel_job('00000000-0000-0000-0000-0000000000a2');
select is((select cancel_requested from public.jobs where clip_id = '00000000-0000-0000-0000-0000000000a2'), true, 'a running job is asked to stop');
select public.cancel_job('00000000-0000-0000-0000-0000000000b1');
reset role;
select is((select state::text from public.jobs where clip_id = '00000000-0000-0000-0000-0000000000b1'), 'running', 'an athlete cannot cancel another job');

update public.jobs set state = 'needs_tap', pause = '{}', attempts = 2 where clip_id = '00000000-0000-0000-0000-0000000000a2';
set local role authenticated;
select public.give_tap('00000000-0000-0000-0000-0000000000a2', '{"t":1,"x":0.5,"y":0.5}');
reset role;
select is((select state::text from public.jobs where clip_id = '00000000-0000-0000-0000-0000000000a2'), 'queued', 'a new tap puts the job back in the queue');
select is((select attempts from public.jobs where clip_id = '00000000-0000-0000-0000-0000000000a2'), 0, 'a new tap starts its tries again');
select is((select tap ->> 'x' from public.clips where id = '00000000-0000-0000-0000-0000000000a2'), '0.5', 'the new tap is saved');

select * from finish();
rollback;
