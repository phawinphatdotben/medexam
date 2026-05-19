-- =============================================================================
-- 045: AI / ML data-readiness pipeline (formative-first ground truth)
-- Extends meq_ai_training_records, interaction event stream, student vector
-- aggregates, sync queue, and security-definer RPCs for export/clustering.
-- Apply after 036 (stage items), 043 (task_category), 044 (proctor events).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Pipeline feature flags (singleton)
-- ---------------------------------------------------------------------------
create table if not exists public.meq_ai_pipeline_config (
  id smallint primary key default 1,
  constraint meq_ai_pipeline_config_singleton check (id = 1),
  formative_capture_enabled boolean not null default true,
  summative_capture_enabled boolean not null default false,
  auto_enqueue_on_lock boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

insert into public.meq_ai_pipeline_config (id, formative_capture_enabled, summative_capture_enabled, auto_enqueue_on_lock)
values (1, true, false, true)
on conflict (id) do nothing;

alter table public.meq_ai_pipeline_config enable row level security;

drop policy if exists "meq_ai_pipeline_config_select_staff" on public.meq_ai_pipeline_config;
create policy "meq_ai_pipeline_config_select_staff"
  on public.meq_ai_pipeline_config for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role::text in ('admin', 'educator', 'sub_admin')
    )
  );

drop policy if exists "meq_ai_pipeline_config_update_admin" on public.meq_ai_pipeline_config;
create policy "meq_ai_pipeline_config_update_admin"
  on public.meq_ai_pipeline_config for update
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ---------------------------------------------------------------------------
-- Expand meq_ai_training_records (structured ground-truth rows)
-- ---------------------------------------------------------------------------
alter table public.meq_ai_training_records
  add column if not exists schema_version int not null default 3;

alter table public.meq_ai_training_records
  add column if not exists record_kind text not null default 'human_correction';

alter table public.meq_ai_training_records
  add column if not exists student_id uuid references public.profiles (id) on delete set null;

alter table public.meq_ai_training_records
  add column if not exists meq_test_id uuid references public.meq_tests (id) on delete set null;

alter table public.meq_ai_training_records
  add column if not exists meq_stage_id uuid references public.meq_test_stages (id) on delete set null;

alter table public.meq_ai_training_records
  add column if not exists meq_stage_item_id uuid references public.meq_stage_items (id) on delete set null;

alter table public.meq_ai_training_records
  add column if not exists assessment_phase public.committee_purpose;

alter table public.meq_ai_training_records
  add column if not exists subject text;

alter table public.meq_ai_training_records
  add column if not exists course_code text;

alter table public.meq_ai_training_records
  add column if not exists test_year int;

alter table public.meq_ai_training_records
  add column if not exists test_function text;

alter table public.meq_ai_training_records
  add column if not exists task_category text;

alter table public.meq_ai_training_records
  add column if not exists response_text text;

alter table public.meq_ai_training_records
  add column if not exists response_status text;

alter table public.meq_ai_training_records
  add column if not exists locked_at timestamptz;

alter table public.meq_ai_training_records
  add column if not exists stage_time_limit_seconds int;

alter table public.meq_ai_training_records
  add column if not exists stage_elapsed_seconds int;

alter table public.meq_ai_training_records
  add column if not exists human_score numeric(10, 2);

alter table public.meq_ai_training_records
  add column if not exists human_max_score int;

alter table public.meq_ai_training_records
  add column if not exists rubric_criteria text;

alter table public.meq_ai_training_records
  add column if not exists staff_feedback text;

alter table public.meq_ai_training_records
  add column if not exists student_profile_snapshot jsonb not null default '{}'::jsonb;

alter table public.meq_ai_training_records
  add column if not exists interaction_timeline jsonb not null default '[]'::jsonb;

alter table public.meq_ai_training_records
  add column if not exists ml_feature_arrays jsonb not null default '{}'::jsonb;

-- Pipeline rows are system-generated; human_correction rows keep staff_id.
alter table public.meq_ai_training_records
  alter column staff_id drop not null;

