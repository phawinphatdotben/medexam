-- Allow sub_admin to update review/committee for tests in their subject/year scope
-- (any committee membership that matches the test subject and year, not only the test's committee_id)

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
        select 1
        from public.committee_members cm
        join public.committees c on c.id = cm.committee_id
        where cm.profile_id = auth.uid()
          and (c.subject is null or c.subject = sba_tests.subject)
          and (c.test_year is null or c.test_year = sba_tests.test_year)
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
        select 1
        from public.committee_members cm
        join public.committees c on c.id = cm.committee_id
        where cm.profile_id = auth.uid()
          and (c.subject is null or c.subject = meq_tests.subject)
          and (c.test_year is null or c.test_year = meq_tests.test_year)
      )
    )
  );
