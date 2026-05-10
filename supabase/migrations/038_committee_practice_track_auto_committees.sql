-- =============================================================================
-- 038 (part 1/2): Add committee_purpose value 'practice'.
--
-- MUST run alone and commit before any SQL uses 'practice'::committee_purpose.
-- Postgres error 55P04 otherwise: "New enum values must be committed before
-- they can be used." The rest of this feature is in 039.
-- =============================================================================

alter type public.committee_purpose add value if not exists 'practice';
