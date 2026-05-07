-- =============================================================================
-- 014: MEQ uses course_catalog via course_code (drop subject_code)
-- =============================================================================

alter table if exists public.meq_tests
  add column if not exists course_code text;

do $$
begin
  -- Backfill only when legacy column still exists.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'meq_tests'
      and column_name = 'subject_code'
  ) then
    insert into public.course_catalog (course_code, year_level, course_title, category)
    select distinct
      mt.subject_code,
      greatest(coalesce(mt.test_year, 1), 1),
      coalesce(nullif(mt.subject, ''), 'Legacy MEQ course'),
      'Legacy Imported'
    from public.meq_tests mt
    left join public.course_catalog cc on cc.course_code = mt.subject_code
    where mt.subject_code is not null
      and cc.course_code is null;

    update public.meq_tests
    set course_code = subject_code
    where course_code is null
      and subject_code is not null;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'meq_tests_course_code_fkey'
      and conrelid = 'public.meq_tests'::regclass
  ) then
    alter table public.meq_tests
      add constraint meq_tests_course_code_fkey
      foreign key (course_code) references public.course_catalog(course_code)
      on update cascade
      on delete restrict;
  end if;
end
$$;

alter table public.meq_tests
  alter column course_code set not null;

alter table if exists public.meq_tests
  drop column if exists subject_code;

