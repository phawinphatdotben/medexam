"use client";
import Link from "next/link";
import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { GRADING_ROLES } from "@/lib/auth/roles";
import { useRoleGate } from "@/hooks/useRoleGate";
import type { GradingHistoryEntry } from "@/lib/grading/meqLockedResponses";
import { fetchLockedMeqResponsesForScope } from "@/lib/grading/meqLockedResponses";

interface ResponseRow {
  id: string;
  user_id: string;
  meq_stage_id: string;
  meq_stage_item_id: string;
  meq_test_id: string;
  answer_text: string | null;
  status: string;
  human_override_score?: number | null;
  ai_rationale_feedback?: string | null;
  grading_history: GradingHistoryEntry[];
  test_label: string;
  stage_order: number;
  item_order: number;
  stage_information: string | null;
  created_by: string | null;
  rubric_criteria: string | null;
  max_score: number | null;
  graded_by: string | null;
  question_text: string | null;
  course_code: string | null;
  test_public_code: string | null;
  test_year: number;
}

interface GradeInputState {
  score: string;
  feedback: string;
  loading: boolean;
  error: string | null;
}

type QuestionPick = {
  meq_stage_item_id: string;
  label: string;
  sortKey: string;
};

export default function GradingDashboard() {
  const { ready: accessOk, loading: gateLoading, userId: graderId, role: graderRole } = useRoleGate(
    GRADING_ROLES,
    { noUserRedirect: "/login", wrongRoleRedirect: "/practice-tests" },
  );
  const [subAdminCourseScopes, setSubAdminCourseScopes] = useState<string[]>([]);
  const [scopesLoading, setScopesLoading] = useState(false);

  const [responses, setResponses] = useState<ResponseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gradeInputs, setGradeInputs] = useState<{ [key: string]: GradeInputState }>({});
  const [trainingBanner, setTrainingBanner] = useState<string | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState<number | "">("");
  const [selectedQuestionItemId, setSelectedQuestionItemId] = useState<string>("");
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");
  const [studentProfiles, setStudentProfiles] = useState<Record<string, { email: string; full_name: string | null }>>(
    {},
  );

  useEffect(() => {
    if (!accessOk || !graderId || !graderRole) return;
    if (graderRole !== "sub_admin") {
      setSubAdminCourseScopes([]);
      setScopesLoading(false);
      return;
    }
    let cancelled = false;
    setScopesLoading(true);
    void (async () => {
      const { data: scopes } = await supabase
        .from("sub_admin_course_scopes")
        .select("course_code")
        .eq("profile_id", graderId);
      const scopeCodes = ((scopes as { course_code: string }[] | null) || []).map((s) => s.course_code);
      if (!cancelled) {
        setSubAdminCourseScopes(scopeCodes);
        setScopesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessOk, graderId, graderRole]);

  const authChecking =
    gateLoading || !accessOk || (graderRole === "sub_admin" && scopesLoading);

  const loadResponses = useCallback(async () => {
    if (authChecking || !graderId || !graderRole) return;
    setLoading(true);
    setError(null);
    const { rows, error: fetchErr } = await fetchLockedMeqResponsesForScope(supabase, {
      graderId,
      graderRole,
      subAdminCourseScopes,
    });
    if (fetchErr) {
      setError(fetchErr);
      setResponses([]);
      setLoading(false);
      return;
    }
    setResponses(rows as ResponseRow[]);
    setLoading(false);
  }, [authChecking, graderId, graderRole, subAdminCourseScopes]);

  useEffect(() => {
    void loadResponses();
  }, [loadResponses]);

  const departmentOptions = useMemo(
    () => Array.from(new Set(responses.map((r) => r.course_code).filter(Boolean))) as string[],
    [responses],
  );

  useEffect(() => {
    if (!departmentOptions.includes(selectedCourse)) {
      setSelectedCourse(departmentOptions[0] || "");
      setSelectedYear("");
      setSelectedQuestionItemId("");
      setSelectedStudentId("");
    }
  }, [departmentOptions, selectedCourse]);

  const courseScoped = useMemo(
    () => (selectedCourse ? responses.filter((r) => r.course_code === selectedCourse) : []),
    [responses, selectedCourse],
  );

  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    for (const r of courseScoped) {
      years.add(r.test_year);
    }
    return [...years].sort((a, b) => b - a);
  }, [courseScoped]);

  useEffect(() => {
    if (selectedYear === "") return;
    if (!yearOptions.includes(selectedYear)) {
      setSelectedYear("");
      setSelectedQuestionItemId("");
      setSelectedStudentId("");
    }
  }, [yearOptions, selectedYear]);

  const courseYearScoped = useMemo(() => {
    if (!selectedCourse || selectedYear === "") return [];
    return courseScoped.filter((r) => r.test_year === selectedYear);
  }, [courseScoped, selectedCourse, selectedYear]);

  const questionOptions: QuestionPick[] = useMemo(() => {
    const m = new Map<string, QuestionPick>();
    const preview = (q: string | null) => {
      const t = (q ?? "").trim();
      if (!t) return "(no prompt text)";
      return t.length <= 56 ? t : `${t.slice(0, 56)}…`;
    };
    for (const r of courseYearScoped) {
      if (!m.has(r.meq_stage_item_id)) {
        const codeTag = r.test_public_code?.trim() || `MEQ-${r.meq_test_id.slice(0, 8)}`;
        const qid = r.meq_stage_item_id;
        m.set(qid, {
          meq_stage_item_id: qid,
          label: `Question ID ${qid} · Exam ${codeTag} — ${preview(r.question_text)}`,
          sortKey: `${codeTag}-${qid}`,
        });
      }
    }
    return [...m.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [courseYearScoped]);

  useEffect(() => {
    const ids = new Set(questionOptions.map((q) => q.meq_stage_item_id));
    if (selectedQuestionItemId && !ids.has(selectedQuestionItemId)) {
      setSelectedQuestionItemId("");
      setSelectedStudentId("");
    }
  }, [questionOptions, selectedQuestionItemId]);

  const questionScoped = useMemo(
    () =>
      selectedQuestionItemId ? courseYearScoped.filter((r) => r.meq_stage_item_id === selectedQuestionItemId) : [],
    [courseYearScoped, selectedQuestionItemId],
  );

  const studentOptions = useMemo(() => {
    const ordered: { user_id: string; label: string }[] = [];
    const seen = new Set<string>();
    for (const r of questionScoped) {
      if (seen.has(r.user_id)) continue;
      seen.add(r.user_id);
      const pf = studentProfiles[r.user_id];
      const label = pf?.full_name?.trim()
        ? `${pf.full_name} · ${pf.email}`
        : pf?.email?.trim()
          ? pf.email
          : `${r.user_id.slice(0, 8)}…${r.user_id.slice(-6)}`;
      ordered.push({ user_id: r.user_id, label });
    }
    ordered.sort((a, b) => a.label.localeCompare(b.label));
    return ordered;
  }, [questionScoped, studentProfiles]);

  useEffect(() => {
    const ids = new Set(studentOptions.map((s) => s.user_id));
    if (selectedStudentId && !ids.has(selectedStudentId)) {
      setSelectedStudentId("");
    }
  }, [studentOptions, selectedStudentId]);

  useEffect(() => {
    if (!questionScoped.length) {
      setStudentProfiles({});
      return;
    }
    const uids = [...new Set(questionScoped.map((r) => r.user_id))];
    let cancelled = false;
    void (async () => {
      const { data, error: pe } = await supabase.from("profiles").select("id, email, full_name").in("id", uids);
      if (cancelled) return;
      if (pe || !data) {
        setStudentProfiles({});
        return;
      }
      const next: Record<string, { email: string; full_name: string | null }> = {};
      for (const p of data as { id: string; email: string; full_name: string | null }[]) {
        next[p.id] = { email: p.email, full_name: p.full_name };
      }
      setStudentProfiles(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [questionScoped]);

  const studentResponses = useMemo(() => {
    if (!selectedStudentId) return [];
    const rows = questionScoped.filter((r) => r.user_id === selectedStudentId);
    return [...rows].sort(
      (a, b) => a.stage_order - b.stage_order || a.item_order - b.item_order,
    );
  }, [selectedStudentId, questionScoped]);

  const handleInputChange = (
    responseId: string,
    field: "score" | "feedback",
    value: string,
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
    if (!score || Number.isNaN(Number(score))) {
      setGradeInputs((prev) => ({
        ...prev,
        [response.id]: {
          ...input,
          error: "Set a numeric score before recording training data.",
        },
      }));
      return;
    }
    const line = {
      schema_version: 2 as const,
      recorded_at: new Date().toISOString(),
      purpose: "human_correction_after_ai" as const,
      response_id: response.id,
      meq_stage_id: response.meq_stage_id,
      meq_stage_item_id: response.meq_stage_item_id,
      test_label: response.test_label,
      course_code: response.course_code,
      stage_order: response.stage_order,
      item_order: response.item_order,
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
          error: insErr.message || "Could not save AI training row.",
        },
      }));
      return;
    }
    setGradeInputs((prev) => ({
      ...prev,
      [response.id]: { ...input, error: null },
    }));
    setError(null);
    setTrainingBanner(
      "Saved as AI training correction (structured JSON). Admins can export JSON Lines from Admin → Audit log.",
    );
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
    if (!score.trim() || Number.isNaN(Number(score))) {
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

    const numScore = Number(score);
    const historyEntry: GradingHistoryEntry = {
      at: new Date().toISOString(),
      kind: "staff_grade",
      grader_id: graderId,
      score: numScore,
      feedback: feedback.trim() || null,
      student_answer: response.answer_text ?? null,
    };
    const nextHistory = [...(response.grading_history || []), historyEntry];

    const { error: uerr } = await supabase
      .from("meq_stage_responses")
      .update({
        human_override_score: numScore,
        ai_rationale_feedback: feedback.trim() || null,
        graded_by: graderId,
        graded_at: new Date().toISOString(),
        grading_history: nextHistory,
      })
      .eq("id", response.id);

    if (!uerr && graderRole === "admin" && response.graded_by && response.graded_by !== graderId) {
      await supabase.from("meq_grade_notifications").insert({
        response_id: response.id,
        grader_id: response.graded_by,
        admin_id: graderId,
        previous_score: response.human_override_score,
        new_score: numScore,
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

  const pickReady =
    selectedCourse && selectedYear !== "" && selectedQuestionItemId && selectedStudentId;

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="w-full border-b border-gray-200 shadow-sm px-8 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-blue-800 tracking-tight">MEQ grading</h1>
            <p className="text-sm text-slate-600 mt-2 max-w-3xl">
              Choose <strong>department</strong>, <strong>academic year</strong>, a <strong>question ID</strong> (
              <code className="text-xs bg-slate-100 px-1 rounded">meq_stage_items.id</code>), then a{" "}
              <strong>student</strong>. The question ID labels each gradable prompt; exam code is shown for context only.
              Grading history is append-only JSON; AI training records corrections for future model work.
            </p>
          </div>
          <Link
            href="/dashboard/grade/test-results"
            className="shrink-0 text-sm font-semibold text-blue-800 hover:underline border border-blue-200 rounded-lg px-3 py-2 bg-blue-50"
          >
            Test results table →
          </Link>
        </div>
      </header>
      <main className="flex-1 w-full max-w-3xl mx-auto mt-8 px-6 pb-12">
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
          <div className="space-y-8 mt-2">
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Start grading</h2>
              <p className="text-sm text-gray-600">
                <strong>Department</strong> → <strong>Year</strong> → <strong>Question ID</strong> →{" "}
                <strong>Student</strong>. Only locked submissions in your grading scope are listed.
              </p>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Department</label>
                  <select
                    value={selectedCourse}
                    onChange={(e) => {
                      setSelectedCourse(e.target.value);
                      setSelectedYear("");
                      setSelectedQuestionItemId("");
                      setSelectedStudentId("");
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
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Year</label>
                  <select
                    value={selectedYear === "" ? "" : String(selectedYear)}
                    disabled={!selectedCourse}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSelectedYear(v === "" ? "" : Number(v));
                      setSelectedQuestionItemId("");
                      setSelectedStudentId("");
                    }}
                    className="w-full border border-gray-300 rounded px-3 py-2 bg-white disabled:bg-gray-100"
                  >
                    <option value="">Select year…</option>
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Question ID <span className="font-normal text-gray-500">(graders pick the item UUID)</span>
                  </label>
                  <select
                    value={selectedQuestionItemId}
                    disabled={selectedYear === ""}
                    onChange={(e) => {
                      setSelectedQuestionItemId(e.target.value);
                      setSelectedStudentId("");
                    }}
                    className="w-full border border-gray-300 rounded px-3 py-2 bg-white disabled:bg-gray-100 text-sm"
                  >
                    <option value="">Select question ID…</option>
                    {questionOptions.map((q) => (
                      <option key={q.meq_stage_item_id} value={q.meq_stage_item_id}>
                        {q.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Student</label>
                  <select
                    value={selectedStudentId}
                    disabled={!selectedQuestionItemId}
                    onChange={(e) => setSelectedStudentId(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2 bg-white disabled:bg-gray-100"
                  >
                    <option value="">Select student…</option>
                    {studentOptions.map((s) => (
                      <option key={s.user_id} value={s.user_id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            {!pickReady ? (
              <div className="text-center text-gray-500 border border-dashed border-gray-300 rounded-lg py-10">
                Choose department, year, question, and student to open the grading panel.
              </div>
            ) : (
              <div className="space-y-8">
                {studentResponses.map((response) => {
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
                  const examStableLabel =
                    response.test_public_code?.trim() || `MEQ ${response.meq_test_id.slice(0, 8)}…`;
                  return (
                    <div
                      key={response.id}
                      className="border border-gray-300 bg-gray-50 rounded-lg shadow-sm p-6"
                    >
                      <div className="mb-2 text-sm text-gray-800 space-y-1">
                        <div>
                          <span className="font-semibold">{response.test_label}</span>
                          <span className="ml-2 text-gray-600">
                            · Stage <strong className="text-gray-900">{response.stage_order}</strong>
                            {response.item_order > 1 ? (
                              <span className="ml-1">
                                · Part <strong>{response.item_order}</strong>
                              </span>
                            ) : null}
                          </span>
                        </div>
                        <div className="text-xs text-gray-600 font-mono break-all">
                          Exam code/id:{" "}
                          <span className="text-gray-900 font-semibold">{examStableLabel}</span>
                          {" · "}
                          Question ID <span className="font-semibold">{response.meq_stage_item_id}</span>
                        </div>
                      </div>
                      {response.rubric_criteria ? (
                        <div className="mb-3 bg-blue-50 border border-blue-200 rounded-md px-4 py-3 text-sm text-blue-900 whitespace-pre-wrap">
                          <span className="font-semibold">Rubric (this question):</span>{" "}
                          {response.rubric_criteria}
                        </div>
                      ) : null}
                      {response.stage_information?.trim() ? (
                        <div className="mb-3 bg-slate-50 border border-slate-200 rounded-md px-4 py-3 text-sm text-slate-900 whitespace-pre-wrap">
                          <div className="font-semibold text-slate-800 mb-1">
                            Stage information (revealed before this block)
                          </div>
                          {response.stage_information}
                        </div>
                      ) : null}
                      {response.question_text ? (
                        <div className="mb-3 bg-white border border-gray-200 rounded-md px-4 py-3 text-sm text-gray-900 whitespace-pre-wrap">
                          <div className="font-semibold text-gray-800 mb-1">
                            Prompt shown to student
                          </div>
                          {response.question_text}
                        </div>
                      ) : null}
                      <div className="mb-1">
                        <span className="text-xs font-semibold text-gray-600 mr-3">Student ID</span>
                        <span className="text-gray-900 font-mono">{response.user_id}</span>
                      </div>
                      <div className="mb-4">
                        <label className="block text-sm font-bold text-gray-700 mb-1">
                          Student reply
                        </label>
                        <div className="bg-yellow-50 border border-yellow-200 rounded-md px-4 py-3 text-base text-gray-800 font-mono shadow-inner whitespace-pre-wrap break-words">
                          {response.answer_text || (
                            <span className="italic text-gray-400">(No answer provided)</span>
                          )}
                        </div>
                      </div>
                      {response.grading_history?.length ? (
                        <details className="mb-4 text-xs border border-gray-200 rounded-md bg-white">
                          <summary className="cursor-pointer px-3 py-2 font-semibold text-gray-700">
                            Grade revision history ({response.grading_history.length})
                          </summary>
                          <ol className="list-decimal pl-8 pr-3 pb-3 space-y-2 text-gray-700">
                            {response.grading_history.map((h, hi) => (
                              <li key={`${response.id}-h-${hi}`}>
                                <span className="text-gray-500">{new Date(h.at).toLocaleString()} — </span>
                                score <strong>{h.score}</strong>
                                {h.feedback?.trim()
                                  ? ` · feedback: ${h.feedback}`
                                  : " · no feedback"}
                                <div className="text-gray-500 font-mono mt-0.5 break-all">
                                  grader {h.grader_id}
                                </div>
                              </li>
                            ))}
                          </ol>
                        </details>
                      ) : null}
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
                            placeholder={`Points${response.max_score ? ` (max ${response.max_score})` : ""}`}
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
                      <div className="flex flex-wrap gap-3 mt-2 items-start">
                        <button
                          className={`bg-blue-700 text-white font-semibold px-8 py-3 rounded shadow hover:bg-blue-800 transition border border-blue-700 ${
                            input.loading ? "opacity-60 cursor-not-allowed" : ""
                          }`}
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
                          disabled
                          title="Automated inference will activate once an API key and faculty-hosted model endpoint are wired in."
                          className="border border-dashed border-slate-400 text-slate-500 font-semibold px-6 py-3 rounded shadow-sm bg-slate-100 cursor-not-allowed"
                        >
                          AI grading (faculty GPU / API — soon)
                        </button>
                        <button
                          type="button"
                          disabled={input.loading}
                          onClick={() => void handleRecordAiTraining(response)}
                          className="bg-emerald-800 text-white font-semibold px-6 py-3 rounded shadow hover:bg-emerald-900 disabled:opacity-50 border border-emerald-900"
                        >
                          AI training (record correction)
                        </button>
                      </div>
                      <div className="text-xs text-slate-600 mt-3 space-y-1">
                        <p>
                          <strong>Canonical grade:</strong> updates the live score columns and appends JSON to{" "}
                          <code className="text-slate-800">grading_history</code>.
                        </p>
                        <p>
                          <strong>AI grading:</strong> disabled until integrations land; scores will originate from your
                          local or faculty-hosted server.
                        </p>
                        <p>
                          <strong>AI training:</strong> records the current numeric score plus staff feedback aligned to
                          the student answer — without calling an external model.
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
