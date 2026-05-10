-- =============================================================================
-- 029: Catalog RPC for Practice tests page
--
-- Some student sessions return zero rows when selecting meq_tests / sba_tests
-- under RLS (profile/role edge cases). The Practice page only shows
-- committee-approved rows with test_function = 'practice'.
--
-- This SECURITY DEFINER function returns exactly that curated list for any
-- authenticated user so the library matches policy intent without depending on
-- the student SELECT predicate shape.
--
-- Unauthorized (no JWT): returns empty array encoded as JSONB [].
-- =============================================================================

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
          )
        ) combined
      ),
      '[]'::jsonb
    )
  end;
$$;

revoke execute on function public.list_approved_practice_tests_catalog_json() from public;
grant execute on function public.list_approved_practice_tests_catalog_json() to authenticated;

comment on function public.list_approved_practice_tests_catalog_json() is
  'Practice library: MEQ/SBA rows with review_status approved and test_function practice. SECURITY DEFINER; requires auth.uid().';
