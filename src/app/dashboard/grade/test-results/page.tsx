"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { GRADING_ROLES } from "@/lib/auth/roles";
import { useRoleGate } from "@/hooks/useRoleGate";
import type { MeqLockedResponseRow } from "@/lib/grading/meqLockedResponses";
import { fetchLockedMeqResponsesForScope } from "@/lib/grading/meqLockedResponses";

type ResultRow = {
  meq_test_id: string;
  test_display_id: string;
  user_id: string;
  student_label: string;
  /** Sum of `human_override_score` for prompts that have a numeric grade */
  earned_sum: number;
  graded_prompts: number;
  submitted_prompts: number;
  /** Sum of authored item max_scores for the exam (every stage item) */
  exam_full_score: number | null;
};

function csvEscape(cell: string) {
  return `"${cell.replace(/"/g, '""')}"`;
}

async function fetchExamFullScoresMax(
  supabaseClient: typeof supabase,
  testIds: string[],
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (!testIds.length) return totals;
  const { data } = await supabaseClient
    .from("meq_test_stages")
    .select(
      `
      meq_test_id,
      meq_stage_items ( max_score )
    `,
    )
    .in("meq_test_id", testIds);

  type StageRow = {
    meq_test_id: string;
    meq_stage_items: { max_score: number | null }[] | null;
  };
  for (const row of (data as StageRow[] | null) || []) {
    const tid = row.meq_test_id;
    let add = totals.get(tid) ?? 0;
    for (const it of row.meq_stage_items ?? []) {
      add += typeof it.max_score === "number" ? it.max_score : 0;
    }
    totals.set(tid, add);
  }
  return totals;
}

