-- =============================================================================
-- 018: MEQ rubric fields + grading ownership + admin override notifications
-- =============================================================================

alter table if exists public.meq_test_stages
  add column if not exists rubric_criteria text,
  add column if not exists max_score int check (max_score between 1 and 100);

alter table if exists public.meq_stage_responses
  add column if not exists graded_by uuid references public.profiles(id) on delete set null,
  add column if not exists graded_at timestamptz;

create table if not exists public.meq_grade_notifications (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.meq_stage_responses(id) on delete cascade,
  grader_id uuid not null references public.profiles(id) on delete cascade,
  admin_id uuid not null references public.profiles(id) on delete cascade,
  previous_score numeric,
  new_score numeric,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists meq_grade_notifications_grader_idx
  on public.meq_grade_notifications(grader_id, created_at desc);

alter table public.meq_grade_notifications enable row level security;

drop policy if exists "meq_grade_notifications_select_own" on public.meq_grade_notifications;
create policy "meq_grade_notifications_select_own"
  on public.meq_grade_notifications for select
  using (
    grader_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

drop policy if exists "meq_grade_notifications_insert_admin" on public.meq_grade_notifications;
create policy "meq_grade_notifications_insert_admin"
  on public.meq_grade_notifications for insert
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

grant select, insert on public.meq_grade_notifications to authenticated, service_role, postgres;

-- Keep student update policy and add staff grading update capability.
drop policy if exists "meq_stage_responses_update_own" on public.meq_stage_responses;
create policy "meq_stage_responses_update_own"
  on public.meq_stage_responses for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and status in ('draft', 'locked'));

drop policy if exists "meq_stage_responses_update_staff_grading" on public.meq_stage_responses;
create policy "meq_stage_responses_update_staff_grading"
  on public.meq_stage_responses for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('educator', 'admin', 'sub_admin')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('educator', 'admin', 'sub_admin')
    )
  );

