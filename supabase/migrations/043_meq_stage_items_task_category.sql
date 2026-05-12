-- =============================================================================
-- 043: Per-prompt task category on MEQ stage items (10 MEQ task domains).
-- =============================================================================

alter table public.meq_stage_items
  add column if not exists task_category text not null default 'basic_knowledge';

comment on column public.meq_stage_items.task_category is
  'MEQ prompt taxonomy: one of ten fixed slugs (problem_identification … basic_knowledge).';

alter table public.meq_stage_items
  drop constraint if exists meq_stage_items_task_category_check;

alter table public.meq_stage_items
  add constraint meq_stage_items_task_category_check check (
    task_category in (
      'problem_identification',
      'hypothesis_generation',
      'data_gathering',
      'data_interpretation',
      'clinical_reasoning',
      'patient_management',
      'patient_education_counseling',
      'ethics_jurisprudences',
      'evidence_based_medicine_biostatistics',
      'basic_knowledge'
    )
  );

create index if not exists meq_stage_items_task_category_idx
  on public.meq_stage_items (task_category);
