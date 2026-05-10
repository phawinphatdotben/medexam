-- =============================================================================
-- 037: Staff test bundles — criteria (course + MEQ|SBA + formative|summative);
--      public stable ids: numeric_key_YEAR_FORMAT_NNN (e.g. 7404_2026_MEQ_002).
--      Legacy bundles (NULL filters) keep staff_test_group_items behavior.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Stable public ids: separate sequence per course_key + year + format
-- -----------------------------------------------------------------------------
create table if not exists public.exam_public_code_counters (
  course_key text not null,
  test_year int not null check (test_year >= 2000 and test_year <= 2100),
  exam_format text not null check (exam_format in ('MEQ', 'SBA', 'OSCE')),
  last_seq int not null default 0 check (last_seq >= 0),
  updated_at timestamptz not null default now(),
  primary key (course_key, test_year, exam_format)
);

alter table public.exam_public_code_counters enable row level security;

drop policy if exists "exam_public_code_counters_noop" on public.exam_public_code_counters;
create policy "exam_public_code_counters_noop"
  on public.exam_public_code_counters for select
  using (false);

grant select on public.exam_public_code_counters to postgres, service_role;

comment on table public.exam_public_code_counters is
  'Per course numeric key + academic year + exam format (MEQ/SBA/OSCE): next seq for tests.public_code.';

-- Migrate legacy XXX_YYY_NNN -> XXX_YYY_MEQ_NNN / XXX_YYY_SBA_NNN (preserve suffix)
update public.meq_tests
set public_code =
  split_part(public_code, '_', 1)
  || '_'
  || split_part(public_code, '_', 2)
  || '_MEQ_'
  || split_part(public_code, '_', 3)
where public_code is not null
  and trim(public_code) <> ''
  and public_code ~ '^\d{4}_\d{4}_\d{3}$';

update public.sba_tests
set public_code =
  split_part(public_code, '_', 1)
  || '_'
  || split_part(public_code, '_', 2)
  || '_SBA_'
  || split_part(public_code, '_', 3)
where public_code is not null
  and trim(public_code) <> ''
  and public_code ~ '^\d{4}_\d{4}_\d{3}$';

-- Seed counters from existing codes (idempotent upsert)
insert into public.exam_public_code_counters (course_key, test_year, exam_format, last_seq, updated_at)
select
  split_part(public_code, '_', 1) as course_key,
  split_part(public_code, '_', 2)::int as test_year,
  split_part(public_code, '_', 3) as exam_format,
  max(split_part(public_code, '_', 4)::int) as last_seq,
  now()
from public.meq_tests
where public_code ~ '^\d{4}_\d{4}_(MEQ|OSCE)_\d{3}$'
group by 1, 2, 3
on conflict (course_key, test_year, exam_format) do update
  set last_seq = greatest(public.exam_public_code_counters.last_seq, excluded.last_seq),
      updated_at = now();

insert into public.exam_public_code_counters (course_key, test_year, exam_format, last_seq, updated_at)
select
  split_part(public_code, '_', 1),
  split_part(public_code, '_', 2)::int,
  split_part(public_code, '_', 3),
  max(split_part(public_code, '_', 4)::int),
  now()
from public.sba_tests
where public_code ~ '^\d{4}_\d{4}_SBA_\d{3}$'
group by 1, 2, 3
on conflict (course_key, test_year, exam_format) do update
  set last_seq = greatest(public.exam_public_code_counters.last_seq, excluded.last_seq),
      updated_at = now();

-- MEQ inserts: CODE_YEAR_MEQ_NNN
create or replace function public.meq_tests_set_public_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  k text;
  y int;
  n int;
  fmt constant text := 'MEQ';
begin
  if tg_op = 'INSERT' then
    if new.public_code is not null and trim(new.public_code) <> '' then
      return new;
    end if;
    k := public.course_code_numeric_key(new.course_code);
    y := new.test_year;
    with upsert as (
      insert into public.exam_public_code_counters (course_key, test_year, exam_format, last_seq)
      values (k, y, fmt, 1)
      on conflict (course_key, test_year, exam_format) do update
        set last_seq = public.exam_public_code_counters.last_seq + 1,
            updated_at = now()
      returning last_seq
    )
    select upsert.last_seq into strict n from upsert;
    new.public_code := k || '_' || y::text || '_MEQ_' || lpad(n::text, 3, '0');
  end if;
  return new;
end;
$$;

