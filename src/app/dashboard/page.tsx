"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { STAFF_DASHBOARD_ROLES } from "@/lib/auth/roles";
import { useRoleGate } from "@/hooks/useRoleGate";

type RecentTestRow = {
  id: string;
  kind: "MEQ" | "SBA";
  label: string;
  itemCount: number;
  itemLabel: string;
  created_at: string;
};

interface StudentResultRow {
  id: string;
  user_id: string;
  human_override_score: number | null;
  ai_rationale_feedback: string | null;
}

export default function EducatorDashboard() {
  const { ready: accessOk, loading: gateLoading, userId: currentUserId, role: userRole } = useRoleGate(
    STAFF_DASHBOARD_ROLES,
    { noUserRedirect: "/login", wrongRoleRedirect: "/practice-tests" },
  );
  const authChecking = gateLoading || !accessOk;

  const [recentTests, setRecentTests] = useState<RecentTestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [studentResults, setStudentResults] = useState<StudentResultRow[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);

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
    const fetchStudentResults = async () => {
      setResultsLoading(true);
      setResultsError(null);
      const { data, error } = await supabase
        .from("meq_stage_responses")
        .select(
          `
            id, user_id, created_at, human_override_score, ai_rationale_feedback,
            meq_test_stages!inner(
              meq_test_id,
              meq_tests!inner( created_by, subject, course_code )
            )
          `
        )
        .not("human_override_score", "is", null);
      if (error) {
        setResultsError("Failed to fetch student results.");
        setStudentResults([]);
        setResultsLoading(false);
        return;
      }
      type Row = {
        id: string;
        user_id: string;
        created_at: string;
        human_override_score: number | null;
        ai_rationale_feedback: string | null;
        meq_test_stages: {
          meq_test_id: string;
          meq_tests: { created_by: string; subject: string; course_code: string };
        };
      };
      const raw = (data as unknown as Row[] | null) || [];
      const filtered =
        userRole === "educator" && currentUserId
          ? raw.filter((r) => r.meq_test_stages.meq_tests.created_by === currentUserId)
          : raw;
      const sorted = [...filtered].sort((a, b) => b.created_at.localeCompare(a.created_at));
      const rows: StudentResultRow[] = sorted.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        human_override_score: r.human_override_score,
        ai_rationale_feedback: r.ai_rationale_feedback,
      }));
      setStudentResults(rows);
      setResultsLoading(false);
    };
    void fetchStudentResults();
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

        {/* Student Results Table */}
        <div className="bg-white border border-gray-200 shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-xl font-semibold text-blue-900">Student Results</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-6 py-3 text-gray-700 font-medium border-b border-gray-200">Student ID</th>
                  <th className="px-6 py-3 text-gray-700 font-medium border-b border-gray-200">Score</th>
                  <th className="px-6 py-3 text-gray-700 font-medium border-b border-gray-200">Feedback</th>
                </tr>
              </thead>
              <tbody>
                {resultsLoading ? (
                  <tr>
                    <td colSpan={3} className="px-6 py-5 text-center text-blue-600">
                      Loading...
                    </td>
                  </tr>
                ) : resultsError ? (
                  <tr>
                    <td colSpan={3} className="px-6 py-5 text-center text-red-600">
                      {resultsError}
                    </td>
                  </tr>
                ) : studentResults.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-6 py-5 text-center text-gray-500">
                      No graded results found.
                    </td>
                  </tr>
                ) : (
                  studentResults.map((result) => (
                    <tr key={result.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 border-b border-gray-100">{result.user_id}</td>
                      <td className="px-6 py-4 border-b border-gray-100">{result.human_override_score !== null ? result.human_override_score : "N/A"}</td>
                      <td className="px-6 py-4 border-b border-gray-100">
                        {result.ai_rationale_feedback ?? ""}
                      </td>
                    </tr>
                  ))
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