-- =============================================================================
-- 025: SBA stable public_code — same pattern as MEQ (numeric_key_year_NNN).
--      Shares public.meq_public_code_counters so MEQ and SBA never reuse the
--      same code for the same course_key + test_year.
-- =============================================================================

alter table if exists public.sba_tests
  add column if not exists public_code text;

drop index if exists sba_tests_public_code_unique;
create unique index sba_tests_public_code_unique
  on public.sba_tests (public_code)
  where public_code is not null;

comment on column public.sba_tests.public_code is
  'Stable human-facing id (same pattern as MEQ): numeric_key_year_seq; shares sequence with MEQ per course/year.';

comment on table public.meq_public_code_counters is
  'Per course numeric key + academic year: next seq for MEQ and SBA public_code (global order within key+year).';

create or replace function public.sba_tests_set_public_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  k text;
  y int;
  n int;
begin
  if tg_op = 'INSERT' then
    if new.public_code is not null and trim(new.public_code) <> '' then
      return new;
    end if;
    k := public.course_code_numeric_key(new.subject_code);
    y := new.test_year;
    with upsert as (
      insert into public.meq_public_code_counters (course_key, test_year, last_seq)
      values (k, y, 1)
      on conflict (course_key, test_year) do update
        set last_seq = public.meq_public_code_counters.last_seq + 1,
            updated_at = now()
      returning last_seq
    )
    select upsert.last_seq into strict n from upsert;
    new.public_code := k || '_' || y::text || '_' || lpad(n::text, 3, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists sba_tests_public_code_bi on public.sba_tests;
create trigger sba_tests_public_code_bi
  before insert on public.sba_tests
  for each row execute function public.sba_tests_set_public_code();

-- Backfill existing SBAs (created_at order); continues shared counters after MEQs.
do $$
declare
  r record;
  k text;
  y int;
  n int;
begin
  for r in
    select id, subject_code, test_year, created_at
    from public.sba_tests
    where public_code is null
    order by created_at asc, id asc
  loop
    k := public.course_code_numeric_key(r.subject_code);
    y := r.test_year;
    insert into public.meq_public_code_counters (course_key, test_year, last_seq)
    values (k, y, 1)
    on conflict (course_key, test_year) do update
      set last_seq = public.meq_public_code_counters.last_seq + 1,
          updated_at = now()
    returning last_seq into n;
    update public.sba_tests
    set public_code = k || '_' || y::text || '_' || lpad(n::text, 3, '0')
    where id = r.id;
  end loop;
end;
$$;
