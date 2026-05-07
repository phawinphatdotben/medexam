"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import { SUBJECTS } from "@/lib/subjects";

type ExamListItem = {
  id: string;
  kind: "MEQ" | "SBA";
  subject: string;
  subjectCode: string;
  preview: string;
  href: string;
  sortKey: string;
  deptName: string;
};

function buildPreviewMeq(vignette: string) {
  if (!vignette?.trim()) return "";
  return vignette.slice(0, 180) + (vignette.length > 180 ? "…" : "");
}

/** Normalize Supabase FK embed (object or singleton array). */
function embedName(d: unknown): string | null {
  if (!d || typeof d !== "object") return null;
  if (Array.isArray(d)) {
    const row = d[0] as { name?: string } | undefined;
    return row?.name ?? null;
  }
  const name = (d as { name?: string }).name;
  return typeof name === "string" ? name : null;
}

function PracticeTestsInner() {
  const { user, profile, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const subjectFilter = searchParams.get("subject");
  const [authTimedOut, setAuthTimedOut] = useState(false);
  const [exams, setExams] = useState<ExamListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [subjectCodeSearch, setSubjectCodeSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<string>("");

  const normalizedCodeSearch = subjectCodeSearch.trim().toLowerCase();

  const departmentOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of exams) {
      if (e.deptName) set.add(e.deptName);
    }
    return ["", ...[...set].sort((a, b) => a.localeCompare(b))];
  }, [exams]);

  const filteredExams = useMemo(() => {
    return exams.filter((exam) => {
      if (subjectFilter && exam.subject !== subjectFilter) return false;
      if (departmentFilter && exam.deptName !== departmentFilter) return false;
      if (normalizedCodeSearch && !exam.subjectCode.toLowerCase().includes(normalizedCodeSearch)) return false;
      return true;
    });
  }, [exams, subjectFilter, departmentFilter, normalizedCodeSearch]);

  const grouped = useMemo(() => {
    const m = new Map<string, ExamListItem[]>();
    for (const e of filteredExams) {
      const key = e.deptName || "No department";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(e);
    }
    const keys = [...m.keys()].sort((a, b) => a.localeCompare(b));
    return keys.map((k) => ({ dept: k, items: m.get(k)! }));
  }, [filteredExams]);

  useEffect(() => {
    if (!authLoading) {
      setAuthTimedOut(false);
      return;
    }
    const timer = setTimeout(() => {
      setAuthTimedOut(true);
    }, 9000);
    return () => clearTimeout(timer);
  }, [authLoading]);

  useEffect(() => {
    const run = async () => {
      if (authLoading) return;
      setLoading(true);
      const uid = user?.id;
      if (!uid) {
        setExams([]);
        setLoading(false);
        return;
      }

      const [meqRes, sbaRes] = await Promise.all([
        supabase
          .from("meq_tests")
          .select("id, subject, course_code, vignette, created_at, department_id, departments ( id, name )")
          .eq("review_status", "approved")
          .eq("test_function", "practice")
          .order("created_at", { ascending: false }),
        supabase
          .from("sba_tests")
          .select("id, subject, subject_code, created_at, department_id, departments ( id, name )")
          .eq("review_status", "approved")
          .eq("test_function", "practice")
          .order("created_at", { ascending: false }),
      ]);

      const list: ExamListItem[] = [];

      if (meqRes.data) {
        for (const row of meqRes.data) {
          const r = row as {
            id: string;
            subject: string;
            course_code: string;
            vignette: string | null;
            created_at: string | null;
            departments?: unknown;
          };
          list.push({
            id: r.id,
            kind: "MEQ",
            subject: r.subject,
            subjectCode: r.course_code,
            preview: buildPreviewMeq(r.vignette ?? ""),
            href: `/exam/${r.id}`,
            sortKey: r.created_at ?? r.id,
            deptName: embedName(r.departments) ?? "",
          });
        }
      }
      if (sbaRes.data) {
        for (const row of sbaRes.data) {
          const r = row as {
            id: string;
            subject: string;
            subject_code: string;
            created_at: string | null;
            departments?: unknown;
          };
          list.push({
            id: r.id,
            kind: "SBA",
            subject: r.subject,
            subjectCode: r.subject_code,
            preview: `Single best answer — ${r.subject} (${r.subject_code}).`,
            href: `/exam/sba/${r.id}`,
            sortKey: r.created_at ?? r.id,
            deptName: embedName(r.departments) ?? "",
          });
        }
      }

      list.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));

      setExams(meqRes.error || sbaRes.error ? [] : list);
      setLoading(false);
    };

    void run();
  }, [authLoading, user?.id]);

  const subjectPicker =
    profile?.role === "student" ? (
      <div className="flex flex-wrap gap-2 mt-4">
        {SUBJECTS.map((subj) => (
          <Link
            key={subj}
            href={`/practice-tests?subject=${encodeURIComponent(subj)}`}
            className={`text-sm px-3 py-1.5 rounded-lg border transition ${
              subjectFilter === subj
                ? "bg-blue-900 text-white border-blue-800"
                : "border-blue-300 text-blue-900 hover:bg-blue-100"
            }`}
          >
            {subj}
          </Link>
        ))}
        <Link
          href="/practice-tests"
          className={`text-sm px-3 py-1.5 rounded-lg border transition ${
            !subjectFilter
              ? "bg-gray-700 text-white border-gray-800"
              : "border-gray-300 text-gray-700 hover:bg-gray-50"
          }`}
        >
          All subjects
        </Link>
      </div>
    ) : null;

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="w-full border-b border-gray-200 px-6 py-6 shadow-sm">
        <h1 className="text-3xl font-bold text-blue-800 tracking-tight">Practice tests</h1>
        <p className="mt-2 text-sm text-gray-600 max-w-2xl">
          Committee-approved practice exams only. Sorted by department; filter by subject area and search by course
          code. Any student may use practice tests.
        </p>
        {subjectFilter ? (
          <p className="mt-1 text-sm text-gray-700">
            Subject area filter:{" "}
            <span className="font-semibold text-blue-900">{subjectFilter}</span>
          </p>
        ) : null}
        {subjectPicker}
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto mt-8 px-4 pb-16">
        {authTimedOut ? (
          <div className="text-center py-16">
            <p className="text-blue-900 text-lg font-semibold">Still checking your session…</p>
            <p className="text-gray-600 text-sm mt-2 max-w-md mx-auto">
              Authentication is taking too long. Try re-login or open public practice listings again.
            </p>
            <div className="mt-5 flex items-center justify-center gap-3">
              <Link href="/login" className="px-4 py-2 rounded bg-blue-800 text-white font-semibold">
                Re-login
              </Link>
              <Link
                href={subjectFilter ? `/practice-tests?subject=${encodeURIComponent(subjectFilter)}` : "/practice-tests"}
                className="px-4 py-2 rounded border border-blue-400 text-blue-900 font-semibold"
              >
                Retry page
              </Link>
            </div>
          </div>
        ) : authLoading ? (
          <div className="flex items-center justify-center py-24">
            <span className="text-blue-800 font-medium">Checking session…</span>
          </div>
        ) : !user ? (
          <div className="text-center py-14">
            <p className="text-gray-600 mb-4">Sign in to view practice tests.</p>
            <Link href="/login" className="text-blue-800 font-semibold underline">
              Login
            </Link>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-24">
            <svg
              className="animate-spin h-8 w-8 text-blue-900 mr-3"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-30" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span className="text-blue-800 font-medium">Loading practice tests…</span>
          </div>
        ) : exams.length === 0 ? (
          <div className="text-gray-500 text-center py-16 text-lg border border-dashed border-gray-200 rounded-xl">
            No committee-approved practice tests are available yet.
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="dept-filter" className="block text-sm font-medium text-gray-700 mb-1">
                  Department
                </label>
                <select
                  id="dept-filter"
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {departmentOptions.map((d) => (
                    <option key={d || "__all"} value={d}>
                      {d === "" ? "All departments" : d}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="code-search-practice" className="block text-sm font-medium text-gray-700 mb-1">
                  Search by course code
                </label>
                <input
                  id="code-search-practice"
                  type="text"
                  value={subjectCodeSearch}
                  onChange={(e) => setSubjectCodeSearch(e.target.value)}
                  placeholder="e.g. MED101"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </div>

            {filteredExams.length === 0 ? (
              <div className="text-gray-500 text-center py-10 border border-dashed border-gray-300 rounded-lg">
                No practice tests match these filters.
              </div>
            ) : (
              <div className="space-y-10">
                {grouped.map(({ dept, items }) => (
                  <section key={dept} className="space-y-4">
                    <h2 className="text-lg font-bold text-gray-900 border-b border-blue-200 pb-2">{dept}</h2>
                    <div className="grid gap-5">
                      {items.map((exam) => (
                        <div
                          key={`${exam.kind}-${exam.id}`}
                          className="bg-gray-50 border border-blue-300 rounded-xl shadow-sm p-5 flex flex-col gap-2 hover:shadow-md transition"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-xl font-semibold text-blue-900">
                              {exam.subject} ({exam.subjectCode})
                            </h3>
                            <span className="text-xs font-bold bg-blue-200 text-blue-900 px-2.5 py-1 rounded-full">
                              {exam.kind}
                            </span>
                          </div>
                          {exam.preview ? (
                            <p className="text-gray-700 text-sm line-clamp-3">{exam.preview}</p>
                          ) : null}
                          <div className="flex justify-end pt-1">
                            <Link
                              href={exam.href}
                              className="bg-blue-900 text-white px-5 py-2 rounded-lg font-semibold text-sm hover:bg-blue-800"
                            >
                              Start practice
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default function PracticeTestsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-blue-800">Loading…</div>
      }
    >
      <PracticeTestsInner />
    </Suspense>
  );
}
