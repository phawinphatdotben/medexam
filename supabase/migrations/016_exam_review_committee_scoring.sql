-- =============================================================================
-- 016: Exam review committee scoring + broader committee visibility
-- =============================================================================

create table if not exists public.committee_test_scores (
  id uuid primary key default gen_random_uuid(),
  test_kind text not null check (test_kind in ('MEQ', 'SBA')),
  test_id uuid not null,
  committee_id uuid not null references public.committees(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  standard_score int not null check (standard_score between 10 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint committee_test_scores_unique unique (test_kind, test_id, reviewer_id)
);

create index if not exists committee_test_scores_test_idx
  on public.committee_test_scores (test_kind, test_id);
create index if not exists committee_test_scores_committee_idx
  on public.committee_test_scores (committee_id);
create index if not exists committee_test_scores_reviewer_idx
  on public.committee_test_scores (reviewer_id);

drop trigger if exists committee_test_scores_set_updated_at on public.committee_test_scores;
create trigger committee_test_scores_set_updated_at
  before update on public.committee_test_scores
  for each row execute function public.set_updated_at();

alter table public.committee_test_scores enable row level security;

drop policy if exists "committee_test_scores_select" on public.committee_test_scores;
create policy "committee_test_scores_select"
  on public.committee_test_scores for select
  using (
    reviewer_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'sub_admin')
    )
  );

drop policy if exists "committee_test_scores_insert" on public.committee_test_scores;
create policy "committee_test_scores_insert"
  on public.committee_test_scores for insert
  with check (
    reviewer_id = auth.uid()
    and exists (
      select 1
      from public.committee_members cm
      where cm.committee_id = committee_test_scores.committee_id
        and cm.profile_id = auth.uid()
    )
  );

drop policy if exists "committee_test_scores_update" on public.committee_test_scores;
create policy "committee_test_scores_update"
  on public.committee_test_scores for update
  using (reviewer_id = auth.uid())
  with check (
    reviewer_id = auth.uid()
    and exists (
      select 1
      from public.committee_members cm
      where cm.committee_id = committee_test_scores.committee_id
        and cm.profile_id = auth.uid()
    )
  );

grant select, insert, update on public.committee_test_scores to authenticated, service_role, postgres;

-- Let committee members (any role) read committees and own membership rows.
drop policy if exists "committees_select" on public.committees;
create policy "committees_select"
  on public.committees for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'sub_admin'))
    or exists (
      select 1 from public.committee_members cm
      where cm.committee_id = committees.id and cm.profile_id = auth.uid()
    )
  );

drop policy if exists "committee_members_select" on public.committee_members;
create policy "committee_members_select"
  on public.committee_members for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'sub_admin'))
    or profile_id = auth.uid()
  );

