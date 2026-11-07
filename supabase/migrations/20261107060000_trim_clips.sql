-- An athlete can trim a clip to any length up to 60 seconds. Clips with no length keep the first 60.

alter table public.clips add column section_length_seconds numeric
  check (section_length_seconds > 0 and section_length_seconds <= 60);

drop function public.submit_clip(uuid, text, text, integer, numeric, jsonb, text, timestamptz, boolean);

create function public.submit_clip(
  clip uuid, boat text, rowing_side text, seat_number integer, section_start numeric,
  tap_point jsonb, clip_note text, filmed timestamptz, uploaded boolean, section_length numeric default null
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  athlete uuid := (select auth.uid());
  waiting integer;
begin
  if athlete is null then
    raise exception 'not_signed_in';
  end if;
  if public.boat_seats(boat) is null or seat_number not between 1 and public.boat_seats(boat) then
    raise exception 'bad_seat';
  end if;
  if (boat in ('1x', '2x', '4x')) <> (rowing_side = 'scull') or rowing_side not in ('stroke', 'bow', 'scull') then
    raise exception 'bad_side';
  end if;
  if section_length <= 0 or section_length > 60 then
    raise exception 'bad_section';
  end if;

  -- One athlete's own submissions must count one at a time.
  perform pg_advisory_xact_lock(hashtext(athlete::text));
  select count(*) into waiting from public.jobs
    where user_id = athlete and state in ('uploading', 'queued');
  if waiting >= 2 then
    raise exception 'queue_full';
  end if;

  insert into public.clips (id, user_id, note, boat_class, side, seat, section_start_seconds, section_length_seconds, tap, source_path, filmed_at)
  values (clip, athlete, nullif(trim(clip_note), ''), boat, rowing_side, seat_number, section_start, section_length, tap_point,
          athlete || '/' || clip || '/source', filmed);

  insert into public.jobs (clip_id, user_id, state, queued_at)
  values (clip, athlete,
          case when uploaded then 'queued' else 'uploading' end::public.job_state,
          case when uploaded then now() end);

  update public.profiles
    set last_setup = jsonb_build_object('boat', boat, 'side', rowing_side, 'seat', seat_number)
    where id = athlete;
end;
$$;

revoke execute on function public.submit_clip(uuid, text, text, integer, numeric, jsonb, text, timestamptz, boolean, numeric) from public, anon;
grant execute on function public.submit_clip(uuid, text, text, integer, numeric, jsonb, text, timestamptz, boolean, numeric) to authenticated;
