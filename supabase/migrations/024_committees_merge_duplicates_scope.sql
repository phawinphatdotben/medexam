-- =============================================================================
-- 024: Fix failed 023 installs — merge duplicate committees that share the same
--      (course_code scope, test_year, purpose) before committees_scope_unique.
--      Safe to run if already deduped (no-op).
--
-- If 023 never ran, committees.course_code does not exist yet — this file adds
-- the same committee columns + backfill as the start of 023, then dedupes.
-- After success, still run the remainder of 023 (MEQ public_code, RLS, etc.)
-- if those pieces are missing.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Prerequisites (same as beginning of 023) — idempotent
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.committee_purpose as enum ('formative', 'summative');
exception when duplicate_object then null;
end $$;

alter table if exists public.committees
  add column if not exists course_code text references public.course_catalog (course_code) on update cascade on delete restrict;

alter table if exists public.committees
  add column if not exists purpose public.committee_purpose;

alter table if exists public.committees
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

insert into public.course_catalog (course_code, year_level, course_title, category)
values ('LEGACY-COMMITTEE', 1, 'Legacy committee (pre-migration)', 'Legacy')
on conflict (course_code) do nothing;

update public.committees
set
  course_code = coalesce(course_code, 'LEGACY-COMMITTEE'),
  purpose = coalesce(purpose, 'summative'::public.committee_purpose),
  test_year = coalesce(test_year, extract(year from now())::int)
where course_code is null or purpose is null or test_year is null;

alter table public.committees alter column course_code set not null;
alter table public.committees alter column purpose set not null;
alter table public.committees alter column test_year set not null;

-- -----------------------------------------------------------------------------
-- Merge duplicate scopes, then unique index
-- -----------------------------------------------------------------------------

do $$
declare
  rec record;
  keeper uuid;
  loser uuid;
  dup_ids uuid[];
  i int;
begin
  for rec in
    select
      lower(trim(course_code)) as cc_key,
      test_year,
      purpose,
      array_agg(id order by id::text) as ids
    from public.committees
    group by lower(trim(course_code)), test_year, purpose
    having count(*) > 1
  loop
    dup_ids := rec.ids;
    keeper := dup_ids[1];
    for i in 2 .. array_length(dup_ids, 1)
    loop
      loser := dup_ids[i];

      delete from public.committee_members cm_del
      where cm_del.committee_id = loser
        and exists (
          select 1 from public.committee_members cm_keep
          where cm_keep.committee_id = keeper and cm_keep.profile_id = cm_del.profile_id
        );
      update public.committee_members set committee_id = keeper where committee_id = loser;

      delete from public.committee_test_scores s_del
      where s_del.committee_id = loser
        and exists (
          select 1 from public.committee_test_scores s_keep
          where s_keep.committee_id = keeper
            and s_keep.test_kind = s_del.test_kind
            and s_keep.test_id = s_del.test_id
            and s_keep.reviewer_id = s_del.reviewer_id
        );
      update public.committee_test_scores set committee_id = keeper where committee_id = loser;

      delete from public.committee_angoff_ratings r_del
      where r_del.committee_id = loser
        and exists (
          select 1 from public.committee_angoff_ratings r_keep
          where r_keep.committee_id = keeper
            and r_keep.reviewer_id = r_del.reviewer_id
            and r_keep.round = r_del.round
            and r_keep.item_ref = r_del.item_ref
        );
      update public.committee_angoff_ratings set committee_id = keeper where committee_id = loser;

      update public.meq_tests set committee_id = keeper where committee_id = loser;
      update public.sba_tests set committee_id = keeper where committee_id = loser;

      delete from public.committees where id = loser;
    end loop;
  end loop;
end $$;

drop index if exists committees_scope_unique;
create unique index committees_scope_unique
  on public.committees (lower(trim(course_code)), test_year, purpose);
