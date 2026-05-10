-- =============================================================================
-- 031: SBA committee review bundles + whole-question/straw-man content edit logs
--
-- Bundles pool real (+ optional practice) SBA tests by course/year/track for
-- admin/sub-admin to assemble; assigned committee educators see the bundle
-- read-only via RLS. Content edits remain admin/sub-admin (existing test-review).
-- Logs store one blob per save: previous_whole -> new_whole (not keystrokes).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Review bundles (separate from staff_test_groups used for student delivery)
-- -----------------------------------------------------------------------------
create table if not exists public.sba_committee_review_bundles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  course_code text not null references public.course_catalog (course_code) on update cascade on delete restrict,
  test_year int not null,
  assessment_purpose public.committee_purpose not null,
  committee_id uuid not null references public.committees (id) on delete restrict,
  include_practice_in_pool boolean not null default false,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.sba_committee_review_bundles is
  'Curated pools of SBA tests for committee review before student assignment.';

drop trigger if exists sba_review_bundles_set_updated_at on public.sba_committee_review_bundles;
create trigger sba_review_bundles_set_updated_at
  before update on public.sba_committee_review_bundles
  for each row execute function public.set_updated_at();

create index if not exists sba_review_bundles_course_year_idx
  on public.sba_committee_review_bundles (course_code, test_year, assessment_purpose);
create index if not exists sba_review_bundles_committee_idx
  on public.sba_committee_review_bundles (committee_id);

create table if not exists public.sba_committee_bundle_items (
  bundle_id uuid not null references public.sba_committee_review_bundles (id) on delete cascade,
  sba_test_id uuid not null references public.sba_tests (id) on delete cascade,
  sort_order int not null default 0,
  primary key (bundle_id, sba_test_id)
);

create index if not exists sba_bundle_items_test_idx on public.sba_committee_bundle_items (sba_test_id);

-- -----------------------------------------------------------------------------
-- Whole-blob edit logs (one row per save on test-review pages)
-- -----------------------------------------------------------------------------
create table if not exists public.sba_question_whole_edit_log (
  id uuid primary key default gen_random_uuid(),
  sba_test_question_id uuid not null references public.sba_test_questions (id) on delete cascade,
  sba_test_id uuid not null references public.sba_tests (id) on delete cascade,
  editor_id uuid references public.profiles (id) on delete set null,
  previous_whole text,
  new_whole text not null,
  created_at timestamptz not null default now()
);

create index if not exists sba_q_edit_log_question_idx on public.sba_question_whole_edit_log (sba_test_question_id);
create index if not exists sba_q_edit_log_test_idx on public.sba_question_whole_edit_log (sba_test_id);

comment on column public.sba_question_whole_edit_log.previous_whole is
  'Snapshot before save (stem + serialized options JSON), for X→Y auditing.';
comment on column public.sba_question_whole_edit_log.new_whole is
  'Snapshot after save.';

create table if not exists public.meq_stage_question_whole_edit_log (
  id uuid primary key default gen_random_uuid(),
  meq_stage_id uuid not null references public.meq_test_stages (id) on delete cascade,
  meq_test_id uuid not null references public.meq_tests (id) on delete cascade,
  editor_id uuid references public.profiles (id) on delete set null,
  previous_whole text,
  new_whole text not null,
  created_at timestamptz not null default now()
);

create index if not exists meq_stage_q_edit_log_stage_idx on public.meq_stage_question_whole_edit_log (meq_stage_id);

comment on column public.meq_stage_question_whole_edit_log.previous_whole is
  'Stage briefing + separator + stem before save.';
comment on column public.meq_stage_question_whole_edit_log.new_whole is
  'Stage briefing + separator + stem after save.';

-- -----------------------------------------------------------------------------
-- RLS helpers
-- -----------------------------------------------------------------------------
create or replace function public.sub_admin_has_course_scope(p_course text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sub_admin_course_scopes sc
    where sc.profile_id = auth.uid()
      and sc.course_code = p_course
  );
$$;

grant execute on function public.sub_admin_has_course_scope(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- sba_committee_review_bundles
-- -----------------------------------------------------------------------------
alter table public.sba_committee_review_bundles enable row level security;

drop policy if exists "sba_review_bundles_select_staff" on public.sba_committee_review_bundles;
create policy "sba_review_bundles_select_staff" on public.sba_committee_review_bundles for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
      and public.sub_admin_has_course_scope(sba_committee_review_bundles.course_code)
    )
    or exists (
      select 1 from public.committee_members cm
      where cm.profile_id = auth.uid()
        and cm.committee_id = sba_committee_review_bundles.committee_id
    )
  );

drop policy if exists "sba_review_bundles_insert" on public.sba_committee_review_bundles;
create policy "sba_review_bundles_insert" on public.sba_committee_review_bundles for insert
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
      and public.sub_admin_has_course_scope(sba_committee_review_bundles.course_code)
      and created_by = auth.uid()
    )
  );

