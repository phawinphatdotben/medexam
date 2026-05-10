"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { TEST_ASSIGNMENT_ROLES } from "@/lib/auth/roles";
import { useRoleGate } from "@/hooks/useRoleGate";
import { type BundleTrack, rowMatchesBundleTrack } from "@/lib/staff/testBundle";

type BundleSelectionScope = {
  course_code: string;
  test_year: number;
  exam_format: "MEQ" | "SBA";
  track: BundleTrack;
};

type GroupRow = {
  id: string;
  name: string;
  filter_course_code: string | null;
  filter_exam_format: string | null;
  filter_assessment_purpose: string | null;
  bundle_selection_scope: BundleSelectionScope | null;
};

type ListedTest =
  | {
      kind: "MEQ";
      id: string;
      subject: string;
      code: string;
      public_code: string | null;
      test_year: number;
      review_status: string;
      test_function: string;
      assessment_purpose: string;
    }
  | {
      kind: "SBA";
      id: string;
      subject: string;
      code: string;
      public_code: string | null;
      test_year: number;
      review_status: string;
      test_function: string;
      assessment_purpose: string;
    };

type DisplayRow = {
  /** `staff_test_group_items.id` when this row is an explicit link; null for criteria-driven listing */
  itemId: string | null;
  test: ListedTest;
};

function parseBundleScope(raw: unknown): BundleSelectionScope | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const course_code = o.course_code;
  const test_year = o.test_year;
  const exam_format = o.exam_format;
  const track = o.track;
  if (typeof course_code !== "string" || !course_code.trim()) return null;
  if (typeof test_year !== "number" || !Number.isFinite(test_year)) return null;
  if (exam_format !== "MEQ" && exam_format !== "SBA") return null;
  if (track !== "practice" && track !== "formative" && track !== "summative") return null;
  return { course_code: course_code.trim(), test_year, exam_format, track };
}

function inferScopeFromRows(rows: DisplayRow[]): BundleSelectionScope | null {
  if (rows.length === 0) return null;
  const t0 = rows[0].test;
  const kind = t0.kind;
  for (const r of rows) {
    const t = r.test;
    if (t.kind !== kind || t.code !== t0.code || t.test_year !== t0.test_year) return null;
  }
  const track: BundleTrack =
    t0.test_function === "practice"
      ? "practice"
      : t0.assessment_purpose === "formative"
        ? "formative"
        : "summative";
  return {
    course_code: t0.code,
    test_year: t0.test_year,
    exam_format: kind,
    track,
  };
}