create unique index if not exists meq_ai_training_pipeline_per_response_idx
  on public.meq_ai_training_records (meq_stage_response_id, record_kind)
  where meq_stage_response_id is not null and record_kind = 'pipeline_sync';

alter table public.meq_ai_training_records
  drop constraint if exists meq_ai_training_records_record_kind_check;

alter table public.meq_ai_training_records
  add constraint meq_ai_training_records_record_kind_check check (
    record_kind in ('human_correction', 'ground_truth_locked', 'pipeline_sync')
  );

create index if not exists meq_ai_training_student_phase_idx
  on public.meq_ai_training_records (student_id, assessment_phase, created_at desc)
  where student_id is not null;

create index if not exists meq_ai_training_course_category_idx
  on public.meq_ai_training_records (course_code, task_category, assessment_phase)
  where course_code is not null;

create index if not exists meq_ai_training_test_idx
  on public.meq_ai_training_records (meq_test_id, meq_stage_item_id);

create index if not exists meq_ai_training_line_json_gin
  on public.meq_ai_training_records using gin (line_json jsonb_path_ops);

comment on table public.meq_ai_training_records is
  'Ground-truth and human-correction rows for future AI precision grading; schema_version 3 adds denormalized columns + ml_feature_arrays.';

-- Staff with grading roles may read (not students).
drop policy if exists "meq_ai_training_select_grading_staff" on public.meq_ai_training_records;
create policy "meq_ai_training_select_grading_staff"
  on public.meq_ai_training_records for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role::text in ('educator', 'admin', 'sub_admin')
    )
  );

-- ---------------------------------------------------------------------------
-- Timestamped student interaction stream (step-locking / timers / drafts)
-- ---------------------------------------------------------------------------
create table if not exists public.meq_exam_interaction_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  meq_test_id uuid not null references public.meq_tests (id) on delete cascade,
  meq_stage_id uuid references public.meq_test_stages (id) on delete set null,
  meq_stage_item_id uuid references public.meq_stage_items (id) on delete set null,
  assignment_id uuid references public.staff_test_assignments (id) on delete set null,
  assessment_phase public.committee_purpose not null,
  event_type text not null check (
    event_type in (
      'session_started',
      'session_ended',
      'stage_entered',
      'draft_updated',
      'stage_timer_tick',
      'stage_locked',
      'auto_submit_stage',
      'auto_submit_overall',
      'focus_lost',
      'focus_returned'
    )
  ),
  occurred_at timestamptz not null default now(),
  client_sequence bigint not null default 0,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists meq_exam_interaction_student_test_idx
  on public.meq_exam_interaction_events (student_id, meq_test_id, occurred_at);

create index if not exists meq_exam_interaction_stage_idx
  on public.meq_exam_interaction_events (meq_stage_id, occurred_at)
  where meq_stage_id is not null;

create index if not exists meq_exam_interaction_assignment_idx
  on public.meq_exam_interaction_events (assignment_id, occurred_at desc)
  where assignment_id is not null;

alter table public.meq_exam_interaction_events enable row level security;

drop policy if exists "meq_exam_interaction_insert_own" on public.meq_exam_interaction_events;
create policy "meq_exam_interaction_insert_own"
  on public.meq_exam_interaction_events for insert
  to authenticated
  with check (
    student_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'student')
    and public.student_can_access_meq_test(meq_test_id)
  );

drop policy if exists "meq_exam_interaction_select_own" on public.meq_exam_interaction_events;
create policy "meq_exam_interaction_select_own"
  on public.meq_exam_interaction_events for select
  to authenticated
  using (student_id = auth.uid());

drop policy if exists "meq_exam_interaction_select_staff" on public.meq_exam_interaction_events;
create policy "meq_exam_interaction_select_staff"
  on public.meq_exam_interaction_events for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role::text in ('admin', 'educator', 'sub_admin')
    )
  );

