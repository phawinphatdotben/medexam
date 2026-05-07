-- =============================================================================
-- 012: Capture student year from signup metadata in profiles
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id, email, full_name, profile_year, medical_student_year, role, requested_role, approval_status
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'profile_year',
    case
      when (new.raw_user_meta_data->>'medical_student_year') ~ '^[0-9]+$'
      then (new.raw_user_meta_data->>'medical_student_year')::int
      else null
    end,
    case
      when new.raw_user_meta_data->>'role' in ('student', 'educator', 'admin', 'sub_admin')
      then (new.raw_user_meta_data->>'role')::public.user_role
      else 'student'::public.user_role
    end,
    case
      when new.raw_user_meta_data->>'requested_role' in ('student', 'educator')
      then new.raw_user_meta_data->>'requested_role'
      else null
    end,
    case
      when new.raw_user_meta_data->>'requested_role' = 'educator' then 'pending'
      else 'approved'
    end
  );
  return new;
end;
$$;

