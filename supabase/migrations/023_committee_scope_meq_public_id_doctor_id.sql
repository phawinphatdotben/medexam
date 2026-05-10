-- =============================================================================
-- 023: Committee scoped by catalog CODE + year + formative/summative;
--      MEQ stable public id CODE_YEAR_NNN; profiles.doctor_id (Thai physician ID)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Committee purpose (matches MEQ test_function for assignment UX)
-- formative ≈ practice, summative ≈ real_test examination
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.committee_purpose as enum ('formative', 'summative');
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- Profiles: Thai doctor license ID (unique where set)
-- -----------------------------------------------------------------------------
alter table if exists public.profiles
  add column if not exists doctor_id text;

drop index if exists profiles_doctor_id_unique_nonempty;
create unique index profiles_doctor_id_unique_nonempty
  on public.profiles (doctor_id)
  where doctor_id is not null and trim(doctor_id) <> '';

comment on column public.profiles.doctor_id is
  'Optional unique physician identifier (e.g. Thai Medical Council ID). Required for staff signup in app.';

-- -----------------------------------------------------------------------------
-- Committees: mandatory scope for new rows (legacy rows backfilled)
-- -----------------------------------------------------------------------------
alter table if exists public.committees
  add column if not exists course_code text references public.course_catalog (course_code) on update cascade on delete restrict;

alter table if exists public.committees
  add column if not exists purpose public.committee_purpose;

alter table if exists public.committees
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

insert into public.course_catalog (course_code, year_level, course_title, category)
values ('LEGACY-COMMITTEE', 1, 'Legacy committee (pre-migration)', 'Legacy')
on conflict (course_code) do nothing;

update public.committees
set
  course_code = coalesce(course_code, 'LEGACY-COMMITTEE'),
  purpose = coalesce(purpose, 'summative'::public.committee_purpose),
  test_year = coalesce(test_year, extract(year from now())::int)
where course_code is null or purpose is null or test_year is null;

alter table public.committees alter column course_code set not null;
alter table public.committees alter column purpose set not null;
alter table public.committees alter column test_year set not null;

-- Legacy backfill can create many rows with the same scope; merge before unique index.
do $$
declare
  rec record;
  keeper uuid;
  loser uuid;
  dup_ids uuid[];
  i int;
begin
  for rec in
    select
      lower(trim(course_code)) as cc_key,
      test_year,
      purpose,
      array_agg(id order by id::text) as ids
    from public.committees
    group by lower(trim(course_code)), test_year, purpose
    having count(*) > 1
  loop
    dup_ids := rec.ids;
    keeper := dup_ids[1];
    for i in 2 .. array_length(dup_ids, 1)
    loop
      loser := dup_ids[i];

      delete from public.committee_members cm_del
      where cm_del.committee_id = loser
        and exists (
          select 1 from public.committee_members cm_keep
          where cm_keep.committee_id = keeper and cm_keep.profile_id = cm_del.profile_id
        );
      update public.committee_members set committee_id = keeper where committee_id = loser;

      delete from public.committee_test_scores s_del
      where s_del.committee_id = loser
        and exists (
          select 1 from public.committee_test_scores s_keep
          where s_keep.committee_id = keeper
            and s_keep.test_kind = s_del.test_kind
            and s_keep.test_id = s_del.test_id
            and s_keep.reviewer_id = s_del.reviewer_id
        );
      update public.committee_test_scores set committee_id = keeper where committee_id = loser;

      delete from public.committee_angoff_ratings r_del
      where r_del.committee_id = loser
        and exists (
          select 1 from public.committee_angoff_ratings r_keep
          where r_keep.committee_id = keeper
            and r_keep.reviewer_id = r_del.reviewer_id
            and r_keep.round = r_del.round
            and r_keep.item_ref = r_del.item_ref
        );
      update public.committee_angoff_ratings set committee_id = keeper where committee_id = loser;

      update public.meq_tests set committee_id = keeper where committee_id = loser;
      update public.sba_tests set committee_id = keeper where committee_id = loser;

      delete from public.committees where id = loser;
    end loop;
  end loop;
end $$;

drop index if exists committees_scope_unique;
create unique index committees_scope_unique
  on public.committees (lower(trim(course_code)), test_year, purpose);

comment on column public.committees.course_code is
  'Catalog course code this committee reviews (e.g. CHMD 7404 stored as catalog row).';
