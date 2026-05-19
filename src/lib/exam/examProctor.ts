import { supabase } from "@/lib/supabase";
import type { RealExamKind } from "@/lib/exam/realTestLock";

export type ExamProctorEventType =
  | "session_started"
  | "session_ended"
  | "focus_lost"
  | "focus_returned"
  | "fullscreen_entered"
  | "fullscreen_exited"
  | "auto_submit_overall"
  | "auto_submit_stage";

export type ExamProctorLogInput = {
  assignmentId: string;
  testKind: RealExamKind;
  testId: string;
  eventType: ExamProctorEventType;
  detail?: Record<string, unknown>;
};

export function testKindToDb(kind: RealExamKind): "MEQ" | "SBA" {
  return kind === "meq" ? "MEQ" : "SBA";
}

/** Persist a proctor audit row (real tests with assignment only). */
export async function logExamProctorEvent(
  input: ExamProctorLogInput,
): Promise<{ ok: boolean; error?: string }> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return { ok: false, error: "not_signed_in" };

  const { error } = await supabase.from("exam_proctor_events").insert({
    assignment_id: input.assignmentId,
    student_id: uid,
    test_kind: testKindToDb(input.testKind),
    test_id: input.testId,
    event_type: input.eventType,
    detail: input.detail ?? {},
  });

  if (error) {
    if (error.message.includes("does not exist") || error.code === "42P01") {
      return { ok: false, error: "migration_044_required" };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export type ExamProctorEventRow = {
  id: string;
  assignment_id: string;
  student_id: string;
  test_kind: "MEQ" | "SBA";
  test_id: string;
  event_type: ExamProctorEventType;
  detail: Record<string, unknown> | null;
  created_at: string;
  profiles?: { full_name: string | null; email: string; student_id: string | null } | null;
  staff_test_assignments?: { title: string } | null;
};

export const PROCTOR_EVENT_LABELS: Record<ExamProctorEventType, string> = {
  session_started: "Exam session started",
  session_ended: "Exam session ended",
  focus_lost: "Left exam window",
  focus_returned: "Returned to exam window",
  fullscreen_entered: "Entered fullscreen",
  fullscreen_exited: "Exited fullscreen",
  auto_submit_overall: "Auto-submitted (overall timer)",
  auto_submit_stage: "Auto-submitted (stage timer)",
};

export function isFocusWarningEvent(type: string): boolean {
  return type === "focus_lost" || type === "fullscreen_exited";
}
