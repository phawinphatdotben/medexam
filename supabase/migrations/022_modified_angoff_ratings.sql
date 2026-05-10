-- =============================================================================
-- 022: Modified Angoff — per-item P(borderline) ratings for MEQ stages & SBA MCQs
-- =============================================================================
-- p_correct is the judge's probability (0–1) that a minimally competent candidate
-- would achieve full credit on that item (SBA: select correct; MEQ: full rubric points).

create table if not exists public.committee_angoff_ratings (
  id uuid primary key default gen_random_uuid(),
  committee_id uuid not null references public.committees (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  round smallint not null default 1 check (round >= 1 and round <= 2),
  meq_stage_id uuid references public.meq_test_stages (id) on delete cascade,
  sba_question_id uuid references public.sba_test_questions (id) on delete cascade,
  p_correct numeric(6,5) not null check (p_correct >= 0 and p_correct <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint committee_angoff_ratings_one_item check (
    (meq_stage_id is not null)::int + (sba_question_id is not null)::int = 1
  ),
  item_ref uuid generated always as (
    coalesce(meq_stage_id, sba_question_id)
  ) stored,
  constraint committee_angoff_ratings_unique_per_item unique (reviewer_id, round, item_ref)
);

create index if not exists committee_angoff_ratings_committee_idx
  on public.committee_angoff_ratings (committee_id);
create index if not exists committee_angoff_ratings_reviewer_idx
  on public.committee_angoff_ratings (reviewer_id);
create index if not exists committee_angoff_ratings_meq_stage_idx
  on public.committee_angoff_ratings (meq_stage_id)
  where meq_stage_id is not null;
create index if not exists committee_angoff_ratings_sba_q_idx
  on public.committee_angoff_ratings (sba_question_id)
  where sba_question_id is not null;

drop trigger if exists committee_angoff_ratings_set_updated_at on public.committee_angoff_ratings;
create trigger committee_angoff_ratings_set_updated_at
  before update on public.committee_angoff_ratings
  for each row execute function public.set_updated_at();

alter table public.committee_angoff_ratings enable row level security;

-- Select: own rows; same-committee members (for panel discussion); admin / sub_admin.
drop policy if exists "committee_angoff_ratings_select" on public.committee_angoff_ratings;
create policy "committee_angoff_ratings_select"
  on public.committee_angoff_ratings for select
  using (
    reviewer_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'sub_admin')
    )
    or exists (
      select 1 from public.committee_members cm
      where cm.committee_id = committee_angoff_ratings.committee_id
        and cm.profile_id = auth.uid()
    )
  );

drop policy if exists "committee_angoff_ratings_insert" on public.committee_angoff_ratings;
create policy "committee_angoff_ratings_insert"
  on public.committee_angoff_ratings for insert
  with check (
    reviewer_id = auth.uid()
    and (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role in ('admin', 'sub_admin')
      )
      or exists (
        select 1 from public.committee_members cm
        where cm.committee_id = committee_angoff_ratings.committee_id
          and cm.profile_id = auth.uid()
      )
    )
  );

drop policy if exists "committee_angoff_ratings_update" on public.committee_angoff_ratings;
create policy "committee_angoff_ratings_update"
  on public.committee_angoff_ratings for update
  using (reviewer_id = auth.uid())
  with check (
    reviewer_id = auth.uid()
    and (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role in ('admin', 'sub_admin')
      )
      or exists (
        select 1 from public.committee_members cm
        where cm.committee_id = committee_angoff_ratings.committee_id
          and cm.profile_id = auth.uid()
      )
    )
  );

drop policy if exists "committee_angoff_ratings_delete" on public.committee_angoff_ratings;
create policy "committee_angoff_ratings_delete"
  on public.committee_angoff_ratings for delete
  using (reviewer_id = auth.uid());

grant select, insert, update, delete on public.committee_angoff_ratings to authenticated, service_role, postgres;
