-- =============================================================================
-- 020: Practice last-attempt snapshots, real-test delete restriction,
--       staff test / student groups and seasonal assignments (admin + sub_admin)
-- Requires prior migrations (e.g. 007 test_function, 010 delete policies).
--
-- Run order: apply 019 before 020 if you use rubric audit / AI training tables.
-- Re-runnable: policies/tables use IF EXISTS / IF NOT EXISTS where possible.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Practice: store last submitted answers before a retake (reference panel)
-- ---------------------------------------------------------------------------
create table if not exists public.meq_practice_last_attempt (
  user_id uuid not null references public.profiles (id) on delete cascade,
  meq_stage_id uuid not null references public.meq_test_stages (id) on delete cascade,
  answer_text text,
  captured_at timestamptz not null default now(),
  primary key (user_id, meq_stage_id)
);

create index if not exists meq_practice_last_attempt_user_idx
  on public.meq_practice_last_attempt (user_id);

alter table public.meq_practice_last_attempt enable row level security;

drop policy if exists "meq_practice_last_own" on public.meq_practice_last_attempt;
create policy "meq_practice_last_own" on public.meq_practice_last_attempt
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.sba_practice_last_attempt (
  user_id uuid not null references public.profiles (id) on delete cascade,
  sba_test_question_id uuid not null references public.sba_test_questions (id) on delete cascade,
  selected_option_id text not null,
  captured_at timestamptz not null default now(),
  primary key (user_id, sba_test_question_id)
);

alter table public.sba_practice_last_attempt enable row level security;

drop policy if exists "sba_practice_last_own" on public.sba_practice_last_attempt;
create policy "sba_practice_last_own" on public.sba_practice_last_attempt
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Students may only delete their own responses for PRACTICE tests (retake / archive flow).
drop policy if exists "meq_stage_responses_delete_own_practice" on public.meq_stage_responses;
drop policy if exists "meq_stage_responses_delete_own" on public.meq_stage_responses;
create policy "meq_stage_responses_delete_own_practice" on public.meq_stage_responses
  for delete
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.meq_test_stages s
      join public.meq_tests t on t.id = s.meq_test_id
      where s.id = meq_stage_responses.meq_stage_id
        and t.test_function = 'practice'
    )
  );

drop policy if exists "sba_qr_delete_own_practice" on public.sba_question_responses;
drop policy if exists "sba_qr_delete_own" on public.sba_question_responses;
create policy "sba_qr_delete_own_practice" on public.sba_question_responses
  for delete
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.sba_test_questions q
      join public.sba_tests t on t.id = q.sba_test_id
      where q.id = sba_question_responses.sba_test_question_id
        and t.test_function = 'practice'
    )
  );

-- ---------------------------------------------------------------------------
-- Staff: bundles of tests, student cohorts, and time-window assignments
-- ---------------------------------------------------------------------------
create table if not exists public.staff_test_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_test_group_items (
  id uuid primary key default gen_random_uuid(),
  test_group_id uuid not null references public.staff_test_groups (id) on delete cascade,
  meq_test_id uuid references public.meq_tests (id) on delete cascade,
  sba_test_id uuid references public.sba_tests (id) on delete cascade,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint staff_test_group_items_one_kind check (
    (meq_test_id is not null)::int + (sba_test_id is not null)::int = 1
  )
);

create index if not exists staff_test_group_items_group_idx on public.staff_test_group_items (test_group_id);

