-- =============================================================================
-- 026: Classify real tests as formative vs summative (committee alignment).
--      Practice tests remain formative-only. Real tests choose formative or
--      summative; sub-admin / RLS use assessment_purpose with committees.purpose.
-- =============================================================================

alter table if exists public.meq_tests
  add column if not exists assessment_purpose public.committee_purpose;

alter table if exists public.sba_tests
  add column if not exists assessment_purpose public.committee_purpose;

update public.meq_tests
set assessment_purpose = case
  when test_function = 'practice' then 'formative'::public.committee_purpose
  else 'summative'::public.committee_purpose
end
where assessment_purpose is null;

update public.sba_tests
set assessment_purpose = case
  when test_function = 'practice' then 'formative'::public.committee_purpose
  else 'summative'::public.committee_purpose
end
where assessment_purpose is null;

alter table public.meq_tests alter column assessment_purpose set not null;
alter table public.sba_tests alter column assessment_purpose set not null;

alter table public.meq_tests drop constraint if exists meq_tests_assessment_fn_check;
alter table public.meq_tests add constraint meq_tests_assessment_fn_check check (
  (test_function = 'practice' and assessment_purpose = 'formative'::public.committee_purpose)
  or (
    test_function = 'real_test'
    and assessment_purpose in (
      'formative'::public.committee_purpose,
      'summative'::public.committee_purpose
    )
  )
);

alter table public.sba_tests drop constraint if exists sba_tests_assessment_fn_check;
alter table public.sba_tests add constraint sba_tests_assessment_fn_check check (
  (test_function = 'practice' and assessment_purpose = 'formative'::public.committee_purpose)
  or (
    test_function = 'real_test'
    and assessment_purpose in (
      'formative'::public.committee_purpose,
      'summative'::public.committee_purpose
    )
  )
);

comment on column public.meq_tests.assessment_purpose is
  'Formative vs summative intent; practice rows are always formative. Real tests may be either.';
comment on column public.sba_tests.assessment_purpose is
  'Formative vs summative intent; practice rows are always formative. Real tests may be either.';

-- -----------------------------------------------------------------------------
-- RLS: sub_admin committee scope — match formative/summative with assessment_purpose
-- -----------------------------------------------------------------------------

drop policy if exists "meq_tests_select" on public.meq_tests;
create policy "meq_tests_select"
  on public.meq_tests for select
  using (
    (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'student')
      and public.student_can_access_meq_test(meq_tests.id)
    )
    or (meq_tests.created_by = auth.uid())
    or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
      and exists (
        select 1 from public.committee_members cm
        join public.committees c on c.id = cm.committee_id
        where cm.profile_id = auth.uid()
          and (c.course_code = meq_tests.course_code)
          and (c.test_year = meq_tests.test_year)
          and (
            c.purpose is null
            or (
              c.purpose = 'formative'::public.committee_purpose
              and (
                meq_tests.test_function = 'practice'
                or (
                  meq_tests.test_function = 'real_test'
                  and meq_tests.assessment_purpose = 'formative'::public.committee_purpose
                )
              )
            )
            or (
              c.purpose = 'summative'::public.committee_purpose
              and meq_tests.test_function = 'real_test'
              and meq_tests.assessment_purpose = 'summative'::public.committee_purpose
            )
          )
      )
    )
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'educator')
      and (
        meq_tests.created_by = auth.uid()
        or meq_tests.review_status = 'approved'
        or exists (
          select 1 from public.committee_members cm
          where cm.profile_id = auth.uid()
            and cm.committee_id = meq_tests.committee_id
        )
      )
    )
  );

