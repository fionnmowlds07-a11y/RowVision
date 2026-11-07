-- Submitting a clip checks the setup and the queue limit in one place, so the page cannot skip them.

create function public.boat_seats(boat text) returns integer
language sql immutable set search_path = ''
as $$
  select case boat when '1x' then 1 when '2x' then 2 when '2-' then 2 when '4x' then 4
    when '4-' then 4 when '4+' then 4 when '8+' then 8 end;
$$;

create function public.submit_clip(
  clip uuid, boat text, rowing_side text, seat_number integer, section_start numeric,
  tap_point jsonb, clip_note text, filmed timestamptz, uploaded boolean
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

  -- One athlete's own submissions must count one at a time.
  perform pg_advisory_xact_lock(hashtext(athlete::text));
  select count(*) into waiting from public.jobs
    where user_id = athlete and state in ('uploading', 'queued');
  if waiting >= 2 then
    raise exception 'queue_full';
  end if;

  insert into public.clips (id, user_id, note, boat_class, side, seat, section_start_seconds, tap, source_path, filmed_at)
  values (clip, athlete, nullif(trim(clip_note), ''), boat, rowing_side, seat_number, section_start, tap_point,
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

create function public.finish_upload(clip uuid) returns void
language sql security definer set search_path = ''
as $$
  update public.jobs set state = 'queued', queued_at = now()
    where clip_id = clip and user_id = (select auth.uid()) and state = 'uploading';
$$;

revoke execute on function public.submit_clip(uuid, text, text, integer, numeric, jsonb, text, timestamptz, boolean) from public, anon;
revoke execute on function public.finish_upload(uuid) from public, anon;
grant execute on function public.submit_clip(uuid, text, text, integer, numeric, jsonb, text, timestamptz, boolean) to authenticated;
grant execute on function public.finish_upload(uuid) to authenticated;

-- Clips are now only added through submit_clip.
revoke insert on public.clips from authenticated;
drop policy "add own clips" on public.clips;
