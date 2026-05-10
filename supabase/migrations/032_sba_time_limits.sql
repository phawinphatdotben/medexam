-- -----------------------------------------------------------------------------
-- Optional time limits for SBA (whole test + per-question); mirrors MEQ patterns.
-- -----------------------------------------------------------------------------
alter table public.sba_tests
  add column if not exists time_limit_minutes int;

comment on column public.sba_tests.time_limit_minutes is
  'Optional overall cap for the SBA attempt (minutes), from exam start.';

alter table public.sba_test_questions
  add column if not exists time_limit_minutes int;

comment on column public.sba_test_questions.time_limit_minutes is
  'Optional per-question timer (minutes) when that question is in view; null = no per-item cap.';
