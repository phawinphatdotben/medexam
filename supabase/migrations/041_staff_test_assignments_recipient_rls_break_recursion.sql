-- =============================================================================
-- 041: Break RLS recursion between staff_test_assignments and
--      staff_test_assignment_recipients for students.
--
-- Before: assignments_select_student EXISTS(recipients), and
-- recipients_select_student EXISTS(assignments with window) ↔ infinite loop.
--
-- After: recipients_select_student only checks the recipient row belongs to the
-- signed-in student (or their cohort). Window + assignment visibility stay on
-- staff_test_assignments_select_student and policies that join both tables.
-- =============================================================================

drop policy if exists "staff_test_assignment_recipients_select_student"
  on public.staff_test_assignment_recipients;

create policy "staff_test_assignment_recipients_select_student"
  on public.staff_test_assignment_recipients for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'student')
    and (
      staff_test_assignment_recipients.student_id = auth.uid()
      or exists (
        select 1 from public.staff_student_group_members m
        where m.student_group_id = staff_test_assignment_recipients.student_group_id
          and m.student_id = auth.uid()
      )
    )
  );

comment on policy "staff_test_assignment_recipients_select_student" on public.staff_test_assignment_recipients is
  'Student sees only their own recipient rows; no nested read of staff_test_assignments (avoids RLS recursion with assignment policies).';
