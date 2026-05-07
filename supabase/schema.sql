-- =============================================================================
-- MEQ Platform — consolidated PostgreSQL schema (Supabase)
-- Single source: MEQ = meq_tests + meq_test_stages + meq_stage_responses
--                 SBA = sba_tests + sba_test_questions + sba_question_responses
-- Legacy: scenarios / stages / rubrics / public.responses (old) REMOVED — use tables above.
--
-- Enums: safe to re-run (duplicate_object). Tables: for fresh database only, or
--         use migrations/ folder for incremental changes on existing projects.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $enum$ begin
  create type public.user_role as enum ('student', 'educator', 'admin');
exception when duplicate_object then null;
end $enum$;

-- Add sub_admin when upgrading existing DBs
do $$ begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on e.enumtypid = t.oid
    where t.typname = 'user_role' and e.enumlabel = 'sub_admin'
  ) then
    alter type public.user_role add value 'sub_admin';
  end if;
end $$;

do $enum$ begin
  create type public.response_status as enum ('draft', 'locked');
exception when duplicate_object then null;
end $enum$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'test_review_status') then
    create type public.test_review_status as enum (
      'pending_committee', 'approved', 'rejected'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text,
  profile_year text,
  staff_id text,
  student_id text,
  medical_student_year int,
  role public.user_role not null default 'student',
  requested_role text check (requested_role in ('student', 'educator') or requested_role is null),
  approval_status text not null default 'approved' check (approval_status in ('pending', 'approved', 'rejected')),
  institution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Departments & committees
-- ---------------------------------------------------------------------------
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  updated_at timestamptz not null default now()
);

create table if not exists public.committees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text,
  test_year int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.committee_members (
  committee_id uuid not null references public.committees (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  primary key (committee_id, profile_id)
);

-- ---------------------------------------------------------------------------
-- Course catalog (imported from curriculum table)
-- ---------------------------------------------------------------------------
create table if not exists public.course_catalog (
  course_code text primary key,
  year_level int not null,
  course_title text not null,
  category text
);

-- ---------------------------------------------------------------------------
-- SBA: one parent test, many questions (each question row has uuid id)
-- ---------------------------------------------------------------------------
create table if not exists public.sba_tests (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  subject_code text not null,
  test_function text not null default 'real_test' check (test_function in ('practice', 'real_test')),
  department_id uuid references public.departments (id) on delete set null,
  committee_id uuid references public.committees (id) on delete set null,
  review_status public.test_review_status not null default 'pending_committee',
  test_year int not null default (extract(year from now())::int),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sba_test_questions (
  id uuid primary key default gen_random_uuid(),
  sba_test_id uuid not null references public.sba_tests (id) on delete cascade,
  sequence_order int not null check (sequence_order >= 1),
  stem text not null,
  image_url text,
  options jsonb not null default '[]'::jsonb,
  correct_option_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sba_test_id, sequence_order)
);

-- ---------------------------------------------------------------------------
-- MEQ: one parent test, many stage rows (each stage uuid = key for student answers)
-- ---------------------------------------------------------------------------
create table if not exists public.meq_tests (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  subject_code text not null,
  test_function text not null default 'real_test' check (test_function in ('practice', 'real_test')),
  department_id uuid references public.departments (id) on delete set null,
  committee_id uuid references public.committees (id) on delete set null,
  review_status public.test_review_status not null default 'pending_committee',
  test_year int not null default (extract(year from now())::int),
  time_limit_minutes int,
  first_page_stem text not null default '',
  vignette text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meq_test_stages (
  id uuid primary key default gen_random_uuid(),
  meq_test_id uuid not null references public.meq_tests (id) on delete cascade,
  sequence_order int not null check (sequence_order >= 1),
  time_limit_minutes int,
  stage_information text,
  question_text text not null,
  media_urls text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meq_test_id, sequence_order)
);

-- ---------------------------------------------------------------------------
-- Student answers: join by meq_test_stages.id or sba_test_questions.id
-- ---------------------------------------------------------------------------
create table if not exists public.meq_stage_responses (
  id uuid primary key default gen_random_uuid(),
  meq_stage_id uuid not null references public.meq_test_stages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  answer_text text,
  status public.response_status not null default 'draft',
  human_override_score numeric(10, 2),
  ai_rationale_feedback text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at timestamptz,
  unique (user_id, meq_stage_id)
);

create table if not exists public.sba_question_responses (
  id uuid primary key default gen_random_uuid(),
  sba_test_question_id uuid not null references public.sba_test_questions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  selected_option_id text not null,
  is_correct boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, sba_test_question_id)
);

