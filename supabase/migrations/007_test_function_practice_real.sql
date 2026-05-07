-- =============================================================================
-- 007: Add test function (practice vs real test)
-- =============================================================================

alter table if exists public.sba_tests
  add column if not exists test_function text not null default 'real_test';

alter table if exists public.meq_tests
  add column if not exists test_function text not null default 'real_test';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sba_tests_test_function_check'
  ) then
    alter table public.sba_tests
      add constraint sba_tests_test_function_check
      check (test_function in ('practice', 'real_test'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'meq_tests_test_function_check'
  ) then
    alter table public.meq_tests
      add constraint meq_tests_test_function_check
      check (test_function in ('practice', 'real_test'));
  end if;
end $$;