export default function TestGroupDetailPage() {
  const params = useParams();
  const router = useRouter();
  const groupId = typeof params.groupId === "string" ? params.groupId : "";
  const { ready: accessOk, loading: gateLoading } = useRoleGate(TEST_ASSIGNMENT_ROLES, {
    noUserRedirect: "/login",
    wrongRoleRedirect: "/practice-tests",
  });

  const [groupLoadDone, setGroupLoadDone] = useState(false);
  const [group, setGroup] = useState<GroupRow | null>(null);
  const [displayRows, setDisplayRows] = useState<DisplayRow[]>([]);
  const [isCriteriaBundle, setIsCriteriaBundle] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [resolvedScope, setResolvedScope] = useState<BundleSelectionScope | null>(null);
  const [addCandidates, setAddCandidates] = useState<ListedTest[]>([]);
  const [loadingAddCandidates, setLoadingAddCandidates] = useState(false);
  const [selectedAddKeys, setSelectedAddKeys] = useState<Set<string>>(() => new Set());
  const [addingTests, setAddingTests] = useState(false);
  const [removingItemId, setRemovingItemId] = useState<string | null>(null);
  const [deletingBundle, setDeletingBundle] = useState(false);

  const includedKeys = useMemo(
    () => new Set(displayRows.map((r) => `${r.test.kind}:${r.test.id}`)),
    [displayRows],
  );

  const load = useCallback(async () => {
    setErr(null);
    setMsg(null);
    setGroupLoadDone(false);
    if (!accessOk || gateLoading) return;
    if (!groupId) {
      setGroup(null);
      setDisplayRows([]);
      setResolvedScope(null);
      setIsCriteriaBundle(false);
      setGroupLoadDone(true);
      return;
    }

    const { data: g, error: ge } = await supabase
      .from("staff_test_groups")
      .select(
        "id, name, filter_course_code, filter_exam_format, filter_assessment_purpose, bundle_selection_scope",
      )
      .eq("id", groupId)
      .maybeSingle();

    if (ge || !g) {
      setGroup(null);
      setDisplayRows([]);
      setResolvedScope(null);
      if (ge) setErr(ge.message);
      setGroupLoadDone(true);
      return;
    }

    const raw = g as Record<string, unknown>;
    const row: GroupRow = {
      id: raw.id as string,
      name: raw.name as string,
      filter_course_code: (raw.filter_course_code as string | null) ?? null,
      filter_exam_format: (raw.filter_exam_format as string | null) ?? null,
      filter_assessment_purpose: (raw.filter_assessment_purpose as string | null) ?? null,
      bundle_selection_scope: parseBundleScope(raw.bundle_selection_scope),
    };
    setGroup(row);

    const isCriteria = !!(
      row.filter_course_code &&
      row.filter_exam_format &&
      row.filter_assessment_purpose
    );
    setIsCriteriaBundle(isCriteria);

    let nextRows: DisplayRow[] = [];
    let nextScope: BundleSelectionScope | null = null;

    if (isCriteria) {
      if (row.filter_exam_format === "MEQ") {
        const { data: mt, error: me } = await supabase
          .from("meq_tests")
          .select(
            "id, subject, course_code, public_code, test_year, review_status, test_function, assessment_purpose",
          )
          .eq("course_code", row.filter_course_code as string)
          .eq("assessment_purpose", row.filter_assessment_purpose as string)
          .eq("test_function", "real_test")
          .order("public_code", { ascending: true });
        if (me) setErr(me.message);
        nextRows = (mt ?? []).map((t) => {
          const r = t as {
            id: string;
            subject: string;
            course_code: string;
            public_code: string | null;
            test_year: number;
            review_status: string;
            test_function: string;
            assessment_purpose: string;
          };
          return {
            itemId: null,
            test: {
              kind: "MEQ" as const,
              id: r.id,
              subject: r.subject,
              code: r.course_code,
              public_code: r.public_code,
              test_year: r.test_year,
              review_status: r.review_status,
              test_function: r.test_function,
              assessment_purpose: r.assessment_purpose,
            },
          };
        });
      } else {
        const { data: st, error: se } = await supabase
          .from("sba_tests")
          .select(
            "id, subject, subject_code, public_code, test_year, review_status, test_function, assessment_purpose",
          )
          .eq("subject_code", row.filter_course_code as string)
          .eq("assessment_purpose", row.filter_assessment_purpose as string)
          .eq("test_function", "real_test")
          .order("public_code", { ascending: true });

        if (se) setErr(se.message);

        nextRows = (st ?? []).map((t) => {
          const r = t as {
            id: string;
            subject: string;
            subject_code: string;
            public_code: string | null;
            test_year: number;
            review_status: string;
            test_function: string;
            assessment_purpose: string;
          };
          return {
            itemId: null,
            test: {
              kind: "SBA" as const,
              id: r.id,
              subject: r.subject,
              code: r.subject_code,
              public_code: r.public_code,
              test_year: r.test_year,
              review_status: r.review_status,
              test_function: r.test_function,
              assessment_purpose: r.assessment_purpose,
            },
          };
        });
      }
    } else {
      const { data: items, error: ie } = await supabase
        .from("staff_test_group_items")
        .select("id, meq_test_id, sba_test_id, sort_order")
        .eq("test_group_id", groupId)
        .order("sort_order", { ascending: true });
      if (ie) {
        setErr(ie.message);
        setDisplayRows([]);
        setResolvedScope(null);
        setGroupLoadDone(true);
        return;
      }
      const itemRows =
        ((items ?? []) as {
          id: string;
          meq_test_id: string | null;
          sba_test_id: string | null;
          sort_order: number;
        }[]) || [];

      const meqIds = [...new Set(itemRows.map((x) => x.meq_test_id).filter((id): id is string => !!id))];
      const sbaIds = [...new Set(itemRows.map((x) => x.sba_test_id).filter((id): id is string => !!id))];

      const meqById = new Map<string, ListedTest>();
      if (meqIds.length > 0) {
        const { data: mt, error: me } = await supabase
          .from("meq_tests")
          .select(
            "id, subject, course_code, public_code, test_year, review_status, test_function, assessment_purpose",
          )
          .in("id", meqIds);
        if (me) setErr(me.message);
        for (const r of (mt ?? []) as {
          id: string;
          subject: string;
          course_code: string;
          public_code: string | null;
          test_year: number;
          review_status: string;
          test_function: string;
          assessment_purpose: string;
        }[]) {
          meqById.set(r.id, {
            kind: "MEQ",
            id: r.id,
            subject: r.subject,
            code: r.course_code,
            public_code: r.public_code,
            test_year: r.test_year,
            review_status: r.review_status,
            test_function: r.test_function,
            assessment_purpose: r.assessment_purpose,
          });
        }
      }

      const sbaById = new Map<string, ListedTest>();
      if (sbaIds.length > 0) {
        const { data: st, error: se } = await supabase
          .from("sba_tests")
          .select(
            "id, subject, subject_code, public_code, test_year, review_status, test_function, assessment_purpose",
          )
          .in("id", sbaIds);
        if (se) setErr(se.message);
        for (const r of (st ?? []) as {
          id: string;
          subject: string;
          subject_code: string;
          public_code: string | null;
          test_year: number;
          review_status: string;
          test_function: string;
          assessment_purpose: string;
        }[]) {
          sbaById.set(r.id, {
            kind: "SBA",
            id: r.id,
            subject: r.subject,
            code: r.subject_code,
            public_code: r.public_code,
            test_year: r.test_year,
            review_status: r.review_status,
            test_function: r.test_function,
            assessment_purpose: r.assessment_purpose,
          });
        }
      }

      nextRows = [];
      for (const it of itemRows) {
        if (it.meq_test_id) {
          const test = meqById.get(it.meq_test_id);
          if (test) nextRows.push({ itemId: it.id, test });
        } else if (it.sba_test_id) {
          const test = sbaById.get(it.sba_test_id);
          if (test) nextRows.push({ itemId: it.id, test });
        }
      }

      nextScope = row.bundle_selection_scope ?? inferScopeFromRows(nextRows);
    }

    setDisplayRows(nextRows);
    setResolvedScope(nextScope);
    setAddCandidates([]);
    setSelectedAddKeys(new Set());
    setGroupLoadDone(true);
  }, [accessOk, gateLoading, groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const headerNote = useMemo(() => {
    if (!group) return "";
    if (isCriteriaBundle) {
      return `${group.filter_course_code} · ${group.filter_exam_format} · ${group.filter_assessment_purpose} — every matching real test for this scope (see table).`;
    }
    if (group.bundle_selection_scope) {
      const s = group.bundle_selection_scope;
      return `Tests linked to this bundle · ${s.course_code} · year ${s.test_year} · ${s.exam_format} · track ${s.track}`;
    }
    return "Explicit test list stored on this bundle.";
  }, [group, isCriteriaBundle]);

  const canEditExplicitItems = !isCriteriaBundle;
  const canAddViaScope = canEditExplicitItems && resolvedScope !== null;

  const loadAddCandidates = async () => {
    if (!groupId || !resolvedScope) return;
    const s = resolvedScope;
    setErr(null);
    setMsg(null);
    setLoadingAddCandidates(true);
    setSelectedAddKeys(new Set());
    try {
      if (s.exam_format === "MEQ") {
        const { data, error } = await supabase
          .from("meq_tests")
          .select(
            "id, subject, course_code, public_code, test_year, review_status, test_function, assessment_purpose",
          )
          .eq("course_code", s.course_code)
          .eq("test_year", s.test_year)
          .order("public_code", { ascending: true });
        if (error) {
          setErr(error.message);
          return;
        }
        const rows = (data || []) as {
          id: string;
          subject: string;
          course_code: string;
          public_code: string | null;
          test_year: number;
          review_status: string;
          test_function: string;
          assessment_purpose: string;
        }[];
        setAddCandidates(
          rows.filter((r) => rowMatchesBundleTrack(r, s.track)).map((r) => ({
            kind: "MEQ" as const,
            id: r.id,
            subject: r.subject,
            code: r.course_code,
            public_code: r.public_code,
            test_year: r.test_year,
            review_status: r.review_status,
            test_function: r.test_function,
            assessment_purpose: r.assessment_purpose,
          })),
        );
      } else {
        const { data, error } = await supabase
          .from("sba_tests")
          .select(
            "id, subject, subject_code, public_code, test_year, review_status, test_function, assessment_purpose",
          )
          .eq("subject_code", s.course_code)
          .eq("test_year", s.test_year)
          .order("public_code", { ascending: true });
        if (error) {
          setErr(error.message);
          return;
        }
        const rows = (data || []) as {
          id: string;
          subject: string;
          subject_code: string;
          public_code: string | null;
          test_year: number;
          review_status: string;
          test_function: string;
          assessment_purpose: string;
        }[];
        setAddCandidates(
          rows.filter((r) => rowMatchesBundleTrack(r, s.track)).map((r) => ({
            kind: "SBA" as const,
            id: r.id,
            subject: r.subject,
            code: r.subject_code,
            public_code: r.public_code,
            test_year: r.test_year,
            review_status: r.review_status,
            test_function: r.test_function,
            assessment_purpose: r.assessment_purpose,
          })),
        );
      }
      setMsg("Pick exams below, then add them to the bundle.");
    } finally {
      setLoadingAddCandidates(false);
    }
  };

  const toggleAddKey = (key: string) => {
    setSelectedAddKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const addSelectedToBundle = async () => {
    if (!groupId || !resolvedScope) return;
    const keysToAdd = [...selectedAddKeys].filter((k) => !includedKeys.has(k));
    if (keysToAdd.length === 0) {
      setErr("Select at least one exam that is not already in this bundle.");
      return;
    }
    setAddingTests(true);
    setErr(null);
    setMsg(null);
    try {
      let startOrder = displayRows.length;

      const { data: rawItems } = await supabase
        .from("staff_test_group_items")
        .select("sort_order")
        .eq("test_group_id", groupId);
      const orders = (((rawItems ?? []) as { sort_order: number }[]) || []).map((x) => x.sort_order);
      if (orders.length > 0) startOrder = Math.max(...orders) + 1;

      const rowsPayload = keysToAdd.map((key, i) => {
        const [kind, id] = key.split(":");
        if (kind === "MEQ") return { test_group_id: groupId, meq_test_id: id, sort_order: startOrder + i };
        return { test_group_id: groupId, sba_test_id: id, sort_order: startOrder + i };
      });
      const { error } = await supabase.from("staff_test_group_items").insert(rowsPayload);
      if (error) {
        setErr(error.message);
        return;
      }
      setMsg(`Added ${keysToAdd.length} exam(s) to this bundle.`);
      setSelectedAddKeys(new Set());
      await load();
    } finally {
      setAddingTests(false);
    }
  };

  const removeItem = async (itemId: string) => {
    if (!itemId) return;
    if (!confirm("Remove this exam from the bundle? (Scheduled assignments stay; they still reference this bundle.)"))
      return;
    setRemovingItemId(itemId);
    setErr(null);
    try {
      const { error } = await supabase.from("staff_test_group_items").delete().eq("id", itemId);
      if (error) {
        setErr(error.message);
        return;
      }
      setMsg("Exam removed from the bundle.");
      await load();
    } finally {
      setRemovingItemId(null);
    }
  };

  const deleteWholeBundle = async () => {
    if (!groupId) return;
    if (
      !confirm(
        "Delete this entire test bundle?\n\n" +
          "This removes the bundle and linked scheduling rows for any assignments tied to it. " +
          "This cannot be undone.",
      )
    )
      return;
    setDeletingBundle(true);
    setErr(null);
    try {
      const { error } = await supabase.from("staff_test_groups").delete().eq("id", groupId);
      if (error) {
        setErr(error.message);
        return;
      }
      router.push("/dashboard/test-assignments");
      router.refresh();
    } finally {
      setDeletingBundle(false);
    }
  };

  if (!accessOk || gateLoading || !groupLoadDone) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-20">
        <span className="text-gray-600">Loading…</span>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="min-h-screen pt-20 px-4">
        <p className="text-red-700">Could not load this bundle.</p>
        <Link href="/dashboard/test-assignments" className="text-blue-700 underline mt-4 inline-block">
          Back to test assignments
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white pt-20 pb-16 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <Link href="/dashboard/test-assignments" className="text-blue-600 text-sm hover:underline">
            ← Test season assignments
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-3 mt-2">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{group.name}</h1>
              <p className="text-sm text-gray-600 mt-1">{headerNote}</p>
              {isCriteriaBundle ? (
                <p className="text-xs text-gray-500 mt-2">
                  This is a criteria bundle: exams are chosen automatically by filters. Remove individual rows by
                  switching to an explicit bundle, or delete the whole bundle below.
                </p>
              ) : (
                <p className="text-xs text-gray-600 mt-2">
                  Rows below are exams linked through <strong>staff_test_group_items</strong>. Students still need{" "}
                  <strong>approved</strong> status to open exams from Test taking when scheduled.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void deleteWholeBundle()}
              disabled={deletingBundle}
              className="shrink-0 rounded border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
            >
              {deletingBundle ? "Deleting…" : "Delete entire bundle"}
            </button>
          </div>
        </div>

        {err ? (
          <div className="text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2 text-sm">{err}</div>
        ) : null}
        {msg ? (
          <div className="text-green-900 bg-green-50 border border-green-200 rounded px-3 py-2 text-sm">{msg}</div>
        ) : null}

        {canEditExplicitItems && !canAddViaScope ? (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            This bundle mixes different subject codes, years, or formats, or was created without a saved scope snapshot.
            You can remove rows or delete the bundle.{" "}
            <span className="font-medium">
              Adding exams requires a single catalog code and year across all linked tests.
            </span>
          </div>
        ) : null}

        {canAddViaScope ? (
          <section className="rounded-lg border border-gray-200 bg-gray-50/80 p-4 space-y-3">
            <h2 className="text-base font-semibold text-gray-900">Add exams (same scope as this bundle)</h2>
            <p className="text-xs text-gray-600">
              Uses code <span className="font-mono">{resolvedScope.course_code}</span>, year{" "}
              <span className="font-mono">{resolvedScope.test_year}</span>, format{" "}
              <span className="font-mono">{resolvedScope.exam_format}</span>, track{" "}
              <span className="font-mono">{resolvedScope.track}</span> — pending and approved exams are listed.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void loadAddCandidates()}
                disabled={loadingAddCandidates}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {loadingAddCandidates ? "Loading…" : "Show matching exams"}
              </button>
              <button
                type="button"
                onClick={() => void addSelectedToBundle()}
                disabled={addingTests || selectedAddKeys.size === 0}
                className="rounded border border-blue-700 px-3 py-1.5 text-sm font-medium text-blue-800 hover:bg-blue-50 disabled:opacity-50"
              >
                {addingTests ? "Adding…" : `Add selected (${selectedAddKeys.size})`}
              </button>
            </div>

            {addCandidates.length === 0 && !loadingAddCandidates ? (
              <p className="text-sm text-gray-500">Load matching exams to add more to this bundle.</p>
            ) : addCandidates.length > 0 ? (
              <div className="border rounded bg-white overflow-x-auto">
                <table className="w-full text-xs min-w-[640px]">
                  <thead className="bg-gray-100 text-left">
                    <tr>
                      <th className="px-2 py-1 w-10" />
                      <th className="px-2 py-1">Public ID</th>
                      <th className="px-2 py-1">Type</th>
                      <th className="px-2 py-1">Review</th>
                      <th className="px-2 py-1">Function</th>
                    </tr>
                  </thead>
                  <tbody>
                    {addCandidates.map((t) => {
                      const key = `${t.kind}:${t.id}`;
                      const already = includedKeys.has(key);
                      return (
                        <tr key={key} className="border-t">
                          <td className="px-2 py-1">
                            <input
                              type="checkbox"
                              checked={selectedAddKeys.has(key)}
                              disabled={already}
                              onChange={() => toggleAddKey(key)}
                              aria-label={`Select ${key}`}
                            />
                          </td>
                          <td className="px-2 py-1 font-mono">{t.public_code ?? "—"}</td>
                          <td className="px-2 py-1">{t.kind}</td>
                          <td className="px-2 py-1">{t.review_status}</td>
                          <td className="px-2 py-1">{t.test_function}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        ) : null}

        {displayRows.length === 0 ? (
          <p className="text-gray-600 text-sm">No tests to show yet.</p>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 text-left">
                <tr>
                  <th className="px-3 py-2">Public ID</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Subject</th>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Year</th>
                  <th className="px-3 py-2">Review</th>
                  <th className="px-3 py-2">Assessment</th>
                  {canEditExplicitItems ? <th className="px-3 py-2 w-28">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row) => {
                  const t = row.test;
                  const key = `${t.kind}:${t.id}`;
                  return (
                    <tr key={key} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs">{t.public_code ?? "—"}</td>
                      <td className="px-3 py-2">{t.kind}</td>
                      <td className="px-3 py-2">{t.subject}</td>
                      <td className="px-3 py-2 font-mono text-xs">{t.code}</td>
                      <td className="px-3 py-2">{t.test_year}</td>
                      <td className="px-3 py-2">{t.review_status}</td>
                      <td className="px-3 py-2">{t.assessment_purpose}</td>
                      {canEditExplicitItems ? (
                        <td className="px-3 py-2">
                          {row.itemId ? (
                            <button
                              type="button"
                              onClick={() => void removeItem(row.itemId!)}
                              disabled={removingItemId === row.itemId}
                              className="text-red-700 text-xs font-medium hover:underline disabled:opacity-50"
                            >
                              {removingItemId === row.itemId ? "…" : "Remove"}
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400" title="Criteria bundle rows are computed">
                              —
                            </span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