-- Students must not read ML aggregates or peer training labels.
revoke all on public.meq_exam_interaction_events from anon;

-- ---------------------------------------------------------------------------
-- Async sync queue: locked response -> training record (formative-first)
-- ---------------------------------------------------------------------------
create table if not exists public.meq_ai_sync_queue (
  id uuid primary key default gen_random_uuid(),
  meq_stage_response_id uuid not null references public.meq_stage_responses (id) on delete cascade,
  enqueued_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text
);

create unique index if not exists meq_ai_sync_queue_pending_unique
  on public.meq_ai_sync_queue (meq_stage_response_id)
  where processed_at is null;

create index if not exists meq_ai_sync_queue_unprocessed_idx
  on public.meq_ai_sync_queue (enqueued_at)
  where processed_at is null;

alter table public.meq_ai_sync_queue enable row level security;

drop policy if exists "meq_ai_sync_queue_staff_select" on public.meq_ai_sync_queue;
create policy "meq_ai_sync_queue_staff_select"
  on public.meq_ai_sync_queue for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role::text in ('admin', 'sub_admin')
    )
  );

-- ---------------------------------------------------------------------------
-- Cluster-ready student vectors (per subject × phase × task category)
-- ---------------------------------------------------------------------------
create table if not exists public.meq_ml_student_vectors (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  subject text not null,
  course_code text not null,
  assessment_phase public.committee_purpose not null default 'formative',
  task_category text not null,
  item_count int not null default 0,
  score_array numeric[] not null default '{}',
  max_score_array numeric[] not null default '{}',
  normalized_score_array numeric[] not null default '{}',
  answer_length_array int[] not null default '{}',
  stage_order_array int[] not null default '{}',
  item_order_array int[] not null default '{}',
  meq_test_id_array uuid[] not null default '{}',
  locked_at_array timestamptz[] not null default '{}',
  refreshed_at timestamptz not null default now(),
  constraint meq_ml_student_vectors_unique unique (
    student_id, subject, course_code, assessment_phase, task_category
  )
);

create index if not exists meq_ml_student_vectors_lookup_idx
  on public.meq_ml_student_vectors (course_code, assessment_phase, task_category);

create index if not exists meq_ml_student_vectors_subject_idx
  on public.meq_ml_student_vectors (subject, assessment_phase);

alter table public.meq_ml_student_vectors enable row level security;

-- No direct student access to aggregated vectors or training labels.
drop policy if exists "meq_ml_student_vectors_select_staff" on public.meq_ml_student_vectors;
create policy "meq_ml_student_vectors_select_staff"
  on public.meq_ml_student_vectors for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role::text in ('admin', 'educator', 'sub_admin')
    )
  );

-- Writes only via security definer RPCs.
revoke insert, update, delete on public.meq_ml_student_vectors from authenticated;
grant select on public.meq_ml_student_vectors to authenticated, service_role;

grant select, insert on public.meq_exam_interaction_events to authenticated, service_role;
grant select on public.meq_ai_pipeline_config to authenticated, service_role;
grant select on public.meq_ai_sync_queue to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helper: student profile snapshot for training rows
-- ---------------------------------------------------------------------------
create or replace function public.meq_student_profile_snapshot(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'user_id', p.id,
    'role', p.role::text,
    'medical_student_year', p.medical_student_year,
    'profile_year', p.profile_year,
    'institution', p.institution,
    'captured_at', now()
  )
  from public.profiles p
  where p.id = p_user_id
  limit 1;
$$;

