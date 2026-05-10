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
  publicCode: string | null;
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

function normalizeCourseCode(raw: string) {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

type PracticeCatalogRpcRow = {
  kind?: string;
  id?: string;
  subject?: string;
  subject_code?: string;
  public_code?: string | null;
  vignette?: string | null;
  dept_name?: string | null;
  created_at?: string | null;
};

function catalogRpcRowsToExams(rows: PracticeCatalogRpcRow[]): ExamListItem[] {
  return rows
    .filter((r) => r.id && r.subject && r.subject_code && (r.kind === "MEQ" || r.kind === "SBA"))
    .map((r) => {
      const kind = r.kind === "SBA" ? "SBA" : "MEQ";
      const created = r.created_at != null ? String(r.created_at) : null;
      return {
        id: r.id as string,
        kind,
        subject: r.subject as string,
        subjectCode: r.subject_code as string,
        publicCode: r.public_code ?? null,
        preview:
          kind === "MEQ"
            ? buildPreviewMeq(r.vignette ?? "")
            : `Single best answer — ${r.subject} (${r.subject_code}).`,
        href: kind === "MEQ" ? `/exam/${r.id}` : `/exam/sba/${r.id}`,
        sortKey: created ?? (r.id as string),
        deptName: typeof r.dept_name === "string" && r.dept_name.trim() ? r.dept_name : "",
      };
    });
}

/** Build practice-tests URL preserving subject filter. */
function practiceTestsHref(params: { subject?: string | null; code?: string | null }) {
  const qs = new URLSearchParams();
  if (params.subject?.trim()) qs.set("subject", params.subject.trim());
  if (params.code?.trim()) qs.set("code", params.code.trim());
  const q = qs.toString();
  return q ? `/practice-tests?${q}` : `/practice-tests`;
}

function PracticeTestsInner() {
  const { user, profile, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const subjectFilter = searchParams.get("subject");
  const selectedCodeRaw = searchParams.get("code");
  const selectedCodeNorm =
    typeof selectedCodeRaw === "string" && selectedCodeRaw.trim()
      ? normalizeCourseCode(selectedCodeRaw)
      : null;

  const [authTimedOut, setAuthTimedOut] = useState(false);
  const [exams, setExams] = useState<ExamListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
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

  /** Exams after subject tab + dept + fuzzy code search (code picker step only). */
  const filteredForCatalog = useMemo(() => {
    return exams.filter((exam) => {
      if (subjectFilter && exam.subject !== subjectFilter) return false;
      if (departmentFilter && exam.deptName !== departmentFilter) return false;
      if (
        normalizedCodeSearch &&
        !exam.subjectCode.toLowerCase().includes(normalizedCodeSearch)
      ) {
        return false;
      }
      return true;
    });
  }, [exams, subjectFilter, departmentFilter, normalizedCodeSearch]);

  /** Unique course codes for the hierarchical first step (ordered). */
  const codeCatalog = useMemo(() => {
    const map = new Map<
      string,
      { display: string; meqCount: number; sbaCount: number; deptNames: Set<string> }
    >();
    for (const e of filteredForCatalog) {
      const key = normalizeCourseCode(e.subjectCode);
      if (!map.has(key)) {
        map.set(key, {
          display: e.subjectCode.trim(),
          meqCount: 0,
          sbaCount: 0,
          deptNames: new Set(),
        });
      }
      const row = map.get(key)!;
      if (e.deptName) row.deptNames.add(e.deptName);
      if (e.kind === "MEQ") row.meqCount += 1;
      else row.sbaCount += 1;
    }
    return [...map.entries()]
      .map(([norm, v]) => ({ norm, ...v }))
      .sort((a, b) => a.display.localeCompare(b.display, undefined, { sensitivity: "base" }));
  }, [filteredForCatalog]);

  /** When a course code is selected, list tests under MEQ vs SBA. */
  const testsForSelectedCode = useMemo(() => {
    if (!selectedCodeNorm) return [];
    return filteredForCatalog.filter((e) => normalizeCourseCode(e.subjectCode) === selectedCodeNorm);
  }, [filteredForCatalog, selectedCodeNorm]);

  const meqTestsForCode = useMemo(
    () => testsForSelectedCode.filter((e) => e.kind === "MEQ"),
    [testsForSelectedCode],
  );
  const sbaTestsForCode = useMemo(
    () => testsForSelectedCode.filter((e) => e.kind === "SBA"),
    [testsForSelectedCode],
  );

  const selectedDisplayCode =
    testsForSelectedCode[0]?.subjectCode?.trim() || selectedCodeRaw?.trim() || "";

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
      setFetchError(null);
      const uid = user?.id;
      if (!uid) {
        setExams([]);
        setLoading(false);
        return;
      }

      const rpcName = "list_approved_practice_tests_catalog_json";
      const rpcRes = await supabase.rpc(rpcName);

      let list: ExamListItem[] = [];

      const rpcParsed = (): ExamListItem[] | null => {
        if (rpcRes.error || rpcRes.data == null) return null;
        const raw = rpcRes.data as unknown;
        if (!Array.isArray(raw)) return null;
        return catalogRpcRowsToExams(raw as PracticeCatalogRpcRow[]);
      };

      const fromRpc = rpcParsed();
      if (fromRpc) {
        list = fromRpc;
      } else {
        if (rpcRes.error?.message?.includes("(PGRST") || rpcRes.error?.code === "PGRST202") {
          setFetchError(
            rpcRes.error.message ||
              `Run migration 029 (${rpcName}) in Supabase so students can load the practice catalog.`,
          );
        }

        const [meqRes, sbaRes] = await Promise.all([
          supabase
            .from("meq_tests")
            .select(
              "id, subject, course_code, vignette, created_at, department_id, public_code, departments ( id, name )",
            )
            .eq("review_status", "approved")
            .eq("test_function", "practice")
            .order("created_at", { ascending: false }),
          supabase
            .from("sba_tests")
            .select(
              "id, subject, subject_code, created_at, department_id, public_code, departments ( id, name )",
            )
            .eq("review_status", "approved")
            .eq("test_function", "practice")
            .order("created_at", { ascending: false }),
        ]);

        const errMsg = meqRes.error?.message || sbaRes.error?.message || null;
        if (errMsg && list.length === 0) {
          setFetchError(
            [rpcRes.error?.message, errMsg].filter(Boolean).join(" · ") || errMsg,
          );
        }
        list = [];

        if (!meqRes.error && meqRes.data) {
          for (const row of meqRes.data) {
            const r = row as {
              id: string;
              subject: string;
              course_code: string;
              vignette: string | null;
              created_at: string | null;
              public_code?: string | null;
              departments?: unknown;
            };
            list.push({
              id: r.id,
              kind: "MEQ",
              subject: r.subject,
              subjectCode: r.course_code,
              publicCode: r.public_code ?? null,
              preview: buildPreviewMeq(r.vignette ?? ""),
              href: `/exam/${r.id}`,
              sortKey: r.created_at ?? r.id,
              deptName: embedName(r.departments) ?? "",
            });
          }
        }
        if (!sbaRes.error && sbaRes.data) {
          for (const row of sbaRes.data) {
            const r = row as {
              id: string;
              subject: string;
              subject_code: string;
              created_at: string | null;
              public_code?: string | null;
              departments?: unknown;
            };
            list.push({
              id: r.id,
              kind: "SBA",
              subject: r.subject,
              subjectCode: r.subject_code,
              publicCode: r.public_code ?? null,
              preview: `Single best answer — ${r.subject} (${r.subject_code}).`,
              href: `/exam/sba/${r.id}`,
              sortKey: r.created_at ?? r.id,
              deptName: embedName(r.departments) ?? "",
            });
          }
        }
      }

      list.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));

      if (list.length > 0) setFetchError(null);

      setExams(list);
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
            href={practiceTestsHref({ subject: subj, code: null })}
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
          href={practiceTestsHref({ subject: null, code: null })}
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

  const renderTestCard = (exam: ExamListItem) => (
    <div
      key={`${exam.kind}-${exam.id}`}
      className="bg-gray-50 border border-blue-300 rounded-xl shadow-sm p-5 flex flex-col gap-2 hover:shadow-md transition"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold text-blue-900">{exam.subject}</h3>
        <span className="text-xs font-bold bg-blue-200 text-blue-900 px-2.5 py-1 rounded-full">
          {exam.kind}
        </span>
      </div>
      {exam.publicCode ? (
        <p className="text-xs font-mono text-slate-600">
          Test code: <span className="text-slate-900 font-semibold">{exam.publicCode}</span>
        </p>
      ) : null}
      {exam.preview ? <p className="text-gray-700 text-sm line-clamp-3">{exam.preview}</p> : null}
      <div className="flex justify-end pt-1">
        <Link
          href={exam.href}
          className="bg-blue-900 text-white px-5 py-2 rounded-lg font-semibold text-sm hover:bg-blue-800"
        >
          Start practice
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="w-full border-b border-gray-200 px-6 py-6 shadow-sm">
        <h1 className="text-3xl font-bold text-blue-800 tracking-tight">Practice tests</h1>
        <p className="mt-2 text-sm text-gray-600 max-w-2xl">
          Committee-approved <strong className="font-semibold">practice</strong> exams only (not scored real
          tests). Pick your subject area, then a <strong className="font-semibold">course code</strong>, then
          open MEQ or SBA. Any enrolled student may use these.
        </p>
        {subjectFilter ? (
          <p className="mt-1 text-sm text-gray-700">
            Subject area: <span className="font-semibold text-blue-900">{subjectFilter}</span>
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
                href={practiceTestsHref({ subject: subjectFilter, code: selectedCodeRaw })}
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
        ) : fetchError ? (
          <div className="text-red-800 text-center py-12 border border-red-200 bg-red-50 rounded-xl text-sm">
            <p className="font-semibold">Could not load the practice list.</p>
            <p className="mt-2 font-mono text-xs break-all">{fetchError}</p>
          </div>
        ) : exams.length === 0 ? (
          <div className="text-gray-600 text-center py-16 text-base border border-dashed border-gray-200 rounded-xl space-y-3">
            <p>No committee-approved <strong>practice</strong> tests are available yet.</p>
            <p className="text-sm text-gray-500 max-w-md mx-auto">
              Real examinations never appear here—only{' '}
              <span className="font-mono">test_function = practice</span> with{' '}
              <span className="font-mono">review_status = approved</span>.
            </p>
            <ul className="text-sm text-gray-500 max-w-lg mx-auto text-left list-disc pl-5 space-y-2">
              <li>
                When creating content, choose the <strong>Practice</strong> track (not the graded real-test
                track).
              </li>
              <li>
                After review, set status to <strong>Approved</strong> on that same practice row.
              </li>
              <li>
                In Supabase, run migration <span className="font-mono">029</span>{' '}
                (<span className="font-mono">list_approved_practice_tests_catalog_json</span>) so the catalog loads
                reliably for students.
              </li>
              <li>
                Deploy the latest frontend—your hosted page must match this branch (subject → course codes → MEQ /
                SBA).
              </li>
            </ul>
          </div>
        ) : selectedCodeNorm && testsForSelectedCode.length === 0 ? (
          <div className="space-y-4">
            <Link
              href={practiceTestsHref({ subject: subjectFilter, code: null })}
              className="text-blue-700 text-sm font-semibold hover:underline inline-block"
            >
              ← Back to course codes
            </Link>
            <div className="text-gray-600 text-center py-12 border border-dashed rounded-xl">
              No practice tests match this course code with the current filters.
            </div>
          </div>
        ) : selectedCodeNorm ? (
          <div className="space-y-8">
            <div>
              <Link
                href={practiceTestsHref({ subject: subjectFilter, code: null })}
                className="text-blue-700 text-sm font-semibold hover:underline"
              >
                ← Back to course codes
              </Link>
              <h2 className="text-xl font-bold text-gray-900 mt-2">
                {selectedDisplayCode}
                {subjectFilter ? (
                  <span className="text-base font-normal text-gray-600"> · {subjectFilter}</span>
                ) : null}
              </h2>
              <p className="text-sm text-gray-600 mt-1">Choose MEQ or SBA, then start a practice exam.</p>
            </div>

            <section className="space-y-3">
              <h3 className="text-lg font-bold text-gray-900 border-b border-blue-200 pb-2">MEQ</h3>
              {meqTestsForCode.length === 0 ? (
                <p className="text-sm text-gray-500 italic">No MEQ practice items for this code.</p>
              ) : (
                <div className="grid gap-5">{meqTestsForCode.map(renderTestCard)}</div>
              )}
            </section>

            <section className="space-y-3">
              <h3 className="text-lg font-bold text-gray-900 border-b border-blue-200 pb-2">SBA</h3>
              {sbaTestsForCode.length === 0 ? (
                <p className="text-sm text-gray-500 italic">No SBA practice items for this code.</p>
              ) : (
                <div className="grid gap-5">{sbaTestsForCode.map(renderTestCard)}</div>
              )}
            </section>
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
                  Search course code
                </label>
                <input
                  id="code-search-practice"
                  type="text"
                  value={subjectCodeSearch}
                  onChange={(e) => setSubjectCodeSearch(e.target.value)}
                  placeholder="e.g. CHMD 7404"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </div>

            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-2">Course codes</h2>
              <p className="text-sm text-gray-600 mb-4">
                Select a code to see MEQ and SBA practice exams for that course.
              </p>
              {codeCatalog.length === 0 ? (
                <div className="text-gray-500 text-center py-10 border border-dashed border-gray-300 rounded-lg">
                  No course codes match these filters.
                </div>
              ) : (
                <ul className="space-y-2">
                  {codeCatalog.map((row) => {
                    const total = row.meqCount + row.sbaCount;
                    const deptLabel =
                      row.deptNames.size === 0
                        ? null
                        : [...row.deptNames].sort().join(", ");
                    return (
                      <li key={row.norm}>
                        <Link
                          href={practiceTestsHref({
                            subject: subjectFilter,
                            code: row.display,
                          })}
                          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border border-blue-200 rounded-xl px-4 py-3 bg-blue-50/50 hover:bg-blue-100 transition"
                        >
                          <span className="font-mono font-semibold text-blue-950 text-lg">
                            {row.display}
                          </span>
                          <span className="text-sm text-gray-700">
                            {row.meqCount} MEQ · {row.sbaCount} SBA · {total} total
                            {deptLabel ? (
                              <span className="block text-xs text-gray-500 mt-0.5">{deptLabel}</span>
                            ) : null}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
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
