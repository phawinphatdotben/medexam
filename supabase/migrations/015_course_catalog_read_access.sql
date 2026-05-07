-- =============================================================================
-- 015: Allow app users to read course_catalog for autocomplete
-- =============================================================================

alter table if exists public.course_catalog enable row level security;

drop policy if exists "course_catalog_select_authenticated" on public.course_catalog;
create policy "course_catalog_select_authenticated"
  on public.course_catalog
  for select
  using (auth.role() = 'authenticated');

grant select on public.course_catalog to authenticated, service_role, postgres;