grant execute on function public.meq_student_profile_snapshot(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Build ml_feature_arrays + interaction_timeline for one locked response
-- ---------------------------------------------------------------------------
create or replace function public.meq_build_training_payload(
  p_response_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row record;
  v_timeline jsonb;
  v_arrays jsonb;
  v_norm numeric;
begin
  select
    r.id as response_id,
    r.user_id as student_id,
    r.answer_text,
    r.status,
    r.locked_at,
    r.human_override_score,
    r.ai_rationale_feedback,
    r.grading_history,
    i.id as item_id,
    i.task_category,
    i.sequence_order as item_order,
    i.rubric_criteria,
    i.max_score as item_max_score,
    s.id as stage_id,
    s.sequence_order as stage_order,
    s.time_limit_minutes,
    t.id as test_id,
    t.subject,
    t.course_code,
    t.test_year,
    t.test_function,
    t.assessment_purpose
  into v_row
  from public.meq_stage_responses r
  join public.meq_stage_items i on i.id = r.meq_stage_item_id
  join public.meq_test_stages s on s.id = r.meq_stage_id
  join public.meq_tests t on t.id = s.meq_test_id
  where r.id = p_response_id
    and r.status = 'locked';

  if not found then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'event_type', e.event_type,
        'occurred_at', e.occurred_at,
        'client_sequence', e.client_sequence,
        'payload', e.payload
      )
      order by e.occurred_at, e.client_sequence
    ),
    '[]'::jsonb
  )
  into v_timeline
  from public.meq_exam_interaction_events e
  where e.student_id = v_row.student_id
    and e.meq_test_id = v_row.test_id
    and (e.meq_stage_id is null or e.meq_stage_id = v_row.stage_id);

  v_norm := case
    when v_row.human_override_score is not null and v_row.item_max_score > 0
    then round((v_row.human_override_score / v_row.item_max_score::numeric)::numeric, 5)
    else null
  end;

  v_arrays := jsonb_build_object(
    'score', coalesce(v_row.human_override_score, null),
    'max_score', v_row.item_max_score,
    'normalized_score', v_norm,
    'answer_char_length', coalesce(length(v_row.answer_text), 0),
    'task_category', v_row.task_category,
    'stage_order', v_row.stage_order,
    'item_order', v_row.item_order,
    'stage_time_limit_seconds', (v_row.time_limit_minutes * 60)
  );

  return jsonb_build_object(
    'timeline', v_timeline,
    'ml_feature_arrays', v_arrays,
    'row', to_jsonb(v_row)
  );
end;
$$;

