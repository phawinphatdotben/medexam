-- =============================================================================
-- 017: Sub-admin scope by course code + update edit policies
-- =============================================================================

create table if not exists public.sub_admin_course_scopes (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  course_code text not null references public.course_catalog(course_code) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, course_code)
);

alter table public.sub_admin_course_scopes enable row level security;

drop policy if exists "sub_admin_course_scopes_select" on public.sub_admin_course_scopes;
create policy "sub_admin_course_scopes_select"
  on public.sub_admin_course_scopes for select
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

drop policy if exists "sub_admin_course_scopes_write_admin" on public.sub_admin_course_scopes;
create policy "sub_admin_course_scopes_write_admin"
  on public.sub_admin_course_scopes for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

grant select, insert, update, delete on public.sub_admin_course_scopes to authenticated, service_role, postgres;

-- Scope test update rights for sub-admin by assigned course codes
drop policy if exists "sba_tests_update" on public.sba_tests;
create policy "sba_tests_update"
  on public.sba_tests for update
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or (
      created_by = auth.uid()
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role in ('educator', 'sub_admin', 'admin')
      )
    )
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'sub_admin')
      and exists (
        select 1 from public.sub_admin_course_scopes sc
        where sc.profile_id = auth.uid()
          and sc.course_code = sba_tests.subject_code
      )
    )
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or (
      created_by = auth.uid()
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role in ('educator', 'sub_admin', 'admin')
      )
    )
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'sub_admin')
      and exists (
        select 1 from public.sub_admin_course_scopes sc
        where sc.profile_id = auth.uid()
          and sc.course_code = sba_tests.subject_code
      )
    )
  );

drop policy if exists "meq_tests_update" on public.meq_tests;
create policy "meq_tests_update"
  on public.meq_tests for update
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or (
      created_by = auth.uid()
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role in ('educator', 'sub_admin', 'admin')
      )
    )
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'sub_admin')
      and exists (
        select 1 from public.sub_admin_course_scopes sc
        where sc.profile_id = auth.uid()
          and sc.course_code = meq_tests.course_code
      )
    )
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or (
      created_by = auth.uid()
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role in ('educator', 'sub_admin', 'admin')
      )
    )
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'sub_admin')
      and exists (
        select 1 from public.sub_admin_course_scopes sc
        where sc.profile_id = auth.uid()
          and sc.course_code = meq_tests.course_code
      )
    )
  );