drop policy if exists "sba_tests_select" on public.sba_tests;
create policy "sba_tests_select"
  on public.sba_tests for select
  using (
    (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'student')
      and public.student_can_access_sba_test(sba_tests.id)
    )
    or (sba_tests.created_by = auth.uid())
    or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
      and exists (
        select 1 from public.committee_members cm
        join public.committees c on c.id = cm.committee_id
        where cm.profile_id = auth.uid()
          and (c.course_code = sba_tests.subject_code)
          and (c.test_year = sba_tests.test_year)
          and (
            c.purpose is null
            or (
              c.purpose = 'formative'::public.committee_purpose
              and (
                sba_tests.test_function = 'practice'
                or (
                  sba_tests.test_function = 'real_test'
                  and sba_tests.assessment_purpose = 'formative'::public.committee_purpose
                )
              )
            )
            or (
              c.purpose = 'summative'::public.committee_purpose
              and sba_tests.test_function = 'real_test'
              and sba_tests.assessment_purpose = 'summative'::public.committee_purpose
            )
          )
      )
    )
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'educator')
      and (
        sba_tests.created_by = auth.uid()
        or sba_tests.review_status = 'approved'
        or exists (
          select 1 from public.committee_members cm
          where cm.profile_id = auth.uid()
            and cm.committee_id = sba_tests.committee_id
        )
      )
    )
  );

drop policy if exists "meq_test_stages_select" on public.meq_test_stages;
create policy "meq_test_stages_select"
  on public.meq_test_stages for select
  using (
    exists (
      select 1 from public.meq_tests t where t.id = meq_test_stages.meq_test_id
      and (
        (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'student')
          and public.student_can_access_meq_test(t.id)
        )
        or (t.created_by = auth.uid())
        or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
        or (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
          and exists (
            select 1 from public.committee_members cm
            join public.committees c on c.id = cm.committee_id
            where cm.profile_id = auth.uid()
              and (c.course_code = t.course_code)
              and (c.test_year = t.test_year)
              and (
                c.purpose is null
                or (
                  c.purpose = 'formative'::public.committee_purpose
                  and (
                    t.test_function = 'practice'
                    or (
                      t.test_function = 'real_test'
                      and t.assessment_purpose = 'formative'::public.committee_purpose
                    )
                  )
                )
                or (
                  c.purpose = 'summative'::public.committee_purpose
                  and t.test_function = 'real_test'
                  and t.assessment_purpose = 'summative'::public.committee_purpose
                )
              )
          )
        )
        or (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'educator')
          and (
            t.created_by = auth.uid()
            or t.review_status = 'approved'
            or exists (
              select 1 from public.committee_members cm
              where cm.profile_id = auth.uid()
                and cm.committee_id = t.committee_id
            )
          )
        )
      )
    )
  );

drop policy if exists "sba_test_questions_select" on public.sba_test_questions;
create policy "sba_test_questions_select"
  on public.sba_test_questions for select
  using (
    exists (
      select 1 from public.sba_tests t where t.id = sba_test_questions.sba_test_id
      and (
        (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'student')
          and public.student_can_access_sba_test(t.id)
        )
        or (t.created_by = auth.uid())
        or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
        or (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
          and exists (
            select 1 from public.committee_members cm
            join public.committees c on c.id = cm.committee_id
            where cm.profile_id = auth.uid()
              and (c.course_code = t.subject_code)
              and (c.test_year = t.test_year)
              and (
                c.purpose is null
                or (
                  c.purpose = 'formative'::public.committee_purpose
                  and (
                    t.test_function = 'practice'
                    or (
                      t.test_function = 'real_test'
                      and t.assessment_purpose = 'formative'::public.committee_purpose
                    )
                  )
                )
                or (
                  c.purpose = 'summative'::public.committee_purpose
                  and t.test_function = 'real_test'
                  and t.assessment_purpose = 'summative'::public.committee_purpose
                )
              )
          )
        )
        or (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'educator')
          and (
            t.created_by = auth.uid()
            or t.review_status = 'approved'
            or exists (
              select 1 from public.committee_members cm
              where cm.profile_id = auth.uid()
                and cm.committee_id = t.committee_id
            )
          )
        )
      )
    )
  );
