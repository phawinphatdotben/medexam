-- =============================================================================
-- 004: MEQ multi-stage (UUID per stage) + student answers keyed by those IDs
-- SBA: one row per question (UUID) + student pick keyed by question ID
--
-- Design note (MEQ):
--   Do NOT put "stage_1_info, stage_1_question, stage_2_..." in ONE wide row.
--   Use 1 parent row (meq_tests) + N child rows (meq_test_stages), each child has its
--   own uuid primary key = the ID you use to store/fetch a student's answer.
-- =============================================================================

-- Optional: add explicit "stage information" column separate from the question text
-- (e.g. labs / imaging for this stage vs the actual prompt).
alter table if exists public.meq_test_stages
  add column if not exists stage_information text;

comment on column public.meq_test_stages.stage_information is
  'Extra data shown at this stage (e.g. results, images narrative). Separate from question_text.';
comment on column public.meq_test_stages.question_text is
  'The actual question the student must answer (typed) at this stage.';
comment on table public.meq_test_stages is
  'One row per MEQ stage; id is the UUID you join to student answers.';

-- =============================================================================
-- MEQ: student text answer per stage (FK = meq_test_stages.id)
-- =============================================================================

create table if not exists public.meq_stage_responses (
  id uuid primary key default gen_random_uuid(),
  meq_stage_id uuid not null references public.meq_test_stages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  answer_text text,
  status public.response_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meq_stage_responses_user_stage_unique unique (user_id, meq_stage_id)
);

create index if not exists meq_stage_responses_stage_idx on public.meq_stage_responses (meq_stage_id);
create index if not exists meq_stage_responses_user_idx on public.meq_stage_responses (user_id);
create index if not exists meq_stage_responses_status_idx on public.meq_stage_responses (status);

comment on table public.meq_stage_responses is
  'Student free-text answer. Join key is meq_stage_id (the stage row UUID in meq_test_stages).';
comment on column public.meq_stage_responses.meq_stage_id is
  'Matches meq_test_stages.id for that specific stage.';

drop trigger if exists meq_stage_responses_set_updated_at on public.meq_stage_responses;
create trigger meq_stage_responses_set_updated_at
  before update on public.meq_stage_responses
  for each row execute function public.set_updated_at();

-- Optional: when locked, record first lock time
alter table if exists public.meq_stage_responses
  add column if not exists locked_at timestamptz;

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

drop trigger if exists meq_stage_responses_lock_trg on public.meq_stage_responses;
create trigger meq_stage_responses_lock_trg
  before insert or update on public.meq_stage_responses
  for each row execute function public.meq_responses_sync_locked_at();

-- =============================================================================
-- SBA: student multiple-choice answer per question row (FK = sba_test_questions.id)
-- =============================================================================

create table if not exists public.sba_question_responses (
  id uuid primary key default gen_random_uuid(),
  sba_test_question_id uuid not null references public.sba_test_questions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  selected_option_id text not null,
  is_correct boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sba_question_responses_user_q_unique unique (user_id, sba_test_question_id)
);

create index if not exists sba_question_responses_q_idx on public.sba_question_responses (sba_test_question_id);
create index if not exists sba_question_responses_user_idx on public.sba_question_responses (user_id);

comment on table public.sba_question_responses is
  'SBA attempt: which option the student selected. Join key = sba_test_questions.id.';
comment on column public.sba_question_responses.selected_option_id is
  'Same id as in sba_test_questions.options json (e.g. A, B, C).';
comment on column public.sba_question_responses.is_correct is
  'Optional cache: selected_option_id = sba_test_questions.correct_option_id. Can be computed in app.';

drop trigger if exists sba_question_responses_set_updated_at on public.sba_question_responses;
create trigger sba_question_responses_set_updated_at
  before update on public.sba_question_responses
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================

alter table public.meq_stage_responses enable row level security;
alter table public.sba_question_responses enable row level security;

drop policy if exists "meq_stage_responses_select_own" on public.meq_stage_responses;
create policy "meq_stage_responses_select_own"
  on public.meq_stage_responses for select
  using (auth.uid() = user_id);

drop policy if exists "meq_stage_responses_select_staff" on public.meq_stage_responses;
create policy "meq_stage_responses_select_staff"
  on public.meq_stage_responses for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('educator', 'admin', 'sub_admin')
    )
  );

drop policy if exists "meq_stage_responses_insert_student" on public.meq_stage_responses;
create policy "meq_stage_responses_insert_student"
  on public.meq_stage_responses for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'student'
    )
  );

drop policy if exists "meq_stage_responses_update_own" on public.meq_stage_responses;
create policy "meq_stage_responses_update_own"
  on public.meq_stage_responses for update
  using (auth.uid() = user_id and status = 'draft')
  with check (auth.uid() = user_id and status in ('draft', 'locked'));

-- -----------------------------------------------------------------------------

drop policy if exists "sba_question_responses_select_own" on public.sba_question_responses;
create policy "sba_question_responses_select_own"
  on public.sba_question_responses for select
  using (auth.uid() = user_id);

drop policy if exists "sba_question_responses_select_staff" on public.sba_question_responses;
create policy "sba_question_responses_select_staff"
  on public.sba_question_responses for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('educator', 'admin', 'sub_admin')
    )
  );

drop policy if exists "sba_question_responses_insert_student" on public.sba_question_responses;
create policy "sba_question_responses_insert_student"
  on public.sba_question_responses for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'student'
    )
  );

drop policy if exists "sba_question_responses_update_student" on public.sba_question_responses;
-- Allow one correction while not yet "final" — optional; tighten to no updates if you want one-shot
create policy "sba_question_responses_update_student"
  on public.sba_question_responses for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Grants (inherit from existing project pattern)
grant select, insert, update, delete on public.meq_stage_responses to postgres, service_role, authenticated;
grant select, insert, update, delete on public.sba_question_responses to postgres, service_role, authenticated;
