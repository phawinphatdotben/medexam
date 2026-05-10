-- =============================================================================
-- 039 (part 2/2): Committee practice track — helpers, backfill, triggers, RLS.
-- Requires migration 038 applied first (enum value 'practice' committed).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Matching helper (reuse in policies)
-- -----------------------------------------------------------------------------
create or replace function public.committee_scope_matches_row(
  c_purpose public.committee_purpose,
  tf text,
  ap public.committee_purpose
)
returns boolean
language sql
stable
as $$
  select
    (c_purpose is null)
    or (
      c_purpose = 'practice'::public.committee_purpose
      and tf = 'practice'
    )
    or (
      c_purpose = 'formative'::public.committee_purpose
      and tf = 'real_test'
      and ap = 'formative'::public.committee_purpose
    )
    or (
      c_purpose = 'summative'::public.committee_purpose
      and tf = 'real_test'
      and ap = 'summative'::public.committee_purpose
    );
$$;

comment on function public.committee_scope_matches_row(public.committee_purpose, text, public.committee_purpose) is
  'Maps committee.purpose (practice/formative/summative) to meq_tests/sba_tests test_function + assessment_purpose.';

-- -----------------------------------------------------------------------------
-- 2) Ensure committees exist and backfill test links before triggers
-- -----------------------------------------------------------------------------

insert into public.committees (name, subject, course_code, test_year, purpose, created_by)
select distinct on (combo.cc_norm, combo.yr, combo.purp)
  combo.label,
  null,
  combo.cc_up,
  combo.yr,
  combo.purp,
  combo.creator
from (
  select
    upper(trim(m.course_code)) as cc_up,
    lower(trim(m.course_code)) as cc_norm,
    m.test_year as yr,
    case
      when m.test_function = 'practice' then 'practice'::public.committee_purpose
      else m.assessment_purpose
    end as purp,
    (upper(trim(m.course_code)) || ' · ' || m.test_year::text || ' · ' ||
      case
        when m.test_function = 'practice' then 'Practice'
        when m.assessment_purpose = 'formative'::public.committee_purpose then 'Formative'
        else 'Summative'
      end) as label,
    m.created_by as creator
  from public.meq_tests m
  union all
  select
    upper(trim(s.subject_code)) as cc_up,
    lower(trim(s.subject_code)) as cc_norm,
    s.test_year as yr,
    case
      when s.test_function = 'practice' then 'practice'::public.committee_purpose
      else s.assessment_purpose
    end as purp,
    (upper(trim(s.subject_code)) || ' · ' || s.test_year::text || ' · ' ||
      case
        when s.test_function = 'practice' then 'Practice'
        when s.assessment_purpose = 'formative'::public.committee_purpose then 'Formative'
        else 'Summative'
      end) as label,
    s.created_by as creator
  from public.sba_tests s
) combo
where not exists (
  select 1
  from public.committees c
  where lower(trim(c.course_code)) = combo.cc_norm
    and c.test_year = combo.yr
    and c.purpose = combo.purp
)
order by combo.cc_norm, combo.yr, combo.purp, combo.label;

update public.meq_tests m
set committee_id = c.id
from public.committees c
where lower(trim(c.course_code)) = lower(trim(m.course_code))
  and c.test_year = m.test_year
  and c.purpose = case
    when m.test_function = 'practice' then 'practice'::public.committee_purpose
    else m.assessment_purpose
  end;

update public.sba_tests s
set committee_id = c.id
from public.committees c
where lower(trim(c.course_code)) = lower(trim(s.subject_code))
  and c.test_year = s.test_year
  and c.purpose = case
    when s.test_function = 'practice' then 'practice'::public.committee_purpose
    else s.assessment_purpose
  end;

insert into public.committee_members (committee_id, profile_id)
select distinct p.id, cm.profile_id
from public.committees f
join public.committees p
  on lower(trim(p.course_code)) = lower(trim(f.course_code))
  and p.test_year = f.test_year
  and p.purpose = 'practice'::public.committee_purpose
  and f.purpose = 'formative'::public.committee_purpose
join public.committee_members cm on cm.committee_id = f.id
where not exists (
  select 1 from public.committee_members x
  where x.committee_id = p.id and x.profile_id = cm.profile_id
);

-- -----------------------------------------------------------------------------
-- 3) BEFORE triggers: assign committee row for scope (SECURITY DEFINER)
-- -----------------------------------------------------------------------------
create or replace function public.assign_committee_for_meq()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tr public.committee_purpose;
  cid uuid;
  cc text;
  need_assign boolean := true;
