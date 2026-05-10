-- =============================================================================
-- 035: SBA practice only when placed in a staff test group bundle
--
-- MEQ practice catalog unchanged. SBA practice rows appear in the student
-- practice library (and satisfy student_can_access_sba_test) only if at least
-- one staff_test_group_items row references that sba_test_id.
-- =============================================================================

-- Helper for client fallback paths when catalog RPC differs from REST.
create or replace function public.list_grouped_practice_sba_ids_json()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then '[]'::jsonb
    else coalesce(
      (
        select jsonb_agg(z.id_txt order by z.id_txt)
        from (
          select distinct t.id::text as id_txt
          from public.sba_tests t
          where t.review_status = 'approved'::public.test_review_status
            and t.test_function = 'practice'
            and exists (
              select 1 from public.staff_test_group_items g
              where g.sba_test_id = t.id
            )
        ) z
      ),
      '[]'::jsonb
    )
  end;
$$;

comment on function public.list_grouped_practice_sba_ids_json() is
  'Practice SBA test ids visible in catalog: approved practice + referenced on a staff bundle.';

revoke execute on function public.list_grouped_practice_sba_ids_json() from public;
grant execute on function public.list_grouped_practice_sba_ids_json() to authenticated;

create or replace function public.list_approved_practice_tests_catalog_json()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then '[]'::jsonb
    else coalesce(
      (
        select jsonb_agg(combined.row_data order by combined.sort_ts desc nulls last)
        from (
          (
            select
              jsonb_build_object(
                'kind', 'MEQ'::text,
                'id', t.id::text,
                'subject', t.subject,
                'subject_code', t.course_code,
                'public_code', t.public_code,
                'vignette', t.vignette,
                'dept_name', d.name,
                'created_at', t.created_at::timestamptz
              ) as row_data,
              coalesce(t.created_at, '-infinity'::timestamptz) as sort_ts
            from public.meq_tests t
            left join public.departments d on d.id = t.department_id
            where t.review_status = 'approved'::public.test_review_status
              and t.test_function = 'practice'
          )
          union all
          (
            select
              jsonb_build_object(
                'kind', 'SBA'::text,
                'id', t.id::text,
                'subject', t.subject,
                'subject_code', t.subject_code,
                'public_code', t.public_code,
                'vignette', null::text,
                'dept_name', d.name,
                'created_at', t.created_at::timestamptz
              ),
              coalesce(t.created_at, '-infinity'::timestamptz)
            from public.sba_tests t
            left join public.departments d on d.id = t.department_id
            where t.review_status = 'approved'::public.test_review_status
              and t.test_function = 'practice'
              and exists (
                select 1 from public.staff_test_group_items g
                where g.sba_test_id = t.id
              )
          )
        ) combined
      ),
      '[]'::jsonb
    )
  end;
$$;

revoke execute on function public.list_approved_practice_tests_catalog_json() from public;
grant execute on function public.list_approved_practice_tests_catalog_json() to authenticated;

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
        (
          t.test_function = 'practice'
          and exists (
            select 1 from public.staff_test_group_items i
            where i.sba_test_id = t.id
          )
        )
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
