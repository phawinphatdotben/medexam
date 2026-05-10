-- Previously inserted with test_taking_nav_visible = false; turn on by default so students
-- see Test taking unless staff explicitly disable it in Dashboard → Test assignments.
update public.student_ui_settings
set test_taking_nav_visible = true
where id = 1;
