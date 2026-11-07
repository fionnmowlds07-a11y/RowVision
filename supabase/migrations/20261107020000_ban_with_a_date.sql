-- Supabase Auth cannot read an infinite date, so a removed account gets a far-future ban instead.
create or replace function public.sync_approved_account() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update auth.users set banned_until = '2999-12-31' where lower(email) = old.email;
    return old;
  end if;
  update auth.users set banned_until = null where lower(email) = new.email;
  return new;
end;
$$;
