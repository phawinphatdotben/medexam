-- =============================================================================
-- 044: Real-exam proctor audit log (focus loss, fullscreen, auto-submit, etc.)
-- Students insert during assigned real tests; staff read for live monitoring.
-- =============================================================================

create table if not exists public.exam_proctor_events (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.staff_test_assignments (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  test_kind text not null check (test_kind in ('MEQ', 'SBA')),
  test_id uuid not null,
  event_type text not null check (
    event_type in (
      'session_started',
      'session_ended',
      'focus_lost',
      'focus_returned',
      'fullscreen_entered',
      'fullscreen_exited',
      'auto_submit_overall',
      'auto_submit_stage'
    )
  ),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists exam_proctor_events_assignment_created_idx
  on public.exam_proctor_events (assignment_id, created_at desc);

create index if not exists exam_proctor_events_student_created_idx
  on public.exam_proctor_events (student_id, created_at desc);

comment on table public.exam_proctor_events is
  'Audit trail when students take assigned real tests (focus changes, timers, session lifecycle).';

-- Student may log only for assignments currently assigned to them.
create or replace function public.student_can_log_proctor_event(p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_test_assignments a
    join public.staff_test_assignment_recipients r on r.assignment_id = a.id
    where a.id = p_assignment_id
      and (a.window_start is null or a.window_start <= now())
      and (a.window_end is null or a.window_end >= now())
      and (
        r.student_id = auth.uid()
        or exists (
          select 1
          from public.staff_student_group_members m
          where m.student_group_id = r.student_group_id
            and m.student_id = auth.uid()
        )
      )
  );
$$;

grant execute on function public.student_can_log_proctor_event(uuid) to authenticated, service_role;

alter table public.exam_proctor_events enable row level security;

drop policy if exists "exam_proctor_events_insert_student" on public.exam_proctor_events;
create policy "exam_proctor_events_insert_student"
  on public.exam_proctor_events for insert
  to authenticated
  with check (
    student_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role::text = 'student'
    )
    and public.student_can_log_proctor_event(assignment_id)
  );

drop policy if exists "exam_proctor_events_select_staff" on public.exam_proctor_events;
create policy "exam_proctor_events_select_staff"
  on public.exam_proctor_events for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role::text in ('admin', 'educator', 'sub_admin')
    )
  );

grant select, insert on public.exam_proctor_events to authenticated, service_role;
