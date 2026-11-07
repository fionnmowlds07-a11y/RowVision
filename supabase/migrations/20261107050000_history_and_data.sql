-- Reruns, the current analysis version, and what athletes need to delete their own files.

create function public.current_version() returns text
language sql stable security definer set search_path = ''
as $$
  select version from public.worker_status order by last_seen desc limit 1;
$$;

-- A rerun reuses the kept section, so it needs the video to still exist.
create function public.rerun_clip(clip uuid, boat text, rowing_side text, seat_number integer) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  athlete uuid := (select auth.uid());
  waiting integer;
begin
  if public.boat_seats(boat) is null or seat_number not between 1 and public.boat_seats(boat) then
    raise exception 'bad_seat';
  end if;
  if (boat in ('1x', '2x', '4x')) <> (rowing_side = 'scull') or rowing_side not in ('stroke', 'bow', 'scull') then
    raise exception 'bad_side';
  end if;
  perform pg_advisory_xact_lock(hashtext(athlete::text));
  if not exists (
    select 1 from public.clips
    where id = clip and user_id = athlete and working_path is not null and video_deleted_at is null
  ) then
    raise exception 'no_video';
  end if;
  if exists (
    select 1 from public.jobs
    where clip_id = clip and state in ('uploading', 'queued', 'running', 'needs_tap')
  ) then
    raise exception 'already_running';
  end if;
  select count(*) into waiting from public.jobs where user_id = athlete and state in ('uploading', 'queued');
  if waiting >= 2 then
    raise exception 'queue_full';
  end if;
  update public.clips set boat_class = boat, side = rowing_side, seat = seat_number where id = clip;
  insert into public.jobs (clip_id, user_id, state, queued_at) values (clip, athlete, 'queued', now());
end;
$$;

revoke execute on function public.current_version() from public, anon;
revoke execute on function public.rerun_clip(uuid, text, text, integer) from public, anon;
grant execute on function public.current_version() to authenticated;
grant execute on function public.rerun_clip(uuid, text, text, integer) to authenticated;

create policy "delete own files" on storage.objects for delete to authenticated
  using (
    bucket_id in ('uploads', 'working', 'frames')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "admin manages training files" on storage.objects for insert to authenticated
  with check (bucket_id = 'training' and public.is_admin());

-- Clips whose video has passed its date and has not yet been kept for training.
create function public.expired_clips() returns table (clip uuid, working text, frames text[])
language sql stable security definer set search_path = ''
as $$
  select c.id, c.working_path,
    coalesce(array_agg(r.frames_path) filter (where r.frames_path is not null), '{}')
  from public.clips c
  left join public.results r on r.clip_id = c.id
  where c.video_expires_at < now() and c.video_deleted_at is null
    and not exists (select 1 from public.training_clips t where t.clip_id = c.id)
  group by c.id;
$$;

revoke execute on function public.expired_clips() from public, anon, authenticated;
grant execute on function public.expired_clips() to service_role;