begin
  if tg_op = 'UPDATE' then
    need_assign := OLD.course_code is distinct from NEW.course_code
      or OLD.test_year is distinct from NEW.test_year
      or OLD.test_function is distinct from NEW.test_function
      or OLD.assessment_purpose is distinct from NEW.assessment_purpose;
  end if;
  if tg_op = 'UPDATE' and not need_assign then
    return NEW;
  end if;

  if NEW.test_function = 'practice' then
    tr := 'practice'::public.committee_purpose;
  else
    tr := NEW.assessment_purpose;
  end if;

  cc := upper(trim(NEW.course_code));

  select c.id into cid
  from public.committees c
  where lower(trim(c.course_code)) = lower(trim(cc))
    and c.test_year = NEW.test_year
    and c.purpose = tr
  limit 1;

  if cid is null then
    insert into public.committees (name, subject, course_code, test_year, purpose, created_by)
    values (
      cc || ' · ' || NEW.test_year::text || ' · ' ||
        case tr
          when 'practice'::public.committee_purpose then 'Practice'
          when 'formative'::public.committee_purpose then 'Formative'
          else 'Summative'
        end,
      null,
      cc,
      NEW.test_year,
      tr,
      NEW.created_by
    )
    returning id into cid;
  end if;

  NEW.committee_id := cid;
  return NEW;
end;
$$;

create or replace function public.assign_committee_for_sba()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tr public.committee_purpose;
  cid uuid;
  cc text;
  need_assign boolean := true;
begin
  if tg_op = 'UPDATE' then
    need_assign := OLD.subject_code is distinct from NEW.subject_code
      or OLD.test_year is distinct from NEW.test_year
      or OLD.test_function is distinct from NEW.test_function
      or OLD.assessment_purpose is distinct from NEW.assessment_purpose;
  end if;
  if tg_op = 'UPDATE' and not need_assign then
    return NEW;
  end if;

  if NEW.test_function = 'practice' then
    tr := 'practice'::public.committee_purpose;
  else
    tr := NEW.assessment_purpose;
  end if;

  cc := upper(trim(NEW.subject_code));

  select c.id into cid
  from public.committees c
  where lower(trim(c.course_code)) = lower(trim(cc))
    and c.test_year = NEW.test_year
    and c.purpose = tr
  limit 1;

  if cid is null then
    insert into public.committees (name, subject, course_code, test_year, purpose, created_by)
    values (
      cc || ' · ' || NEW.test_year::text || ' · ' ||
        case tr
          when 'practice'::public.committee_purpose then 'Practice'
          when 'formative'::public.committee_purpose then 'Formative'
          else 'Summative'
        end,
      null,
      cc,
      NEW.test_year,
      tr,
      NEW.created_by
    )
    returning id into cid;
  end if;

  NEW.committee_id := cid;
  return NEW;
end;
$$;

drop trigger if exists meq_tests_assign_committee on public.meq_tests;
create trigger meq_tests_assign_committee
  before insert or update of course_code, test_year, test_function, assessment_purpose
  on public.meq_tests
  for each row
  execute function public.assign_committee_for_meq();

drop trigger if exists sba_tests_assign_committee on public.sba_tests;
create trigger sba_tests_assign_committee
  before insert or update of subject_code, test_year, test_function, assessment_purpose
  on public.sba_tests
  for each row
  execute function public.assign_committee_for_sba();

-- -----------------------------------------------------------------------------
-- 4) RLS: sub_admin + educator committee scope — use helper + practice branch
-- -----------------------------------------------------------------------------
drop policy if exists "meq_tests_select" on public.meq_tests;
create policy "meq_tests_select"
  on public.meq_tests for select
  using (
    (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'student')
      and public.student_can_access_meq_test(meq_tests.id)
    )
    or (meq_tests.created_by = auth.uid())
    or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
      and exists (
        select 1 from public.committee_members cm
        join public.committees c on c.id = cm.committee_id
        where cm.profile_id = auth.uid()
          and (c.course_code = meq_tests.course_code)
          and (c.test_year = meq_tests.test_year)
          and public.committee_scope_matches_row(c.purpose, meq_tests.test_function, meq_tests.assessment_purpose)
      )
    )
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'educator')
      and (
        meq_tests.created_by = auth.uid()
        or meq_tests.review_status = 'approved'
        or exists (
          select 1 from public.committee_members cm
          where cm.profile_id = auth.uid()
            and cm.committee_id = meq_tests.committee_id
        )
        or exists (
          select 1 from public.committee_members cm
          join public.committees c on c.id = cm.committee_id
          where cm.profile_id = auth.uid()
            and c.course_code = meq_tests.course_code
            and c.test_year = meq_tests.test_year
            and public.committee_scope_matches_row(c.purpose, meq_tests.test_function, meq_tests.assessment_purpose)
        )
      )
    )
  );

