-- =============================================================================
-- 008: Add profile identity/academic fields
-- =============================================================================

alter table if exists public.profiles
  add column if not exists profile_year text;

alter table if exists public.profiles
  add column if not exists staff_id text;

alter table if exists public.profiles
  add column if not exists student_id text;

alter table if exists public.profiles
  add column if not exists medical_student_year int;

