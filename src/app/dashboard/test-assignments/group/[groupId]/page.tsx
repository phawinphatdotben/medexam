"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { TEST_ASSIGNMENT_ROLES } from "@/lib/auth/roles";
import { useRoleGate } from "@/hooks/useRoleGate";

type GroupRow = {
  id: string;
  name: string;
  filter_course_code: string | null;
  filter_exam_format: string | null;
  filter_assessment_purpose: string | null;
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

export default function TestGroupDetailPage() {
  const params = useParams();
  const groupId = typeof params.groupId === "string" ? params.groupId : "";
  const { ready: accessOk, loading: gateLoading } = useRoleGate(TEST_ASSIGNMENT_ROLES, {
    noUserRedirect: "/login",
    wrongRoleRedirect: "/practice-tests",
  });

  const [groupLoadDone, setGroupLoadDone] = useState(false);
  const [group, setGroup] = useState<GroupRow | null>(null);
  const [tests, setTests] = useState<ListedTest[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    setGroupLoadDone(false);
    if (!accessOk || gateLoading) return;
    if (!groupId) {
      setGroup(null);
      setTests([]);
      setGroupLoadDone(true);
      return;
    }

    const { data: g, error: ge } = await supabase.from("staff_test_groups").select("*").eq("id", groupId).maybeSingle();

    if (ge || !g) {
      setGroup(null);
      setTests([]);
      if (ge) setErr(ge.message);
      setGroupLoadDone(true);
      return;
    }

    const row = g as GroupRow;
    setGroup(row);

    if (!row.filter_course_code || !row.filter_exam_format || !row.filter_assessment_purpose) {
      setTests([]);
      setGroupLoadDone(true);
      return;
    }

    if (row.filter_exam_format === "MEQ") {
      const { data: mt, error: me } = await supabase
        .from("meq_tests")
        .select("id, subject, course_code, public_code, test_year, review_status, test_function, assessment_purpose")
        .eq("course_code", row.filter_course_code)
        .eq("assessment_purpose", row.filter_assessment_purpose)
        .eq("test_function", "real_test")
        .order("public_code", { ascending: true });
      if (me) setErr(me.message);
      setTests(
        (mt ?? []).map((t) => {
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
            kind: "MEQ" as const,
            id: r.id,
            subject: r.subject,
            code: r.course_code,
            public_code: r.public_code,
            test_year: r.test_year,
            review_status: r.review_status,
            test_function: r.test_function,
            assessment_purpose: r.assessment_purpose,
          };
        }),
      );
      setGroupLoadDone(true);
      return;
    }

    const { data: st, error: se } = await supabase
      .from("sba_tests")
      .select("id, subject, subject_code, public_code, test_year, review_status, test_function, assessment_purpose")
      .eq("subject_code", row.filter_course_code)
      .eq("assessment_purpose", row.filter_assessment_purpose)
      .eq("test_function", "real_test")
      .order("public_code", { ascending: true });

    if (se) setErr(se.message);

    const raw = st ?? [];
    setTests(
      raw.map((t) => {
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
          kind: "SBA" as const,
          id: r.id,
          subject: r.subject,
          code: r.subject_code,
          public_code: r.public_code,
          test_year: r.test_year,
          review_status: r.review_status,
          test_function: r.test_function,
          assessment_purpose: r.assessment_purpose,
        };
      }),
    );
    setGroupLoadDone(true);
  }, [accessOk, gateLoading, groupId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const isCriteria =
    !!(group.filter_course_code && group.filter_exam_format && group.filter_assessment_purpose);

  return (
    <div className="min-h-screen bg-white pt-20 pb-16 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <Link href="/dashboard/test-assignments" className="text-blue-600 text-sm hover:underline">
            ← Test season assignments
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">{group.name}</h1>
          {isCriteria ? (
            <p className="text-sm text-gray-600 mt-1">
              <span className="font-mono">{group.filter_course_code}</span> · {group.filter_exam_format} ·{" "}
              {group.filter_assessment_purpose} — listing <strong>{group.filter_exam_format}</strong> real tests that
              match these filters (any review status).
            </p>
          ) : (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-2">
              Legacy bundle — tests are attached by UUID from the main assignments page, not scope filters.
            </p>
          )}
        </div>

        {err ? <div className="text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2 text-sm">{err}</div> : null}

        {!isCriteria ? null : tests.length === 0 ? (
          <p className="text-gray-600 text-sm">No real tests match these filters yet.</p>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 text-left">
                <tr>
                  <th className="px-3 py-2">Public ID</th>
                  <th className="px-3 py-2">Subject</th>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Year</th>
                  <th className="px-3 py-2">Review</th>
                  <th className="px-3 py-2">Assessment</th>
                </tr>
              </thead>
              <tbody>
                {tests.map((t) => (
                  <tr key={`${t.kind}-${t.id}`} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{t.public_code ?? "—"}</td>
                    <td className="px-3 py-2">{t.subject}</td>
                    <td className="px-3 py-2 font-mono text-xs">{t.code}</td>
                    <td className="px-3 py-2">{t.test_year}</td>
                    <td className="px-3 py-2">{t.review_status}</td>
                    <td className="px-3 py-2">{t.assessment_purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
