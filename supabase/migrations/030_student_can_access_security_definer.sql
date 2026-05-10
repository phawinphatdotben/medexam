-- =============================================================================
-- 030: SECURITY DEFINER on student_can_access_* helpers
--
-- These functions SELECT from meq_tests / sba_tests. Without SECURITY DEFINER,
-- that inner SELECT runs under the caller and is filtered by the same table's
-- RLS policy that invoked the function → the EXISTS often sees zero rows →
-- students cannot load approved practice exams (catalog RPC worked; /exam/[id]
-- showed "could not be loaded").
--
-- SECURITY DEFINER evaluates the qualification with owner privileges while
-- still using auth.uid() for assignment-window checks (session variable).
-- =============================================================================

create or replace function public.student_can_access_meq_test(p_meq_test_id uuid)
returns boolean
language sql
stable
security definer
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
security definer
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
