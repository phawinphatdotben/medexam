-- =============================================================================
-- 019: Rubric edit audit log, AI grading training records, admin stage writes
-- Re-runnable: policies use DROP IF EXISTS before CREATE; tables use IF NOT EXISTS.
-- =============================================================================

-- Allow admins to update MEQ stages (e.g. rubric) — with_check previously blocked this.
drop policy if exists "meq_test_stages_write" on public.meq_test_stages;
create policy "meq_test_stages_write" on public.meq_test_stages for all
using (
  exists (
    select 1
    from public.meq_tests t
    where t.id = meq_test_stages.meq_test_id
      and (
        t.created_by = auth.uid()
        or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
      )
  )
)
with check (
  exists (
    select 1
    from public.meq_tests t
    where t.id = meq_test_stages.meq_test_id
      and (
        t.created_by = auth.uid()
        or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
      )
  )
);

create table if not exists public.meq_rubric_revision_log (
  id uuid primary key default gen_random_uuid(),
  meq_stage_id uuid not null references public.meq_test_stages (id) on delete cascade,
  meq_test_id uuid not null references public.meq_tests (id) on delete cascade,
  editor_id uuid not null references public.profiles (id) on delete set null,
  previous_rubric_criteria text,
  new_rubric_criteria text,
  previous_max_score int,
  new_max_score int,
  created_at timestamptz not null default now()
);

create index if not exists meq_rubric_revision_log_test_idx
  on public.meq_rubric_revision_log (meq_test_id, created_at desc);

alter table public.meq_rubric_revision_log enable row level security;

drop policy if exists "meq_rubric_log_select_admin" on public.meq_rubric_revision_log;
drop policy if exists "meq_rubric_log_insert_staff" on public.meq_rubric_revision_log;

create policy "meq_rubric_log_select_admin" on public.meq_rubric_revision_log
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy "meq_rubric_log_insert_staff" on public.meq_rubric_revision_log
  for insert with check (
    editor_id = auth.uid()
    and exists (
      select 1
      from public.meq_test_stages s
      join public.meq_tests t on t.id = s.meq_test_id
      where s.id = meq_stage_id
        and (
          t.created_by = auth.uid()
          or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
        )
    )
  );

create table if not exists public.meq_ai_training_records (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  staff_id uuid not null references public.profiles (id) on delete set null,
  meq_stage_response_id uuid references public.meq_stage_responses (id) on delete set null,
  line_json jsonb not null
);

create index if not exists meq_ai_training_created_idx
  on public.meq_ai_training_records (created_at desc);

alter table public.meq_ai_training_records enable row level security;

drop policy if exists "meq_ai_training_insert" on public.meq_ai_training_records;
drop policy if exists "meq_ai_training_select_admin" on public.meq_ai_training_records;
drop policy if exists "meq_ai_training_select_own" on public.meq_ai_training_records;

create policy "meq_ai_training_insert" on public.meq_ai_training_records
  for insert with check (
    staff_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role::text in ('educator', 'admin', 'sub_admin')
    )
  );

create policy "meq_ai_training_select_admin" on public.meq_ai_training_records
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy "meq_ai_training_select_own" on public.meq_ai_training_records
  for select using (staff_id = auth.uid());

grant select, insert on public.meq_rubric_revision_log to authenticated, service_role;
grant select, insert on public.meq_ai_training_records to authenticated, service_role;
