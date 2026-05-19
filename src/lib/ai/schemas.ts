import { AI_TRAINING_SCHEMA_VERSION, type AiTrainingLineJson } from "@/lib/ai/types";
import type { MeqTaskCategorySlug } from "@/lib/meqTaskCategories";

/** Build v3 `line_json` for grading-dashboard human corrections. */
export function buildHumanCorrectionLineJson(input: {
  responseId: string;
  meqStageId: string;
  meqStageItemId: string;
  studentId: string;
  meqTestId: string;
  courseCode: string;
  taskCategory: MeqTaskCategorySlug | string;
  assessmentPhase: "formative" | "summative";
  testLabel: string;
  stageOrder: number;
  itemOrder: number;
  questionText: string | null;
  rubricCriteria: string | null;
  maxScore: number | null;
  studentAnswer: string | null;
  humanScore: number;
  staffFeedback: string | null;
}): AiTrainingLineJson {
  return {
    schema_version: AI_TRAINING_SCHEMA_VERSION,
    recorded_at: new Date().toISOString(),
    purpose: "human_correction_after_ai",
    response_id: input.responseId,
    meq_stage_id: input.meqStageId,
    meq_stage_item_id: input.meqStageItemId,
    student_id: input.studentId,
    meq_test_id: input.meqTestId,
    course_code: input.courseCode,
    task_category: input.taskCategory,
    assessment_phase: input.assessmentPhase,
    test_label: input.testLabel,
    stage_order: input.stageOrder,
    item_order: input.itemOrder,
    question_text: input.questionText ?? undefined,
    rubric_criteria: input.rubricCriteria,
    max_score: input.maxScore,
    student_answer: input.studentAnswer,
    human_score: input.humanScore,
    staff_feedback: input.staffFeedback,
  };
}

/** Row payload for `meq_ai_training_records` insert from grading UI. */
export function buildHumanCorrectionTrainingRow(input: {
  staffId: string;
  responseId: string;
  meqStageId: string;
  meqStageItemId: string;
  studentId: string;
  meqTestId: string;
  subject: string;
  courseCode: string;
  testYear: number;
  testFunction: string;
  taskCategory: MeqTaskCategorySlug | string;
  assessmentPhase: "formative" | "summative";
  responseText: string | null;
  lockedAt: string | null;
  stageTimeLimitSeconds: number | null;
  stageOrder: number;
  itemOrder: number;
  humanScore: number;
  humanMaxScore: number;
  rubricCriteria: string | null;
  staffFeedback: string | null;
  studentProfileSnapshot: Record<string, unknown>;
  lineJson: AiTrainingLineJson;
}) {
  return {
    staff_id: input.staffId,
    meq_stage_response_id: input.responseId,
    line_json: input.lineJson,
    schema_version: AI_TRAINING_SCHEMA_VERSION,
    record_kind: "human_correction" as const,
    student_id: input.studentId,
    meq_test_id: input.meqTestId,
    meq_stage_id: input.meqStageId,
    meq_stage_item_id: input.meqStageItemId,
    assessment_phase: input.assessmentPhase,
    subject: input.subject,
    course_code: input.courseCode,
    test_year: input.testYear,
    test_function: input.testFunction,
    task_category: input.taskCategory,
    response_text: input.responseText,
    response_status: "locked",
    locked_at: input.lockedAt,
    stage_time_limit_seconds: input.stageTimeLimitSeconds,
    human_score: input.humanScore,
    human_max_score: input.humanMaxScore,
    rubric_criteria: input.rubricCriteria,
    staff_feedback: input.staffFeedback,
    student_profile_snapshot: input.studentProfileSnapshot,
    interaction_timeline: [],
    ml_feature_arrays: {
      score: input.humanScore,
      max_score: input.humanMaxScore,
      normalized_score:
        input.humanMaxScore > 0
          ? Math.round((input.humanScore / input.humanMaxScore) * 100000) / 100000
          : null,
      answer_char_length: input.responseText?.length ?? 0,
      task_category: input.taskCategory,
      stage_order: input.stageOrder,
      item_order: input.itemOrder,
      stage_time_limit_seconds: input.stageTimeLimitSeconds,
    },
  };
}
