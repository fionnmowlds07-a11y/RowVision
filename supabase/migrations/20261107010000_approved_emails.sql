-- Only approved emails can join. The rule lives here so that it holds for direct API calls too.

create function public.hook_approved_email(event jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.approved_emails where email = lower(event -> 'user' ->> 'email')) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'not_approved'
  ));
end;
$$;

revoke execute on function public.hook_approved_email(jsonb) from public, anon, authenticated;
grant execute on function public.hook_approved_email(jsonb) to supabase_auth_admin;

-- The hook only runs for new users, so removing an email bans the existing account.
create function public.sync_approved_account() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update auth.users set banned_until = 'infinity' where lower(email) = old.email;
    return old;
  end if;
  update auth.users set banned_until = null where lower(email) = new.email;
  return new;
end;
$$;

revoke execute on function public.sync_approved_account() from public, anon, authenticated;

create trigger on_approved_email_changed
  after insert or delete on public.approved_emails
  for each row execute function public.sync_approved_account();
