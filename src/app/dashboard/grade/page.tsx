"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface ResponseRow {
  id: string;
  user_id: string;
  meq_stage_id: string;
  meq_test_id: string;
  answer_text: string | null;
  status: string;
  human_override_score?: number | null;
  ai_rationale_feedback?: string | null;
  test_label: string;
  stage_order: number;
  created_by: string | null;
  rubric_criteria: string | null;
  max_score: number | null;
  graded_by: string | null;
  question_text: string | null;
  course_code: string | null;
}

interface GradeInputState {
  score: string;
  feedback: string;
  loading: boolean;
  error: string | null;
}

export default function GradingDashboard() {
  const [responses, setResponses] = useState<ResponseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gradeInputs, setGradeInputs] = useState<{ [key: string]: GradeInputState }>({});
  const [authChecking, setAuthChecking] = useState(true);
  const [graderId, setGraderId] = useState<string | null>(null);
  const [graderRole, setGraderRole] = useState<string | null>(null);
  const [subAdminCourseScopes, setSubAdminCourseScopes] = useState<string[]>([]);
  const [trainingBanner, setTrainingBanner] = useState<string | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<string>("");
  const [selectedStage, setSelectedStage] = useState<string>("");

  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    async function secureAccess() {
      setAuthChecking(true);
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (!mounted) return;
      const user = userData.user;
      if (!user) {
        router.push("/exam");
        return;
      }
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (
        profileError ||
        !profile ||
        !profile.role ||
        !["admin", "educator", "sub_admin"].includes(profile.role)
      ) {
        router.push("/exam");
        return;
      }
      setGraderId(user.id);
      setGraderRole(profile.role);
      if (profile.role === "sub_admin") {
        const { data: scopes } = await supabase
          .from("sub_admin_course_scopes")
          .select("course_code")
          .eq("profile_id", user.id);
        const scopeCodes = ((scopes as { course_code: string }[] | null) || []).map((s) => s.course_code);
        setSubAdminCourseScopes(scopeCodes);
      } else {
        setSubAdminCourseScopes([]);
      }
      setAuthChecking(false);
    }
    void secureAccess();
    return () => {
      mounted = false;
    };
  }, [router]);

  const loadResponses = useCallback(async () => {
    if (authChecking || !graderId) return;
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from("meq_stage_responses")
      .select(
        `
        id, user_id, meq_stage_id, answer_text, status, human_override_score, ai_rationale_feedback, graded_by,
        meq_test_stages!inner(
          sequence_order,
          rubric_criteria,
          max_score,
          question_text,
          meq_test_id,
          meq_tests!inner( id, created_by, subject, course_code )
        )
      `
      )
      .eq("status", "locked")
      .order("id", { ascending: false });

    if (fetchError) {
      setError("Failed to fetch responses.");
      setResponses([]);
      setLoading(false);
      return;
    }

    type D = {
      id: string;
      user_id: string;
      meq_stage_id: string;
      answer_text: string | null;
      status: string;
      human_override_score: number | null;
      ai_rationale_feedback: string | null;
      graded_by: string | null;
      meq_test_stages: {
        sequence_order: number;
        rubric_criteria: string | null;
        max_score: number | null;
        question_text: string;
        meq_test_id: string;
        meq_tests: { id: string; created_by: string; subject: string; course_code: string };
      };
    };
    const raw = (data as unknown as D[] | null) || [];
    const visible =
      graderRole === "educator"
        ? raw.filter((r) => r.meq_test_stages.meq_tests.created_by === graderId)
        : graderRole === "sub_admin"
          ? raw.filter((r) => {
              const code = r.meq_test_stages.meq_tests.course_code;
              return !!code && subAdminCourseScopes.includes(code);
            })
        : raw;
    setResponses(
      visible.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        meq_stage_id: r.meq_stage_id,
        meq_test_id: r.meq_test_stages.meq_test_id,
        answer_text: r.answer_text,
        status: r.status,
        human_override_score: r.human_override_score,
        ai_rationale_feedback: r.ai_rationale_feedback,
        test_label: `${r.meq_test_stages.meq_tests.subject} (${r.meq_test_stages.meq_tests.course_code})`,
        stage_order: r.meq_test_stages.sequence_order,
        created_by: r.meq_test_stages.meq_tests.created_by,
        rubric_criteria: r.meq_test_stages.rubric_criteria,
        max_score: r.meq_test_stages.max_score,
        graded_by: r.graded_by,
        question_text: r.meq_test_stages.question_text,
        course_code: r.meq_test_stages.meq_tests.course_code,
      }))
    );
    setLoading(false);
  }, [authChecking, graderId, graderRole, subAdminCourseScopes]);

  useEffect(() => {
    void loadResponses();
  }, [loadResponses]);

  useEffect(() => {
    const availableCourses = Array.from(new Set(responses.map((r) => r.course_code).filter(Boolean))) as string[];
    if (!selectedCourse || !availableCourses.includes(selectedCourse)) {
      setSelectedCourse(availableCourses[0] || "");
      setSelectedStage("");
    }
  }, [responses, selectedCourse]);

  const handleInputChange = (
    responseId: string,
    field: "score" | "feedback",
    value: string
  ) => {
    setGradeInputs((prev) => ({
      ...prev,
      [responseId]: {
        ...prev[responseId],
        [field]: value,
        loading: prev[responseId]?.loading ?? false,
        error: null,
      },
    }));
  };

  const canEditRow = (response: ResponseRow) =>
    graderRole === "admin" ||
    (response.created_by === graderId &&
      (response.human_override_score == null || response.graded_by === graderId));

  const handleRecordAiTraining = async (response: ResponseRow) => {
    if (!graderId) return;
    const input = gradeInputs[response.id] || {
      score:
        response.human_override_score != null ? String(response.human_override_score) : "",
      feedback: response.ai_rationale_feedback ?? "",
      loading: false,
      error: null,
    };
    const score = input.score.trim();
    const feedback = input.feedback.trim();
    if (!score || isNaN(Number(score))) {
      setGradeInputs((prev) => ({
        ...prev,
        [response.id]: { ...input, error: "Set a numeric score before recording training data." },
      }));
      return;
    }
    const line = {
      schema_version: 1 as const,
      recorded_at: new Date().toISOString(),
      purpose: "human_grade_for_ai_finetune",
      response_id: response.id,
      meq_stage_id: response.meq_stage_id,
      test_label: response.test_label,
      course_code: response.course_code,
      stage_order: response.stage_order,
      question_text: response.question_text,
      rubric_criteria: response.rubric_criteria,
      max_score: response.max_score,
      student_answer: response.answer_text,
      human_score: Number(score),
      staff_feedback: feedback || null,
    };

    const { error: insErr } = await supabase.from("meq_ai_training_records").insert({
      staff_id: graderId,
      meq_stage_response_id: response.id,
      line_json: line,
    });
    if (insErr) {
      setGradeInputs((prev) => ({
        ...prev,
        [response.id]: {
          ...input,
          error: insErr.message || "Could not save AI training row. Run migration 019.",
        },
      }));
      return;
    }
    setGradeInputs((prev) => ({
      ...prev,
      [response.id]: { ...input, error: null },
    }));
    setError(null);
    setTrainingBanner("Recorded as training JSON for AI grading. Admins can export JSONL from Admin → Audit log.");
    window.setTimeout(() => setTrainingBanner(null), 8000);
  };

  const handleGradeSubmit = async (response: ResponseRow, score: string, feedback: string) => {
    if (!graderId) return;
    if (!canEditRow(response)) {
      setGradeInputs((prev) => ({
        ...prev,
        [response.id]: {
          ...prev[response.id],
          error: "You can only grade tests you created, and edit only grades made by you.",
          loading: false,
        },
      }));
      return;
    }
    if (!score.trim() || isNaN(Number(score))) {
      setGradeInputs((prev) => ({
        ...prev,
        [response.id]: {
          ...prev[response.id],
          error: "Please enter a valid number of points.",
          loading: false,
        },
      }));
      return;
    }
    setGradeInputs((prev) => ({
      ...prev,
      [response.id]: {
        ...(prev[response.id] || { score: "", feedback: "" }),
        score,
        feedback,
        loading: true,
        error: null,
      },
    }));

    const { error: uerr } = await supabase
      .from("meq_stage_responses")
      .update({
        human_override_score: Number(score),
        ai_rationale_feedback: feedback || null,
        graded_by: graderId,
        graded_at: new Date().toISOString(),
      })
      .eq("id", response.id);

    if (!uerr && graderRole === "admin" && response.graded_by && response.graded_by !== graderId) {
      await supabase.from("meq_grade_notifications").insert({
        response_id: response.id,
        grader_id: response.graded_by,
        admin_id: graderId,
        previous_score: response.human_override_score,
        new_score: Number(score),
      });
    }

    if (uerr) {
      setGradeInputs((prev) => ({
        ...prev,
        [response.id]: {
          ...prev[response.id]!,
          loading: false,
          error: "Error submitting grade. Try again.",
        },
      }));
    } else {
      void loadResponses();
    }
  };

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <span className="text-blue-700 text-lg font-medium">Checking access...</span>
      </div>
    );
  }

  const departmentOptions = Array.from(new Set(responses.map((r) => r.course_code).filter(Boolean))) as string[];
  const departmentScopedResponses = selectedCourse
    ? responses.filter((r) => r.course_code === selectedCourse)
    : [];
  const questionOptions = Array.from(
    new Map(
      departmentScopedResponses.map((r) => [
        r.meq_stage_id,
        {
          stageId: r.meq_stage_id,
          label: `${r.test_label} · Stage ${r.stage_order}`,
          questionText: r.question_text ?? "",
        },
      ])
    ).values()
  );
  const visibleResponses = selectedStage
    ? departmentScopedResponses.filter((r) => r.meq_stage_id === selectedStage)
    : [];

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="w-full border-b border-gray-200 shadow-sm px-8 py-6">
        <h1 className="text-3xl font-bold text-blue-800 tracking-tight">MEQ grading</h1>
      </header>
      <main className="flex-1 w-full max-w-3xl mx-auto mt-8 px-6">
        {trainingBanner ? (
          <div className="mb-4 p-4 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 text-sm">
            {trainingBanner}
          </div>
        ) : null}
        {loading ? (
          <div className="text-blue-700 text-center py-12 text-lg font-medium">Loading...</div>
        ) : error ? (
          <div className="bg-red-100 border border-red-300 text-red-700 rounded p-6 mt-8 text-center font-medium">
            {error}
          </div>
        ) : responses.length === 0 ? (
          <div className="text-gray-500 text-center py-16 text-xl font-medium">No MEQ stage submissions found</div>
        ) : (
          <div className="space-y-8 mt-2 mb-10">
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Start grading</h2>
              <p className="text-sm text-gray-600">
                Select a department and assigned question before grading. Only questions within your grading scope are listed.
              </p>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Department</label>
                  <select
                    value={selectedCourse}
                    onChange={(e) => {
                      setSelectedCourse(e.target.value);
                      setSelectedStage("");
                    }}
                    className="w-full border border-gray-300 rounded px-3 py-2 bg-white"
                  >
                    <option value="">Select department…</option>
                    {departmentOptions.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Question</label>
                  <select
                    value={selectedStage}
                    disabled={!selectedCourse}
                    onChange={(e) => setSelectedStage(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2 bg-white disabled:bg-gray-100"
                  >
                    <option value="">Select question…</option>
                    {questionOptions.map((option) => (
                      <option key={option.stageId} value={option.stageId}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {selectedStage ? (
                <div className="text-sm text-gray-700 bg-white border border-gray-200 rounded p-3 whitespace-pre-wrap">
                  <span className="font-semibold">Question prompt:</span>{" "}
                  {questionOptions.find((q) => q.stageId === selectedStage)?.questionText || "-"}
                </div>
              ) : null}
            </div>
            {!selectedCourse || !selectedStage ? (
              <div className="text-center text-gray-500 border border-dashed border-gray-300 rounded-lg py-10">
                Choose department and question to start grading.
              </div>
            ) : null}
            {visibleResponses.map((response) => {
              const input = gradeInputs[response.id] || {
                score:
                  response.human_override_score != null
                    ? String(response.human_override_score)
                    : "",
                feedback: response.ai_rationale_feedback ?? "",
                loading: false,
                error: null,
              };
              const canEdit = canEditRow(response);
              return (
                <div
                  key={response.id}
                  className="border border-gray-300 bg-gray-50 rounded-lg shadow-sm p-6"
                >
                  <div className="mb-2 text-sm text-gray-700">
                    <span className="font-semibold">{response.test_label}</span>
                    <span className="ml-2 text-gray-500">· Stage {response.stage_order}</span>
                  </div>
                  {response.rubric_criteria ? (
                    <div className="mb-3 bg-blue-50 border border-blue-200 rounded-md px-4 py-3 text-sm text-blue-900 whitespace-pre-wrap">
                      <span className="font-semibold">Rubric:</span> {response.rubric_criteria}
                    </div>
                  ) : null}
                  <div className="mb-1">
                    <span className="text-xs font-semibold text-gray-600 mr-3">Student ID</span>
                    <span className="text-gray-900 font-mono">{response.user_id}</span>
                  </div>
                  <div className="mb-1">
                    <span className="text-xs font-semibold text-gray-600 mr-3">Stage (response) ID</span>
                    <span className="text-gray-900 font-mono text-sm break-all">{response.meq_stage_id}</span>
                  </div>
                  <div className="mb-4">
                    <label className="block text-sm font-bold text-gray-700 mb-1">Student answer</label>
                    <div className="bg-yellow-50 border border-yellow-200 rounded-md px-4 py-3 text-base text-gray-800 font-mono shadow-inner whitespace-pre-wrap break-words">
                      {response.answer_text || (
                        <span className="italic text-gray-400">(No answer provided)</span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                    <div>
                      <label
                        htmlFor={`score-${response.id}`}
                        className="block text-sm font-semibold text-gray-700 mb-1"
                      >
                        Score
                      </label>
                      <input
                        id={`score-${response.id}`}
                        type="number"
                        min={0}
                        max={response.max_score ?? 100}
                        value={input.score}
                        onChange={(e) => handleInputChange(response.id, "score", e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                        disabled={input.loading || !canEdit}
                        placeholder={`Enter points${response.max_score ? ` (max ${response.max_score})` : ""}`}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`feedback-${response.id}`}
                        className="block text-sm font-semibold text-gray-700 mb-1"
                      >
                        Feedback
                      </label>
                      <textarea
                        id={`feedback-${response.id}`}
                        value={input.feedback}
                        onChange={(e) => handleInputChange(response.id, "feedback", e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                        rows={2}
                        disabled={input.loading || !canEdit}
                        placeholder="Brief feedback"
                      />
                    </div>
                  </div>
                  {input.error && (
                    <div className="bg-red-50 border border-red-300 text-red-700 rounded px-4 py-2 mb-2 text-sm">
                      {input.error}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3 mt-2">
                    <button
                      className={`bg-blue-700 text-white font-semibold px-8 py-3 rounded shadow hover:bg-blue-800 transition border border-blue-700
                      ${input.loading ? "opacity-60 cursor-not-allowed" : ""}
                    `}
                      onClick={() => void handleGradeSubmit(response, input.score, input.feedback)}
                      disabled={input.loading || !canEdit}
                      type="button"
                    >
                      {input.loading
                        ? "Submitting..."
                        : response.human_override_score == null
                          ? "Submit grade"
                          : "Update grade"}
                    </button>
                    <button
                      type="button"
                      disabled={input.loading}
                      onClick={() => void handleRecordAiTraining(response)}
                      className="bg-slate-700 text-white font-semibold px-6 py-3 rounded shadow hover:bg-slate-800 disabled:opacity-50 border border-slate-800"
                    >
                      AI grading (record training)
                    </button>
                  </div>
                  <p className="text-xs text-slate-600 mt-2">
                    AI grading stores this row as structured JSON for a future model-training export
                    (JSON Lines), without calling an external API yet.
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
