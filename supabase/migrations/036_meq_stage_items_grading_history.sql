-- =============================================================================
-- 036: Multiple graded questions per MEQ stage (meq_stage_items) + append-only
--       grading_history on responses for staff grade audit trail.
-- Backfills one item per existing stage; migrates responses to item_id uniqueness.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Stage items: rubric/score/prompt live here; meq_test_stages keeps stage shell
-- ---------------------------------------------------------------------------
create table if not exists public.meq_stage_items (
  id uuid primary key default gen_random_uuid(),
  meq_stage_id uuid not null references public.meq_test_stages (id) on delete cascade,
  sequence_order int not null check (sequence_order >= 1),
  question_text text not null,
  rubric_criteria text,
  max_score int not null default 10 check (max_score between 1 and 100),
  media_urls text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meq_stage_id, sequence_order)
);

create index if not exists meq_stage_items_stage_idx
  on public.meq_stage_items (meq_stage_id);

alter table public.meq_stage_items enable row level security;

drop policy if exists "meq_stage_items_select" on public.meq_stage_items;
create policy "meq_stage_items_select" on public.meq_stage_items for select
using (
  exists (
    select 1
    from public.meq_test_stages s
    join public.meq_tests t on t.id = s.meq_test_id
    where s.id = meq_stage_items.meq_stage_id
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
            select 1 from public.committee_members cm join public.committees c on c.id = cm.committee_id
            where cm.profile_id = auth.uid()
              and (c.subject is null or c.subject = t.subject)
              and (c.test_year is null or c.test_year = t.test_year)
          )
        )
        or (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'educator')
          and (t.created_by = auth.uid() or t.review_status = 'approved')
        )
      )
  )
);

drop policy if exists "meq_stage_items_write" on public.meq_stage_items;
create policy "meq_stage_items_write" on public.meq_stage_items for all
using (
  exists (
    select 1
    from public.meq_test_stages s
    join public.meq_tests t on t.id = s.meq_test_id
    where s.id = meq_stage_items.meq_stage_id
      and (
        t.created_by = auth.uid()
        or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
        or (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
          and exists (
            select 1 from public.sub_admin_course_scopes sc
            where sc.profile_id = auth.uid() and sc.course_code = t.course_code
          )
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.meq_test_stages s
    join public.meq_tests t on t.id = s.meq_test_id
    where s.id = meq_stage_items.meq_stage_id
      and (
        t.created_by = auth.uid()
        or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
        or (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
          and exists (
            select 1 from public.sub_admin_course_scopes sc
            where sc.profile_id = auth.uid() and sc.course_code = t.course_code
          )
        )
      )
  )
);

grant select, insert, update, delete on public.meq_stage_items to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Backfill: exactly one item per existing stage (preserve current behavior)
-- ---------------------------------------------------------------------------
insert into public.meq_stage_items (
  meq_stage_id,
  sequence_order,
  question_text,
  rubric_criteria,
  max_score,
  media_urls
)
select
  s.id,
  1,
  s.question_text,
  s.rubric_criteria,
  coalesce(s.max_score, 10),
  coalesce(s.media_urls, '{}')
from public.meq_test_stages s
where not exists (
  select 1 from public.meq_stage_items i where i.meq_stage_id = s.id
);

-- ---------------------------------------------------------------------------
-- Responses: point at item; unique per (user, item)
-- ---------------------------------------------------------------------------
alter table public.meq_stage_responses
  add column if not exists meq_stage_item_id uuid references public.meq_stage_items (id) on delete cascade;

alter table public.meq_stage_responses
  add column if not exists grading_history jsonb not null default '[]'::jsonb;

update public.meq_stage_responses r
set meq_stage_item_id = i.id
from public.meq_stage_items i
where i.meq_stage_id = r.meq_stage_id
  and i.sequence_order = 1
  and r.meq_stage_item_id is null;

alter table public.meq_stage_responses alter column meq_stage_item_id set not null;

alter table public.meq_stage_responses
  drop constraint if exists meq_stage_responses_user_stage_unique;

alter table public.meq_stage_responses
  drop constraint if exists meq_stage_responses_user_id_meq_stage_id_key;

create unique index if not exists meq_stage_responses_user_item_unique
  on public.meq_stage_responses (user_id, meq_stage_item_id);

-- Stage-level rubric aggregates can exceed one part × 100 (multi-item stages).
alter table public.meq_test_stages drop constraint if exists meq_test_stages_max_score_check;

alter table public.meq_test_stages
  add constraint meq_test_stages_max_score_agg_check check (
    max_score is null or (max_score >= 1 and max_score <= 1000)
  );
