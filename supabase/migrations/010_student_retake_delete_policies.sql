-- =============================================================================
-- 010: Allow students to reset and retake tests
-- =============================================================================

drop policy if exists "meq_stage_responses_delete_own" on public.meq_stage_responses;
create policy "meq_stage_responses_delete_own"
  on public.meq_stage_responses for delete
  using (auth.uid() = user_id);

drop policy if exists "sba_qr_delete_own" on public.sba_question_responses;
create policy "sba_qr_delete_own"
  on public.sba_question_responses for delete
  using (auth.uid() = user_id);

