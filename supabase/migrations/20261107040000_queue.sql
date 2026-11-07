-- The job queue. The worker runs claim_job and release_expired_jobs. Athletes use the rest.

alter table public.jobs add column pause jsonb;

-- Everyone's first clip goes before anyone's second, and a running clip counts as a turn taken.
create function public.claim_job(worker text, lease_seconds integer) returns uuid
language sql security definer set search_path = ''
as $$
  with active as (
    select user_id, count(*) as running from public.jobs where state = 'running' group by user_id
  ), ranked as (
    select j.id, j.queued_at,
      row_number() over (partition by j.user_id order by j.queued_at) + coalesce(a.running, 0) as turn
    from public.jobs j left join active a using (user_id)
    where j.state = 'queued'
  ), pick as (
    select j.id from public.jobs j join ranked r on r.id = j.id
    order by r.turn, r.queued_at
    for update of j skip locked
    limit 1
  )
  update public.jobs j set
    state = 'running', locked_by = worker, attempts = j.attempts + 1, error = null,
    locked_until = now() + make_interval(secs => lease_seconds),
    started_at = coalesce(j.started_at, now()), stage = 'Getting ready', progress = null
  from pick where j.id = pick.id
  returning j.id;
$$;

-- A job whose worker stopped renewing its lease gets one more try.
create function public.release_expired_jobs(max_attempts integer) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  released integer;
begin
  update public.jobs set
    state = case when attempts >= max_attempts then 'failed' else 'queued' end::public.job_state,
    error = case when attempts >= max_attempts then 'stopped' end,
    locked_by = null, locked_until = null,
    finished_at = case when attempts >= max_attempts then now() end
  where state = 'running' and locked_until < now();
  get diagnostics released = row_count;
  return released;
end;
$$;

revoke execute on function public.claim_job(text, integer) from public, anon, authenticated;
revoke execute on function public.release_expired_jobs(integer) from public, anon, authenticated;

-- Athletes cancel through this, so that a waiting job stops at once and a running one is asked to.
create function public.cancel_job(clip uuid) returns void
language sql security definer set search_path = ''
as $$
  update public.jobs set
    cancel_requested = state = 'running',
    state = case when state = 'running' then state else 'cancelled' end,
    finished_at = case when state = 'running' then finished_at else now() end
  where clip_id = clip and user_id = (select auth.uid())
    and state in ('uploading', 'queued', 'running', 'needs_tap');
$$;

create function public.give_tap(clip uuid, tap_point jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.clips set tap = tap_point where id = clip and user_id = (select auth.uid());
  update public.jobs set state = 'queued', queued_at = now(), pause = null, attempts = 0
    where clip_id = clip and user_id = (select auth.uid()) and state = 'needs_tap';
end;
$$;

-- Clips ahead in the same order as claim_job, or null when this job isn't waiting.
create function public.queue_position(clip uuid) returns integer
language sql stable security definer set search_path = ''
as $$
  with active as (
    select user_id, count(*) as running from public.jobs where state = 'running' group by user_id
  ), ranked as (
    select j.clip_id, j.user_id,
      row_number() over (
        order by row_number_in_turn.turn, j.queued_at
      ) as place
    from public.jobs j
    join lateral (
      select (select count(*) from public.jobs o
              where o.user_id = j.user_id and o.state = 'queued' and o.queued_at <= j.queued_at)
             + coalesce((select running from active a where a.user_id = j.user_id), 0) as turn
    ) row_number_in_turn on true
    where j.state = 'queued'
  )
  select place::integer from ranked
  where clip_id = clip and user_id = (select auth.uid());
$$;

create function public.worker_online() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.worker_status where last_seen > now() - interval '2 minutes');
$$;

revoke execute on function public.cancel_job(uuid) from public, anon;
revoke execute on function public.give_tap(uuid, jsonb) from public, anon;
revoke execute on function public.queue_position(uuid) from public, anon;
revoke execute on function public.worker_online() from public, anon;
grant execute on function public.cancel_job(uuid) to authenticated;
grant execute on function public.give_tap(uuid, jsonb) to authenticated;
grant execute on function public.queue_position(uuid) to authenticated;
grant execute on function public.worker_online() to authenticated;

revoke update on public.jobs from authenticated;
drop policy "cancel own jobs" on public.jobs;
