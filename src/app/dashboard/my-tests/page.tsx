"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Row = {
  id: string;
  kind: "SBA" | "MEQ";
  subject: string;
  subject_code: string;
  test_function: "practice" | "real_test";
  test_year: number;
  review_status: string;
  created_at: string;
  created_by: string | null;
};

const statusClass: Record<string, string> = {
  pending_committee: "bg-amber-100 text-amber-900",
  approved: "bg-green-100 text-green-900",
  rejected: "bg-red-100 text-red-900",
};

export default function MyTestsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [profileRole, setProfileRole] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: s } = await supabase.auth.getSession();
    if (!s.session?.user) {
      router.replace("/login");
      return;
    }
    setUid(s.session.user.id);
    const { data: prof } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", s.session.user.id)
      .maybeSingle();
    setProfileRole(prof?.role ?? null);
    setErr(null);
    const { data: sba, error: e1 } = await supabase
      .from("sba_tests")
      .select("id, subject, subject_code, test_function, test_year, review_status, created_at, created_by")
      .order("created_at", { ascending: false });
    const { data: meq, error: e2 } = await supabase
      .from("meq_tests")
      .select("id, subject, course_code, test_function, test_year, review_status, created_at, created_by")
      .order("created_at", { ascending: false });

    if (e1 || e2) {
      setErr(
        e1?.message ||
          e2?.message ||
          "Could not load tests. If tables are missing, run migration 002 in Supabase."
      );
    }

    const merged: Row[] = [
      ...(sba || []).map((r) => ({ ...r, kind: "SBA" as const, created_by: r.created_by ?? null })),
      ...(meq || []).map((r) => ({
        ...r,
        subject_code: r.course_code,
        kind: "MEQ" as const,
        created_by: r.created_by ?? null,
      })),
    ];
    merged.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    setRows(merged);
    setReady(true);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-20">
        <span className="text-gray-600">Loading...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white pt-20 pb-16 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">My tests</h1>
        <p className="text-gray-600 text-sm mb-6">
          When the committee approves, status shows <strong>pass</strong> (approved) here and in
          sub-admin review tools.
        </p>
        <div className="mb-4 flex gap-2">
          <Link
            href="/dashboard/create"
            className="text-sm font-medium text-blue-600 hover:underline"
          >
            + Create new test
          </Link>
          <span className="text-gray-300">|</span>
          <Link href="/dashboard" className="text-sm text-gray-600 hover:underline">
            Staff dashboard
          </Link>
        </div>

        {err && (
          <div className="mb-4 p-3 rounded border border-red-200 bg-red-50 text-red-800 text-sm">
            {err}
          </div>
        )}

        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Subject</th>
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2">Function</th>
                <th className="px-4 py-2">Year</th>
                <th className="px-4 py-2">Committee</th>
                <th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    No tests yet. Create an SBA or MEQ from the staff dashboard.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={`${r.kind}-${r.id}`} className="border-t">
                    <td className="px-4 py-2 font-mono text-xs">{r.kind}</td>
                    <td className="px-4 py-2">{r.subject}</td>
                    <td className="px-4 py-2 font-mono">{r.subject_code}</td>
                    <td className="px-4 py-2">
                      {r.test_function === "practice" ? "Practice" : "Real test"}
                    </td>
                    <td className="px-4 py-2">{r.test_year}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded ${
                          statusClass[r.review_status] || "bg-gray-100"
                        }`}
                      >
                        {r.review_status === "approved"
                          ? "Pass (approved)"
                          : r.review_status === "pending_committee"
                            ? "Pending committee"
                            : r.review_status}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {r.kind === "MEQ" &&
                      uid &&
                      (r.created_by === uid || profileRole === "admin") ? (
                        <a
                          href={`/dashboard/edit-meq/${r.id}`}
                          className="text-blue-700 hover:underline text-sm font-medium"
                        >
                          Edit rubric
                        </a>
                      ) : (
                        <span className="text-gray-400 text-sm">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
