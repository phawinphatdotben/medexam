-- =============================================================================
-- Requires migration 020 (staff_test_* tables and policies).
-- =============================================================================
-- 021: Students may only SELECT approved PRACTICE tests freely; approved REAL
--      tests require an active staff_test_assignment targeting the student or
--      their group (same rules as staff_test_group_items SELECT for students).
--      Staff / committee visibility unchanged aside from dropping the blanket
--      "approved + authenticated" shortcut for authenticated users (replaced by
--      explicit student predicate + student_can_access_*).
-- =============================================================================

create or replace function public.student_can_access_meq_test(p_meq_test_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.meq_tests t
    where t.id = p_meq_test_id
      and t.review_status = 'approved'
      and (
        t.test_function = 'practice'
        or exists (
          select 1
          from public.staff_test_group_items i
          join public.staff_test_assignments a on a.test_group_id = i.test_group_id
          join public.staff_test_assignment_recipients r on r.assignment_id = a.id
          where i.meq_test_id = t.id
            and (a.window_start is null or a.window_start <= now())
            and (a.window_end is null or a.window_end >= now())
            and (
              r.student_id = auth.uid()
              or exists (
                select 1 from public.staff_student_group_members m
                where m.student_group_id = r.student_group_id
                  and m.student_id = auth.uid()
              )
            )
        )
      )
  );
$$;

create or replace function public.student_can_access_sba_test(p_sba_test_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.sba_tests t
    where t.id = p_sba_test_id
      and t.review_status = 'approved'
      and (
        t.test_function = 'practice'
        or exists (
          select 1
          from public.staff_test_group_items i
          join public.staff_test_assignments a on a.test_group_id = i.test_group_id
          join public.staff_test_assignment_recipients r on r.assignment_id = a.id
          where i.sba_test_id = t.id
            and (a.window_start is null or a.window_start <= now())
            and (a.window_end is null or a.window_end >= now())
            and (
              r.student_id = auth.uid()
              or exists (
                select 1 from public.staff_student_group_members m
                where m.student_group_id = r.student_group_id
                  and m.student_id = auth.uid()
              )
            )
        )
      )
  );
$$;

grant execute on function public.student_can_access_meq_test(uuid) to authenticated, service_role;
grant execute on function public.student_can_access_sba_test(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- meq_tests / sba_tests
-- ---------------------------------------------------------------------------
drop policy if exists "meq_tests_select" on public.meq_tests;
create policy "meq_tests_select" on public.meq_tests for select
using (
  (
    exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'student'
    )
    and public.student_can_access_meq_test(meq_tests.id)
  )
  or (meq_tests.created_by = auth.uid())
  or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
    and exists (
      select 1 from public.committee_members cm
      join public.committees c on c.id = cm.committee_id
      where cm.profile_id = auth.uid()
        and (c.subject is null or c.subject = meq_tests.subject)
        and (c.test_year is null or c.test_year = meq_tests.test_year)
    ))
  or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'educator')
    and (meq_tests.created_by = auth.uid() or meq_tests.review_status = 'approved'))
);

drop policy if exists "sba_tests_select" on public.sba_tests;
create policy "sba_tests_select" on public.sba_tests for select
using (
  (
    exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'student'
    )
    and public.student_can_access_sba_test(sba_tests.id)
  )
  or (sba_tests.created_by = auth.uid())
  or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
    and exists (
      select 1 from public.committee_members cm join public.committees c on c.id = cm.committee_id
      where cm.profile_id = auth.uid()
        and (c.subject is null or c.subject = sba_tests.subject)
        and (c.test_year is null or c.test_year = sba_tests.test_year)
    ))
  or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'educator')
    and (sba_tests.created_by = auth.uid() or sba_tests.review_status = 'approved'))
);

-- ---------------------------------------------------------------------------
-- Stages / questions (mirror parent test visibility rules)
-- ---------------------------------------------------------------------------
drop policy if exists "meq_test_stages_select" on public.meq_test_stages;
create policy "meq_test_stages_select" on public.meq_test_stages for select
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
        or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
            and exists (
              select 1 from public.committee_members cm join public.committees c on c.id = cm.committee_id
              where cm.profile_id = auth.uid() and (c.subject is null or c.subject = t.subject)
                and (c.test_year is null or c.test_year = t.test_year)
            ))
        or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'educator')
            and (t.created_by = auth.uid() or t.review_status = 'approved'))
      )
  ));

drop policy if exists "sba_test_questions_select" on public.sba_test_questions;
create policy "sba_test_questions_select" on public.sba_test_questions for select
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
        or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
            and exists (
              select 1 from public.committee_members cm join public.committees c on c.id = cm.committee_id
              where cm.profile_id = auth.uid() and (c.subject is null or c.subject = t.subject)
                and (c.test_year is null or c.test_year = t.test_year)
            ))
        or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'educator')
            and (t.created_by = auth.uid() or t.review_status = 'approved'))
      )
  ));

-- ---------------------------------------------------------------------------
-- Responses: student inserts only when allowed to reach the underlying test.
-- ---------------------------------------------------------------------------
drop policy if exists "meq_stage_responses_insert" on public.meq_stage_responses;
create policy "meq_stage_responses_insert" on public.meq_stage_responses for insert
with check (
  auth.uid() = user_id
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'student')
  and exists (
    select 1
    from public.meq_test_stages s
    join public.meq_tests t on t.id = s.meq_test_id
    where s.id = meq_stage_responses.meq_stage_id
      and public.student_can_access_meq_test(t.id)
  )
);

drop policy if exists "sba_qr_insert" on public.sba_question_responses;
create policy "sba_qr_insert" on public.sba_question_responses for insert
with check (
  auth.uid() = user_id
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'student')
  and exists (
    select 1
    from public.sba_test_questions q
    join public.sba_tests t on t.id = q.sba_test_id
    where q.id = sba_question_responses.sba_test_question_id
      and public.student_can_access_sba_test(t.id)
  )
);

-- ---------------------------------------------------------------------------
-- RPC (security definer): restrict student callers to approved practice-only rows.
-- ---------------------------------------------------------------------------
create or replace function public.get_grouped_approved_tests(p_subject text default null)
returns table (
  subject text,
  tests jsonb
)
language sql
security definer
set search_path = public
as $$
  with all_tests as (
    select
      'MEQ'::text as test_type,
      t.id,
      t.subject,
      t.course_code as subject_code,
      t.test_year,
      t.created_at
    from public.meq_tests t
    where t.review_status = 'approved'
      and (
        public.current_user_role() is distinct from 'student'::text
        or t.test_function = 'practice'
      )
    union all
    select
      'SBA'::text as test_type,
      t.id,
      t.subject,
      t.subject_code,
      t.test_year,
      t.created_at
    from public.sba_tests t
    where t.review_status = 'approved'
      and (
        public.current_user_role() is distinct from 'student'::text
        or t.test_function = 'practice'
      )
  ),
  filtered as (
    select *
    from all_tests
    where p_subject is null or subject = p_subject
  )
  select
    f.subject,
    jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'type', f.test_type,
        'subject_code', f.subject_code,
        'test_year', f.test_year,
        'created_at', f.created_at
      )
      order by f.created_at desc
    ) as tests
  from filtered f
  group by f.subject
  order by f.subject;
$$;

grant execute on function public.get_grouped_approved_tests(text) to authenticated, service_role;