drop policy if exists "sba_tests_select" on public.sba_tests;
create policy "sba_tests_select"
  on public.sba_tests for select
  using (
    (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'student')
      and public.student_can_access_sba_test(sba_tests.id)
    )
    or (sba_tests.created_by = auth.uid())
    or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
      and exists (
        select 1 from public.committee_members cm
        join public.committees c on c.id = cm.committee_id
        where cm.profile_id = auth.uid()
          and (c.course_code = sba_tests.subject_code)
          and (c.test_year = sba_tests.test_year)
          and public.committee_scope_matches_row(c.purpose, sba_tests.test_function, sba_tests.assessment_purpose)
      )
    )
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'educator')
      and (
        sba_tests.created_by = auth.uid()
        or sba_tests.review_status = 'approved'
        or exists (
          select 1 from public.committee_members cm
          where cm.profile_id = auth.uid()
            and cm.committee_id = sba_tests.committee_id
        )
        or exists (
          select 1 from public.committee_members cm
          join public.committees c on c.id = cm.committee_id
          where cm.profile_id = auth.uid()
            and c.course_code = sba_tests.subject_code
            and c.test_year = sba_tests.test_year
            and public.committee_scope_matches_row(c.purpose, sba_tests.test_function, sba_tests.assessment_purpose)
        )
      )
    )
  );

drop policy if exists "meq_test_stages_select" on public.meq_test_stages;
create policy "meq_test_stages_select"
  on public.meq_test_stages for select
  using (
    exists (
      select 1 from public.meq_tests t where t.id = meq_test_stages.meq_test_id
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
            select 1 from public.committee_members cm
            join public.committees c on c.id = cm.committee_id
            where cm.profile_id = auth.uid()
              and (c.course_code = t.course_code)
              and (c.test_year = t.test_year)
              and public.committee_scope_matches_row(c.purpose, t.test_function, t.assessment_purpose)
          )
        )
        or (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'educator')
          and (
            t.created_by = auth.uid()
            or t.review_status = 'approved'
            or exists (
              select 1 from public.committee_members cm
              where cm.profile_id = auth.uid()
                and cm.committee_id = t.committee_id
            )
            or exists (
              select 1 from public.committee_members cm
              join public.committees c on c.id = cm.committee_id
              where cm.profile_id = auth.uid()
                and c.course_code = t.course_code
                and c.test_year = t.test_year
                and public.committee_scope_matches_row(c.purpose, t.test_function, t.assessment_purpose)
            )
          )
        )
      )
    )
  );

drop policy if exists "sba_test_questions_select" on public.sba_test_questions;
create policy "sba_test_questions_select"
  on public.sba_test_questions for select
  using (
    exists (
      select 1 from public.sba_tests t where t.id = sba_test_questions.sba_test_id
      and (
        (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'student')
          and public.student_can_access_sba_test(t.id)
        )
        or (t.created_by = auth.uid())
        or (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
        or (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'sub_admin')
          and exists (
            select 1 from public.committee_members cm
            join public.committees c on c.id = cm.committee_id
            where cm.profile_id = auth.uid()
              and (c.course_code = t.subject_code)
              and (c.test_year = t.test_year)
              and public.committee_scope_matches_row(c.purpose, t.test_function, t.assessment_purpose)
          )
        )
        or (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'educator')
          and (
            t.created_by = auth.uid()
            or t.review_status = 'approved'
            or exists (
              select 1 from public.committee_members cm
              where cm.profile_id = auth.uid()
                and cm.committee_id = t.committee_id
            )
            or exists (
              select 1 from public.committee_members cm
              join public.committees c on c.id = cm.committee_id
              where cm.profile_id = auth.uid()
                and c.course_code = t.subject_code
                and c.test_year = t.test_year
                and public.committee_scope_matches_row(c.purpose, t.test_function, t.assessment_purpose)
            )
          )
        )
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 5) Committees: admin-only delete
-- -----------------------------------------------------------------------------
drop policy if exists "committees_write" on public.committees;
drop policy if exists "committees_insert" on public.committees;
drop policy if exists "committees_update" on public.committees;
drop policy if exists "committees_delete" on public.committees;

create policy "committees_insert" on public.committees
  for insert
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text in ('admin', 'sub_admin'))
  );

create policy "committees_update" on public.committees
  for update
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text in ('admin', 'sub_admin'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text in ('admin', 'sub_admin'))
  );

create policy "committees_delete" on public.committees
  for delete
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

comment on column public.committees.purpose is
  'Committee track: practice (self-study pool), formative (real low-stakes), summative (real high-stakes).';
