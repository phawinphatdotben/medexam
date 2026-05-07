-- =============================================================================
-- 005: Staff approval queue in profiles
-- - store requested staff role and approval status
-- - expose admin update policy to approve/reject requests
-- =============================================================================

alter table if exists public.profiles
  add column if not exists requested_role text;

alter table if exists public.profiles
  add column if not exists approval_status text not null default 'approved';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_requested_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_requested_role_check
      check (requested_role in ('student', 'educator') or requested_role is null);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_approval_status_check'
  ) then
    alter table public.profiles
      add constraint profiles_approval_status_check
      check (approval_status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

update public.profiles
set approval_status = 'approved'
where approval_status is null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, requested_role, approval_status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    case
      when new.raw_user_meta_data->>'role' in ('student', 'educator', 'admin', 'sub_admin')
      then (new.raw_user_meta_data->>'role')::public.user_role
      else 'student'::public.user_role
    end,
    case
      when new.raw_user_meta_data->>'requested_role' in ('student', 'educator')
      then new.raw_user_meta_data->>'requested_role'
      else null
    end,
    case
      when new.raw_user_meta_data->>'requested_role' = 'educator' then 'pending'
      else 'approved'
    end
  );
  return new;
end;
$$;

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role::text = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role::text = 'admin'
    )
  );

