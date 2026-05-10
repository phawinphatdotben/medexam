-- =============================================================================
-- 028: Allow sub_admin (course scope) to update MEQ stages and SBA questions,
--      matching meq_tests / sba_tests update rules from migration 017.
-- =============================================================================

drop policy if exists "meq_test_stages_write" on public.meq_test_stages;
create policy "meq_test_stages_write"
  on public.meq_test_stages for all
  using (
    exists (
      select 1
      from public.meq_tests t
      where t.id = meq_test_stages.meq_test_id
        and (
          t.created_by = auth.uid()
          or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
          or (
            exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'sub_admin')
            and exists (
              select 1 from public.sub_admin_course_scopes sc
              where sc.profile_id = auth.uid()
                and sc.course_code = t.course_code
            )
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.meq_tests t
      where t.id = meq_test_stages.meq_test_id
        and (
          t.created_by = auth.uid()
          or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
          or (
            exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'sub_admin')
            and exists (
              select 1 from public.sub_admin_course_scopes sc
              where sc.profile_id = auth.uid()
                and sc.course_code = t.course_code
            )
          )
        )
    )
  );

drop policy if exists "sba_test_questions_write" on public.sba_test_questions;
create policy "sba_test_questions_write"
  on public.sba_test_questions for all
  using (
    exists (
      select 1 from public.sba_tests t
      where t.id = sba_test_questions.sba_test_id
        and (
          t.created_by = auth.uid()
          or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
          or (
            exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'sub_admin')
            and exists (
              select 1 from public.sub_admin_course_scopes sc
              where sc.profile_id = auth.uid()
                and sc.course_code = t.subject_code
            )
          )
        )
    )
  )
  with check (
    exists (
      select 1 from public.sba_tests t
      where t.id = sba_test_questions.sba_test_id
        and (
          t.created_by = auth.uid()
          or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
          or (
            exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'sub_admin')
            and exists (
              select 1 from public.sub_admin_course_scopes sc
              where sc.profile_id = auth.uid()
                and sc.course_code = t.subject_code
            )
          )
        )
    )
  );
