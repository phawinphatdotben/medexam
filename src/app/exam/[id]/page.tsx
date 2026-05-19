"use client";

import { useEffect, useState, useCallback, useRef, useMemo, type ReactNode } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { RealTestCompleteActions } from "@/components/exam/RealTestCompleteActions";
import { RealTestExamShell } from "@/components/exam/RealTestExamShell";
import { appendMeqExamInteraction, createInteractionSequence } from "@/lib/ai/interactionLogger";
import { logExamProctorEvent } from "@/lib/exam/examProctor";

type MeqTest = {
  id: string;
  subject: string;
  course_code: string;
  first_page_stem: string;
  vignette: string;
  time_limit_minutes: number | null;
  test_function: "practice" | "real_test";
};

type DbStageRow = {
  id: string;
  meq_test_id: string;
  sequence_order: number;
  time_limit_minutes: number | null;
  stage_information: string | null;
  question_text: string;
  media_urls: string[] | null;
  meq_stage_items:
    | { id: string; meq_stage_id?: string; sequence_order: number; question_text: string; media_urls: string[] | null }[]
    | null;
};

type StageItem = {
  id: string;
  sequence_order: number;
  question_text: string;
  media_urls: string[] | null;
};

type Stage = DbStageRow & { itemsSorted: StageItem[] };

function normalizeItems(stage: DbStageRow): StageItem[] {
  const raw = stage.meq_stage_items;
  const rows = Array.isArray(raw) ? raw : [];
  return [...rows]
    .sort((a, b) => a.sequence_order - b.sequence_order)
    .map((r) => ({
      id: r.id,
      sequence_order: r.sequence_order,
      question_text: r.question_text,
      media_urls: r.media_urls ?? null,
    }));
}

function buildStages(rows: DbStageRow[]): Stage[] {
  const ordered = [...(rows || [])].sort((a, b) => a.sequence_order - b.sequence_order);
  return ordered.map((s) => ({ ...s, itemsSorted: normalizeItems(s) }));
}

type SavedItemRow = {
  meq_stage_id: string;
  meq_stage_item_id: string;
  answer_text: string | null;
  status: string;
};

const PRACTICE_MULTI_PREFIX = "{\"meq_multi\":";

function serializePracticeAnswers(stage: Stage, draftByItem: Record<string, string>): string | null {
  const items = stage.itemsSorted;
  if (items.length === 0) return null;
  const parts = items.map((it) => draftByItem[it.id]?.trim() ?? "");
  if (parts.every((p) => !p)) return null;
  if (items.length === 1) return parts[0] || null;
  const map: Record<string, string> = {};
  items.forEach((it, idx) => {
    if (parts[idx]) map[it.id] = parts[idx]!;
  });
  return JSON.stringify({ meq_multi: true, parts: map });
}

function deserializePracticePrev(raw: string, items: StageItem[]): Record<string, string> | null {
  const t = raw.trim();
  if (!t) return {};
  if (items.length <= 1) {
    const only = items[0];
    if (!only) return {};
    return { [only.id]: raw };
  }
  if (!t.startsWith(PRACTICE_MULTI_PREFIX)) return null;
  try {
    const o = JSON.parse(t) as { meq_multi?: boolean; parts?: Record<string, string> };
    if (o?.meq_multi && o.parts && typeof o.parts === "object") return o.parts;
  } catch {
    /* ignore */
  }
  return null;
}

/** Any item row for this stage is locked → treat stage complete (legacy compat). */
function stageFullyLocked(stage: Stage, byItemId: Record<string, SavedItemRow | undefined>): boolean {
  const items = stage.itemsSorted;
  if (items.length === 0) return false;
  return items.every((it) => byItemId[it.id]?.status === "locked");
}

function allStagesComplete(stagesArr: Stage[], byItemId: Record<string, SavedItemRow | undefined>): boolean {
  return stagesArr.length > 0 && stagesArr.every((s) => stageFullyLocked(s, byItemId));
}

function firstOpenStageIndex(stagesArr: Stage[], byItemId: Record<string, SavedItemRow | undefined>): number {
  const i = stagesArr.findIndex((s) => !stageFullyLocked(s, byItemId));
  return i === -1 ? 0 : i;
}