comment on column public.committees.purpose is
  'formative (practice-style) vs summative (high-stakes / real test track).';

-- -----------------------------------------------------------------------------
-- MEQ public identifier: {numeric_key}_{year}_{seq}
-- -----------------------------------------------------------------------------
create table if not exists public.meq_public_code_counters (
  course_key text not null,
  test_year int not null check (test_year >= 2000 and test_year <= 2100),
  last_seq int not null default 0 check (last_seq >= 0),
  updated_at timestamptz not null default now(),
  primary key (course_key, test_year)
);

alter table public.meq_public_code_counters enable row level security;

create or replace function public.course_code_numeric_key(p_course_code text)
returns text
language sql
immutable
as $$
  select case
    when p_course_code is null or trim(p_course_code) = '' then '0000'
    else
      lpad(
        case
          when length(regexp_replace(lower(trim(p_course_code)), '[^0-9]', '', 'g')) <= 4
          then regexp_replace(lower(trim(p_course_code)), '[^0-9]', '', 'g')
          else right(regexp_replace(lower(trim(p_course_code)), '[^0-9]', '', 'g'), 4)
        end,
        4,
        '0'
      )
  end;
$$;

alter table if exists public.meq_tests
  add column if not exists public_code text;

drop index if exists meq_tests_public_code_unique;
create unique index meq_tests_public_code_unique
  on public.meq_tests (public_code)
  where public_code is not null;

comment on column public.meq_tests.public_code is
  'Stable human-facing id: course_numeric_key + test_year + sequence (e.g. 7404_2026_001).';

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
begin
  if tg_op = 'INSERT' then
    if new.public_code is not null and trim(new.public_code) <> '' then
      return new;
    end if;
    k := public.course_code_numeric_key(new.course_code);
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

drop trigger if exists meq_tests_public_code_bi on public.meq_tests;
create trigger meq_tests_public_code_bi
  before insert on public.meq_tests
  for each row execute function public.meq_tests_set_public_code();

-- Backfill existing MEQs (deterministic order)
do $$
declare
  r record;
  k text;
  y int;
  n int;
begin
  for r in
    select id, course_code, test_year, created_at
    from public.meq_tests
    where public_code is null
    order by created_at asc, id asc
  loop
    k := public.course_code_numeric_key(r.course_code);
    y := r.test_year;
    insert into public.meq_public_code_counters (course_key, test_year, last_seq)
    values (k, y, 1)
    on conflict (course_key, test_year) do update
      set last_seq = public.meq_public_code_counters.last_seq + 1,
          updated_at = now()
    returning last_seq into n;
    update public.meq_tests
    set public_code = k || '_' || y::text || '_' || lpad(n::text, 3, '0')
    where id = r.id;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Auth: capture doctor_id from signup metadata
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    email,
    full_name,
    profile_year,
    medical_student_year,
    role,
    requested_role,
    approval_status,
    doctor_id
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'profile_year',
    case
      when (new.raw_user_meta_data->>'medical_student_year') ~ '^[0-9]+$'
      then (new.raw_user_meta_data->>'medical_student_year')::int
      else null
    end,
    case
      when new.raw_user_meta_data->>'role' in ('student', 'educator', 'admin', 'sub_admin')
      then (new.raw_user_meta_data->>'role')::public.user_role
      else 'student'::public.user_role
    end,
    case
      when new.raw_user_meta_data->>'requested_role' in ('student', 'educator')
      then new.raw_user_meta_data->>'requested_role'
      else null
    end,
    case
      when new.raw_user_meta_data->>'requested_role' = 'educator' then 'pending'
      else 'approved'
    end,
    nullif(trim(coalesce(new.raw_user_meta_data->>'doctor_id', '')), '')
  );
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS: educator on assigned committee can read that MEQ/SBA for review
-- -----------------------------------------------------------------------------
drop policy if exists "meq_tests_select" on public.meq_tests;
create policy "meq_tests_select"
  on public.meq_tests for select
  using (
    (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'student')
      and public.student_can_access_meq_test(meq_tests.id)
    )
    or (meq_tests.created_by = auth.uid())
    or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
      and exists (
        select 1 from public.committee_members cm
        join public.committees c on c.id = cm.committee_id
        where cm.profile_id = auth.uid()
          and (c.course_code = meq_tests.course_code)
          and (c.test_year = meq_tests.test_year)
          and (
            c.purpose is null
            or (c.purpose = 'formative'::public.committee_purpose and meq_tests.test_function = 'practice')
            or (c.purpose = 'summative'::public.committee_purpose and meq_tests.test_function = 'real_test')
          )
      )
    )
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'educator')
      and (
        meq_tests.created_by = auth.uid()
        or meq_tests.review_status = 'approved'
        or exists (
          select 1 from public.committee_members cm
          where cm.profile_id = auth.uid()
            and cm.committee_id = meq_tests.committee_id
        )
      )
    )
  );

