-- =============================================================================
-- 040: Optional JSON metadata for explicitly-built test bundles (course/year/
--      format/track at creation time). Scoped triple-filter bundles remain unchanged.
-- =============================================================================

alter table if exists public.staff_test_groups
  add column if not exists bundle_selection_scope jsonb;

comment on column public.staff_test_groups.bundle_selection_scope is
  'When staff pick tests explicitly (criteria filters null): snapshot '
  '{"course_code","test_year","exam_format","track"} used in the picker UI '
  '(track: practice | formative | summative).';
