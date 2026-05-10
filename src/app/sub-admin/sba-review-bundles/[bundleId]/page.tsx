"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { COMMITTEE_PAGE_ROLES } from "@/lib/auth/roles";
import { useRoleGate } from "@/hooks/useRoleGate";
import type { CommitteePurpose } from "@/lib/committeeScope";

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

type PoolTestRow = {
  id: string;
  subject: string;
  subject_code: string;
  review_status: string;
  test_function: "practice" | "real_test";
  assessment_purpose: CommitteePurpose;
  public_code: string | null;
  created_by: string | null;
};

type BundleItemRow = {
  bundle_id: string;
  sba_test_id: string;
  sort_order: number;
  sba_tests: PoolTestRow | null;
};

export default function SbaReviewBundleDetailPage() {
  const rawId = useParams()?.bundleId;
  const bundleId = typeof rawId === "string" ? rawId : "";

  const { ready: accessOk, loading: gateLoading, role: myRole } = useRoleGate(COMMITTEE_PAGE_ROLES, {
    noUserRedirect: "/login",
    wrongRoleRedirect: "/dashboard",
  });

  const canManageItems = myRole === "admin" || myRole === "sub_admin";
  const isEducator = myRole === "educator";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [bundle, setBundle] = useState<BundleRow | null>(null);
  const [committeeLabel, setCommitteeLabel] = useState("");
  const [pool, setPool] = useState<PoolTestRow[]>([]);
  const [items, setItems] = useState<BundleItemRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, { full_name: string | null; email: string | null }>>({});
  const [savingMut, setSavingMut] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessOk || gateLoading || !bundleId) return;
    setLoading(true);
    setErr(null);

    const { data: bd, error: be } = await supabase.from("sba_committee_review_bundles").select("*").eq("id", bundleId).maybeSingle();
    if (be || !bd) {
      setErr(be?.message ?? "Bundle not found or not authorized.");
      setBundle(null);
      setLoading(false);
      return;
    }
    const b = bd as BundleRow;
    setBundle(b);

    const { data: cm } = await supabase.from("committees").select("name").eq("id", b.committee_id).maybeSingle();
    setCommitteeLabel((cm as { name: string } | null)?.name ?? b.committee_id);

    const { data: itemRows, error: ie } = await supabase
      .from("sba_committee_bundle_items")
      .select(`
        bundle_id,
        sba_test_id,
        sort_order,
        sba_tests (
          id,
          subject,
          subject_code,
          review_status,
          test_function,
          assessment_purpose,
          public_code,
          created_by
        )
      `)
      .eq("bundle_id", bundleId)
      .order("sort_order");

    if (ie) {
      setErr(ie.message);
      setLoading(false);
      return;
    }
    const typedItems = ((itemRows as unknown[]) || []).map((row) => {
      const r = row as Omit<BundleItemRow, "sba_tests"> & { sba_tests: PoolTestRow | PoolTestRow[] | null };
      const st = r.sba_tests;
      const one = Array.isArray(st) ? st[0] : st;
      return {
        bundle_id: r.bundle_id,
        sba_test_id: r.sba_test_id,
        sort_order: r.sort_order,
        sba_tests: one ?? null,
      } satisfies BundleItemRow;
    });
    setItems(typedItems);

    let poolQuery = supabase
      .from("sba_tests")
      .select("id, subject, subject_code, review_status, test_function, assessment_purpose, public_code, created_by")
      .eq("subject_code", b.course_code)
      .eq("test_year", b.test_year)
      .eq("assessment_purpose", b.assessment_purpose);

    if (!b.include_practice_in_pool) {
      poolQuery = poolQuery.eq("test_function", "real_test");
    }

    const { data: poolRows, error: pe } = await poolQuery.order("subject");
    let poolResolved: PoolTestRow[] = [];
    if (pe) {
      setErr(pe.message);
      setPool([]);
    } else {
      poolResolved = (poolRows as PoolTestRow[]) || [];
      setPool(poolResolved);
    }

    const creatorIds = new Set<string>();
    for (const t of poolResolved) {
      if (t.created_by) creatorIds.add(t.created_by);
    }
    const idList = [...creatorIds];
    if (idList.length > 0) {
      const { data: pf } = await supabase.from("profiles").select("id, full_name, email").in("id", idList);
      const pmap: Record<string, { full_name: string | null; email: string | null }> = {};
      for (const row of pf || []) {
        const id = row.id as string;
        pmap[id] = { full_name: (row.full_name as string | null) ?? null, email: (row.email as string) ?? null };
      }
      setProfiles(pmap);
    } else {
      setProfiles({});
    }

    setLoading(false);
  }, [accessOk, gateLoading, bundleId]);

  useEffect(() => {
    void load();
  }, [load]);

  const itemTestIds = useMemo(() => new Set(items.map((i) => i.sba_test_id)), [items]);

  const poolGrouped = useMemo(() => {
    const byStaff = new Map<string, PoolTestRow[]>();
    for (const row of pool) {
      const k = row.created_by ?? "__unknown__";
      const cur = byStaff.get(k) || [];
      cur.push(row);
      byStaff.set(k, cur);
    }
    const sortRows = (a: PoolTestRow, x: PoolTestRow) =>
      a.subject.localeCompare(x.subject) || a.id.localeCompare(x.id);

    const out: { staffKey: string; label: string; rows: PoolTestRow[] }[] = [];
    for (const [key, rows] of byStaff) {
      rows.sort(sortRows);
      const label =
        key === "__unknown__"
          ? "Staff unknown"
          : profiles[key]?.full_name?.trim()
            ? profiles[key]!.full_name!
            : profiles[key]?.email
              ? profiles[key]!.email!
              : `Staff (${key.slice(0, 8)}…)`;
      out.push({ staffKey: key, label, rows });
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [pool, profiles]);

  const displayStatus = (s: string) => {
    if (s === "approved") return { text: "Approved", cls: "text-green-800 bg-green-50 border-green-100" };
    if (s === "pending_committee") return { text: "Pending", cls: "text-amber-900 bg-amber-50 border-amber-100" };
    if (s === "rejected") return { text: "Rejected", cls: "text-red-800 bg-red-50 border-red-100" };
    return { text: s, cls: "text-slate-700 bg-slate-50 border-slate-100" };
  };

  const addTest = async (testId: string) => {
    if (!bundleId || !bundle || !canManageItems || savingMut) return;
    const nextOrd = Math.max(0, ...items.map((i) => i.sort_order ?? 0)) + 10;
    setSavingMut(`add-${testId}`);
    setErr(null);
    const { error } = await supabase.from("sba_committee_bundle_items").upsert({
      bundle_id: bundleId,
      sba_test_id: testId,
      sort_order: nextOrd,
    });
    setSavingMut(null);
    if (error) {
      setErr(error.message);
      return;
    }
    await load();
  };

  const removeTest = async (testId: string) => {
    if (!bundleId || !canManageItems || savingMut) return;
    setSavingMut(`rm-${testId}`);
    setErr(null);
    const { error } = await supabase
      .from("sba_committee_bundle_items")
      .delete()
      .eq("bundle_id", bundleId)
      .eq("sba_test_id", testId);
    setSavingMut(null);
    if (error) {
      setErr(error.message);
      return;
    }
    await load();
  };

  if (!accessOk || gateLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-20 text-gray-600">Loading...</div>
    );
  }

  if (!bundleId) {
    return (
      <div className="min-h-screen pt-20 px-4">
        <p className="text-red-700">Missing bundle.</p>
        <Link href="/sub-admin/sba-review-bundles" className="text-blue-600 text-sm mt-4 inline-block">
          Back to bundles
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pt-20 pb-16 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-start">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{bundle?.name ?? "Review bundle"}</h1>
            {bundle ? (
              <p className="text-sm text-slate-600 mt-1">
                {bundle.course_code} · Year {bundle.test_year} · {bundle.assessment_purpose === "summative" ? "Summative" : "Formative"}
                · Committee {committeeLabel}
                {bundle.include_practice_in_pool ? " · pool includes practice SBAs" : ""}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <Link href="/sub-admin/sba-review-bundles" className="text-blue-600 hover:underline whitespace-nowrap">
              &larr; All bundles
            </Link>
            <Link href="/sub-admin" className="text-blue-600 hover:underline whitespace-nowrap">
              Committee home
            </Link>
          </div>
        </div>

        {err && (
          <div className="p-3 rounded border border-red-200 bg-red-50 text-red-800 text-sm">{err}</div>
        )}

        {isEducator && bundle ? (
          <div className="rounded border border-amber-200 bg-amber-50 text-amber-950 px-4 py-3 text-sm">
            <strong>Committee view:</strong> browse the curated list and open any test — content is read-only for
            educators. Modified Angoff and scores stay on each test row under <Link href="/sub-admin" className="underline font-semibold">Exam review committee</Link>.
          </div>
        ) : null}

        {loading ? (
          <p className="text-slate-600">Loading…</p>
        ) : !bundle ? null : (
          <>
            <section className="bg-white border rounded-lg p-6 text-sm space-y-3">
              <h2 className="font-semibold text-lg">Tests in this bundle</h2>
              {items.length === 0 ? (
                <p className="text-slate-500">No tests added yet{canManageItems ? " — use the pool below." : "."}</p>
              ) : (
                <ul className="space-y-2">
                  {items.map((row) => {
                    const q = row.sba_tests;
                    if (!q) return null;
                    const st = displayStatus(q.review_status);
                    return (
                      <li
                        key={row.sba_test_id}
                        className="flex flex-wrap gap-3 items-start justify-between border border-slate-100 rounded p-3"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/sub-admin/test-review/sba/${row.sba_test_id}`}
                            className="font-medium text-blue-700 hover:underline"
                          >
                            {q.subject} · {q.subject_code}{" "}
                            <span className="font-mono text-xs text-slate-600">
                              [{q.public_code ?? row.sba_test_id.slice(0, 8)}]
                            </span>
                          </Link>
                          <div className="text-xs text-slate-600 mt-0.5">
                            {q.test_function === "practice" ? "Practice" : `Real (${q.assessment_purpose})`}
                          </div>
                          <span className={`mt-1 inline-block text-xs px-2 py-0.5 rounded border ${st.cls}`}>
                            {st.text}
                          </span>
                        </div>
                        <div className="flex shrink-0 gap-2 flex-wrap justify-end">
                          <Link
                            href={`/sub-admin/angoff/sba/${row.sba_test_id}`}
                            className="text-xs font-semibold text-slate-700 border rounded px-2 py-1 hover:bg-slate-50"
                          >
                            Angoff
                          </Link>
                          {canManageItems ? (
                            <button
                              type="button"
                              disabled={savingMut?.startsWith("rm")}
                              className="text-xs font-semibold text-red-700 border border-red-100 rounded px-2 py-1 hover:bg-red-50 disabled:opacity-50"
                              onClick={() => void removeTest(row.sba_test_id)}
                            >
                              {savingMut === `rm-${row.sba_test_id}` ? "Removing…" : "Remove from bundle"}
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {canManageItems ? (
              <section className="bg-white border rounded-lg p-6 text-sm space-y-6">
                <div>
                  <h2 className="font-semibold text-lg mb-2">Pool (matching code, year, track)</h2>
                  <p className="text-xs text-slate-600">
                    Rows are grouped by author. Approved means review status passes; admins and sub-admins edit content
                    on the test review screen regardless.
                  </p>
                </div>
                <div className="space-y-6">
                  {poolGrouped.map((grp) => (
                    <div key={grp.staffKey}>
                      <h3 className="font-semibold text-slate-900 mb-2 border-b border-slate-100 pb-1">
                        {grp.label}
                      </h3>
                      <ul className="space-y-2">
                        {grp.rows.map((t) => {
                          const ds = displayStatus(t.review_status);
                          const inBundle = itemTestIds.has(t.id);
                          return (
                            <li
                              key={t.id}
                              className="flex flex-wrap gap-3 items-start justify-between border rounded p-3 border-slate-100"
                            >
                              <div className="min-w-0">
                                <Link
                                  href={`/sub-admin/test-review/sba/${t.id}`}
                                  className="font-medium text-blue-700 hover:underline"
                                >
                                  {t.subject} ·{" "}
                                  <span className="font-mono text-xs">
                                    {t.public_code ?? t.id.slice(0, 8)}
                                  </span>
                                </Link>
                                <div className="text-xs text-slate-600 mt-0.5">
                                  {t.test_function === "practice" ? "Practice" : `Real (${t.assessment_purpose})`}
                                </div>
                                <span className={`mt-1 inline-block text-xs px-2 py-0.5 rounded border ${ds.cls}`}>
                                  {ds.text}
                                </span>
                              </div>
                              {inBundle ? (
                                <span className="text-xs font-semibold text-slate-500">In bundle</span>
                              ) : (
                                <button
                                  type="button"
                                  className="text-xs font-semibold bg-blue-900 text-white rounded px-3 py-1.5 disabled:opacity-50 shrink-0"
                                  disabled={savingMut?.startsWith("add")}
                                  onClick={() => void addTest(t.id)}
                                >
                                  {savingMut === `add-${t.id}` ? "Adding…" : "Add to bundle"}
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                  {pool.length === 0 ? (
                    <p className="text-slate-500 text-sm">
                      No SBA tests matched this bundle scope yet (or migration 031 is not applied).
                    </p>
                  ) : null}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