drop policy if exists "sba_tests_select" on public.sba_tests;
create policy "sba_tests_select"
  on public.sba_tests for select
  using (
    (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'student')
      and public.student_can_access_sba_test(sba_tests.id)
    )
    or (sba_tests.created_by = auth.uid())
    or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
      and exists (
        select 1 from public.committee_members cm
        join public.committees c on c.id = cm.committee_id
        where cm.profile_id = auth.uid()
          and (c.course_code = sba_tests.subject_code)
          and (c.test_year = sba_tests.test_year)
          and (
            c.purpose is null
            or (c.purpose = 'formative'::public.committee_purpose and sba_tests.test_function = 'practice')
            or (c.purpose = 'summative'::public.committee_purpose and sba_tests.test_function = 'real_test')
          )
      )
    )
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'educator')
      and (
        sba_tests.created_by = auth.uid()
        or sba_tests.review_status = 'approved'
        or exists (
          select 1 from public.committee_members cm
          where cm.profile_id = auth.uid()
            and cm.committee_id = sba_tests.committee_id
        )
      )
    )
  );

-- Mirror nested selects for stages/questions (021)
drop policy if exists "meq_test_stages_select" on public.meq_test_stages;
create policy "meq_test_stages_select"
  on public.meq_test_stages for select
  using (
    exists (
      select 1 from public.meq_tests t where t.id = meq_test_stages.meq_test_id
      and (
        (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'student')
          and public.student_can_access_meq_test(t.id)
        )
        or (t.created_by = auth.uid())
        or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
        or (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
          and exists (
            select 1 from public.committee_members cm
            join public.committees c on c.id = cm.committee_id
            where cm.profile_id = auth.uid()
              and (c.course_code = t.course_code)
              and (c.test_year = t.test_year)
              and (
                c.purpose is null
                or (c.purpose = 'formative'::public.committee_purpose and t.test_function = 'practice')
                or (c.purpose = 'summative'::public.committee_purpose and t.test_function = 'real_test')
              )
          )
        )
        or (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'educator')
          and (
            t.created_by = auth.uid()
            or t.review_status = 'approved'
            or exists (
              select 1 from public.committee_members cm
              where cm.profile_id = auth.uid()
                and cm.committee_id = t.committee_id
            )
          )
        )
      )
    )
  );

drop policy if exists "sba_test_questions_select" on public.sba_test_questions;
create policy "sba_test_questions_select"
  on public.sba_test_questions for select
  using (
    exists (
      select 1 from public.sba_tests t where t.id = sba_test_questions.sba_test_id
      and (
        (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'student')
          and public.student_can_access_sba_test(t.id)
        )
        or (t.created_by = auth.uid())
        or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
        or (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
          and exists (
            select 1 from public.committee_members cm
            join public.committees c on c.id = cm.committee_id
            where cm.profile_id = auth.uid()
              and (c.course_code = t.subject_code)
              and (c.test_year = t.test_year)
              and (
                c.purpose is null
                or (c.purpose = 'formative'::public.committee_purpose and t.test_function = 'practice')
                or (c.purpose = 'summative'::public.committee_purpose and t.test_function = 'real_test')
              )
          )
        )
        or (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'educator')
          and (
            t.created_by = auth.uid()
            or t.review_status = 'approved'
            or exists (
              select 1 from public.committee_members cm
              where cm.profile_id = auth.uid()
                and cm.committee_id = t.committee_id
            )
          )
        )
      )
    )
  );

-- Counter table: service role / postgres only (no client writes)
drop policy if exists "meq_public_code_counters_noop" on public.meq_public_code_counters;
create policy "meq_public_code_counters_noop"
  on public.meq_public_code_counters for select
  using (false);

grant select on public.meq_public_code_counters to postgres, service_role;
