"use client";

import { useEffect, useState, useCallback, useRef, useMemo, type ReactNode } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { RealTestCompleteActions } from "@/components/exam/RealTestCompleteActions";
import { RealTestExamShell } from "@/components/exam/RealTestExamShell";
import { logExamProctorEvent } from "@/lib/exam/examProctor";

type SbaTest = {
  id: string;
  subject: string;
  subject_code: string;
  review_status: string;
  test_year: number;
  test_function: "practice" | "real_test";
  time_limit_minutes: number | null;
};

type SbaOption = { id: string; text: string };

type Question = {
  id: string;
  sba_test_id: string;
  sequence_order: number;
  stem: string;
  image_url: string | null;
  options: SbaOption[] | null;
  correct_option_id: string | null;
};

type AnswersMap = Record<string, string | undefined>;

export default function StudentSbaExamPage() {
  const { id: testId } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const assignmentId = searchParams.get("assignment")?.trim() || null;

  const [test, setTest] = useState<SbaTest | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<AnswersMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const sessionStartRef = useRef<number | null>(null);
  const overallAutoSubmitFiredRef = useRef(false);
  const [sessionTick, setSessionTick] = useState(0);
  const [lastPracticeByQuestion, setLastPracticeByQuestion] = useState<Record<string, string>>({});
  const [overallExpired, setOverallExpired] = useState(false);

  useEffect(() => {
    let m = true;
    const run = async () => {
      setLoading(true);
      setError(null);

      const { data: userData, error: uerr } = await supabase.auth.getUser();
      if (uerr || !userData.user) {
        if (m) {
          setLoading(false);
          router.replace("/login");
        }
        return;
      }
      if (m) setUserId(userData.user.id);
      const { data: me } = await supabase
        .from("profiles")
        .select("role, medical_student_year")
        .eq("id", userData.user.id)
        .maybeSingle();

      const { data: t, error: terr } = await supabase
        .from("sba_tests")
        .select("id, subject, subject_code, review_status, test_year, test_function, time_limit_minutes")
        .eq("id", testId)
        .maybeSingle();
      if (terr || !t) {
        if (m) {
          setError(
            me?.role === "student"
              ? "This test could not be loaded. Practice items must be approved; real exams open from Test taking when assigned."
              : "Could not load this test.",
          );
          setLoading(false);
        }
        return;
      }
      if (t.review_status !== "approved") {
        if (m) {
          setError("This test is not available for students yet.");
          setLoading(false);
        }
        return;
      }
      if (
        me?.role === "student" &&
        t.test_function !== "practice" &&
        me.medical_student_year != null &&
        me.medical_student_year !== t.test_year
      ) {
        if (m) {
          setError("This test is not available for your year.");
          setLoading(false);
        }
        return;
      }

      const tfVal = (t.test_function as "practice" | "real_test" | null) ?? "real_test";
      const isPracticeTf = tfVal === "practice";
      let mergedTl: number | null = t.time_limit_minutes ?? null;
      if (!isPracticeTf && assignmentId) {
        const { data: asgRow } = await supabase
          .from("staff_test_assignments")
          .select("exam_time_limit_minutes")
          .eq("id", assignmentId)
          .maybeSingle();
        const cap = asgRow?.exam_time_limit_minutes;
        if (cap != null && Number.isFinite(cap) && cap > 0) {
          mergedTl = cap;
        }
      }

      const { data: qrows, error: qerr } = await supabase
        .from("sba_test_questions")
        .select("id, sba_test_id, sequence_order, stem, image_url, options, correct_option_id")
        .eq("sba_test_id", testId)
        .order("sequence_order", { ascending: true });
      if (qerr) {
        if (m) {
          setError("Could not load questions.");
          setLoading(false);
        }
        return;
      }
      const qlist = (qrows as Question[]) || [];
      const qids = qlist.map((q) => q.id);
      let practicePrev: Record<string, string> = {};
      if (t.test_function === "practice" && qids.length > 0) {
        const { data: snaps } = await supabase
          .from("sba_practice_last_attempt")
          .select("sba_test_question_id, selected_option_id")
          .eq("user_id", userData.user.id)
          .in("sba_test_question_id", qids);
        if (snaps) {
          practicePrev = Object.fromEntries(snaps.map((r) => [r.sba_test_question_id, r.selected_option_id]));
        }
      }

      if (m) {
        setTest({
          ...t,
          time_limit_minutes: mergedTl,
          test_function: (t.test_function as "practice" | "real_test" | null) ?? "real_test",
        });
        setQuestions(qlist);
        setLastPracticeByQuestion(practicePrev);
        sessionStartRef.current = Date.now();
        setLoading(false);
      }
    };
    void run();
    return () => {
      m = false;
    };
  }, [testId, router, assignmentId]);

  const setOne = (qid: string, optionId: string) => {
    setAnswers((prev) => ({ ...prev, [qid]: optionId }));
  };

  const submit = useCallback(async (opts?: { forceTimer?: boolean }) => {
    if (!userId) {
      setError("You are not signed in.");
      return;
    }
    const timedOut =
      opts?.forceTimer ||
      (overallExpired && test?.time_limit_minutes != null && test.time_limit_minutes > 0);
    const allowIncomplete = timedOut;
    if (!allowIncomplete) {
      for (const q of questions) {
        if (!answers[q.id]?.trim()) {
          setError("Select an answer for every question.");
          return;
        }
      }
    } else if (!opts?.forceTimer) {
      const anyAnswered = questions.some((q) => answers[q.id]?.trim());
      if (!anyAnswered) {
        setError("Overall time elapsed — choose at least one answer before submitting.");
        return;
      }
    }
    setError(null);
    setSaving(true);

    const rows = questions
      .map((q) => {
        const pick = answers[q.id]?.trim();
        if (!pick) return null;
        return {
          sba_test_question_id: q.id,
          user_id: userId,
          selected_option_id: pick,
          is_correct: null,
        };
      })
      .filter(Boolean) as {
      sba_test_question_id: string;
      user_id: string;
      selected_option_id: string;
      is_correct: null;
    }[];

    if (rows.length > 0) {
      const { error: insErr } = await supabase.from("sba_question_responses").upsert(rows, {
        onConflict: "user_id,sba_test_question_id",
      });
      if (insErr) {
        setError("Failed to save answers. Try again.");
        setSaving(false);
        return;
      }
    }
    if (opts?.forceTimer && assignmentId) {
      void logExamProctorEvent({
        assignmentId,
        testKind: "sba",
        testId,
        eventType: "auto_submit_overall",
      });
    }
    setDone(true);
    setSaving(false);
  }, [answers, questions, userId, overallExpired, test, assignmentId, testId]);

  const isPractice = test?.test_function === "practice";

  const retake = useCallback(async () => {
    if (!userId || questions.length === 0 || !test || test.test_function !== "practice") return;
    setSaving(true);
    setError(null);
    const qids = questions.map((q) => q.id);

    const snapRows = questions
      .map((q) => {
        const oid = answers[q.id];
        if (!oid) return null;
        return {
          user_id: userId,
          sba_test_question_id: q.id,
          selected_option_id: oid,
          captured_at: new Date().toISOString(),
        };
      })
      .filter(Boolean) as {
      user_id: string;
      sba_test_question_id: string;
      selected_option_id: string;
      captured_at: string;
    }[];

    if (snapRows.length > 0) {
      const { error: snapErr } = await supabase.from("sba_practice_last_attempt").upsert(snapRows, {
        onConflict: "user_id,sba_test_question_id",
      });
      if (snapErr) {
        setError(
          snapErr.message.includes("does not exist") || snapErr.message.includes("relation")
            ? "Database not updated (migration 020). Cannot keep previous answers."
            : "Could not save previous attempt reference.",
        );
        setSaving(false);
        return;
      }
    }

    const nextPrev: Record<string, string> = { ...lastPracticeByQuestion };
    for (const r of snapRows) {
      nextPrev[r.sba_test_question_id] = r.selected_option_id;
    }
    setLastPracticeByQuestion(nextPrev);

    const { error: delErr } = await supabase
      .from("sba_question_responses")
      .delete()
      .eq("user_id", userId)
      .in("sba_test_question_id", qids);
    if (delErr) {
      setError(
        delErr.message.includes("policy") || delErr.code === "42501"
          ? "Retake is only for practice exams (or apply migration 020)."
          : "Could not reset your attempt. Please try again.",
      );
      setSaving(false);
      return;
    }
    setAnswers({});
    setDone(false);
    setOverallExpired(false);
    sessionStartRef.current = Date.now();
    setSessionTick((n) => n + 1);
    setSaving(false);
  }, [questions, userId, test, answers, lastPracticeByQuestion]);

  const formatMmSs = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return `${mins.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const elapsedSeconds = useMemo(() => {
    if (sessionStartRef.current == null) return 0;
    return Math.floor((Date.now() - sessionStartRef.current) / 1000);
  }, [sessionTick]);

  const overallLimitMin = test?.time_limit_minutes ?? null;
  const overallRemainingSeconds = useMemo(() => {
    if (overallLimitMin == null || overallLimitMin <= 0) return null;
    return Math.max(0, overallLimitMin * 60 - elapsedSeconds);
  }, [overallLimitMin, elapsedSeconds]);

  useEffect(() => {
    if (
      overallRemainingSeconds != null &&
      overallRemainingSeconds <= 0 &&
      !done &&
      test &&
      overallLimitMin != null
    ) {
      setOverallExpired(true);
    }
  }, [overallRemainingSeconds, done, test, overallLimitMin]);

  useEffect(() => {
    if (done || !test || overallRemainingSeconds == null || overallRemainingSeconds > 0) return;
    if (overallAutoSubmitFiredRef.current) return;
    overallAutoSubmitFiredRef.current = true;
    void submit({ forceTimer: true });
  }, [overallRemainingSeconds, done, test, submit]);

  useEffect(() => {
    if (done || !test) return;
    const id = window.setInterval(() => setSessionTick((tick) => tick + 1), 1000);
    return () => window.clearInterval(id);
  }, [done, test]);

  const secureExam = !!assignmentId;
  const examShellTitle = test?.subject ? `${test.subject} (SBA)` : "SBA exam";
  const isRealTest = test?.test_function !== "practice";

  const wrapExam = (content: ReactNode) => (
    <RealTestExamShell
      kind="sba"
      testId={testId}
      secureExam={secureExam}
      finished={done}
      title={examShellTitle}
    >
      {content}
    </RealTestExamShell>
  );

  if (loading) {
    return wrapExam(
      <div className="min-h-screen flex items-center justify-center bg-white">
        <span className="text-blue-800 text-lg">Loading test…</span>
      </div>,
    );
  }
  if (error && !test) {
    return wrapExam(
      <div className="min-h-screen flex items-center justify-center bg-white p-4">
        <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-6 py-4 max-w-md text-center">
          {error}
        </div>
      </div>,
    );
  }
  if (done) {
    return wrapExam(
      <div className="min-h-screen flex flex-col items-center justify-center bg-white p-4">
        <div className="bg-green-50 border border-green-200 rounded-lg shadow p-8 max-w-md text-center">
          <h1 className="text-2xl font-bold text-green-800">Submitted</h1>
          <p className="text-green-900 mt-2">Your SBA answers were recorded.</p>
          {test?.test_function === "practice" ? (
            <button
              type="button"
              onClick={() => void retake()}
              disabled={saving}
              className="mt-5 bg-blue-800 text-white font-semibold px-6 py-2 rounded-lg hover:bg-blue-900 disabled:opacity-60"
            >
              {saving ? "Resetting..." : "Retake (practice) — see last choices beside questions"}
            </button>
          ) : (
            <>
              <p className="mt-4 text-sm text-gray-600">Formal exam: one submission — retake is not available.</p>
              <RealTestCompleteActions isRealTest={isRealTest} />
            </>
          )}
        </div>
      </div>,
    );
  }
  if (!test) return null;

  return wrapExam(
    <div className="min-h-screen bg-white flex flex-col pb-16">
      <header className="border-b border-gray-200 px-6 py-6">
        <h1 className="text-2xl font-bold text-blue-900 flex flex-wrap items-center gap-2">
          <span>
            {test.subject} <span className="text-gray-500 font-medium">({test.subject_code})</span>
          </span>
          {test.test_function === "practice" ? (
            <span className="text-xs font-bold bg-orange-200 text-orange-950 px-2 py-0.5 rounded">Practice</span>
          ) : (
            <span className="text-xs font-bold bg-slate-200 text-slate-900 px-2 py-0.5 rounded">Real test</span>
          )}
        </h1>
        <p className="text-sm text-gray-600 mt-1">Single best answer: choose one option per question.</p>
        {!done ? (
          <div className="text-sm mt-2 space-y-1">
            <p className="font-semibold text-blue-950">
              Time on this test: <span className="tabular-nums">{formatMmSs(elapsedSeconds)}</span>
            </p>
            {overallRemainingSeconds != null ? (
              <p
                className={
                  overallExpired || overallRemainingSeconds <= 120 ? "text-red-700 font-semibold" : "text-slate-800"
                }
              >
                Overall time left:{" "}
                <span className="tabular-nums">{formatMmSs(overallRemainingSeconds)}</span>
              </p>
            ) : null}
          </div>
        ) : null}
        {overallExpired && !done ? (
          <p className="text-sm font-semibold text-red-700 mt-2 rounded border border-red-200 bg-red-50 px-3 py-2">
            Overall time has elapsed — selections are frozen. Submit to save whichever questions you answered.
          </p>
        ) : null}
      </header>
      <main className="max-w-3xl mx-auto w-full px-4 py-8 space-y-8">
        {questions.map((q) => {
          const opts: SbaOption[] = Array.isArray(q.options) ? (q.options as SbaOption[]) : [];
          const prevOid = lastPracticeByQuestion[q.id];
          const prevOpt = prevOid ? opts.find((o) => o.id === prevOid) : null;
          const showPrev = isPractice && !!prevOpt;
          return (
            <section key={q.id} className="border border-gray-200 rounded-lg p-6 space-y-4">
              <div className="text-sm font-semibold text-blue-800">Q{q.sequence_order}</div>
              <p className="text-gray-900 text-lg whitespace-pre-line">{q.stem}</p>
              {q.image_url ? (
                <img src={q.image_url} alt="" className="max-w-full max-h-64 rounded border object-contain" />
              ) : null}
              <div className={showPrev ? "grid grid-cols-1 lg:grid-cols-2 gap-6" : ""}>
                <ul className="space-y-2">
                  {opts
                    .filter((o) => o.text && o.id)
                    .map((o) => (
                      <li key={o.id} className="flex items-start gap-3">
                        <input
                          type="radio"
                          className="mt-1.5 h-4 w-4"
                          name={`q-${q.id}`}
                          checked={answers[q.id] === o.id}
                          onChange={() => setOne(q.id, o.id)}
                          disabled={saving || overallExpired}
                        />
                        <span className="pt-0.5">
                          <span className="font-mono font-bold mr-2">{o.id}.</span>
                          {o.text}
                        </span>
                      </li>
                    ))}
                </ul>
                {showPrev ? (
                  <div className="rounded-md border border-orange-300 bg-orange-100 p-4 text-sm self-start">
                    <div className="font-semibold text-orange-950 mb-1">Previous attempt</div>
                    <p className="text-gray-800">
                      <span className="font-mono font-bold">{prevOpt!.id}.</span> {prevOpt!.text}
                    </p>
                  </div>
                ) : null}
              </div>
            </section>
          );
        })}
        {error ? <div className="text-red-600 font-medium text-center">{error}</div> : null}
        {questions.length === 0 ? (
          <p className="text-gray-500">No questions in this test yet.</p>
        ) : (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void submit(undefined)}
              disabled={saving}
              className="bg-blue-800 text-white font-semibold px-8 py-3 rounded-lg shadow hover:bg-blue-900 disabled:opacity-50"
            >
              {saving ? "Submitting…" : "Submit all answers"}
            </button>
          </div>
        )}
      </main>
    </div>,
  );
}