-- ---------------------------------------------------------------------------
-- Triggers: updated_at
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$ begin new.updated_at := now(); return new; end $$;

create or replace function public.meq_responses_sync_locked_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'locked' and (tg_op = 'INSERT' or old.status is distinct from 'locked') then
    new.locked_at := coalesce(new.locked_at, now());
  elsif new.status = 'draft' then
    new.locked_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles for each row execute function public.set_updated_at();

drop trigger if exists departments_set_updated_at on public.departments;
create trigger departments_set_updated_at
  before update on public.departments for each row execute function public.set_updated_at();

drop trigger if exists committees_set_updated_at on public.committees;
create trigger committees_set_updated_at
  before update on public.committees for each row execute function public.set_updated_at();

drop trigger if exists sba_tests_set_updated_at on public.sba_tests;
create trigger sba_tests_set_updated_at
  before update on public.sba_tests for each row execute function public.set_updated_at();

drop trigger if exists sba_test_questions_set_updated_at on public.sba_test_questions;
create trigger sba_test_questions_set_updated_at
  before update on public.sba_test_questions for each row execute function public.set_updated_at();

drop trigger if exists meq_tests_set_updated_at on public.meq_tests;
create trigger meq_tests_set_updated_at
  before update on public.meq_tests for each row execute function public.set_updated_at();

drop trigger if exists meq_test_stages_set_updated_at on public.meq_test_stages;
create trigger meq_test_stages_set_updated_at
  before update on public.meq_test_stages for each row execute function public.set_updated_at();

drop trigger if exists meq_stage_responses_set_updated_at on public.meq_stage_responses;
create trigger meq_stage_responses_set_updated_at
  before update on public.meq_stage_responses for each row execute function public.set_updated_at();

drop trigger if exists meq_stage_responses_lock_trg on public.meq_stage_responses;
create trigger meq_stage_responses_lock_trg
  before insert or update on public.meq_stage_responses
  for each row execute function public.meq_responses_sync_locked_at();

drop trigger if exists sba_question_responses_set_updated_at on public.sba_question_responses;
create trigger sba_question_responses_set_updated_at
  before update on public.sba_question_responses for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- New user -> profile
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id, email, full_name, profile_year, medical_student_year, role, requested_role, approval_status
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
    end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Seed departments (optional)
-- ---------------------------------------------------------------------------
insert into public.departments (name) values
  ('Internal Medicine'), ('Surgery'), ('Pediatrics'), ('OBGYN'),
  ('Emergency Medicine'), ('Anesthesiology'), ('Orthopedics'), ('ENT'),
  ('Ophthalmology'), ('Forensic Medicine'), ('Family & Community Medicine'),
  ('ICU / Critical Care'), ('Pathology / Lab'), ('Other')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- RLS: enable
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.departments enable row level security;
alter table public.committees enable row level security;
alter table public.committee_members enable row level security;
alter table public.sba_tests enable row level security;
alter table public.sba_test_questions enable row level security;
alter table public.meq_tests enable row level security;
alter table public.meq_test_stages enable row level security;
alter table public.meq_stage_responses enable row level security;
alter table public.sba_question_responses enable row level security;

-- Helper to avoid recursive profiles policies.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role::text
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

grant execute on function public.current_user_role() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

drop policy if exists "profiles_select_staff" on public.profiles;
create policy "profiles_select_staff" on public.profiles for select
using (public.current_user_role() in ('educator', 'admin', 'sub_admin'));

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles for update
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- Departments: read all authenticated; write admin only
-- ---------------------------------------------------------------------------
drop policy if exists "departments_select_all" on public.departments;
create policy "departments_select_all" on public.departments for select
using (auth.role() = 'authenticated');

