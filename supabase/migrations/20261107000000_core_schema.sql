-- Core tables, row-level security and storage for the preview.
-- Athletes reach only their own data. The admin can read everything. The worker uses the service role.
-- Tables are closed by default: Supabase grants everything to app roles, so that is revoked and each
-- right is given back by column.

create type public.job_state as enum (
  'uploading', 'queued', 'running', 'needs_tap', 'done', 'failed', 'cancelled'
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  is_admin boolean not null default false,
  last_setup jsonb,
  ground_colour text check (ground_colour ~ '^#[0-9a-f]{6}$'),
  highlight_colour text check (highlight_colour ~ '^#[0-9a-f]{6}$'),
  created_at timestamptz not null default now()
);

create table public.approved_emails (
  email text primary key check (email = lower(email)),
  note text check (char_length(note) <= 200),
  added_by uuid references public.profiles (id) on delete set null,
  added_at timestamptz not null default now()
);

create table public.clips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  note text check (char_length(note) <= 200),
  boat_class text not null check (boat_class in ('1x', '2x', '2-', '4x', '4-', '4+', '8+')),
  side text not null check (side in ('stroke', 'bow', 'scull')),
  seat integer not null check (seat between 1 and 8),
  section_start_seconds numeric not null default 0 check (section_start_seconds >= 0),
  tap jsonb,
  source_path text,
  working_path text,
  filmed_at timestamptz,
  duration_seconds numeric,
  fps numeric,
  frames integer,
  width integer,
  height integer,
  video_expires_at timestamptz,
  video_deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index clips_user_created on public.clips (user_id, created_at desc);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  state public.job_state not null default 'uploading',
  stage text,
  progress numeric check (progress between 0 and 1),
  attempts integer not null default 0,
  locked_by text,
  locked_until timestamptz,
  cancel_requested boolean not null default false,
  error text,
  created_at timestamptz not null default now(),
  queued_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz
);
create index jobs_waiting on public.jobs (queued_at) where state = 'queued';
create index jobs_clip on public.jobs (clip_id);

create table public.results (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete set null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  code_version text not null,
  summary jsonb not null,
  accuracy numeric,
  band text,
  overall numeric,
  frames_path text,
  created_at timestamptz not null default now()
);
create index results_clip on public.results (clip_id, created_at desc);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips (id) on delete cascade,
  result_id uuid references public.results (id) on delete set null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('wrong_rower', 'angle_off', 'other')),
  message text check (char_length(message) <= 1000),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- Keeps its rows when a clip goes, as a record of who opened what.
create table public.admin_access_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null references public.profiles (id) on delete cascade,
  clip_id uuid,
  action text not null,
  created_at timestamptz not null default now()
);

create table public.worker_status (
  worker_id text primary key,
  version text,
  device text,
  last_seen timestamptz not null default now()
);

create table public.training_clips (
  clip_id uuid primary key references public.clips (id) on delete cascade,
  path text not null,
  kept_by uuid references public.profiles (id) on delete set null,
  kept_at timestamptz not null default now()
);

-- Security definer so that policies on profiles can call it without recursing.
create function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select is_admin from public.profiles where id = (select auth.uid())), false);
$$;

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

alter table public.profiles enable row level security;
alter table public.approved_emails enable row level security;
alter table public.clips enable row level security;
alter table public.jobs enable row level security;
alter table public.results enable row level security;
alter table public.feedback enable row level security;
alter table public.admin_access_log enable row level security;
alter table public.worker_status enable row level security;
alter table public.training_clips enable row level security;

grant select on public.profiles to authenticated;
grant update (display_name, last_setup, ground_colour, highlight_colour) on public.profiles to authenticated;
create policy "read own profile, or any as admin" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());
create policy "change own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

grant select, insert, delete, update (note) on public.approved_emails to authenticated;
create policy "admin manages emails" on public.approved_emails for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, delete on public.clips to authenticated;
grant insert (user_id, note, boat_class, side, seat, section_start_seconds, tap, source_path, filmed_at)
  on public.clips to authenticated;
grant update (note, boat_class, side, seat, tap) on public.clips to authenticated;
create policy "read own clips, or any as admin" on public.clips for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
create policy "add own clips" on public.clips for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "change own clips" on public.clips for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "delete own clips" on public.clips for delete to authenticated
  using (user_id = (select auth.uid()));

grant select on public.jobs to authenticated;
grant update (cancel_requested) on public.jobs to authenticated;
create policy "read own jobs, or any as admin" on public.jobs for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
create policy "cancel own jobs" on public.jobs for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select on public.results to authenticated;
create policy "read own results, or any as admin" on public.results for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

grant select on public.feedback to authenticated;
grant insert (clip_id, result_id, user_id, kind, message) on public.feedback to authenticated;
grant update (resolved_at) on public.feedback to authenticated;
create policy "read own feedback, or any as admin" on public.feedback for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
create policy "report on own clips" on public.feedback for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.clips where id = clip_id and user_id = (select auth.uid()))
  );
create policy "admin resolves feedback" on public.feedback for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select on public.admin_access_log to authenticated;
grant insert (admin_id, clip_id, action) on public.admin_access_log to authenticated;
create policy "admin reads the log" on public.admin_access_log for select to authenticated
  using (public.is_admin());
create policy "admin adds to the log" on public.admin_access_log for insert to authenticated
  with check (public.is_admin() and admin_id = (select auth.uid()));

grant select on public.worker_status to authenticated;
create policy "admin reads worker status" on public.worker_status for select to authenticated
  using (public.is_admin());

grant select, insert, delete on public.training_clips to authenticated;
create policy "admin manages training clips" on public.training_clips for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Each athlete's files sit under a folder named after their user id.
insert into storage.buckets (id, name, public, file_size_limit) values
  ('uploads', 'uploads', false, 4294967296),
  ('working', 'working', false, null),
  ('frames', 'frames', false, null),
  ('training', 'training', false, null);

create policy "upload to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "resume own uploads" on storage.objects for update to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "read own files" on storage.objects for select to authenticated
  using (
    bucket_id in ('uploads', 'working', 'frames')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "admin reads all files" on storage.objects for select to authenticated
  using (bucket_id in ('uploads', 'working', 'frames', 'training') and public.is_admin());