-- SBA inserts: CODE_YEAR_SBA_NNN
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
  fmt constant text := 'SBA';
begin
  if tg_op = 'INSERT' then
    if new.public_code is not null and trim(new.public_code) <> '' then
      return new;
    end if;
    k := public.course_code_numeric_key(new.subject_code);
    y := new.test_year;
    with upsert as (
      insert into public.exam_public_code_counters (course_key, test_year, exam_format, last_seq)
      values (k, y, fmt, 1)
      on conflict (course_key, test_year, exam_format) do update
        set last_seq = public.exam_public_code_counters.last_seq + 1,
            updated_at = now()
      returning last_seq
    )
    select upsert.last_seq into strict n from upsert;
    new.public_code := k || '_' || y::text || '_SBA_' || lpad(n::text, 3, '0');
  end if;
  return new;
end;
$$;

drop table if exists public.meq_public_code_counters cascade;

comment on column public.meq_tests.public_code is
  'Stable human-facing id: numeric_key_year_FORMAT_seq (e.g. 7404_2026_MEQ_001).';

comment on column public.sba_tests.public_code is
  'Stable human-facing id: numeric_key_year_FORMAT_seq (e.g. 7404_2026_SBA_001); per-format sequence.';

-- -----------------------------------------------------------------------------
-- Criteria-based bundles (optional triple; NULL = legacy manual UUID items)
-- -----------------------------------------------------------------------------
alter table if exists public.staff_test_groups
  add column if not exists filter_course_code text references public.course_catalog (course_code)
    on update cascade on delete restrict;

alter table if exists public.staff_test_groups
  add column if not exists filter_exam_format text;

alter table if exists public.staff_test_groups
  add column if not exists filter_assessment_purpose public.committee_purpose;

do $$ begin
  alter table public.staff_test_groups
    add constraint staff_test_groups_filter_exam_format_chk
    check (
      filter_exam_format is null
      or filter_exam_format in ('MEQ', 'SBA')
    );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter table public.staff_test_groups
    add constraint staff_test_groups_filter_triple_chk
    check (
      (
        filter_course_code is null
        and filter_exam_format is null
        and filter_assessment_purpose is null
      )
      or (
        filter_course_code is not null
        and filter_exam_format is not null
        and filter_assessment_purpose is not null
      )
    );
exception
  when duplicate_object then null;
end $$;

comment on column public.staff_test_groups.filter_course_code is
  'When set with filter_exam_format and filter_assessment_purpose, bundle lists all matching approved real tests; staff_test_group_items ignored for scheduling/RLS.';

comment on column public.staff_test_groups.filter_assessment_purpose is
  'Matches meq_tests.assessment_purpose / sba_tests.assessment_purpose (distinct from UI labels on authoring forms).';

-- -----------------------------------------------------------------------------
-- Student access: assignment + criteria bundle OR assignment + explicit item
-- -----------------------------------------------------------------------------
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
        or exists (
          select 1
          from public.staff_test_groups g
          join public.staff_test_assignments a on a.test_group_id = g.id
          join public.staff_test_assignment_recipients r on r.assignment_id = a.id
          where g.filter_course_code is not null
            and g.filter_exam_format = 'MEQ'
            and g.filter_course_code = t.course_code
            and g.filter_assessment_purpose = t.assessment_purpose
            and t.test_function = 'real_test'
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
        or exists (
          select 1
          from public.staff_test_groups g
          join public.staff_test_assignments a on a.test_group_id = g.id
          join public.staff_test_assignment_recipients r on r.assignment_id = a.id
          where g.filter_course_code is not null
            and g.filter_exam_format = 'SBA'
            and g.filter_course_code = t.subject_code
            and g.filter_assessment_purpose = t.assessment_purpose
            and t.test_function = 'real_test'
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

-- Students: read bundle scope fields for groups attached to assignments they receive
drop policy if exists "staff_test_groups_select_assigned_student" on public.staff_test_groups;
create policy "staff_test_groups_select_assigned_student"
  on public.staff_test_groups for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role::text = 'student'
    )
    and exists (
      select 1
      from public.staff_test_assignments a
      join public.staff_test_assignment_recipients r on r.assignment_id = a.id
      where a.test_group_id = staff_test_groups.id
        and (
          r.student_id = auth.uid()
          or exists (
            select 1 from public.staff_student_group_members m
            where m.student_group_id = r.student_group_id
              and m.student_id = auth.uid()
          )
        )
    )
  );