drop policy if exists "departments_write_admin" on public.departments;
create policy "departments_write_admin" on public.departments for all
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ---------------------------------------------------------------------------
-- MEQ tests: staff CRUD; students read approved; sub_admin scope; admin all
-- ---------------------------------------------------------------------------
drop policy if exists "meq_tests_select" on public.meq_tests;
create policy "meq_tests_select" on public.meq_tests for select
using (
  (review_status = 'approved' and auth.role() = 'authenticated')
  or (created_by = auth.uid())
  or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
    and exists (
      select 1 from public.committee_members cm
      join public.committees c on c.id = cm.committee_id
      where cm.profile_id = auth.uid()
        and (c.subject is null or c.subject = meq_tests.subject)
        and (c.test_year is null or c.test_year = meq_tests.test_year)
    ))
  or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'educator')
    and (created_by = auth.uid() or review_status = 'approved'))
);

drop policy if exists "meq_tests_insert" on public.meq_tests;
create policy "meq_tests_insert" on public.meq_tests for insert
with check (
  created_by = auth.uid()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text in ('educator', 'admin', 'sub_admin'))
);

drop policy if exists "meq_tests_update" on public.meq_tests;
create policy "meq_tests_update" on public.meq_tests for update
using (
  (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  or (created_by = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text in ('educator', 'sub_admin', 'admin')))
  or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
    and exists (
      select 1 from public.committee_members cm
      join public.committees c on c.id = cm.committee_id
      where cm.profile_id = auth.uid()
        and (c.subject is null or c.subject = meq_tests.subject)
        and (c.test_year is null or c.test_year = meq_tests.test_year)
    ))
);

-- ---------------------------------------------------------------------------
-- MEQ stages: read if user can read parent; write by creator
-- ---------------------------------------------------------------------------
drop policy if exists "meq_test_stages_select" on public.meq_test_stages;
create policy "meq_test_stages_select" on public.meq_test_stages for select
using (exists (select 1 from public.meq_tests t where t.id = meq_test_stages.meq_test_id
  and (
    (t.review_status = 'approved' and auth.role() = 'authenticated')
    or (t.created_by = auth.uid())
    or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
    or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
        and exists (
          select 1 from public.committee_members cm join public.committees c on c.id = cm.committee_id
          where cm.profile_id = auth.uid() and (c.subject is null or c.subject = t.subject)
            and (c.test_year is null or c.test_year = t.test_year)
        ))
    or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'educator')
        and (t.created_by = auth.uid() or t.review_status = 'approved'))
  )
));

drop policy if exists "meq_test_stages_write" on public.meq_test_stages;
create policy "meq_test_stages_write" on public.meq_test_stages for all
using (exists (select 1 from public.meq_tests t
  where t.id = meq_test_stages.meq_test_id
    and (t.created_by = auth.uid() or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')))))
with check (exists (select 1 from public.meq_tests t
  where t.id = meq_test_stages.meq_test_id and t.created_by = auth.uid()));

-- SBA: mirror policies
drop policy if exists "sba_tests_select" on public.sba_tests;
create policy "sba_tests_select" on public.sba_tests for select
using (
  (review_status = 'approved' and auth.role() = 'authenticated')
  or (created_by = auth.uid())
  or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
    and exists (
      select 1 from public.committee_members cm join public.committees c on c.id = cm.committee_id
      where cm.profile_id = auth.uid()
        and (c.subject is null or c.subject = sba_tests.subject)
        and (c.test_year is null or c.test_year = sba_tests.test_year)
    ))
  or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'educator')
    and (created_by = auth.uid() or review_status = 'approved'))
);

drop policy if exists "sba_tests_insert" on public.sba_tests;
create policy "sba_tests_insert" on public.sba_tests for insert
with check (created_by = auth.uid() and exists (select 1 from public.profiles p
  where p.id = auth.uid() and p.role::text in ('educator', 'admin', 'sub_admin')));

drop policy if exists "sba_tests_update" on public.sba_tests;
create policy "sba_tests_update" on public.sba_tests for update
using (
  (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  or (created_by = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text in ('educator', 'sub_admin', 'admin')))
  or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
    and exists (
      select 1 from public.committee_members cm join public.committees c on c.id = cm.committee_id
      where cm.profile_id = auth.uid()
        and (c.subject is null or c.subject = sba_tests.subject)
        and (c.test_year is null or c.test_year = sba_tests.test_year)
    ))
);

