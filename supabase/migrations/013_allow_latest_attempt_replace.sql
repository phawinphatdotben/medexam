-- =============================================================================
-- 013: Allow students to replace locked MEQ answers on retake
-- Keeps one row per (user_id, meq_stage_id); latest attempt overwrites older one.
-- =============================================================================

drop policy if exists "meq_stage_responses_update_own" on public.meq_stage_responses;
create policy "meq_stage_responses_update_own"
  on public.meq_stage_responses for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and status in ('draft', 'locked'));