export default function GradeTestResultsPage() {
  const { ready: accessOk, loading: gateLoading, userId: graderId, role: graderRole } = useRoleGate(
    GRADING_ROLES,
    { noUserRedirect: "/login", wrongRoleRedirect: "/practice-tests" },
  );

  const [subAdminCourseScopes, setSubAdminCourseScopes] = useState<string[]>([]);
  const [scopesLoading, setScopesLoading] = useState(false);
  const [rows, setRows] = useState<MeqLockedResponseRow[]>([]);
  const [examTotals, setExamTotals] = useState<Map<string, number>>(new Map());
  const [profiles, setProfiles] = useState<Record<string, { email: string; full_name: string | null }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedCourse, setSelectedCourse] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState<number | "">("");

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
    gateLoading || !accessOk || !graderId || !graderRole || (graderRole === "sub_admin" && scopesLoading);

  const reload = useCallback(async () => {
    if (authChecking) return;
    setLoading(true);
    setError(null);
    const { rows: loaded, error: fe } = await fetchLockedMeqResponsesForScope(supabase, {
      graderId,
      graderRole,
      subAdminCourseScopes,
    });
    if (fe) {
      setError(fe);
      setRows([]);
      setExamTotals(new Map());
      setLoading(false);
      return;
    }
    setRows(loaded);
    const tid = [...new Set(loaded.map((r) => r.meq_test_id))];
    const totalsMap = await fetchExamFullScoresMax(supabase, tid);
    setExamTotals(totalsMap);

    const uids = [...new Set(loaded.map((r) => r.user_id))];
    if (uids.length) {
      const { data: pdata } = await supabase.from("profiles").select("id, email, full_name").in("id", uids);
      const pr: Record<string, { email: string; full_name: string | null }> = {};
      for (const p of (pdata as { id: string; email: string; full_name: string | null }[] | null) || []) {
        pr[p.id] = { email: p.email, full_name: p.full_name };
      }
      setProfiles(pr);
    } else setProfiles({});

    setLoading(false);
  }, [authChecking, graderId, graderRole, subAdminCourseScopes]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const departmentOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.course_code).filter(Boolean))) as string[],
    [rows],
  );

  useEffect(() => {
    if (!departmentOptions.includes(selectedCourse)) {
      setSelectedCourse(departmentOptions[0] || "");
      setSelectedYear("");
    }
  }, [departmentOptions, selectedCourse]);

  const courseScoped = useMemo(
    () => (selectedCourse ? rows.filter((r) => r.course_code === selectedCourse) : []),
    [rows, selectedCourse],
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
    }
  }, [yearOptions, selectedYear]);

  const filtered = useMemo(() => {
    if (!selectedCourse || selectedYear === "") return [];
    return courseScoped.filter((r) => r.test_year === selectedYear);
  }, [courseScoped, selectedCourse, selectedYear]);

  const resultRows: ResultRow[] = useMemo(() => {
    type Agg = {
      meq_test_id: string;
      test_display_id: string;
      user_id: string;
      earned_sum: number;
      graded_prompts: number;
      submitted_prompts: number;
    };
    const map = new Map<string, Agg>();
    for (const r of filtered) {
      const key = `${r.meq_test_id}\t${r.user_id}`;
      const code = r.test_public_code?.trim() || r.meq_test_id;
      if (!map.has(key)) {
        map.set(key, {
          meq_test_id: r.meq_test_id,
          test_display_id: code,
          user_id: r.user_id,
          earned_sum: 0,
          graded_prompts: 0,
          submitted_prompts: 0,
        });
      }
      const a = map.get(key)!;
      a.submitted_prompts += 1;
      if (r.human_override_score != null && Number.isFinite(r.human_override_score)) {
        a.graded_prompts += 1;
        a.earned_sum += r.human_override_score;
      }
    }

    const out: ResultRow[] = [...map.values()].map((a) => ({
      ...a,
      student_label:
        profiles[a.user_id]?.full_name?.trim() ||
        profiles[a.user_id]?.email?.trim() ||
        `${a.user_id.slice(0, 8)}…${a.user_id.slice(-6)}`,
      exam_full_score: examTotals.get(a.meq_test_id) ?? null,
    }));

    out.sort((x, y) => {
      const c = x.test_display_id.localeCompare(y.test_display_id);
      if (c !== 0) return c;
      return x.student_label.localeCompare(y.student_label);
    });
    return out;
  }, [filtered, examTotals, profiles]);

  const exportCsv = () => {
    const headers = ["Test ID", "Student", "Score accumulation", "Full score"];
    const lines = [
      headers.map(csvEscape).join(","),
      ...resultRows.map((r) =>
        [
          r.test_display_id,
          r.student_label,
          String(r.graded_prompts === 0 ? "" : r.earned_sum),
          r.exam_full_score != null ? String(r.exam_full_score) : "",
        ]
          .map(csvEscape)
          .join(","),
      ),
    ];
    const csv = `\uFEFF${lines.join("\r\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meq-test-results-${selectedCourse}-${selectedYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pickReady = selectedCourse && selectedYear !== "";

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white pt-16">
        <span className="text-blue-700">Checking access…</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="w-full border-b border-gray-200 shadow-sm px-8 py-6">
        <div className="flex flex-wrap justify-between gap-4 items-start">
          <div>
            <Link href="/dashboard/grade" className="text-sm text-blue-700 hover:underline">
              ← MEQ grading
            </Link>
            <h1 className="text-3xl font-bold text-blue-800 tracking-tight mt-2">Test results</h1>
            <p className="text-sm text-slate-600 mt-2 max-w-3xl">
              Per exam and student: total points awarded so far across all graded prompts, and the full exam maximum
              (sum of item rubrics). Filter by department and year to export a CSV.
            </p>
          </div>
          <button
            type="button"
            disabled={!pickReady || resultRows.length === 0}
            onClick={exportCsv}
            className="bg-slate-900 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-40 shrink-0"
          >
            Export CSV
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto mt-6 px-6 pb-16">
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Department</label>
            <select
              className="w-full border border-gray-300 rounded px-3 py-2 bg-white"
              value={selectedCourse}
              onChange={(e) => {
                setSelectedCourse(e.target.value);
                setSelectedYear("");
              }}
            >
              <option value="">Select department…</option>
              {departmentOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Year</label>
            <select
              className="w-full border border-gray-300 rounded px-3 py-2 bg-white disabled:bg-gray-100"
              disabled={!selectedCourse}
              value={selectedYear === "" ? "" : String(selectedYear)}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedYear(v === "" ? "" : Number(v));
              }}
            >
              <option value="">Select year…</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <p className="text-blue-700 py-12 text-center">Loading…</p>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4">{error}</div>
        ) : !pickReady ? (
          <p className="text-gray-500 border border-dashed border-gray-300 rounded-lg py-10 text-center">
            Choose department and year to load the summary table.
          </p>
        ) : (
          <>
            <p className="text-xs text-slate-500 mb-3">
              <strong>Score accumulation</strong> sums staff scores for prompts that already have a grade. Ungraded
              prompts add <strong>0</strong> to that column until you grade them on the grading page (full exam max still
              lists every item).
            </p>
            <div className="border border-gray-200 rounded-lg overflow-x-auto shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-left border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-slate-800">Test ID</th>
                    <th className="px-4 py-3 font-semibold text-slate-800">Student</th>
                    <th className="px-4 py-3 font-semibold text-slate-800 whitespace-nowrap">Score accumulation</th>
                    <th className="px-4 py-3 font-semibold text-slate-800 whitespace-nowrap">Full score</th>
                  </tr>
                </thead>
                <tbody>
                  {resultRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                        No locked submissions for this scope.
                      </td>
                    </tr>
                  ) : (
                    resultRows.map((r) => (
                      <tr key={`${r.meq_test_id}-${r.user_id}`} className="border-t border-slate-100">
                        <td className="px-4 py-2 font-mono text-xs align-top">{r.test_display_id}</td>
                        <td className="px-4 py-2 align-top">{r.student_label}</td>
                        <td className="px-4 py-2 tabular-nums align-top whitespace-nowrap">
                          {r.graded_prompts === 0 ? (
                            <span className="text-amber-800">Not graded yet</span>
                          ) : (
                            <>
                              {r.earned_sum}{" "}
                              <span className="text-gray-500 font-normal">
                                ({r.graded_prompts}/{r.submitted_prompts} prompts scored)
                              </span>
                            </>
                          )}
                        </td>
                        <td className="px-4 py-2 tabular-nums align-top">
                          {r.exam_full_score != null ? r.exam_full_score : <span className="text-gray-400">—</span>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