drop policy if exists "sba_test_questions_select" on public.sba_test_questions;
create policy "sba_test_questions_select" on public.sba_test_questions for select
using (exists (select 1 from public.sba_tests t where t.id = sba_test_questions.sba_test_id
  and (
    (t.review_status = 'approved' and auth.role() = 'authenticated')
    or (t.created_by = auth.uid())
    or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
    or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
        and exists (
          select 1 from public.committee_members cm join public.committees c on c.id = cm.committee_id
          where cm.profile_id = auth.uid() and (c.subject is null or c.subject = t.subject)
            and (c.test_year is null or c.test_year = t.test_year)
        ))
    or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'educator')
        and (t.created_by = auth.uid() or t.review_status = 'approved'))
  )
));

drop policy if exists "sba_test_questions_write" on public.sba_test_questions;
create policy "sba_test_questions_write" on public.sba_test_questions for all
using (exists (select 1 from public.sba_tests t
  where t.id = sba_test_questions.sba_test_id
    and (t.created_by = auth.uid() or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')))))
with check (exists (select 1 from public.sba_tests t
  where t.id = sba_test_questions.sba_test_id and t.created_by = auth.uid()));

-- ---------------------------------------------------------------------------
-- Committees: admin + sub_admin
-- ---------------------------------------------------------------------------
drop policy if exists "committees_select" on public.committees;
create policy "committees_select" on public.committees for select
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text in ('admin', 'sub_admin')));

drop policy if exists "committees_write" on public.committees;
create policy "committees_write" on public.committees for all
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text in ('admin', 'sub_admin')))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text in ('admin', 'sub_admin')));

drop policy if exists "committee_members_read" on public.committee_members;
create policy "committee_members_read" on public.committee_members for select
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text in ('admin', 'sub_admin')));

drop policy if exists "committee_members_write" on public.committee_members;
create policy "committee_members_write" on public.committee_members for all
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text in ('admin', 'sub_admin')))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text in ('admin', 'sub_admin')));

-- ---------------------------------------------------------------------------
-- meq_stage_responses
-- ---------------------------------------------------------------------------
drop policy if exists "meq_stage_responses_select_own" on public.meq_stage_responses;
create policy "meq_stage_responses_select_own" on public.meq_stage_responses for select
using (auth.uid() = user_id);

drop policy if exists "meq_stage_responses_select_staff" on public.meq_stage_responses;
create policy "meq_stage_responses_select_staff" on public.meq_stage_responses for select
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text in ('educator', 'admin', 'sub_admin')));

drop policy if exists "meq_stage_responses_insert" on public.meq_stage_responses;
create policy "meq_stage_responses_insert" on public.meq_stage_responses for insert
with check (
  auth.uid() = user_id
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'student')
);

drop policy if exists "meq_stage_responses_update" on public.meq_stage_responses;
drop policy if exists "meq_stage_responses_grade" on public.meq_stage_responses;
drop policy if exists "meq_stage_responses_update_own" on public.meq_stage_responses;
drop policy if exists "meq_stage_responses_grade_staff" on public.meq_stage_responses;
create policy "meq_stage_responses_update_own" on public.meq_stage_responses for update
using (auth.uid() = user_id and status = 'draft')
with check (auth.uid() = user_id and status in ('draft', 'locked'));

create policy "meq_stage_responses_grade_staff" on public.meq_stage_responses for update
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text in ('educator', 'admin', 'sub_admin')));

drop policy if exists "meq_stage_responses_delete_own" on public.meq_stage_responses;
create policy "meq_stage_responses_delete_own" on public.meq_stage_responses for delete
using (auth.uid() = user_id);

-- sba_question_responses
-- ---------------------------------------------------------------------------
drop policy if exists "sba_qr_select" on public.sba_question_responses;
create policy "sba_qr_select" on public.sba_question_responses for select
using (auth.uid() = user_id or
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text in ('educator', 'admin', 'sub_admin')));

drop policy if exists "sba_qr_insert" on public.sba_question_responses;
create policy "sba_qr_insert" on public.sba_question_responses for insert
with check (auth.uid() = user_id
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'student'));

drop policy if exists "sba_qr_update" on public.sba_question_responses;
create policy "sba_qr_update" on public.sba_question_responses for update
using (auth.uid() = user_id);

drop policy if exists "sba_qr_delete_own" on public.sba_question_responses;
create policy "sba_qr_delete_own" on public.sba_question_responses for delete
using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Helper function: grouped approved tests by subject
-- Students can see approved tests without per-student assignment.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant usage on schema public to postgres, anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to postgres, service_role, authenticated;
revoke all on all tables in schema public from anon;
