"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { COMMITTEE_PAGE_ROLES } from "@/lib/auth/roles";
import { getSessionUserId } from "@/lib/auth/session";
import { committeeScopesMatchTest } from "@/lib/committeeScope";
import type { CommitteePurpose } from "@/lib/committeeScope";
import { useRoleGate } from "@/hooks/useRoleGate";

type BundleRow = {
  id: string;
  name: string;
  course_code: string;
  test_year: number;
  assessment_purpose: CommitteePurpose;
  committee_id: string;
  include_practice_in_pool: boolean;
  created_at: string;
};

type CommitteeRow = {
  id: string;
  name: string;
  course_code: string;
  test_year: number;
  purpose: CommitteePurpose;
};

export default function SbaReviewBundlesPage() {
  const { ready: accessOk, loading: gateLoading, role: myRole } = useRoleGate(COMMITTEE_PAGE_ROLES, {
    noUserRedirect: "/login",
    wrongRoleRedirect: "/dashboard",
  });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [bundles, setBundles] = useState<BundleRow[]>([]);
  const [committees, setCommittees] = useState<CommitteeRow[]>([]);
  const [catalogCourses, setCatalogCourses] = useState<{ course_code: string; course_title: string | null }[]>(
    [],
  );

  const canManageBundles = myRole === "admin" || myRole === "sub_admin";

  const load = useCallback(async () => {
    if (!accessOk || gateLoading) return;
    setLoading(true);
    setErr(null);
    const { data: bs, error: be } = await supabase
      .from("sba_committee_review_bundles")
      .select("id, name, course_code, test_year, assessment_purpose, committee_id, include_practice_in_pool, created_at")
      .order("created_at", { ascending: false });
    if (be) {
      setErr(be.message);
      setBundles([]);
      setLoading(false);
      return;
    }
    setBundles((bs as BundleRow[]) || []);
    const { data: cc } = await supabase.from("course_catalog").select("course_code, course_title").order("course_code").limit(800);
    setCatalogCourses(cc || []);

    const { data: cms } = await supabase.from("committees").select("id, name, course_code, test_year, purpose").order("name");
    setCommittees((cms as CommitteeRow[]) || []);

    setLoading(false);
  }, [accessOk, gateLoading]);

  useEffect(() => {
    void load();
  }, [load]);

  const committeeNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of committees) m.set(c.id, c.name);
    return m;
  }, [committees]);

  const newBundleDefaults = () => ({
    name: "",
    course_code: "",
    test_year: String(new Date().getFullYear()),
    assessment_purpose: "summative" as CommitteePurpose,
    committee_id: "",
    include_practice_in_pool: false,
  });
  const [form, setForm] = useState(newBundleDefaults);
  const [savingCreate, setSavingCreate] = useState(false);

  const committeesForForm = useMemo(() => {
    const y = parseInt(form.test_year, 10);
    if (!Number.isFinite(y) || !form.course_code.trim()) return [];
    const code = form.course_code.trim().toUpperCase();
    return committees.filter((c) =>
      committeeScopesMatchTest({
        committeeCourseCode: c.course_code,
        committeeYear: c.test_year,
        committeePurpose: c.purpose,
        testCourseCode: code,
        testYear: y,
        testFunction: "real_test",
        assessmentPurpose: form.assessment_purpose,
      }),
    );
  }, [committees, form.assessment_purpose, form.course_code, form.test_year]);

  const handleCreateBundle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageBundles) return;
    const creator = await getSessionUserId();
    if (!creator) {
      setErr("Not signed in.");
      return;
    }
    const y = parseInt(form.test_year, 10);
    if (!Number.isFinite(y)) {
      setErr("Enter a valid year.");
      return;
    }
    if (!form.name.trim()) {
      setErr("Give the bundle a name.");
      return;
    }
    if (!form.course_code.trim()) {
      setErr("Select a catalog course.");
      return;
    }
    if (!form.committee_id) {
      setErr("Select a committee scoped to this course, year, and track.");
      return;
    }
    setSavingCreate(true);
    setErr(null);
    const row = {
      name: form.name.trim(),
      course_code: form.course_code.trim().toUpperCase(),
      test_year: y,
      assessment_purpose: form.assessment_purpose,
      committee_id: form.committee_id,
      include_practice_in_pool: form.include_practice_in_pool,
      created_by: creator,
    };
    const { error } = await supabase.from("sba_committee_review_bundles").insert(row);
    setSavingCreate(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setForm(newBundleDefaults());
    await load();
  };

  if (!accessOk || gateLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-20 text-gray-600">Loading...</div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pt-20 pb-16 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-start">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">SBA committee review bundles</h1>
            <p className="text-sm text-slate-600 mt-1 max-w-xl">
              Group qualifying SBA tests by catalog code, year, and formative or summative track. Assign your exam
              committee so members can browse the curated list and open tests read-only alongside Angoff workflows.
              Only admins and sub-admins assemble bundles and edit tests.
            </p>
          </div>
          <Link href="/sub-admin" className="text-blue-600 text-sm shrink-0 hover:underline whitespace-nowrap">
            &larr; Exam review committee
          </Link>
        </div>

        {err && (
          <div className="p-3 rounded border border-red-200 bg-red-50 text-red-800 text-sm">{err}</div>
        )}

        {canManageBundles && (
          <section className="bg-white border rounded-lg p-6 text-sm space-y-4">
            <h2 className="font-semibold text-lg">New bundle</h2>
            <form onSubmit={handleCreateBundle} className="space-y-4 max-w-xl">
              <div>
                <label className="block text-xs font-semibold text-slate-500">Bundle name</label>
                <input
                  type="text"
                  className="mt-1 w-full border rounded-md px-3 py-2"
                  placeholder="e.g. CHMD 7404 · 2026 · Summative real pool"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Course (catalog)</label>
                  <select
                    className="mt-1 w-full border rounded-md px-3 py-2"
                    value={form.course_code}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, course_code: e.target.value, committee_id: "" }))
                    }
                  >
                    <option value="">Select…</option>
                    {catalogCourses
                      .filter((row) => row.course_code !== "LEGACY-COMMITTEE")
                      .map((row) => (
                        <option key={row.course_code} value={row.course_code}>
                          {row.course_code}
                          {row.course_title ? ` — ${row.course_title}` : ""}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Year</label>
                  <input
                    type="number"
                    className="mt-1 w-full border rounded-md px-3 py-2"
                    value={form.test_year}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, test_year: e.target.value, committee_id: "" }))
                    }
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500">Assessment track</label>
                <select
                  className="mt-1 w-full border rounded-md px-3 py-2"
                  value={form.assessment_purpose}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      assessment_purpose: e.target.value as CommitteePurpose,
                      committee_id: "",
                    }))
                  }
                >
                  <option value="summative">Summative (real high-stakes)</option>
                  <option value="formative">Formative (practice + real formative)</option>
                </select>
              </div>
              <div className="flex items-start gap-2">
                <input
                  id="incl-prac"
                  type="checkbox"
                  checked={form.include_practice_in_pool}
                  onChange={(e) => setForm((f) => ({ ...f, include_practice_in_pool: e.target.checked }))}
                />
                <label htmlFor="incl-prac" className="text-sm leading-tight cursor-pointer">
                  Include <strong>practice</strong> SBA rows in the staff pool picker (summative bundles usually leave
                  this off).
                </label>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500">Exam committee</label>
                <select
                  className="mt-1 w-full border rounded-md px-3 py-2 disabled:opacity-50"
                  disabled={committeesForForm.length === 0}
                  value={form.committee_id}
                  onChange={(e) => setForm((f) => ({ ...f, committee_id: e.target.value }))}
                >
                  <option value="">{committeesForForm.length ? "Choose committee…" : "No matching committees yet"}</option>
                  {committeesForForm.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={savingCreate}
                className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {savingCreate ? "Creating…" : "Create bundle"}
              </button>
            </form>
          </section>
        )}

        <section className="bg-white border rounded-lg p-6 text-sm space-y-3">
          <div className="flex justify-between items-baseline gap-4">
            <h2 className="font-semibold text-lg">Your bundles</h2>
            <button
              type="button"
              onClick={() => void load()}
              className="text-blue-700 text-xs font-semibold hover:underline"
              disabled={loading}
            >
              Refresh
            </button>
          </div>
          {loading ? (
            <p className="text-slate-600">Loading…</p>
          ) : bundles.length === 0 ? (
            <p className="text-slate-500">No bundles yet — create one if you&apos;re permitted, or join a committee.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {bundles.map((b) => (
                <li key={b.id} className="py-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link
                      href={`/sub-admin/sba-review-bundles/${b.id}`}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {b.name}
                    </Link>
                    <div className="text-xs text-slate-600 mt-0.5">
                      {b.course_code} · {b.test_year} · {b.assessment_purpose === "summative" ? "Summative" : "Formative"}{" "}
                      · committee {committeeNameById.get(b.committee_id) ?? b.committee_id}
                      {b.include_practice_in_pool ? " · pool includes practice SBAs" : ""}
                    </div>
                  </div>
                  <Link
                    href={`/sub-admin/sba-review-bundles/${b.id}`}
                    className="text-slate-800 text-xs font-semibold border rounded px-2 py-1 hover:bg-slate-50"
                  >
                    Open bundle
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
