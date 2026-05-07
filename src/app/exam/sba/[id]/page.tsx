"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type SbaTest = {
  id: string;
  subject: string;
  subject_code: string;
  review_status: string;
  test_year: number;
  test_function: "practice" | "real_test";
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
  const [test, setTest] = useState<SbaTest | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<AnswersMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const sessionStartRef = useRef<number | null>(null);
  const [sessionTick, setSessionTick] = useState(0);
  const [lastPracticeByQuestion, setLastPracticeByQuestion] = useState<Record<string, string>>({});

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
        .select("id, subject, subject_code, review_status, test_year, test_function")
        .eq("id", testId)
        .maybeSingle();
      if (terr || !t) {
        if (m) {
          setError(
            me?.role === "student"
              ? "This test could not be loaded. Practice items must be approved; real exams only open from your Test session when assigned."
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
      if (me?.role === "student" && me.medical_student_year != null && me.medical_student_year !== t.test_year) {
        if (m) {
          setError("This test is not available for your year.");
          setLoading(false);
        }
        return;
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
  }, [testId, router]);

  const setOne = (qid: string, optionId: string) => {
    setAnswers((prev) => ({ ...prev, [qid]: optionId }));
  };

  const submit = useCallback(async () => {
    if (!userId) {
      setError("You are not signed in.");
      return;
    }
    for (const q of questions) {
      if (!answers[q.id]?.trim()) {
        setError("Select an answer for every question.");
        return;
      }
    }
    setError(null);
    setSaving(true);

    const rows = questions.map((q) => ({
      sba_test_question_id: q.id,
      user_id: userId,
      selected_option_id: answers[q.id]!,
      // Keep only latest attempt's grading state.
      is_correct: null,
    }));

    const { error: insErr } = await supabase.from("sba_question_responses").upsert(rows, {
      onConflict: "user_id,sba_test_question_id",
    });
    if (insErr) {
      setError("Failed to save answers. Try again.");
      setSaving(false);
      return;
    }
    setDone(true);
    setSaving(false);
  }, [answers, questions, userId]);

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
            : "Could not save previous attempt reference."
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
          : "Could not reset your attempt. Please try again."
      );
      setSaving(false);
      return;
    }
    setAnswers({});
    setDone(false);
    sessionStartRef.current = Date.now();
    setSessionTick((n) => n + 1);
    setSaving(false);
  }, [questions, userId, test, answers, lastPracticeByQuestion]);

  const formatMmSs = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const elapsedSeconds = useMemo(() => {
    if (sessionStartRef.current == null) return 0;
    return Math.floor((Date.now() - sessionStartRef.current) / 1000);
  }, [sessionTick]);

  useEffect(() => {
    if (done || !test) return;
    const id = window.setInterval(() => setSessionTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [done, test]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <span className="text-blue-800 text-lg">Loading test…</span>
      </div>
    );
  }
  if (error && !test) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white p-4">
        <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-6 py-4 max-w-md text-center">
          {error}
        </div>
      </div>
    );
  }
  if (done) {
    return (
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
            <p className="mt-4 text-sm text-gray-600">Formal exam: one submission — retake is not available.</p>
          )}
        </div>
      </div>
    );
  }
  if (!test) return null;

  return (
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
          <p className="text-sm font-semibold text-blue-950 mt-2">
            Time on this test: <span className="tabular-nums">{formatMmSs(elapsedSeconds)}</span>
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
                          disabled={saving}
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
              onClick={() => void submit()}
              disabled={saving}
              className="bg-blue-800 text-white font-semibold px-8 py-3 rounded-lg shadow hover:bg-blue-900 disabled:opacity-50"
            >
              {saving ? "Submitting…" : "Submit all answers"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