create table if not exists public.staff_student_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_student_group_members (
  student_group_id uuid not null references public.staff_student_groups (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  primary key (student_group_id, student_id)
);

create table if not exists public.staff_test_assignments (
  id uuid primary key default gen_random_uuid(),
  test_group_id uuid not null references public.staff_test_groups (id) on delete cascade,
  title text not null default 'Assignment',
  window_start timestamptz,
  window_end timestamptz,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint staff_test_assignments_window_ok check (
    window_start is null
    or window_end is null
    or window_end >= window_start
  )
);

create table if not exists public.staff_test_assignment_recipients (
  assignment_id uuid not null references public.staff_test_assignments (id) on delete cascade,
  student_id uuid references public.profiles (id) on delete cascade,
  student_group_id uuid references public.staff_student_groups (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint staff_test_assignment_recipients_one_target check (
    (student_id is not null)::int + (student_group_id is not null)::int = 1
  )
);

create index if not exists staff_test_assignment_recipients_assign_idx
  on public.staff_test_assignment_recipients (assignment_id);
create index if not exists staff_test_assignment_recipients_student_idx
  on public.staff_test_assignment_recipients (student_id);

-- RLS: staff (admin + sub_admin) manage authoring tables
alter table public.staff_test_groups enable row level security;
alter table public.staff_test_group_items enable row level security;
alter table public.staff_student_groups enable row level security;
alter table public.staff_student_group_members enable row level security;
alter table public.staff_test_assignments enable row level security;
alter table public.staff_test_assignment_recipients enable row level security;

-- Helpers (CREATE OR REPLACE — no DROP FUNCTION needed for re-runs)
create or replace function public.is_admin_or_sub_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role::text in ('admin', 'sub_admin')
  );
$$;

grant execute on function public.is_admin_or_sub_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Re-run safety: drop every policy this section (re)creates (names must match CREATE)
-- ---------------------------------------------------------------------------
drop policy if exists "staff_test_groups_select" on public.staff_test_groups;
drop policy if exists "staff_test_groups_write" on public.staff_test_groups;
drop policy if exists "staff_test_groups_update" on public.staff_test_groups;
drop policy if exists "staff_test_groups_delete" on public.staff_test_groups;

drop policy if exists "staff_test_group_items_select" on public.staff_test_group_items;
drop policy if exists "staff_test_group_items_insert" on public.staff_test_group_items;
drop policy if exists "staff_test_group_items_write" on public.staff_test_group_items;
drop policy if exists "staff_test_group_items_update" on public.staff_test_group_items;
drop policy if exists "staff_test_group_items_delete" on public.staff_test_group_items;
drop policy if exists "staff_test_group_items_select_assigned_student" on public.staff_test_group_items;

drop policy if exists "staff_student_groups_select" on public.staff_student_groups;
drop policy if exists "staff_student_groups_insert" on public.staff_student_groups;
drop policy if exists "staff_student_groups_update" on public.staff_student_groups;
drop policy if exists "staff_student_groups_delete" on public.staff_student_groups;

drop policy if exists "staff_student_group_members_select" on public.staff_student_group_members;
drop policy if exists "staff_student_group_members_insert" on public.staff_student_group_members;
drop policy if exists "staff_student_group_members_write" on public.staff_student_group_members;
drop policy if exists "staff_student_group_members_delete" on public.staff_student_group_members;

drop policy if exists "staff_test_assignments_select_staff" on public.staff_test_assignments;
drop policy if exists "staff_test_assignments_select_student" on public.staff_test_assignments;
drop policy if exists "staff_test_assignments_insert" on public.staff_test_assignments;
drop policy if exists "staff_test_assignments_update" on public.staff_test_assignments;
drop policy if exists "staff_test_assignments_delete" on public.staff_test_assignments;

drop policy if exists "staff_test_assignment_recipients_select_staff" on public.staff_test_assignment_recipients;
drop policy if exists "staff_test_assignment_recipients_select_student" on public.staff_test_assignment_recipients;
drop policy if exists "staff_test_assignment_recipients_insert" on public.staff_test_assignment_recipients;
drop policy if exists "staff_test_assignment_recipients_delete" on public.staff_test_assignment_recipients;

-- staff_test_groups
create policy "staff_test_groups_select" on public.staff_test_groups for select
  using (
    public.is_admin_or_sub_admin()
    and (
      created_by = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    )
  );

create policy "staff_test_groups_write" on public.staff_test_groups for insert
  with check (public.is_admin_or_sub_admin() and created_by = auth.uid());

create policy "staff_test_groups_update" on public.staff_test_groups for update
  using (
    public.is_admin_or_sub_admin()
    and (
      created_by = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    )
  );

create policy "staff_test_groups_delete" on public.staff_test_groups for delete
  using (
    public.is_admin_or_sub_admin()
    and (
      created_by = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    )
  );

-- staff_test_group_items (same visibility as parent group via exists)
create policy "staff_test_group_items_select" on public.staff_test_group_items for select
  using (
    public.is_admin_or_sub_admin()
    and exists (
      select 1 from public.staff_test_groups g
      where g.id = staff_test_group_items.test_group_id
        and (
          g.created_by = auth.uid()
          or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
        )
    )
  );

create policy "staff_test_group_items_insert" on public.staff_test_group_items for insert
  with check (
    public.is_admin_or_sub_admin()
    and exists (
      select 1 from public.staff_test_groups g
      where g.id = staff_test_group_items.test_group_id
        and (
          g.created_by = auth.uid()
          or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
        )
    )
  );

create policy "staff_test_group_items_update" on public.staff_test_group_items for update
  using (
    public.is_admin_or_sub_admin()
    and exists (
      select 1 from public.staff_test_groups g
      where g.id = staff_test_group_items.test_group_id
        and (
          g.created_by = auth.uid()
          or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
        )
    )
  );

create policy "staff_test_group_items_delete" on public.staff_test_group_items for delete
  using (
    public.is_admin_or_sub_admin()
    and exists (
      select 1 from public.staff_test_groups g
      where g.id = staff_test_group_items.test_group_id
        and (
          g.created_by = auth.uid()
          or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
        )
    )
  );

-- staff_student_groups
create policy "staff_student_groups_select" on public.staff_student_groups for select
  using (
    public.is_admin_or_sub_admin()
    and (
      created_by = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    )
  );

create policy "staff_student_groups_insert" on public.staff_student_groups for insert
  with check (public.is_admin_or_sub_admin() and created_by = auth.uid());

create policy "staff_student_groups_update" on public.staff_student_groups for update
  using (
    public.is_admin_or_sub_admin()
    and (
      created_by = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    )
  );

create policy "staff_student_groups_delete" on public.staff_student_groups for delete
  using (
    public.is_admin_or_sub_admin()
    and (
      created_by = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    )
  );

-- staff_student_group_members
create policy "staff_student_group_members_select" on public.staff_student_group_members for select
  using (
    public.is_admin_or_sub_admin()
    and exists (
      select 1 from public.staff_student_groups g
      where g.id = staff_student_group_members.student_group_id
        and (
          g.created_by = auth.uid()
          or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
        )
    )
  );

create policy "staff_student_group_members_insert" on public.staff_student_group_members for insert
  with check (
    public.is_admin_or_sub_admin()
    and exists (
      select 1 from public.staff_student_groups g
      where g.id = staff_student_group_members.student_group_id
        and (
          g.created_by = auth.uid()
          or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
        )
    )
  );

create policy "staff_student_group_members_delete" on public.staff_student_group_members for delete
  using (
    public.is_admin_or_sub_admin()
    and exists (
      select 1 from public.staff_student_groups g
      where g.id = staff_student_group_members.student_group_id
        and (
          g.created_by = auth.uid()
          or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
        )
    )
  );

-- staff_test_assignments
create policy "staff_test_assignments_select_staff" on public.staff_test_assignments for select
  using (
    public.is_admin_or_sub_admin()
    and (
      created_by = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    )
  );

-- Students: see assignments where they are targeted and window is open
create policy "staff_test_assignments_select_student" on public.staff_test_assignments for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'student')
    and (
      staff_test_assignments.window_start is null
      or staff_test_assignments.window_start <= now()
    )
    and (
      staff_test_assignments.window_end is null
      or staff_test_assignments.window_end >= now()
    )
    and exists (
      select 1 from public.staff_test_assignment_recipients r
      where r.assignment_id = staff_test_assignments.id
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

create policy "staff_test_assignments_insert" on public.staff_test_assignments for insert
  with check (public.is_admin_or_sub_admin() and created_by = auth.uid());

create policy "staff_test_assignments_update" on public.staff_test_assignments for update
  using (
    public.is_admin_or_sub_admin()
    and (
      created_by = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    )
  );

create policy "staff_test_assignments_delete" on public.staff_test_assignments for delete
  using (
    public.is_admin_or_sub_admin()
    and (
      created_by = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    )
  );

-- staff_test_assignment_recipients
create policy "staff_test_assignment_recipients_select_staff" on public.staff_test_assignment_recipients for select
  using (
    public.is_admin_or_sub_admin()
    and exists (
      select 1 from public.staff_test_assignments a
      where a.id = staff_test_assignment_recipients.assignment_id
        and (
          a.created_by = auth.uid()
          or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
        )
    )
  );

create policy "staff_test_assignment_recipients_select_student" on public.staff_test_assignment_recipients for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'student')
    and exists (
      select 1 from public.staff_test_assignments a
      where a.id = staff_test_assignment_recipients.assignment_id
        and (
          a.window_start is null or a.window_start <= now()
        )
        and (
          a.window_end is null or a.window_end >= now()
        )
    )
    and (
      staff_test_assignment_recipients.student_id = auth.uid()
      or exists (
        select 1 from public.staff_student_group_members m
        where m.student_group_id = staff_test_assignment_recipients.student_group_id
          and m.student_id = auth.uid()
      )
    )
  );

