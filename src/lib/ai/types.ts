import type { MeqTaskCategorySlug } from "@/lib/meqTaskCategories";

/** Matches `public.committee_purpose` / `assessment_purpose` on tests. */
export type AssessmentPhase = "formative" | "summative";

export const AI_TRAINING_SCHEMA_VERSION = 3 as const;

export type AiTrainingRecordKind =
  | "human_correction"
  | "ground_truth_locked"
  | "pipeline_sync";

export type ExamInteractionEventType =
  | "session_started"
  | "session_ended"
  | "stage_entered"
  | "draft_updated"
  | "stage_timer_tick"
  | "stage_locked"
  | "auto_submit_stage"
  | "auto_submit_overall"
  | "focus_lost"
  | "focus_returned";

/** Denormalized columns on `meq_ai_training_records` (schema v3). */
export type MeqAiTrainingRecord = {
  id: string;
  created_at: string;
  schema_version: number;
  record_kind: AiTrainingRecordKind;
  staff_id: string | null;
  student_id: string | null;
  meq_stage_response_id: string | null;
  meq_test_id: string | null;
  meq_stage_id: string | null;
  meq_stage_item_id: string | null;
  assessment_phase: AssessmentPhase | null;
  subject: string | null;
  course_code: string | null;
  test_year: number | null;
  test_function: string | null;
  task_category: MeqTaskCategorySlug | string | null;
  response_text: string | null;
  response_status: string | null;
  locked_at: string | null;
  stage_time_limit_seconds: number | null;
  stage_elapsed_seconds: number | null;
  human_score: number | null;
  human_max_score: number | null;
  rubric_criteria: string | null;
  staff_feedback: string | null;
  student_profile_snapshot: StudentProfileSnapshot;
  interaction_timeline: InteractionTimelineEntry[];
  ml_feature_arrays: MlFeatureArrays;
  line_json: AiTrainingLineJson;
};

export type StudentProfileSnapshot = {
  user_id?: string;
  role?: string;
  medical_student_year?: number | null;
  profile_year?: string | null;
  institution?: string | null;
  captured_at?: string;
};

export type InteractionTimelineEntry = {
  event_type: string;
  occurred_at: string;
  client_sequence?: number;
  payload?: Record<string, unknown>;
};

/** Parallel scalars for one locked item — ready to stack into cohort arrays. */
export type MlFeatureArrays = {
  score?: number | null;
  max_score?: number | null;
  normalized_score?: number | null;
  answer_char_length?: number;
  task_category?: string;
  stage_order?: number;
  item_order?: number;
  stage_time_limit_seconds?: number | null;
};

/** Legacy + v3 JSON line written to `line_json`. */
export type AiTrainingLineJson = {
  schema_version: number;
  recorded_at: string;
  purpose: string;
  response_id?: string;
  meq_stage_id?: string;
  meq_stage_item_id?: string;
  student_id?: string;
  meq_test_id?: string;
  course_code?: string;
  task_category?: string;
  assessment_phase?: AssessmentPhase;
  test_label?: string;
  stage_order?: number;
  item_order?: number;
  question_text?: string;
  rubric_criteria?: string | null;
  max_score?: number | null;
  student_answer?: string | null;
  human_score?: number;
  staff_feedback?: string | null;
};

export type MeqExamInteractionEvent = {
  id: string;
  student_id: string;
  meq_test_id: string;
  meq_stage_id: string | null;
  meq_stage_item_id: string | null;
  assignment_id: string | null;
  assessment_phase: AssessmentPhase;
  event_type: ExamInteractionEventType;
  occurred_at: string;
  client_sequence: number;
  payload: Record<string, unknown>;
};

/** One row per student × subject × course × phase × task category. */
export type MeqMlStudentVector = {
  id: string;
  student_id: string;
  subject: string;
  course_code: string;
  assessment_phase: AssessmentPhase;
  task_category: MeqTaskCategorySlug | string;
  item_count: number;
  score_array: number[];
  max_score_array: number[];
  normalized_score_array: (number | null)[];
  answer_length_array: number[];
  stage_order_array: number[];
  item_order_array: number[];
  meq_test_id_array: string[];
  locked_at_array: string[];
  refreshed_at: string;
};

export type MeqAiPipelineConfig = {
  id: number;
  formative_capture_enabled: boolean;
  summative_capture_enabled: boolean;
  auto_enqueue_on_lock: boolean;
  updated_at: string;
  updated_by: string | null;
};

export type FormativeCorpusExport = {
  schema_version: number;
  assessment_phase: AssessmentPhase;
  exported_at: string;
  filters: {
    course_code: string | null;
    task_category: string | null;
    limit: number;
  };
  student_id_array: string[];
  vectors: Array<{
    student_id: string;
    subject: string;
    course_code: string;
    task_category: string;
    item_count: number;
    score_array: number[];
    normalized_score_array: (number | null)[];
    answer_length_array: number[];
    stage_order_array: number[];
  }>;
};

export type RefreshVectorsResult = {
  assessment_phase: AssessmentPhase;
  subject: string | null;
  course_code: string | null;
  vector_groups_upserted: number;
};

export type ProcessSyncQueueResult = {
  processed: number;
  failed: number;
};
