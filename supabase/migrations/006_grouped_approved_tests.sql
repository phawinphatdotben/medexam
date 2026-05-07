-- =============================================================================
-- 006: Group approved tests by subject
-- Lets app fetch available tests by selected subject without per-student assignment.
-- =============================================================================

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
      t.subject_code,
      t.test_year,
      t.created_at
    from public.meq_tests t
    where t.review_status = 'approved'
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

