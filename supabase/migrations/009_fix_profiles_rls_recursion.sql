-- =============================================================================
-- 009: Fix recursive RLS on public.profiles
-- =============================================================================

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role::text
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

grant execute on function public.current_user_role() to authenticated, service_role;

drop policy if exists "profiles_select_staff" on public.profiles;
create policy "profiles_select_staff"
  on public.profiles for select
  using (public.current_user_role() in ('educator', 'admin', 'sub_admin'));

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
  on public.profiles for update
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

