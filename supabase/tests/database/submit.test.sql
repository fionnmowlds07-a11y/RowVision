begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select lives_ok($$ select public.submit_clip('00000000-0000-0000-0000-0000000000a1', '8+', 'bow', 3, 12, '{"t":1,"x":0.5,"y":0.5}', ' Steady state ', now(), false) $$, 'a good clip is accepted');
select is((select state::text from public.jobs), 'uploading', 'a job waits for its upload');
select is((select note from public.clips), 'Steady state', 'the note is trimmed');
select is((select source_path from public.clips), '00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-0000000000a1/source', 'the upload path is set by the server');
select is((select last_setup ->> 'seat' from public.profiles), '3', 'the setup is remembered');

select lives_ok($$ select public.finish_upload('00000000-0000-0000-0000-0000000000a1') $$, 'an upload can finish');
select is((select state::text from public.jobs), 'queued', 'a finished upload joins the queue');

select throws_ok($$ select public.submit_clip(gen_random_uuid(), '4-', 'bow', 5, 0, null, null, null, true) $$, 'P0001', 'bad_seat', 'a seat must exist in the boat');
select throws_ok($$ select public.submit_clip(gen_random_uuid(), '1x', 'bow', 1, 0, null, null, null, true) $$, 'P0001', 'bad_side', 'a scull cannot be bow side');
select throws_ok($$ select public.submit_clip(gen_random_uuid(), '8+', 'scull', 1, 0, null, null, null, true) $$, 'P0001', 'bad_side', 'an eight cannot be sculled');

select throws_ok($$ select public.submit_clip(gen_random_uuid(), '4-', 'bow', 1, 0, null, null, now(), true, 61) $$, 'P0001', 'bad_section', 'A trim cannot run over 60 seconds');
select throws_ok($$ select public.submit_clip(gen_random_uuid(), '4-', 'bow', 1, 0, null, null, now(), true, 0) $$, 'P0001', 'bad_section', 'A trim cannot be empty');
select public.submit_clip('00000000-0000-0000-0000-0000000000a2', '1x', 'scull', 1, 0, null, null, null, true);
select throws_ok($$ select public.submit_clip(gen_random_uuid(), '1x', 'scull', 1, 0, null, null, null, true) $$, 'P0001', 'queue_full', 'a third waiting clip is refused');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select lives_ok($$ select public.submit_clip(gen_random_uuid(), '1x', 'scull', 1, 0, null, null, null, true) $$, 'another athlete has their own limit');
reset role;

select * from finish();
rollback;
