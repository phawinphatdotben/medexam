"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { STAFF_DASHBOARD_ROLES } from "@/lib/auth/roles";
import { useRoleGate } from "@/hooks/useRoleGate";
import { fetchLockedMeqResponsesForScope } from "@/lib/grading/meqLockedResponses";

type RecentTestRow = {
  id: string;
  kind: "MEQ" | "SBA";
  label: string;
  itemCount: number;
  itemLabel: string;
  created_at: string;
};

type GradedItemRow = {
  response_id: string;
  meq_stage_id: string;
  meq_stage_item_id: string;
  stage_order: number;
  item_order: number;
  human_override_score: number;
  ai_rationale_feedback: string | null;
  graded_at: string | null;
};

type StudentResultGroup = {
  meq_test_id: string;
  test_display_id: string;
  test_label: string;
  course_code: string | null;
  test_year: number;
  user_id: string;
  student_label: string;
  total_score: number;
  latest_graded_at: number;
  items: GradedItemRow[];
};

type GradingQueueRow = {
  meq_test_id: string;
  test_display_id: string;
  test_label: string;
  waiting: number;
  completed: number;
  total_sent: number;
};

export default function EducatorDashboard() {
  const { ready: accessOk, loading: gateLoading, userId: currentUserId, role: userRole } = useRoleGate(
    STAFF_DASHBOARD_ROLES,
    { noUserRedirect: "/login", wrongRoleRedirect: "/practice-tests" },
  );
  const authChecking = gateLoading || !accessOk;

  const [recentTests, setRecentTests] = useState<RecentTestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [studentResults, setStudentResults] = useState<StudentResultGroup[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [expandedResults, setExpandedResults] = useState<Record<string, boolean>>({});

  const [gradingQueue, setGradingQueue] = useState<GradingQueueRow[]>([]);
  const [gradingQueueLoading, setGradingQueueLoading] = useState(false);
  const [gradingQueueError, setGradingQueueError] = useState<string | null>(null);

  useEffect(() => {
    if (authChecking) return;
    if (userRole === "sub_admin" || !currentUserId) {
      setRecentTests([]);
      setLoading(false);
      return;
    }
    const fetchRecent = async () => {
      setLoading(true);
      setError(null);
      const [meq, sba] = await Promise.all([
        supabase
          .from("meq_tests")
          .select("id, subject, course_code, created_at, meq_test_stages (id)")
          .eq("created_by", currentUserId)
          .order("created_at", { ascending: false }),
        supabase
          .from("sba_tests")
          .select("id, subject, subject_code, created_at, sba_test_questions (id)")
          .eq("created_by", currentUserId)
          .order("created_at", { ascending: false }),
      ]);
      if (meq.error || sba.error) {
        setError("Failed to fetch your tests.");
        setRecentTests([]);
        setLoading(false);
        return;
      }
      const items: RecentTestRow[] = [];
      for (const r of meq.data || []) {
        const n = (r as { meq_test_stages?: { id: string }[] }).meq_test_stages?.length ?? 0;
        items.push({
          id: r.id,
          kind: "MEQ",
          label: `${r.subject} (${r.course_code})`,
          itemCount: n,
          itemLabel: n === 1 ? "stage" : "stages",
          created_at: r.created_at,
        });
      }
      for (const r of sba.data || []) {
        const n = (r as { sba_test_questions?: { id: string }[] }).sba_test_questions?.length ?? 0;
        items.push({
          id: r.id,
          kind: "SBA",
          label: `${r.subject} (${r.subject_code})`,
          itemCount: n,
          itemLabel: n === 1 ? "question" : "questions",
          created_at: r.created_at,
        });
      }
      items.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setRecentTests(items);
      setLoading(false);
    };
    void fetchRecent();
  }, [authChecking, userRole, currentUserId]);

  useEffect(() => {
    if (authChecking) return;
    if (userRole === "sub_admin") {
      setStudentResults([]);
      return;
    }
    if (!currentUserId || !userRole) {
      setStudentResults([]);
      return;
    }
    const fetchStudentResults = async () => {
      setResultsLoading(true);
      setResultsError(null);
      const { rows, error: fe } = await fetchLockedMeqResponsesForScope(supabase, {
        graderId: currentUserId,
        graderRole: userRole,
        subAdminCourseScopes: [],
      });
      if (fe) {
        setResultsError("Failed to fetch student results.");
        setStudentResults([]);
        setResultsLoading(false);
        return;
      }
      const gradedOnly = rows.filter(
        (r) => r.human_override_score != null && Number.isFinite(r.human_override_score),
      );
      const uids = [...new Set(gradedOnly.map((r) => r.user_id))];
      const profileMap: Record<string, { email: string; full_name: string | null }> = {};
      if (uids.length) {
        const { data: pdata } = await supabase
          .from("profiles")
          .select("id, email, full_name")
          .in("id", uids);
        for (const p of (pdata as { id: string; email: string; full_name: string | null }[] | null) || []) {
          profileMap[p.id] = { email: p.email, full_name: p.full_name };
        }
      }
      const gradedAtByResponse: Record<string, string | null> = {};
      if (gradedOnly.length) {
        const responseIds = gradedOnly.map((r) => r.id);
        const { data: gradedAtData } = await supabase
          .from("meq_stage_responses")
          .select("id, graded_at")
          .in("id", responseIds);
        for (const ga of (gradedAtData as { id: string; graded_at: string | null }[] | null) || []) {
          gradedAtByResponse[ga.id] = ga.graded_at;
        }
      }
      type Bucket = StudentResultGroup;
      const bucketByKey = new Map<string, Bucket>();
      for (const r of gradedOnly) {
        const key = `${r.meq_test_id}\t${r.user_id}`;
        if (!bucketByKey.has(key)) {
          const display =
            r.test_public_code?.trim() || `MEQ-${r.meq_test_id.slice(0, 8)}…`;
          const pf = profileMap[r.user_id];
          const studentLabel = pf?.full_name?.trim()
            ? `${pf.full_name} · ${pf.email}`
            : pf?.email?.trim()
              ? pf.email
              : `${r.user_id.slice(0, 8)}…${r.user_id.slice(-6)}`;
          bucketByKey.set(key, {
            meq_test_id: r.meq_test_id,
            test_display_id: display,
            test_label: r.test_label,
            course_code: r.course_code,
            test_year: r.test_year,
            user_id: r.user_id,
            student_label: studentLabel,
            total_score: 0,
            latest_graded_at: 0,
            items: [],
          });
        }
        const b = bucketByKey.get(key)!;
        const gradedAt = gradedAtByResponse[r.id] ?? null;
        const gradedAtMs = gradedAt ? new Date(gradedAt).getTime() : 0;
        b.items.push({
          response_id: r.id,
          meq_stage_id: r.meq_stage_id,
          meq_stage_item_id: r.meq_stage_item_id,
          stage_order: r.stage_order,
          item_order: r.item_order,
          human_override_score: r.human_override_score!,
          ai_rationale_feedback: r.ai_rationale_feedback,
          graded_at: gradedAt,
        });
        b.total_score += r.human_override_score!;
        if (gradedAtMs > b.latest_graded_at) b.latest_graded_at = gradedAtMs;
      }
      const list = [...bucketByKey.values()].map((g) => ({
        ...g,
        items: [...g.items].sort(
          (a, b) => a.stage_order - b.stage_order || a.item_order - b.item_order,
        ),
      }));
      list.sort((a, b) => b.latest_graded_at - a.latest_graded_at);
      setStudentResults(list);
      setResultsLoading(false);
    };
    void fetchStudentResults();
  }, [authChecking, userRole, currentUserId]);

  useEffect(() => {
    if (authChecking || !currentUserId) return;
    if (userRole === "sub_admin") {
      setGradingQueue([]);
      return;
    }
    const fetchGradingQueue = async () => {
      setGradingQueueLoading(true);
      setGradingQueueError(null);
      const { data, error: qErr } = await supabase
        .from("meq_stage_responses")
        .select(
          `
            user_id,
            human_override_score,
            meq_stage_items!inner(
              meq_test_stages!inner(
                meq_test_id,
                meq_tests!inner(id, created_by, public_code, subject, course_code)
              )
            )
          `,
        )
        .eq("status", "locked");
      if (qErr) {
        setGradingQueueError("Could not load grading queue.");
        setGradingQueue([]);
        setGradingQueueLoading(false);
        return;
      }
      type R = {
        user_id: string;
        human_override_score: number | null;
        meq_stage_items: {
          meq_test_stages: {
            meq_test_id: string;
            meq_tests: {
              id: string;
              created_by: string;
              public_code: string | null;
              subject: string;
              course_code: string;
            };
          };
        };
      };
      const raw = (data as unknown as R[] | null) || [];
      const visible =
        userRole === "educator"
          ? raw.filter((r) => r.meq_stage_items.meq_test_stages.meq_tests.created_by === currentUserId)
          : raw;

      /** testId -> studentId -> { anyRow, needsGrade } needsGrade iff any locked row lacks score */
      const byTest = new Map<string, Map<string, { needsGrade: boolean }>>();
      const metaByTest = new Map<string, { label: string; displayId: string }>();

      for (const row of visible) {
        const t = row.meq_stage_items.meq_test_stages;
        const testId = t.meq_test_id;
        const mt = t.meq_tests;
        if (!metaByTest.has(testId)) {
          const display =
            mt.public_code?.trim() ||
            `${mt.course_code ?? ""} MEQ-${mt.id.slice(0, 8)}`;
          metaByTest.set(testId, {
            displayId: display,
            label: `${mt.subject} (${mt.course_code})`,
          });
        }
        const uid = row.user_id;
        const needs = row.human_override_score == null;
        if (!byTest.has(testId)) byTest.set(testId, new Map());
        const sm = byTest.get(testId)!;
        const cur = sm.get(uid);
        if (!cur) {
          sm.set(uid, { needsGrade: needs });
        } else if (needs) {
          cur.needsGrade = true;
        }
      }

      const out: GradingQueueRow[] = [];
      for (const [meq_test_id, sm] of byTest) {
        const meta = metaByTest.get(meq_test_id);
        if (!meta) continue;
        let waiting = 0;
        let completed = 0;
        for (const st of sm.values()) {
          if (st.needsGrade) waiting++;
          else completed++;
        }
        const total_sent = waiting + completed;
        out.push({
          meq_test_id,
          test_display_id: meta.displayId,
          test_label: meta.label,
          waiting,
          completed,
          total_sent,
        });
      }
      out.sort((a, b) => {
        if (b.waiting !== a.waiting) return b.waiting - a.waiting;
        return a.test_label.localeCompare(b.test_label);
      });
      setGradingQueue(out);
      setGradingQueueLoading(false);
    };
    void fetchGradingQueue();
  }, [authChecking, userRole, currentUserId]);

  function formatDate(dateString: string) {
    const date = new Date(dateString);
    // Format: May 10, 2024
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  }

  // Loading spinner UI if we're still checking for authentication AND profile RBAC role
  if (authChecking) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white">
        <svg className="animate-spin h-8 w-8 text-blue-600 mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-30" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        <span className="text-blue-700 text-lg font-medium">Loading dashboard...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="w-full border-b border-gray-200 shadow-sm px-8 py-6">
        <h1 className="text-3xl font-bold text-blue-800 tracking-tight">Staff dashboard</h1>
        {userRole === "sub_admin" && (
          <p className="text-sm text-gray-600 mt-1">
            Sub-Admin: focus on committee assignment and test review.
          </p>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-3xl mx-auto mt-10 px-6">
        <div className="grid sm:grid-cols-2 gap-3 mb-8">
          <Link
            href="/dashboard/create"
            className="text-center border-2 border-blue-600 text-blue-800 font-semibold py-4 rounded-lg hover:bg-blue-50"
          >
            Create test (SBA / MEQ)
          </Link>
          <Link
            href="/dashboard/my-tests"
            className="text-center border-2 border-gray-200 font-semibold py-4 rounded-lg hover:bg-gray-50"
          >
            My tests &amp; status
          </Link>
          {(userRole === "educator" || userRole === "admin" || userRole === "sub_admin") && (
            <Link
              href="/sub-admin"
              className="text-center border-2 border-slate-300 text-slate-800 font-semibold py-4 rounded-lg hover:bg-slate-50 sm:col-span-2"
            >
              Exam review committee
            </Link>
          )}
          {userRole === "admin" && (
            <>
              <Link
                href="/admin/tests"
                className="text-center border-2 border-slate-800 text-white bg-slate-800 font-semibold py-4 rounded-lg hover:bg-slate-700 sm:col-span-2"
              >
                Admin: search all tests
              </Link>
              <Link
                href="/dashboard/admin"
                className="text-center bg-gray-200 text-gray-800 px-6 py-3 rounded-lg font-semibold sm:col-span-2"
              >
                Manage user roles
              </Link>
            </>
          )}
        </div>

        {userRole === "sub_admin" ? null : (
          <>
        {/* Recent tests */}
        <div className="bg-white border border-gray-200 shadow rounded-lg mb-10">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-xl font-semibold text-blue-900">Recent tests</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-6 py-3 text-gray-700 font-medium border-b border-gray-200">Test</th>
                  <th className="px-6 py-3 text-gray-700 font-medium border-b border-gray-200">Type</th>
                  <th className="px-6 py-3 text-gray-700 font-medium border-b border-gray-200">Size</th>
                  <th className="px-6 py-3 text-gray-700 font-medium border-b border-gray-200">Created</th>
                  <th className="px-6 py-3 text-gray-700 font-medium border-b border-gray-200">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-5 text-center text-blue-600">
                      Loading...
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-5 text-center text-red-600">
                      {error}
                    </td>
                  </tr>
                ) : recentTests.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-5 text-center text-gray-500">
                      No tests found. Create one to see it here.
                    </td>
                  </tr>
                ) : (
                  recentTests.map((t) => (
                    <tr key={`${t.kind}-${t.id}`} className="hover:bg-gray-50">
                      <td className="px-6 py-4 border-b border-gray-100">{t.label}</td>
                      <td className="px-6 py-4 border-b border-gray-100 font-medium text-gray-800">
                        {t.kind}
                      </td>
                      <td className="px-6 py-4 border-b border-gray-100">
                        {t.itemCount} {t.itemLabel}
                      </td>
                      <td className="px-6 py-4 border-b border-gray-100">
                        {t.created_at ? formatDate(t.created_at) : "N/A"}
                      </td>
                      <td className="px-6 py-4 border-b border-gray-100">
                        <Link
                          href="/dashboard/my-tests"
                          className="inline-block bg-blue-50 text-blue-800 border border-blue-600 px-4 py-1.5 rounded shadow hover:bg-blue-100 font-medium"
                        >
                          My tests
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* MEQ grading queue */}
        <div className="bg-white border border-gray-200 shadow rounded-lg mb-10">
          <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-xl font-semibold text-blue-900">Tests waiting to be graded</h2>
              <p className="text-xs text-gray-600 mt-1 max-w-xl">
                Per MEQ exam: distinct students who have <strong>locked</strong> submissions.{" "}
                <strong>Students waiting</strong> still have at least one unsubmitted score; <strong>Completed</strong>{" "}
                have every submitted item scored. Totals exclude students who have not begun the exam.
              </p>
            </div>
            <Link
              href="/dashboard/grade"
              className="text-sm font-semibold text-blue-800 hover:underline shrink-0"
            >
              Open grading →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-6 py-3 text-gray-700 font-medium border-b border-gray-200">Test ID</th>
                  <th className="px-6 py-3 text-gray-700 font-medium border-b border-gray-200">
                    Students waiting to be graded
                  </th>
                  <th className="px-6 py-3 text-gray-700 font-medium border-b border-gray-200">Completed</th>
                  <th className="px-6 py-3 text-gray-700 font-medium border-b border-gray-200">
                    Total students (submitted)
                  </th>
                </tr>
              </thead>
              <tbody>
                {gradingQueueLoading ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-5 text-center text-blue-600">
                      Loading...
                    </td>
                  </tr>
                ) : gradingQueueError ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-5 text-center text-red-600">
                      {gradingQueueError}
                    </td>
                  </tr>
                ) : gradingQueue.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-5 text-center text-gray-500">
                      No locked MEQ submissions to grade in your scope.
                    </td>
                  </tr>
                ) : (
                  gradingQueue.map((q) => (
                    <tr key={q.meq_test_id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 border-b border-gray-100 align-top">
                        <div className="font-mono text-xs">{q.test_display_id}</div>
                        <div className="text-xs text-gray-600 mt-0.5">{q.test_label}</div>
                      </td>
                      <td className="px-6 py-4 border-b border-gray-100 tabular-nums font-semibold text-amber-900">
                        {q.waiting}
                      </td>
                      <td className="px-6 py-4 border-b border-gray-100 tabular-nums text-green-800">
                        {q.completed}
                      </td>
                      <td className="px-6 py-4 border-b border-gray-100 tabular-nums">{q.total_sent}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Student Results Table */}
        <div className="bg-white border border-gray-200 shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-xl font-semibold text-blue-900">Student Results</h2>
              <p className="text-xs text-gray-600 mt-1 max-w-xl">
                One row per <strong>exam × student</strong>. Click the arrow to see every graded stage with its score
                and feedback. Use <strong>Edit</strong> to jump back into the grader with all selectors preset.
              </p>
            </div>
            <Link
              href="/dashboard/grade/test-results"
              className="text-sm font-semibold text-blue-800 hover:underline shrink-0"
            >
              Test results table →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-3 py-3 text-gray-700 font-medium border-b border-gray-200 w-8" aria-hidden />
                  <th className="px-6 py-3 text-gray-700 font-medium border-b border-gray-200">Test ID</th>
                  <th className="px-6 py-3 text-gray-700 font-medium border-b border-gray-200">Date</th>
                  <th className="px-6 py-3 text-gray-700 font-medium border-b border-gray-200">Student</th>
                  <th className="px-6 py-3 text-gray-700 font-medium border-b border-gray-200 whitespace-nowrap">
                    Score
                  </th>
                  <th className="px-6 py-3 text-gray-700 font-medium border-b border-gray-200">Actions</th>
                </tr>
              </thead>
              <tbody>
                {resultsLoading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-5 text-center text-blue-600">
                      Loading...
                    </td>
                  </tr>
                ) : resultsError ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-5 text-center text-red-600">
                      {resultsError}
                    </td>
                  </tr>
                ) : studentResults.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-5 text-center text-gray-500">
                      No graded results found.
                    </td>
                  </tr>
                ) : (
                  studentResults.flatMap((g) => {
                    const key = `${g.meq_test_id}::${g.user_id}`;
                    const isOpen = !!expandedResults[key];
                    const parentEditHref =
                      `/dashboard/grade?course=${encodeURIComponent(g.course_code ?? "")}` +
                      `&year=${g.test_year}` +
                      `&test=${encodeURIComponent(g.meq_test_id)}` +
                      `&student=${encodeURIComponent(g.user_id)}`;
                    const totalLabel = Number.isInteger(g.total_score)
                      ? String(g.total_score)
                      : g.total_score.toFixed(1);
                    const lastGraded = g.latest_graded_at
                      ? new Date(g.latest_graded_at).toLocaleString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—";
                    const parentRow = (
                      <tr
                        key={`row-${key}`}
                        className="hover:bg-blue-50/40 cursor-pointer"
                        onClick={() => setExpandedResults((p) => ({ ...p, [key]: !p[key] }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setExpandedResults((p) => ({ ...p, [key]: !p[key] }));
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-expanded={isOpen}
                      >
                        <td className="px-3 py-4 border-b border-gray-100 text-blue-900 font-semibold text-center">
                          {isOpen ? "▼" : "▸"}
                        </td>
                        <td className="px-6 py-4 border-b border-gray-100 align-top">
                          <div className="font-mono text-sm font-semibold text-gray-900">
                            {g.test_display_id}
                          </div>
                          <div className="text-xs text-gray-600 mt-0.5">{g.test_label}</div>
                          <div className="text-xs text-blue-800 mt-1 font-medium">
                            {g.items.length} graded stage{g.items.length === 1 ? "" : "s"}
                          </div>
                        </td>
                        <td className="px-6 py-4 border-b border-gray-100 align-top text-sm text-gray-700">
                          <span className="text-gray-500 text-xs block">Last graded</span>
                          {lastGraded}
                        </td>
                        <td className="px-6 py-4 border-b border-gray-100 align-top text-sm">
                          <div className="font-semibold text-gray-900">{g.student_label}</div>
                          <div className="text-xs text-gray-500 font-mono mt-0.5 break-all">
                            {g.user_id}
                          </div>
                        </td>
                        <td className="px-6 py-4 border-b border-gray-100 align-top">
                          <span className="inline-block px-3 py-1 rounded-full bg-blue-100 text-blue-950 font-semibold text-sm tabular-nums">
                            {totalLabel}
                          </span>
                          <span className="block text-xs text-gray-500 mt-1">sum of parts</span>
                        </td>
                        <td className="px-6 py-4 border-b border-gray-100 align-top">
                          <Link
                            href={parentEditHref}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-block bg-blue-50 text-blue-800 border border-blue-600 px-4 py-1.5 rounded shadow hover:bg-blue-100 font-medium text-sm"
                          >
                            Edit
                          </Link>
                        </td>
                      </tr>
                    );
                    const childRows = isOpen
                      ? g.items.map((item) => {
                          const childHref =
                            `/dashboard/grade?course=${encodeURIComponent(g.course_code ?? "")}` +
                            `&year=${g.test_year}` +
                            `&test=${encodeURIComponent(g.meq_test_id)}` +
                            `&stage=${encodeURIComponent(item.meq_stage_id)}` +
                            `&item=${encodeURIComponent(item.meq_stage_item_id)}` +
                            `&student=${encodeURIComponent(g.user_id)}`;
                          return (
                            <tr
                              key={`child-${key}-${item.response_id}`}
                              className="bg-slate-50/80 border-b border-gray-100"
                            >
                              <td className="px-3 py-3 border-b border-gray-100" aria-hidden />
                              <td className="px-6 py-3 border-b border-gray-100 align-top text-sm text-gray-800">
                                <span className="font-medium">Stage {item.stage_order}</span>
                                {item.item_order > 1 ? (
                                  <span className="text-gray-600"> · Part {item.item_order}</span>
                                ) : null}
                              </td>
                              <td className="px-6 py-3 border-b border-gray-100 align-top text-xs text-gray-600">
                                {item.graded_at
                                  ? new Date(item.graded_at).toLocaleString(undefined, {
                                      year: "numeric",
                                      month: "short",
                                      day: "2-digit",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })
                                  : "—"}
                              </td>
                              <td className="px-6 py-3 border-b border-gray-100 align-top text-sm text-gray-700">
                                {item.ai_rationale_feedback ? (
                                  <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-blue-900 text-sm max-w-md break-words">
                                    {item.ai_rationale_feedback}
                                  </div>
                                ) : (
                                  <span className="italic text-gray-400">No feedback</span>
                                )}
                              </td>
                              <td className="px-6 py-3 border-b border-gray-100 align-top">
                                <span className="inline-block px-3 py-1 rounded-full bg-blue-200 text-blue-950 font-semibold text-base tabular-nums">
                                  {item.human_override_score}
                                </span>
                              </td>
                              <td className="px-6 py-3 border-b border-gray-100 align-top">
                                <Link
                                  href={childHref}
                                  className="inline-block bg-white text-blue-800 border border-blue-300 px-3 py-1.5 rounded shadow-sm hover:bg-blue-50 font-medium text-sm"
                                >
                                  Edit
                                </Link>
                              </td>
                            </tr>
                          );
                        })
                      : [];
                    return [parentRow, ...childRows];
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
          </>
        )}
      </main>
    </div>
  );
}