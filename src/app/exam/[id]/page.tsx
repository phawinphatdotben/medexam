"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type MeqTest = {
  id: string;
  subject: string;
  course_code: string;
  first_page_stem: string;
  vignette: string;
  time_limit_minutes: number | null;
  test_function: "practice" | "real_test";
};

type Stage = {
  id: string;
  meq_test_id: string;
  sequence_order: number;
  time_limit_minutes: number | null;
  stage_information: string | null;
  question_text: string;
  media_urls: string[] | null;
};

type ResponseRow = {
  meq_stage_id: string;
  answer_text: string | null;
  status: string;
};

export default function StudentMeqExamPage() {
  const { id: testId } = useParams<{ id: string }>();
  const router = useRouter();
  const [test, setTest] = useState<MeqTest | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [byStage, setByStage] = useState<Record<string, ResponseRow | undefined>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [saving, setSaving] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const examSessionStartRef = useRef<number | null>(null);
  const [sessionTick, setSessionTick] = useState(0);
  const [lastPracticeByStage, setLastPracticeByStage] = useState<Record<string, string>>({});

  const allLocked = useCallback(
    (rows: Record<string, ResponseRow | undefined>, st: Stage[]) =>
      st.length > 0 && st.every((s) => rows[s.id]?.status === "locked"),
    []
  );

  const firstOpenIndex = useCallback(
    (st: Stage[], rows: Record<string, ResponseRow | undefined>) => {
      const i = st.findIndex((s) => rows[s.id]?.status !== "locked");
      return i === -1 ? 0 : i;
    },
    []
  );

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
          "id, subject, course_code, first_page_stem, vignette, time_limit_minutes, review_status, test_year, test_function"
        )
        .eq("id", testId)
        .maybeSingle();

      if (testErr || !testData) {
        if (isMounted) {
          setError(
            me?.role === "student"
              ? "This exam could not be loaded. Practice MEQ/SBA items must be approved; real exams only open from your Test session if an admin assigned them."
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
      if (me?.role === "student" && me.medical_student_year != null && me.medical_student_year !== testData.test_year) {
        if (isMounted) {
          setError("This test is not available for your year.");
          setLoading(false);
        }
        return;
      }

      const { data: stageData, error: stageErr } = await supabase
        .from("meq_test_stages")
        .select(
          "id, meq_test_id, sequence_order, time_limit_minutes, stage_information, question_text, media_urls"
        )
        .eq("meq_test_id", testId)
        .order("sequence_order", { ascending: true });

      if (stageErr) {
        if (isMounted) {
          setError("Could not load exam stages.");
          setLoading(false);
        }
        return;
      }
      const st = stageData || [];
      const stageIds = st.map((s) => s.id);
      const isPractice = testData.test_function === "practice";

      let resMap: Record<string, ResponseRow> = {};
      if (stageIds.length > 0) {
        const { data: existing, error: resErr } = await supabase
          .from("meq_stage_responses")
          .select("meq_stage_id, answer_text, status")
          .eq("user_id", uid)
          .in("meq_stage_id", stageIds);
        if (!resErr && existing) {
          resMap = Object.fromEntries(
            existing.map((r) => [r.meq_stage_id, r as ResponseRow] as const)
          );
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
            snaps.map((r) => [r.meq_stage_id, r.answer_text ?? ""] as const)
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
          time_limit_minutes: testData.time_limit_minutes,
          test_function: (testData.test_function as "practice" | "real_test" | null) ?? "real_test",
        });
        setStages(st);
        setByStage(resMap);
        setLastPracticeByStage(practicePrev);
        if (allLocked(resMap, st)) {
          setComplete(true);
        } else {
          examSessionStartRef.current = Date.now();
          setCurrentStageIndex(firstOpenIndex(st, resMap));
        }
        setLoading(false);
      }
    };

    void run();
    return () => {
      isMounted = false;
    };
  }, [testId, router, allLocked, firstOpenIndex]);

  const currentStage = stages[currentStageIndex];
  const currentSaved = currentStage ? byStage[currentStage.id] : undefined;
  const isCurrentLocked = currentSaved?.status === "locked";
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

  // Keep textarea in sync with stage and saved state
  useEffect(() => {
    if (currentStage) {
      setCurrentAnswer(byStage[currentStage.id]?.answer_text ?? "");
    }
  }, [currentStage, byStage, currentStageIndex]);

  // Reset per-stage countdown whenever the active stage changes.
  useEffect(() => {
    if (!currentStage) {
      setRemainingSeconds(null);
      return;
    }
    if (isCurrentLocked) {
      setRemainingSeconds(0);
      return;
    }
    if (stageTimeLimitMinutes == null || stageTimeLimitMinutes <= 0) {
      setRemainingSeconds(null);
      return;
    }
    setRemainingSeconds(stageTimeLimitMinutes * 60);
  }, [currentStage, stageTimeLimitMinutes, isCurrentLocked]);

  // Tick down once per second while this stage is active and unlocked.
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

  // Session clock: elapsed always; drives re-render for overall countdown.
  useEffect(() => {
    if (complete || !test || allLocked(byStage, stages)) return;
    const id = window.setInterval(() => {
      setSessionTick((n) => n + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [complete, test, byStage, stages, allLocked]);

  const formatCountdown = (totalSeconds: number) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  };

  const handleSubmitAnswer = async (forceSubmit = false) => {
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

    const answerText = currentAnswer.trim();
    if (!forceSubmit && !answerText) {
      setError("Please enter your answer before submitting.");
      return;
    }

    setSaving(true);
    setError(null);

    const { error: saveError } = await supabase.from("meq_stage_responses").upsert(
      {
        meq_stage_id: currentStage.id,
        user_id: userId,
        answer_text: answerText || null,
        status: "locked" as const,
        // New attempt replaces old graded result; latest submission is source of truth.
        human_override_score: null,
        ai_rationale_feedback: null,
      },
      { onConflict: "user_id,meq_stage_id" }
    );

    if (saveError) {
      setError("Failed to save your answer. Please try again.");
      setSaving(false);
      return;
    }

    const next = {
      ...byStage,
      [currentStage.id]: {
        meq_stage_id: currentStage.id,
        answer_text: answerText,
        status: "locked",
      },
    };
    setByStage(next);
    setSaving(false);
    setRemainingSeconds(0);

    if (currentStageIndex === stages.length - 1) {
      setComplete(true);
      return;
    }
    setCurrentStageIndex((i) => i + 1);
  };

  // Auto-submit when the stage timer reaches zero.
  useEffect(() => {
    if (!currentStage || isCurrentLocked || saving) return;
    if (remainingSeconds !== 0) return;
    void handleSubmitAnswer(true);
  }, [remainingSeconds, currentStage, isCurrentLocked, saving]);

  const isPractice = test?.test_function === "practice";

  const handleRetake = async () => {
    if (!stages.length || !userId || !isPractice) return;
    setSaving(true);
    setError(null);
    const stageIds = stages.map((s) => s.id);

    const archiveRows = stages
      .map((s) => {
        const row = byStage[s.id];
        if (!row?.answer_text?.trim()) return null;
        return {
          user_id: userId,
          meq_stage_id: s.id,
          answer_text: row.answer_text,
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
            : "Could not save your previous attempt for reference."
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
          : "Could not reset your attempt. Please try again."
      );
      setSaving(false);
      return;
    }
    setLastPracticeByStage(nextPrev);
    setByStage({});
    setCurrentStageIndex(0);
    setCurrentAnswer("");
    setComplete(false);
    examSessionStartRef.current = Date.now();
    setSessionTick((n) => n + 1);
    setSaving(false);
  };

  if (loading) {
    return (
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
      </div>
    );
  }

  if (error && !test) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="bg-red-50 text-red-700 border border-red-300 px-6 py-4 rounded-lg text-lg font-semibold shadow">
          {error}
        </div>
      </div>
    );
  }

  if (complete) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white">
        <div className="bg-green-50 border border-green-300 rounded-lg shadow p-8 max-w-md text-center">
          <h2 className="text-2xl font-bold text-green-800 mb-2">Congratulations!</h2>
          <p className="text-green-900 text-lg mb-4">You have completed the MEQ exam.</p>
          <span className="inline-block text-green-700 font-semibold">
            Thank you for submitting your responses.
          </span>
          {test?.test_function === "practice" ? (
            <div className="mt-6">
              <button
                type="button"
                onClick={() => void handleRetake()}
                disabled={saving}
                className="bg-blue-800 text-white px-5 py-2 rounded-lg font-semibold hover:bg-blue-900 disabled:opacity-60"
              >
                {saving ? "Resetting..." : "Retake (practice) — previous answers kept beside next attempt"}
              </button>
            </div>
          ) : (
            <p className="mt-6 text-sm text-gray-600">
              This is a formal exam: one submission only — retake is not available.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!test || !currentStage) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-gray-600">No stages configured for this exam.</span>
      </div>
    );
  }

  return (
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

      <main className="flex-1 w-full max-w-xl mx-auto mt-8 px-4 flex flex-col gap-8">
        <section className="bg-blue-100 border border-blue-300 rounded-xl shadow-sm p-6 mb-2 space-y-3">
          {test.first_page_stem ? (
            <p className="text-gray-800 text-base whitespace-pre-line">{test.first_page_stem}</p>
          ) : null}
          {test.vignette ? <p className="text-gray-900 text-base whitespace-pre-line">{test.vignette}</p> : null}
        </section>

        <section className="bg-white border border-gray-100 rounded-xl shadow px-6 py-8 flex flex-col gap-4">
          <div className="text-sm text-blue-900 mb-2 font-semibold">
            Stage {currentStageIndex + 1} of {stages.length}
            {isCurrentLocked ? " — submitted" : ""}
          </div>
          <div className="text-sm font-semibold text-gray-700">
            {remainingSeconds != null ? (
              <>
                Time left for this stage:{" "}
                <span className={`tabular-nums ${remainingSeconds <= 30 ? "text-red-600" : "text-blue-800"}`}>
                  {formatCountdown(remainingSeconds)}
                </span>
              </>
            ) : (
              <span className="font-normal text-gray-600">
                This stage has no countdown — use the exam clock above.
              </span>
            )}
          </div>

          {currentStage.stage_information ? (
            <div className="text-base text-gray-800 whitespace-pre-line border-l-2 border-blue-400 pl-3 mb-2">
              {currentStage.stage_information}
            </div>
          ) : null}
          <div className="text-xl font-medium text-gray-900 mb-2 whitespace-pre-line">
            {currentStage.question_text}
          </div>

          {currentStage.media_urls && currentStage.media_urls.length > 0 ? (
            <div className="mb-3">
              {/\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(currentStage.media_urls[0]!) ? (
                <img
                  src={currentStage.media_urls[0]!}
                  alt="Stage media"
                  className="rounded-lg max-h-64 w-auto mx-auto shadow"
                />
              ) : /^.*\.(mp4|webm|ogg)(\?|#|$)/i.test(currentStage.media_urls[0]!) ? (
                <video
                  src={currentStage.media_urls[0]!}
                  controls
                  className="rounded-lg max-h-64 w-full mx-auto shadow"
                />
              ) : (
                <a
                  href={currentStage.media_urls[0]!}
                  className="text-blue-700 underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View media
                </a>
              )}
            </div>
          ) : null}

          <label htmlFor="stage-answer" className="block text-base font-semibold text-gray-700 mb-1">
            Your answer
          </label>
          <div
            className={
              test.test_function === "practice" && lastPracticeByStage[currentStage.id]
                ? "grid grid-cols-1 lg:grid-cols-2 gap-4"
                : ""
            }
          >
            <textarea
              id="stage-answer"
              className="w-full px-4 py-3 border border-blue-400 rounded-md shadow focus:outline-none focus:ring-2 focus:ring-blue-500 text-base bg-white placeholder-blue-300 resize-y min-h-[160px] disabled:opacity-70"
              placeholder="Type your answer here…"
              value={currentAnswer}
              onChange={(e) => setCurrentAnswer(e.target.value)}
              disabled={saving || isCurrentLocked}
              readOnly={isCurrentLocked}
            />
            {test.test_function === "practice" && lastPracticeByStage[currentStage.id] ? (
              <div className="rounded-md border border-orange-300 bg-orange-100 p-4 text-sm">
                <div className="font-semibold text-orange-950 mb-2">Previous attempt (reference)</div>
                <div className="text-gray-800 whitespace-pre-wrap font-mono text-sm">
                  {lastPracticeByStage[currentStage.id]}
                </div>
              </div>
            ) : null}
          </div>

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
            disabled={saving || (!isCurrentLocked && currentAnswer.trim() === "")}
            type="button"
          >
            {isCurrentLocked
              ? currentStageIndex === stages.length - 1
                ? "Finish"
                : "Continue"
              : saving
                ? "Submitting…"
                : currentStageIndex === stages.length - 1
                  ? "Submit final answer and finish"
                  : "Submit answer and continue"}
          </button>
        </section>
      </main>
    </div>
  );
}
