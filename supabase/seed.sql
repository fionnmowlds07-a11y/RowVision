-- Local development only. Hosted accounts are approved on the admin page.
insert into public.approved_emails (email, note) values
  ('admin@example.com', 'Local admin'),
  ('athlete@example.com', 'Local athlete');

-- The local admin is promoted as soon as that account signs in for the first time.
create or replace function public.seed_local_admin() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.id in (select id from auth.users where email = 'admin@example.com') then
    new.is_admin := true;
  end if;
  return new;
end;
$$;
create trigger seed_local_admin before insert on public.profiles
  for each row execute function public.seed_local_admin();