export default function StudentMeqExamPage() {
  const { id: testId } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const assignmentId = searchParams.get("assignment")?.trim() || null;
  const [test, setTest] = useState<MeqTest | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [byItemId, setByItemId] = useState<Record<string, SavedItemRow | undefined>>({});
  const [draftByItem, setDraftByItem] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const examSessionStartRef = useRef<number | null>(null);
  const overallAutoSubmitFiredRef = useRef(false);
  const interactionSeqRef = useRef(createInteractionSequence());
  const sessionLoggedRef = useRef(false);
  const [sessionTick, setSessionTick] = useState(0);
  const [lastPracticeByStage, setLastPracticeByStage] = useState<Record<string, string>>({});

  useEffect(() => {
    let isMounted = true;
    const run = async () => {
      setLoading(true);
      setError(null);

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        if (isMounted) {
          setLoading(false);
          router.replace("/login");
        }
        return;
      }
      const uid = userData.user.id;
      if (isMounted) setUserId(uid);
      const { data: me } = await supabase
        .from("profiles")
        .select("role, medical_student_year")
        .eq("id", uid)
        .maybeSingle();

      const { data: testData, error: testErr } = await supabase
        .from("meq_tests")
        .select(
          "id, subject, course_code, first_page_stem, vignette, time_limit_minutes, review_status, test_year, test_function",
        )
        .eq("id", testId)
        .maybeSingle();

      if (testErr || !testData) {
        if (isMounted) {
          setError(
            me?.role === "student"
              ? "This exam could not be loaded. Practice MEQ/SBA items must be approved; real exams only open from Test taking if an admin assigned them."
              : "Could not load this exam.",
          );
          setLoading(false);
        }
        return;
      }
      if (testData.review_status !== "approved") {
        if (isMounted) {
          setError("This exam is not available for students yet.");
          setLoading(false);
        }
        return;
      }
      const tf = (testData.test_function as "practice" | "real_test" | null) ?? "real_test";
      if (
        me?.role === "student" &&
        tf !== "practice" &&
        me.medical_student_year != null &&
        me.medical_student_year !== testData.test_year
      ) {
        if (isMounted) {
          setError("This test is not available for your year.");
          setLoading(false);
        }
        return;
      }

      const { data: stageData, error: stageErr } = await supabase
        .from("meq_test_stages")
        .select(
          `
          id, meq_test_id, sequence_order, time_limit_minutes, stage_information, question_text, media_urls,
          meq_stage_items ( id, sequence_order, question_text, media_urls )
        `,
        )
        .eq("meq_test_id", testId)
        .order("sequence_order", { ascending: true });

      if (stageErr) {
        if (isMounted) {
          setError(
            stageErr.message?.includes("meq_stage_items") || stageErr.code === "PGRST200"
              ? "Database needs migration 036 (MEQ stage items). Ask an admin to apply Supabase migrations."
              : "Could not load exam stages.",
          );
          setLoading(false);
        }
        return;
      }
      const rawStages = stageData || [];
      const st = buildStages(rawStages as DbStageRow[]);
      const flatItemIds = st.flatMap((s) => s.itemsSorted.map((i) => i.id));
      const stageIds = st.map((s) => s.id);
      const isPractice = testData.test_function === "practice";

      const nextDraft: Record<string, string> = {};
      let resMap: Record<string, SavedItemRow> = {};
      if (flatItemIds.length > 0) {
        const { data: existing, error: resErr } = await supabase
          .from("meq_stage_responses")
          .select("meq_stage_id, meq_stage_item_id, answer_text, status")
          .eq("user_id", uid)
          .in("meq_stage_item_id", flatItemIds);

        if (resErr) {
          const msg =
            resErr.code === "42703" ||
            resErr.message?.includes("meq_stage_item_id") ||
            resErr.message?.includes("column")
              ? "Database needs migration 036 before you can take this exam."
              : "Could not load saved answers.";
          if (isMounted) {
            setError(msg);
            setLoading(false);
          }
          return;
        }
        if (existing) {
          resMap = Object.fromEntries(
            existing.map((r) => [r.meq_stage_item_id, r as SavedItemRow] as const),
          );
          for (const row of existing) {
            if (row.answer_text != null) nextDraft[row.meq_stage_item_id] = row.answer_text;
          }
        }
      }

      let mergedOverallMin: number | null = testData.time_limit_minutes;
      if (!isPractice && assignmentId) {
        const { data: asgRow } = await supabase
          .from("staff_test_assignments")
          .select("exam_time_limit_minutes")
          .eq("id", assignmentId)
          .maybeSingle();
        const cap = asgRow?.exam_time_limit_minutes;
        if (cap != null && Number.isFinite(cap) && cap > 0) {
          mergedOverallMin = cap;
        }
      }

      let practicePrev: Record<string, string> = {};
      if (isPractice && stageIds.length > 0) {
        const { data: snaps } = await supabase
          .from("meq_practice_last_attempt")
          .select("meq_stage_id, answer_text")
          .eq("user_id", uid)
          .in("meq_stage_id", stageIds);
        if (snaps) {
          practicePrev = Object.fromEntries(
            snaps.map((r) => [r.meq_stage_id, r.answer_text ?? ""] as const),
          );
        }
      }

      if (isMounted) {
        setTest({
          id: testData.id,
          subject: testData.subject,
          course_code: testData.course_code,
          first_page_stem: testData.first_page_stem,
          vignette: testData.vignette,
          time_limit_minutes: mergedOverallMin,
          test_function: (testData.test_function as "practice" | "real_test" | null) ?? "real_test",
        });
        setStages(st);
        setByItemId(resMap);
        setDraftByItem(nextDraft);
        setLastPracticeByStage(practicePrev);
        if (allStagesComplete(st, resMap)) {
          setComplete(true);
        } else {
          examSessionStartRef.current = Date.now();
          setCurrentStageIndex(isPractice ? 0 : firstOpenStageIndex(st, resMap));
        }
        setLoading(false);
      }
    };

    void run();
    return () => {
      isMounted = false;
    };
  }, [testId, router, assignmentId]);

  const currentStage = stages[currentStageIndex];
  const isCurrentLocked = currentStage ? stageFullyLocked(currentStage, byItemId) : false;

  const interactionCtx = useMemo(
    () => ({
      meqTestId: testId,
      assignmentId,
      meqStageId: currentStage?.id ?? null,
      meqStageItemId: currentStage?.itemsSorted[0]?.id ?? null,
    }),
    [testId, assignmentId, currentStage?.id, currentStage?.itemsSorted],
  );

  useEffect(() => {
    if (!test || complete || loading || sessionLoggedRef.current) return;
    sessionLoggedRef.current = true;
    void appendMeqExamInteraction(interactionCtx, "session_started", {
      test_function: test.test_function,
    });
  }, [test, complete, loading, interactionCtx]);

  useEffect(() => {
    if (!test || !currentStage || complete) return;
    void appendMeqExamInteraction(interactionCtx, "stage_entered", {
      stage_index: currentStageIndex,
      sequence_order: currentStage.sequence_order,
    });
  }, [test, currentStage, currentStageIndex, complete, interactionCtx]);
  const stageTimeLimitMinutes = currentStage?.time_limit_minutes ?? null;

  const overallLimitMin = test?.time_limit_minutes ?? null;
  const elapsedSessionSeconds = useMemo(() => {
    if (examSessionStartRef.current == null) return 0;
    return Math.floor((Date.now() - examSessionStartRef.current) / 1000);
  }, [sessionTick]);

  const overallRemainingSeconds = useMemo(() => {
    if (overallLimitMin == null || overallLimitMin <= 0) return null;
    return Math.max(0, overallLimitMin * 60 - elapsedSessionSeconds);
  }, [overallLimitMin, elapsedSessionSeconds]);

  useEffect(() => {
    if (!currentStage) {
      setRemainingSeconds(null);
      return;
    }
    if (isCurrentLocked) {
      setRemainingSeconds(null);
      return;
    }
    if (stageTimeLimitMinutes == null || stageTimeLimitMinutes <= 0) {
      setRemainingSeconds(null);
      return;
    }
    setRemainingSeconds(stageTimeLimitMinutes * 60);
  }, [currentStage, stageTimeLimitMinutes, isCurrentLocked]);

  useEffect(() => {
    if (saving || isCurrentLocked || remainingSeconds == null || remainingSeconds <= 0) return;
    const interval = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev == null || prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [saving, isCurrentLocked, remainingSeconds]);

  useEffect(() => {
    if (complete || !test || allStagesComplete(stages, byItemId)) return;
    const id = window.setInterval(() => {
      setSessionTick((n) => n + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [complete, test, byItemId, stages]);

  const formatCountdown = (totalSeconds: number) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  };

  const handleSubmitAnswer = useCallback(
    async (forceSubmit = false) => {
      if (!currentStage) return;
      if (!userId) {
        setError("User not authenticated. Please log in again.");
        return;
      }

      if (isCurrentLocked) {
        if (currentStageIndex < stages.length - 1) {
          setCurrentStageIndex((i) => i + 1);
        } else {
          setComplete(true);
        }
        return;
      }

      const itemsLocal = currentStage.itemsSorted;
      if (itemsLocal.length === 0) {
        setError("This stage has no questions configured.");
        return;
      }

      for (let i = 0; i < itemsLocal.length; i++) {
        const it = itemsLocal[i]!;
        const text = (draftByItem[it.id] ?? "").trim();
        if (!forceSubmit && !text) {
          setError(
            `Please answer every part before submitting (missing part ${i + 1} of ${itemsLocal.length}).`,
          );
          return;
        }
      }

      setSaving(true);
      setError(null);

      const rows = itemsLocal.map((it) => ({
        meq_stage_id: currentStage.id,
        meq_stage_item_id: it.id,
        user_id: userId,
        answer_text: (draftByItem[it.id] ?? "").trim() || null,
        status: "locked" as const,
        human_override_score: null,
        ai_rationale_feedback: null,
        graded_by: null,
        graded_at: null,
        grading_history: [] as unknown[],
      }));

      const { error: saveError } = await supabase.from("meq_stage_responses").upsert(rows, {
        onConflict: "user_id,meq_stage_item_id",
      });

      if (saveError) {
        setError(
          saveError.message?.includes("grading_history")
            ? "Database needs migration 036 (grading_history column). Ask an admin to apply migrations."
            : "Failed to save your answer. Please try again.",
        );
        setSaving(false);
        return;
      }

      setByItemId((prev) => {
        const next = { ...prev };
        for (const it of itemsLocal) {
          next[it.id] = {
            meq_stage_id: currentStage.id,
            meq_stage_item_id: it.id,
            answer_text: (draftByItem[it.id] ?? "").trim() || null,
            status: "locked",
          };
        }
        return next;
      });
      setSaving(false);

      void appendMeqExamInteraction(
        {
          meqTestId: testId,
          assignmentId,
          meqStageId: currentStage.id,
          meqStageItemId: itemsLocal[0]?.id ?? null,
        },
        forceSubmit ? "auto_submit_stage" : "stage_locked",
        {
          stage_index: currentStageIndex,
          item_count: itemsLocal.length,
        },
        interactionSeqRef.current(),
      );

      if (currentStageIndex === stages.length - 1) {
        setComplete(true);
        return;
      }
      setCurrentStageIndex((i) => i + 1);
    },
    [
      currentStage,
      userId,
      isCurrentLocked,
      currentStageIndex,
      stages.length,
      draftByItem,
      testId,
      assignmentId,
    ],
  );

  useEffect(() => {
    if (!currentStage || isCurrentLocked || saving) return;
    if (remainingSeconds == null || remainingSeconds > 0) return;
    if (assignmentId) {
      void logExamProctorEvent({
        assignmentId,
        testKind: "meq",
        testId,
        eventType: "auto_submit_stage",
        detail: { stage_index: currentStageIndex },
      });
    }
    void handleSubmitAnswer(true);
  }, [
    remainingSeconds,
    currentStage,
    isCurrentLocked,
    saving,
    handleSubmitAnswer,
    assignmentId,
    testId,
    currentStageIndex,
  ]);

  const handleOverallExpiry = useCallback(async () => {
    if (!userId || stages.length === 0 || complete) return;
    setSaving(true);
    setError(null);

    const rows = stages.flatMap((stage) =>
      stage.itemsSorted.map((it) => ({
        meq_stage_id: stage.id,
        meq_stage_item_id: it.id,
        user_id: userId,
        answer_text: (draftByItem[it.id] ?? "").trim() || null,
        status: "locked" as const,
        human_override_score: null,
        ai_rationale_feedback: null,
        graded_by: null,
        graded_at: null,
        grading_history: [] as unknown[],
      })),
    );

    const toUpsert = rows.filter((r) => byItemId[r.meq_stage_item_id]?.status !== "locked");
    if (toUpsert.length > 0) {
      const { error: saveError } = await supabase.from("meq_stage_responses").upsert(toUpsert, {
        onConflict: "user_id,meq_stage_item_id",
      });
      if (saveError) {
        setError("Overall time elapsed but answers could not be saved. Contact your instructor.");
        setSaving(false);
        return;
      }
    }

    setByItemId((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        next[r.meq_stage_item_id] = {
          meq_stage_id: r.meq_stage_id,
          meq_stage_item_id: r.meq_stage_item_id,
          answer_text: r.answer_text,
          status: "locked",
        };
      }
      return next;
    });
    if (assignmentId) {
      void logExamProctorEvent({
        assignmentId,
        testKind: "meq",
        testId,
        eventType: "auto_submit_overall",
      });
    }
    void appendMeqExamInteraction(
      { meqTestId: testId, assignmentId },
      "auto_submit_overall",
      {},
      interactionSeqRef.current(),
    );
    setComplete(true);
    setSaving(false);
  }, [userId, stages, complete, draftByItem, byItemId, assignmentId, testId]);

  useEffect(() => {
    if (complete || !test || overallRemainingSeconds == null) return;
    if (overallRemainingSeconds > 0) return;
    if (overallAutoSubmitFiredRef.current) return;
    overallAutoSubmitFiredRef.current = true;
    void handleOverallExpiry();
  }, [overallRemainingSeconds, complete, test, handleOverallExpiry]);

  const isPractice = test?.test_function === "practice";

  const handleRetake = async () => {
    if (!stages.length || !userId || !isPractice) return;
    setSaving(true);
    setError(null);
    const stageIds = stages.map((s) => s.id);

    const archiveRows = stages
      .map((s) => {
        const snap = serializePracticeAnswers(s, draftByItem);
        if (!snap?.trim()) return null;
        return {
          user_id: userId,
          meq_stage_id: s.id,
          answer_text: snap,
          captured_at: new Date().toISOString(),
        };
      })
      .filter(Boolean) as {
      user_id: string;
      meq_stage_id: string;
      answer_text: string | null;
      captured_at: string;
    }[];

    if (archiveRows.length > 0) {
      const { error: snapErr } = await supabase.from("meq_practice_last_attempt").upsert(archiveRows, {
        onConflict: "user_id,meq_stage_id",
      });
      if (snapErr) {
        setError(
          snapErr.message.includes("does not exist") || snapErr.message.includes("relation")
            ? "Database not updated yet (run migration 020). Cannot archive practice answers."
            : "Could not save your previous attempt for reference.",
        );
        setSaving(false);
        return;
      }
    }

    const nextPrev: Record<string, string> = { ...lastPracticeByStage };
    for (const r of archiveRows) {
      if (r.answer_text) nextPrev[r.meq_stage_id] = r.answer_text;
    }

    const { error: delErr } = await supabase
      .from("meq_stage_responses")
      .delete()
      .eq("user_id", userId)
      .in("meq_stage_id", stageIds);
    if (delErr) {
      setError(
        delErr.message.includes("policy") || delErr.code === "42501"
          ? "Retake is only allowed for practice tests (or apply migration 020)."
          : "Could not reset your attempt. Please try again.",
      );
      setSaving(false);
      return;
    }
    const stage0 = stages[0];
    const stage0InitialSeconds =
      stage0?.time_limit_minutes != null && stage0.time_limit_minutes > 0
        ? stage0.time_limit_minutes * 60
        : null;

    setLastPracticeByStage(nextPrev);
    setByItemId({});
    setDraftByItem({});
    setCurrentStageIndex(0);
    setComplete(false);
    setRemainingSeconds(stage0InitialSeconds);
    examSessionStartRef.current = Date.now();
    setSessionTick((n) => n + 1);
    setSaving(false);
  };

  const secureExam = !!assignmentId;
  const examShellTitle = test?.subject ? `${test.subject} (MEQ)` : "MEQ exam";
  const isRealTest = test?.test_function !== "practice";

  const wrapExam = (content: ReactNode) => (
    <RealTestExamShell
      kind="meq"
      testId={testId}
      secureExam={secureExam}
      finished={complete}
      title={examShellTitle}
    >
      {content}
    </RealTestExamShell>
  );

  if (loading) {
    return wrapExam(
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center">
          <svg
            className="animate-spin h-8 w-8 text-blue-900 mb-3"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-30" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <span className="text-blue-800 text-lg font-medium">Loading exam...</span>
        </div>
      </div>,
    );
  }

  if (error && !test) {
    return wrapExam(
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="bg-red-50 text-red-700 border border-red-300 px-6 py-4 rounded-lg text-lg font-semibold shadow">
          {error}
        </div>
      </div>,
    );
  }

  if (complete) {
    return wrapExam(
      <div className="min-h-screen flex flex-col items-center justify-center bg-white">
        <div className="bg-green-50 border border-green-300 rounded-lg shadow p-8 max-w-md text-center">
          <h2 className="text-2xl font-bold text-green-800 mb-2">Congratulations!</h2>
          <p className="text-green-900 text-lg mb-4">You have completed the MEQ exam.</p>
          <span className="inline-block text-green-700 font-semibold">
            Thank you for submitting your responses.
          </span>
          {test?.test_function === "practice" ? (
            <div className="mt-6 space-y-3">
              <button
                type="button"
                disabled
                className="w-full border border-dashed border-slate-400 text-slate-600 font-semibold px-5 py-3 rounded-lg bg-slate-100 cursor-not-allowed text-sm"
                title="Trainer model not selected yet; this will call your institution's AI endpoint when ready."
              >
                Request AI score (trained model) — coming soon
              </button>
              <button
                type="button"
                onClick={() => void handleRetake()}
                disabled={saving}
                className="w-full bg-blue-800 text-white px-5 py-2 rounded-lg font-semibold hover:bg-blue-900 disabled:opacity-60"
              >
                {saving ? "Resetting..." : "Retake (practice) — previous answers kept beside next attempt"}
              </button>
            </div>
          ) : (
            <>
              <p className="mt-6 text-sm text-gray-600">
                This is a formal exam: one submission only — retake is not available.
              </p>
              <RealTestCompleteActions isRealTest={isRealTest} />
            </>
          )}
        </div>
      </div>,
    );
  }

  if (!test || !currentStage) {
    return wrapExam(
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-gray-600">No stages configured for this exam.</span>
      </div>,
    );
  }

  const items = currentStage.itemsSorted;
  const practiceSnapRaw = lastPracticeByStage[currentStage.id];
  const practicePartsDecoded =
    practiceSnapRaw && items.length ? deserializePracticePrev(practiceSnapRaw, items) : null;

  return wrapExam(
    <div className="min-h-screen bg-white flex flex-col">
      <header className="w-full border-b border-gray-200 px-6 py-6 shadow-sm">
        <h1 className="text-3xl font-bold text-blue-800 tracking-tight">
          {test.subject} <span className="text-lg font-medium text-gray-500">({test.course_code})</span>
          {test.test_function === "practice" ? (
            <span className="ml-2 text-sm font-semibold text-orange-900 bg-orange-200 px-2 py-0.5 rounded">
              Practice
            </span>
          ) : (
            <span className="ml-2 text-sm font-semibold text-slate-800 bg-slate-200 px-2 py-0.5 rounded">
              Real test
            </span>
          )}
        </h1>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium">
          <span className="text-gray-800">
            Time on this exam:{" "}
            <span className="tabular-nums text-blue-900">{formatCountdown(elapsedSessionSeconds)}</span>
          </span>
          {overallRemainingSeconds != null ? (
            <span className="text-gray-800">
              Overall time remaining:{" "}
              <span
                className={`tabular-nums ${
                  overallRemainingSeconds <= 120 ? "text-red-600 font-semibold" : "text-blue-900"
                }`}
              >
                {formatCountdown(overallRemainingSeconds)}
              </span>
              <span className="text-gray-500 font-normal ml-1">({test.time_limit_minutes} min test)</span>
            </span>
          ) : null}
        </div>
      </header>

      <main className="flex-1 w-full max-w-xl mx-auto mt-8 px-4 pb-36 flex flex-col gap-8">
        <section className="bg-blue-100 border border-blue-300 rounded-xl shadow-sm p-6 mb-2 space-y-3">
          {test.first_page_stem ? (
            <p className="text-gray-800 text-base whitespace-pre-line">{test.first_page_stem}</p>
          ) : null}
          {test.vignette ? <p className="text-gray-900 text-base whitespace-pre-line">{test.vignette}</p> : null}
        </section>

        <section className="bg-white border border-gray-100 rounded-xl shadow px-6 py-8 flex flex-col gap-4">
          <p className="text-xs text-gray-500 -mt-1">
            Stage timers stay visible at the bottom of your screen while you scroll. This stage may include multiple
            related questions answered together.
          </p>
          {!isCurrentLocked &&
          stageTimeLimitMinutes != null &&
          stageTimeLimitMinutes > 0 ? (
            <p className="text-sm text-blue-900 font-medium -mt-1">
              This stage: {stageTimeLimitMinutes}-minute countdown (starts as soon as you reach this open stage;
              see the bar at the bottom).
            </p>
          ) : null}

          {currentStage.stage_information ? (
            <div className="text-base text-gray-800 whitespace-pre-line border-l-2 border-blue-400 pl-3 mb-2">
              {currentStage.stage_information}
            </div>
          ) : null}

          {items.map((item, ii) => {
            const pid = `meq-${item.id}`;
            return (
              <div key={item.id} className="border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
                <div className="text-base font-semibold text-slate-800 mb-1">
                  {items.length > 1 ? `Part ${ii + 1} of ${items.length}` : "Question"}
                </div>
                <div className="text-lg font-medium text-gray-900 mb-2 whitespace-pre-line">
                  {item.question_text}
                </div>
                {item.media_urls && item.media_urls.length > 0 ? (
                  <div className="mb-3">
                    {/\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(item.media_urls[0]!) ? (
                      <img
                        src={item.media_urls[0]!}
                        alt="Question media"
                        className="rounded-lg max-h-64 w-auto mx-auto shadow"
                      />
                    ) : /^.*\.(mp4|webm|ogg)(\?|#|$)/i.test(item.media_urls[0]!) ? (
                      <video
                        src={item.media_urls[0]!}
                        controls
                        className="rounded-lg max-h-64 w-full mx-auto shadow"
                      />
                    ) : (
                      <a
                        href={item.media_urls[0]!}
                        className="text-blue-700 underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View media
                      </a>
                    )}
                  </div>
                ) : null}
                <div
                  className={
                    test.test_function === "practice" &&
                    practicePartsDecoded &&
                    Object.keys(practicePartsDecoded).length > 0
                      ? "grid grid-cols-1 lg:grid-cols-2 gap-4"
                      : ""
                  }
                >
                  <div>
                    <label htmlFor={pid} className="block text-base font-semibold text-gray-700 mb-1">
                      Your answer{items.length > 1 ? ` (part ${ii + 1})` : ""}
                    </label>
                    <textarea
                      id={pid}
                      className="w-full px-4 py-3 border border-blue-400 rounded-md shadow focus:outline-none focus:ring-2 focus:ring-blue-500 text-base bg-white placeholder-blue-300 resize-y min-h-[120px] disabled:opacity-70"
                      placeholder="Type your answer here…"
                      value={draftByItem[item.id] ?? ""}
                      onChange={(e) =>
                        setDraftByItem((d) => ({
                          ...d,
                          [item.id]: e.target.value,
                        }))
                      }
                      disabled={saving || isCurrentLocked}
                      readOnly={isCurrentLocked}
                    />
                  </div>
                  {test.test_function === "practice" && practiceSnapRaw ? (
                    <div className="rounded-md border border-orange-300 bg-orange-100 p-4 text-sm">
                      <div className="font-semibold text-orange-950 mb-2">Previous attempt (reference)</div>
                      {practicePartsDecoded && practicePartsDecoded[item.id]?.trim() ? (
                        <div className="text-gray-800 whitespace-pre-wrap font-mono text-sm">
                          {practicePartsDecoded[item.id]}
                        </div>
                      ) : !practicePartsDecoded && ii === 0 ? (
                        <div className="text-gray-800 whitespace-pre-wrap font-mono text-sm">{practiceSnapRaw}</div>
                      ) : practicePartsDecoded && !practicePartsDecoded[item.id]?.trim() ? (
                        <span className="text-gray-500 italic text-xs">(No saved text for this part)</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}

          {error ? (
            <div className="bg-red-50 text-red-700 border border-red-300 px-4 py-2 rounded text-base font-medium mb-2">
              {error}
            </div>
          ) : null}

          <button
            className={`mt-4 bg-blue-800 text-white text-lg font-semibold px-8 py-4 rounded-lg shadow hover:bg-blue-900 transition border border-blue-800
              ${saving ? "opacity-60 cursor-not-allowed" : ""}
            `}
            onClick={() => void handleSubmitAnswer(false)}
            disabled={saving}
            type="button"
          >
            {isCurrentLocked
              ? currentStageIndex === stages.length - 1
                ? "Finish"
                : "Continue"
              : saving
                ? "Submitting…"
                : currentStageIndex === stages.length - 1
                  ? "Submit answers and finish"
                  : "Submit answers for this stage and continue"}
          </button>
        </section>
      </main>

      <div
        className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 bg-gradient-to-t from-white via-white to-transparent"
        aria-live="polite"
        aria-label="Exam timers"
      >
        <div className="pointer-events-auto w-full max-w-xl rounded-t-xl border border-blue-200 bg-white/95 backdrop-blur-md shadow-[0_-4px_24px_rgba(15,23,42,0.12)] px-4 py-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
            <div className="text-sm font-semibold text-blue-900">
              Stage {currentStageIndex + 1} of {stages.length}
              {items.length > 1 ? (
                <span className="font-normal text-slate-700"> · {items.length} questions together</span>
              ) : null}
              {isCurrentLocked ? <span className="font-normal text-slate-600"> — submitted</span> : null}
            </div>
            <div className="text-sm font-semibold text-gray-800 sm:text-right">
              {isCurrentLocked ? (
                <span className="font-normal text-gray-700 text-sm">
                  <span className="text-gray-600 font-medium">This stage: </span>
                  <span className="text-slate-900 font-semibold">submitted</span>
                  {stageTimeLimitMinutes != null && stageTimeLimitMinutes > 0 ? (
                    <span className="block sm:inline sm:ml-1 text-xs text-gray-500 font-normal">
                      (when you can edit again, {stageTimeLimitMinutes} min countdown)
                    </span>
                  ) : null}
                </span>
              ) : remainingSeconds != null ? (
                <>
                  <span className="text-gray-600 font-medium">This stage: </span>
                  <span
                    className={`tabular-nums text-base ${
                      remainingSeconds <= 30 ? "text-red-600 font-bold" : "text-blue-800"
                    }`}
                  >
                    {formatCountdown(remainingSeconds)}
                  </span>
                  {stageTimeLimitMinutes != null && stageTimeLimitMinutes > 0 ? (
                    <span className="block text-xs text-gray-500 font-normal mt-0.5 sm:mt-0">
                      of {stageTimeLimitMinutes} min for this stage
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="font-normal text-gray-600 text-sm">
                  No per-stage timer — use exam clocks below.
                </span>
              )}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 border-t border-slate-100 pt-2">
            <span>
              Time on exam:{" "}
              <span className="tabular-nums font-semibold text-slate-800">
                {formatCountdown(elapsedSessionSeconds)}
              </span>
            </span>
            {overallRemainingSeconds != null ? (
              <span>
                Overall left:{" "}
                <span
                  className={`tabular-nums font-semibold ${
                    overallRemainingSeconds <= 120 ? "text-red-600" : "text-slate-800"
                  }`}
                >
                  {formatCountdown(overallRemainingSeconds)}
                </span>
                {test.time_limit_minutes != null ? (
                  <span className="text-gray-500 font-normal"> ({test.time_limit_minutes} min)</span>
                ) : null}
              </span>
            ) : (
              <span className="text-gray-500">No overall time cap on this exam.</span>
            )}
          </div>
        </div>
      </div>
    </div>,
  );
}
