-- -----------------------------------------------------------------------------
-- Assignment-level exam timer (minutes once opened) + gated "Test taking" nav.
-- Drops per-question SBA timer column (students use assignment + overall test caps only).
-- -----------------------------------------------------------------------------

alter table public.staff_test_assignments
  add column if not exists exam_time_limit_minutes int;

comment on column public.staff_test_assignments.exam_time_limit_minutes is
  'Caps the attempt length (minutes after the student enters the exam). When null, MEQ/SBA test row time_limit_minutes is used if set.';

alter table public.sba_test_questions
  drop column if exists time_limit_minutes;

create table if not exists public.student_ui_settings (
  id smallint primary key default 1,
  constraint student_ui_settings_singleton check (id = 1),
  test_taking_nav_visible boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

comment on table public.student_ui_settings is
  'Single-row UX flags (students see Test taking navbar link when enabled by admin/sub-admin).';

insert into public.student_ui_settings (id, test_taking_nav_visible)
values (1, true)
on conflict (id) do nothing;

alter table public.student_ui_settings enable row level security;

drop trigger if exists student_ui_settings_set_updated_at on public.student_ui_settings;
create trigger student_ui_settings_set_updated_at
  before update on public.student_ui_settings
  for each row execute function public.set_updated_at();

drop policy if exists "student_ui_settings_select_authenticated" on public.student_ui_settings;
create policy "student_ui_settings_select_authenticated" on public.student_ui_settings
  for select
  to authenticated
  using (true);

drop policy if exists "student_ui_settings_update_staff" on public.student_ui_settings;
create policy "student_ui_settings_update_staff" on public.student_ui_settings
  for update
  to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
  );

grant select on public.student_ui_settings to authenticated, service_role;
grant update on public.student_ui_settings to authenticated, service_role;