drop policy if exists "sba_review_bundles_update" on public.sba_committee_review_bundles;
create policy "sba_review_bundles_update" on public.sba_committee_review_bundles for update
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
      and public.sub_admin_has_course_scope(sba_committee_review_bundles.course_code)
      and (
        created_by = auth.uid()
        or exists (select 1 from public.profiles p2 where p2.id = auth.uid() and p2.role = 'admin')
      )
    )
  );

drop policy if exists "sba_review_bundles_delete" on public.sba_committee_review_bundles;
create policy "sba_review_bundles_delete" on public.sba_committee_review_bundles for delete
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
      and public.sub_admin_has_course_scope(sba_committee_review_bundles.course_code)
      and created_by = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- sba_committee_bundle_items
-- -----------------------------------------------------------------------------
alter table public.sba_committee_bundle_items enable row level security;

drop policy if exists "sba_bundle_items_select" on public.sba_committee_bundle_items;
create policy "sba_bundle_items_select" on public.sba_committee_bundle_items for select
  using (
    exists (
      select 1 from public.sba_committee_review_bundles b
      where b.id = sba_committee_bundle_items.bundle_id
        and (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
          or (
            exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
            and public.sub_admin_has_course_scope(b.course_code)
          )
          or exists (
            select 1 from public.committee_members cm
            where cm.profile_id = auth.uid()
              and cm.committee_id = b.committee_id
          )
        )
    )
  );

drop policy if exists "sba_bundle_items_insert_staff" on public.sba_committee_bundle_items;
create policy "sba_bundle_items_insert_staff" on public.sba_committee_bundle_items for insert
  with check (
    exists (
      select 1 from public.sba_committee_review_bundles b
      where b.id = sba_committee_bundle_items.bundle_id
        and (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
          or (
            exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
            and public.sub_admin_has_course_scope(b.course_code)
          )
        )
    )
  );

drop policy if exists "sba_bundle_items_update_staff" on public.sba_committee_bundle_items;
create policy "sba_bundle_items_update_staff" on public.sba_committee_bundle_items for update
  using (
    exists (
      select 1 from public.sba_committee_review_bundles b
      where b.id = sba_committee_bundle_items.bundle_id
        and (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
          or (
            exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
            and public.sub_admin_has_course_scope(b.course_code)
          )
        )
    )
  );

drop policy if exists "sba_bundle_items_delete_staff" on public.sba_committee_bundle_items;
create policy "sba_bundle_items_delete_staff" on public.sba_committee_bundle_items for delete
  using (
    exists (
      select 1 from public.sba_committee_review_bundles b
      where b.id = sba_committee_bundle_items.bundle_id
        and (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
          or (
            exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
            and public.sub_admin_has_course_scope(b.course_code)
          )
        )
    )
  );

-- -----------------------------------------------------------------------------
-- Edit logs: admin / sub-admin with course scope OR global admin reads
-- -----------------------------------------------------------------------------
alter table public.sba_question_whole_edit_log enable row level security;

drop policy if exists "sba_q_edit_log_select" on public.sba_question_whole_edit_log;
create policy "sba_q_edit_log_select" on public.sba_question_whole_edit_log for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
      and exists (
        select 1 from public.sba_tests t
        where t.id = sba_question_whole_edit_log.sba_test_id
          and public.sub_admin_has_course_scope(t.subject_code)
      )
    )
  );

drop policy if exists "sba_q_edit_log_insert" on public.sba_question_whole_edit_log;
create policy "sba_q_edit_log_insert" on public.sba_question_whole_edit_log for insert
  with check (
    editor_id = auth.uid()
    and (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
      or (
        exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
        and exists (
          select 1 from public.sba_tests t
          where t.id = sba_question_whole_edit_log.sba_test_id
            and public.sub_admin_has_course_scope(t.subject_code)
        )
      )
    )
  );

alter table public.meq_stage_question_whole_edit_log enable row level security;

drop policy if exists "meq_stage_q_edit_log_select" on public.meq_stage_question_whole_edit_log;
create policy "meq_stage_q_edit_log_select" on public.meq_stage_question_whole_edit_log for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
      and exists (
        select 1 from public.meq_tests t
        where t.id = meq_stage_question_whole_edit_log.meq_test_id
          and public.sub_admin_has_course_scope(t.course_code)
      )
    )
  );

drop policy if exists "meq_stage_q_edit_log_insert" on public.meq_stage_question_whole_edit_log;
create policy "meq_stage_q_edit_log_insert" on public.meq_stage_question_whole_edit_log for insert
  with check (
    editor_id = auth.uid()
    and (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
      or (
        exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
        and exists (
          select 1 from public.meq_tests t
          where t.id = meq_stage_question_whole_edit_log.meq_test_id
            and public.sub_admin_has_course_scope(t.course_code)
        )
      )
    )
  );

grant select, insert, update, delete on public.sba_committee_review_bundles to authenticated, service_role, postgres;
grant select, insert, update, delete on public.sba_committee_bundle_items to authenticated, service_role, postgres;
grant select, insert on public.sba_question_whole_edit_log to authenticated, service_role, postgres;
grant select, insert on public.meq_stage_question_whole_edit_log to authenticated, service_role, postgres;
