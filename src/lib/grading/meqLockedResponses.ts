import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssessmentPhase } from "@/lib/ai/types";
import type { MeqTaskCategorySlug } from "@/lib/meqTaskCategories";

export type GradingHistoryEntry = {
  at: string;
  kind: "staff_grade";
  grader_id: string;
  score: number;
  feedback: string | null;
  student_answer: string | null;
};

export function parseGradingHistory(raw: unknown): GradingHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x): x is GradingHistoryEntry =>
      x != null &&
      typeof x === "object" &&
      typeof (x as GradingHistoryEntry).at === "string" &&
      (x as GradingHistoryEntry).kind === "staff_grade" &&
      typeof (x as GradingHistoryEntry).grader_id === "string" &&
      typeof (x as GradingHistoryEntry).score === "number",
  );
}

export interface MeqLockedResponseRow {
  id: string;
  user_id: string;
  meq_stage_id: string;
  /** Question identity for grading — `meq_stage_items.id` (not the parent stage id). */
  meq_stage_item_id: string;
  meq_test_id: string;
  answer_text: string | null;
  status: string;
  human_override_score: number | null;
  ai_rationale_feedback: string | null;
  graded_by: string | null;
  grading_history: GradingHistoryEntry[];
  test_label: string;
  stage_order: number;
  item_order: number;
  stage_information: string | null;
  created_by: string | null;
  rubric_criteria: string | null;
  max_score: number | null;
  question_text: string | null;
  course_code: string | null;
  test_public_code: string | null;
  test_year: number;
  subject: string;
  task_category: MeqTaskCategorySlug | string;
  assessment_phase: AssessmentPhase;
  test_function: string;
  locked_at: string | null;
  stage_time_limit_minutes: number | null;
}

type FetchCtx = {
  graderId: string;
  graderRole: string;
  subAdminCourseScopes: string[];
};

const SELECT_QUERY = `
  id, user_id, meq_stage_id, meq_stage_item_id,
  answer_text, status, human_override_score, ai_rationale_feedback, graded_by, grading_history, locked_at,
  meq_stage_items!inner (
    id,
    sequence_order,
    question_text,
    rubric_criteria,
    max_score,
    task_category,
    meq_test_stages!inner (
      sequence_order,
      stage_information,
      rubric_criteria,
      max_score,
      question_text,
      time_limit_minutes,
      meq_test_id,
      meq_tests!inner(
        id,
        created_by,
        subject,
        course_code,
        public_code,
        test_year,
        test_function,
        assessment_purpose
      )
    )
  )
`;

type NestedRow = {
  id: string;
  user_id: string;
  meq_stage_id: string;
  meq_stage_item_id: string;
  answer_text: string | null;
  status: string;
  human_override_score: number | null;
  ai_rationale_feedback: string | null;
  graded_by: string | null;
  grading_history: unknown;
  locked_at: string | null;
  meq_stage_items: {
    id: string;
    sequence_order: number;
    question_text: string;
    rubric_criteria: string | null;
    max_score: number | null;
    task_category: string;
    meq_test_stages: {
      sequence_order: number;
      stage_information: string | null;
      rubric_criteria: string | null;
      max_score: number | null;
      question_text: string;
      time_limit_minutes: number | null;
      meq_test_id: string;
      meq_tests: {
        id: string;
        created_by: string;
        subject: string;
        course_code: string;
        public_code: string | null;
        test_year: number;
        test_function: string;
        assessment_purpose: AssessmentPhase;
      };
    };
  };
};

export async function fetchLockedMeqResponsesForScope(
  supabase: SupabaseClient,
  ctx: FetchCtx,
): Promise<{ rows: MeqLockedResponseRow[]; error: string | null }> {
  const { data, error: fetchError } = await supabase
    .from("meq_stage_responses")
    .select(SELECT_QUERY)
    .eq("status", "locked")
    .order("id", { ascending: false });

  if (fetchError) {
    return { rows: [], error: "Failed to fetch responses." };
  }

  const raw = (data as unknown as NestedRow[] | null) || [];
  const visible =
    ctx.graderRole === "educator"
      ? raw.filter((r) => r.meq_stage_items.meq_test_stages.meq_tests.created_by === ctx.graderId)
      : ctx.graderRole === "sub_admin"
        ? raw.filter((r) => {
            const code = r.meq_stage_items.meq_test_stages.meq_tests.course_code;
            return !!code && ctx.subAdminCourseScopes.includes(code);
          })
        : raw;

  const rows: MeqLockedResponseRow[] = visible.map((r) => {
    const st = r.meq_stage_items.meq_test_stages;
    const t = st.meq_tests;
    const itemRub = r.meq_stage_items.rubric_criteria ?? st.rubric_criteria;
    const itemMax = r.meq_stage_items.max_score ?? st.max_score;
    return {
      id: r.id,
      user_id: r.user_id,
      meq_stage_id: r.meq_stage_id,
      meq_stage_item_id: r.meq_stage_item_id,
      meq_test_id: st.meq_test_id,
      answer_text: r.answer_text,
      status: r.status,
      human_override_score: r.human_override_score,
      ai_rationale_feedback: r.ai_rationale_feedback,
      graded_by: r.graded_by,
      grading_history: parseGradingHistory(r.grading_history),
      test_label: `${t.subject} (${t.course_code})`,
      stage_order: st.sequence_order,
      item_order: r.meq_stage_items.sequence_order,
      stage_information: st.stage_information,
      created_by: t.created_by,
      rubric_criteria: itemRub,
      max_score: itemMax,
      question_text: r.meq_stage_items.question_text,
      course_code: t.course_code,
      test_public_code: t.public_code ?? null,
      test_year: t.test_year,
      subject: t.subject,
      task_category: r.meq_stage_items.task_category,
      assessment_phase: t.assessment_purpose,
      test_function: t.test_function,
      locked_at: r.locked_at,
      stage_time_limit_minutes: st.time_limit_minutes,
    };
  });

  return { rows, error: null };
}
