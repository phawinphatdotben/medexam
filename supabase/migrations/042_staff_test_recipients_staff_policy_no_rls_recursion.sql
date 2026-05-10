-- =============================================================================
-- 042: Fix remaining RLS recursion on staff_test_assignments (staff path).
--
-- When staff SELECT assignments, BOTH permissive SELECT policies run. The
-- student policy's EXISTS(correlated recipients) invokes recipient RLS; the
-- staff recipient policy used EXISTS(correlated assignments) → re-enters
-- assignment RLS → infinite recursion.
--
-- 041 broke assignments ↔ recipients for the *student* recipient policy only.
--
-- Replace inline SELECT from staff_test_assignments in staff recipient policies
-- with SECURITY DEFINER + SET row_security = off so checks do not recurse.
-- =============================================================================

create or replace function public.staff_test_assignment_staff_can_manage_recipients(p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select public.is_admin_or_sub_admin()
    and exists (
      select 1
      from public.staff_test_assignments a
      where a.id = p_assignment_id
        and (
          a.created_by = auth.uid()
          or exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role::text = 'admin'
          )
        )
    );
$$;

grant execute on function public.staff_test_assignment_staff_can_manage_recipients(uuid) to authenticated;

comment on function public.staff_test_assignment_staff_can_manage_recipients(uuid) is
  'RLS-safe check: staff owns or admin on assignment row; used by recipient policies instead of inlined SELECT staff_test_assignments (avoids RLS recursion).';

drop policy if exists "staff_test_assignment_recipients_select_staff"
  on public.staff_test_assignment_recipients;

create policy "staff_test_assignment_recipients_select_staff"
  on public.staff_test_assignment_recipients for select
  using (
    public.staff_test_assignment_staff_can_manage_recipients(staff_test_assignment_recipients.assignment_id)
  );

drop policy if exists "staff_test_assignment_recipients_insert"
  on public.staff_test_assignment_recipients;

create policy "staff_test_assignment_recipients_insert"
  on public.staff_test_assignment_recipients for insert
  with check (
    public.staff_test_assignment_staff_can_manage_recipients(staff_test_assignment_recipients.assignment_id)
  );

drop policy if exists "staff_test_assignment_recipients_delete"
  on public.staff_test_assignment_recipients;

create policy "staff_test_assignment_recipients_delete"
  on public.staff_test_assignment_recipients for delete
  using (
    public.staff_test_assignment_staff_can_manage_recipients(staff_test_assignment_recipients.assignment_id)
  );