create policy "staff_test_assignment_recipients_insert" on public.staff_test_assignment_recipients for insert
  with check (
    public.is_admin_or_sub_admin()
    and exists (
      select 1 from public.staff_test_assignments a
      where a.id = staff_test_assignment_recipients.assignment_id
        and (
          a.created_by = auth.uid()
          or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
        )
    )
  );

create policy "staff_test_assignment_recipients_delete" on public.staff_test_assignment_recipients for delete
  using (
    public.is_admin_or_sub_admin()
    and exists (
      select 1 from public.staff_test_assignments a
      where a.id = staff_test_assignment_recipients.assignment_id
        and (
          a.created_by = auth.uid()
          or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
        )
    )
  );

-- Students can read group items only through an active assignment that includes them
create policy "staff_test_group_items_select_assigned_student" on public.staff_test_group_items for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'student')
    and exists (
      select 1
      from public.staff_test_assignments a
      join public.staff_test_assignment_recipients r on r.assignment_id = a.id
      where a.test_group_id = staff_test_group_items.test_group_id
        and (a.window_start is null or a.window_start <= now())
        and (a.window_end is null or a.window_end >= now())
        and (
          r.student_id = auth.uid()
          or exists (
            select 1 from public.staff_student_group_members m
            where m.student_group_id = r.student_group_id and m.student_id = auth.uid()
          )
        )
    )
  );

grant select, insert, update, delete on public.meq_practice_last_attempt to authenticated, service_role;
grant select, insert, update, delete on public.sba_practice_last_attempt to authenticated, service_role;

grant select, insert, update, delete on public.staff_test_groups to authenticated, service_role;
grant select, insert, update, delete on public.staff_test_group_items to authenticated, service_role;
grant select, insert, update, delete on public.staff_student_groups to authenticated, service_role;
grant select, insert, update, delete on public.staff_student_group_members to authenticated, service_role;
grant select, insert, update, delete on public.staff_test_assignments to authenticated, service_role;
grant select, insert, update, delete on public.staff_test_assignment_recipients to authenticated, service_role;