grant execute on function public.meq_build_training_payload(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Upsert training record from a locked response (idempotent per response)
-- ---------------------------------------------------------------------------
create or replace function public.meq_sync_training_record_from_response(
  p_response_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_row jsonb;
  v_cfg record;
  v_id uuid;
  v_line jsonb;
begin
  select formative_capture_enabled, summative_capture_enabled
  into v_cfg
  from public.meq_ai_pipeline_config
  where id = 1;

  v_payload := public.meq_build_training_payload(p_response_id);
  if v_payload is null then
    return null;
  end if;

  v_row := v_payload->'row';

  if (v_row->>'assessment_purpose') = 'formative' and not coalesce(v_cfg.formative_capture_enabled, true) then
    return null;
  end if;
  if (v_row->>'assessment_purpose') = 'summative' and not coalesce(v_cfg.summative_capture_enabled, false) then
    return null;
  end if;

  if (v_row->>'assessment_purpose') = 'summative'
     and (v_row->>'test_function') = 'real_test'
     and not exists (
       select 1 from public.meq_tests t
       where t.id = (v_row->>'test_id')::uuid and t.review_status = 'approved'
     ) then
    return null;
  end if;

  v_line := jsonb_build_object(
    'schema_version', 3,
    'recorded_at', now(),
    'purpose', 'ground_truth_locked',
    'response_id', p_response_id,
    'student_id', v_row->>'student_id',
    'meq_test_id', v_row->>'test_id',
    'meq_stage_id', v_row->>'stage_id',
    'meq_stage_item_id', v_row->>'item_id',
    'course_code', v_row->>'course_code',
    'task_category', v_row->>'task_category',
    'assessment_phase', v_row->>'assessment_purpose',
    'student_answer', v_row->>'answer_text',
    'human_score', v_row->>'human_override_score',
    'max_score', v_row->>'item_max_score'
  );

  insert into public.meq_ai_training_records (
    staff_id,
    meq_stage_response_id,
    line_json,
    schema_version,
    record_kind,
    student_id,
    meq_test_id,
    meq_stage_id,
    meq_stage_item_id,
    assessment_phase,
    subject,
    course_code,
    test_year,
    test_function,
    task_category,
    response_text,
    response_status,
    locked_at,
    stage_time_limit_seconds,
    human_score,
    human_max_score,
    rubric_criteria,
    staff_feedback,
    student_profile_snapshot,
    interaction_timeline,
    ml_feature_arrays
  )
  values (
    null,
    p_response_id,
    v_line,
    3,
    'pipeline_sync',
    (v_row->>'student_id')::uuid,
    (v_row->>'test_id')::uuid,
    (v_row->>'stage_id')::uuid,
    (v_row->>'item_id')::uuid,
    (v_row->>'assessment_purpose')::public.committee_purpose,
    v_row->>'subject',
    v_row->>'course_code',
    (v_row->>'test_year')::int,
    v_row->>'test_function',
    v_row->>'task_category',
    v_row->>'answer_text',
    v_row->>'status',
    (v_row->>'locked_at')::timestamptz,
    ((v_row->>'time_limit_minutes')::int) * 60,
    (v_row->>'human_override_score')::numeric,
    (v_row->>'item_max_score')::int,
    v_row->>'rubric_criteria',
    v_row->>'ai_rationale_feedback',
    public.meq_student_profile_snapshot((v_row->>'student_id')::uuid),
    v_payload->'timeline',
    v_payload->'ml_feature_arrays'
  )
  on conflict (meq_stage_response_id, record_kind)
  do update set
    response_text = excluded.response_text,
    human_score = excluded.human_score,
    human_max_score = excluded.human_max_score,
    staff_feedback = excluded.staff_feedback,
    locked_at = excluded.locked_at,
    interaction_timeline = excluded.interaction_timeline,
    ml_feature_arrays = excluded.ml_feature_arrays,
    line_json = excluded.line_json
  returning id into v_id;

  if v_id is null then
    select tr.id into v_id
    from public.meq_ai_training_records tr
    where tr.meq_stage_response_id = p_response_id
      and tr.record_kind = 'pipeline_sync'
    limit 1;
  end if;

  return v_id;
end;
$$;

grant execute on function public.meq_sync_training_record_from_response(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Process sync queue batch (call from cron / admin tooling)
-- ---------------------------------------------------------------------------
create or replace function public.meq_process_ai_sync_queue(p_limit int default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_processed int := 0;
  v_failed int := 0;
  rec record;
  v_new_id uuid;
begin
  select p.role::text into v_role from public.profiles p where p.id = auth.uid();
  if v_role is distinct from 'admin' and auth.role() is distinct from 'service_role' then
    raise exception 'admin or service_role required';
  end if;

  for rec in
    select id, meq_stage_response_id
    from public.meq_ai_sync_queue
    where processed_at is null
    order by enqueued_at
    limit greatest(1, least(p_limit, 500))
  loop
    begin
      v_new_id := public.meq_sync_training_record_from_response(rec.meq_stage_response_id);
      update public.meq_ai_sync_queue
      set processed_at = now(), last_error = null
      where id = rec.id;
      v_processed := v_processed + 1;
    exception when others then
      update public.meq_ai_sync_queue
      set last_error = sqlerrm
      where id = rec.id;
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object('processed', v_processed, 'failed', v_failed);
end;
$$;

grant execute on function public.meq_process_ai_sync_queue(int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Refresh cluster vectors for formative (all clinical subjects)
-- ---------------------------------------------------------------------------
create or replace function public.meq_refresh_ml_student_vectors(
  p_assessment_phase public.committee_purpose default 'formative',
  p_subject text default null,
  p_course_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_rows int := 0;
begin
  select p.role::text into v_role from public.profiles p where p.id = auth.uid();
  if v_role not in ('admin', 'educator', 'sub_admin') and auth.role() is distinct from 'service_role' then
    raise exception 'staff role required';
  end if;

  insert into public.meq_ml_student_vectors (
    student_id,
    subject,
    course_code,
    assessment_phase,
    task_category,
    item_count,
    score_array,
    max_score_array,
    normalized_score_array,
    answer_length_array,
    stage_order_array,
    item_order_array,
    meq_test_id_array,
    locked_at_array,
    refreshed_at
  )
  select
    r.student_id,
    r.subject,
    r.course_code,
    r.assessment_phase,
    r.task_category,
    count(*)::int,
    array_agg(r.human_score order by r.locked_at nulls last),
    array_agg(r.human_max_score::numeric order by r.locked_at nulls last),
    array_agg(
      case when r.human_max_score > 0 and r.human_score is not null
        then round((r.human_score / r.human_max_score::numeric)::numeric, 5)
        else null
      end
      order by r.locked_at nulls last
    ),
    array_agg(coalesce(length(r.response_text), 0) order by r.locked_at nulls last),
    array_agg(r.stage_order order by r.locked_at nulls last),
    array_agg(r.item_order order by r.locked_at nulls last),
    array_agg(r.meq_test_id order by r.locked_at nulls last),
    array_agg(r.locked_at order by r.locked_at nulls last),
    now()
  from (
    select
      tr.student_id,
      tr.subject,
      tr.course_code,
      tr.assessment_phase,
      tr.task_category,
      tr.human_score,
      tr.human_max_score,
      tr.response_text,
      tr.locked_at,
      tr.meq_test_id,
      si.sequence_order as item_order,
      st.sequence_order as stage_order
    from public.meq_ai_training_records tr
    join public.meq_stage_items si on si.id = tr.meq_stage_item_id
    join public.meq_test_stages st on st.id = tr.meq_stage_id
    where tr.record_kind in ('pipeline_sync', 'ground_truth_locked', 'human_correction')
      and tr.student_id is not null
      and tr.assessment_phase = p_assessment_phase
      and (p_subject is null or tr.subject = p_subject)
      and (p_course_code is null or tr.course_code = p_course_code)
      and tr.locked_at is not null
  ) r
  group by r.student_id, r.subject, r.course_code, r.assessment_phase, r.task_category
  on conflict (student_id, subject, course_code, assessment_phase, task_category)
  do update set
    item_count = excluded.item_count,
    score_array = excluded.score_array,
    max_score_array = excluded.max_score_array,
    normalized_score_array = excluded.normalized_score_array,
    answer_length_array = excluded.answer_length_array,
    stage_order_array = excluded.stage_order_array,
    item_order_array = excluded.item_order_array,
    meq_test_id_array = excluded.meq_test_id_array,
    locked_at_array = excluded.locked_at_array,
    refreshed_at = excluded.refreshed_at;

  get diagnostics v_rows = row_count;

  return jsonb_build_object(
    'assessment_phase', p_assessment_phase,
    'subject', p_subject,
    'course_code', p_course_code,
    'vector_groups_upserted', v_rows
  );
end;
$$;

grant execute on function public.meq_refresh_ml_student_vectors(public.committee_purpose, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Export formative corpus as parallel arrays (ML plug-in point)
-- ---------------------------------------------------------------------------
create or replace function public.meq_export_formative_corpus_arrays(
  p_course_code text default null,
  p_task_category text default null,
  p_limit int default 5000
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select p.role::text into v_role from public.profiles p where p.id = auth.uid();
  if v_role not in ('admin', 'educator', 'sub_admin') and auth.role() is distinct from 'service_role' then
    raise exception 'staff role required';
  end if;

  return (
    select jsonb_build_object(
      'schema_version', 3,
      'assessment_phase', 'formative',
      'exported_at', now(),
      'filters', jsonb_build_object(
        'course_code', p_course_code,
        'task_category', p_task_category,
        'limit', p_limit
      ),
      'student_id_array', coalesce(jsonb_agg(distinct v.student_id), '[]'::jsonb),
      'vectors', coalesce(
        jsonb_agg(
          jsonb_build_object(
            'student_id', v.student_id,
            'subject', v.subject,
            'course_code', v.course_code,
            'task_category', v.task_category,
            'item_count', v.item_count,
            'score_array', v.score_array,
            'normalized_score_array', v.normalized_score_array,
            'answer_length_array', v.answer_length_array,
            'stage_order_array', v.stage_order_array
          )
        ),
        '[]'::jsonb
      )
    )
    from (
      select *
      from public.meq_ml_student_vectors mv
      where mv.assessment_phase = 'formative'
        and (p_course_code is null or mv.course_code = p_course_code)
        and (p_task_category is null or mv.task_category = p_task_category)
      order by mv.refreshed_at desc
      limit greatest(1, least(p_limit, 20000))
    ) v
  );
end;
$$;

grant execute on function public.meq_export_formative_corpus_arrays(text, text, int)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Append interaction event (validated, high-throughput insert path)
-- ---------------------------------------------------------------------------
create or replace function public.meq_append_exam_interaction(
  p_meq_test_id uuid,
  p_event_type text,
  p_meq_stage_id uuid default null,
  p_meq_stage_item_id uuid default null,
  p_assignment_id uuid default null,
  p_client_sequence bigint default 0,
  p_payload jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
  v_phase public.committee_purpose;
  v_id uuid;
begin
  v_student_id := auth.uid();
  if v_student_id is null then
    raise exception 'not authenticated';
  end if;

  if not public.student_can_access_meq_test(p_meq_test_id) then
    raise exception 'test not accessible';
  end if;

  select t.assessment_purpose into v_phase
  from public.meq_tests t
  where t.id = p_meq_test_id;

  insert into public.meq_exam_interaction_events (
    student_id,
    meq_test_id,
    meq_stage_id,
    meq_stage_item_id,
    assignment_id,
    assessment_phase,
    event_type,
    occurred_at,
    client_sequence,
    payload
  )
  values (
    v_student_id,
    p_meq_test_id,
    p_meq_stage_id,
    p_meq_stage_item_id,
    p_assignment_id,
    coalesce(v_phase, 'formative'),
    p_event_type,
    coalesce(p_occurred_at, now()),
    coalesce(p_client_sequence, 0),
    coalesce(p_payload, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.meq_append_exam_interaction(
  uuid, text, uuid, uuid, uuid, bigint, jsonb, timestamptz
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enqueue on lock trigger
-- ---------------------------------------------------------------------------
create or replace function public.meq_enqueue_ai_sync_on_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auto boolean;
begin
  if new.status <> 'locked' or (tg_op = 'UPDATE' and old.status = 'locked') then
    return new;
  end if;

  select auto_enqueue_on_lock into v_auto from public.meq_ai_pipeline_config where id = 1;
  if not coalesce(v_auto, true) then
    return new;
  end if;

  insert into public.meq_ai_sync_queue (meq_stage_response_id)
  values (new.id)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists meq_stage_responses_ai_sync_trg on public.meq_stage_responses;
create trigger meq_stage_responses_ai_sync_trg
  after insert or update of status on public.meq_stage_responses
  for each row
  execute function public.meq_enqueue_ai_sync_on_lock();

-- Backfill queue for existing locked formative responses (optional one-time)
insert into public.meq_ai_sync_queue (meq_stage_response_id)
select r.id
from public.meq_stage_responses r
join public.meq_stage_items i on i.id = r.meq_stage_item_id
join public.meq_test_stages s on s.id = r.meq_stage_id
join public.meq_tests t on t.id = s.meq_test_id
where r.status = 'locked'
  and t.assessment_purpose = 'formative'
  and t.review_status = 'approved'
  and not exists (
    select 1 from public.meq_ai_sync_queue q
    where q.meq_stage_response_id = r.id and q.processed_at is null
  );
