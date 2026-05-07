"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { ADMIN_ONLY_ROLES } from "@/lib/auth/roles";
import { useRoleGate } from "@/hooks/useRoleGate";
import { SUBJECTS, type SubjectName } from "@/lib/subjects";

type Result = {
  id: string;
  type: "SBA" | "MEQ";
  subject: string;
  subject_code: string;
  test_year: number;
  review_status: string;
  created_at: string;
};

type StaffRequestRow = {
  id: string;
  email: string;
  requested_role: string | null;
  approval_status: "pending" | "approved" | "rejected";
};

export default function AdminTestSearchPage() {
  const { ready: accessOk, loading: gateLoading } = useRoleGate(ADMIN_ONLY_ROLES, {
    noUserRedirect: "/login",
    wrongRoleRedirect: "/dashboard",
  });
  const allowed = accessOk && !gateLoading;
  const [subject, setSubject] = useState<SubjectName | "">("");
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Result[]>([]);
  const [requests, setRequests] = useState<StaffRequestRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"requests" | "tests">("requests");
  const [approving, setApproving] = useState<string | null>(null);

  const loadRequests = async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, requested_role, approval_status")
      .eq("approval_status", "pending")
      .eq("requested_role", "educator")
      .order("email", { ascending: true });
    if (error) {
      setErr(error.message || "Failed to fetch pending requests.");
      setRequests([]);
      return;
    }
    setRequests((data as StaffRequestRow[] | null) || []);
  };

  useEffect(() => {
    if (!allowed) return;
    if (tab !== "requests") return;
    void loadRequests();
  }, [allowed, tab]);

  const doSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject) {
      setErr("Select a subject.");
      return;
    }
    setLoading(true);
    setErr(null);
    setSearched(true);
    const y = parseInt(year, 10);
    if (isNaN(y)) {
      setErr("Invalid year.");
      setLoading(false);
      return;
    }
    const { data: sba, error: e1 } = await supabase
      .from("sba_tests")
      .select("id, subject, subject_code, test_year, review_status, created_at")
      .eq("subject", subject)
      .eq("test_year", y)
      .order("created_at", { ascending: false });
    const { data: meq, error: e2 } = await supabase
      .from("meq_tests")
      .select("id, subject, course_code, test_year, review_status, created_at")
      .eq("subject", subject)
      .eq("test_year", y)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (e1 || e2) {
      setErr(e1?.message || e2?.message || "Search failed.");
      setRows([]);
      return;
    }
    const merged: Result[] = [
      ...(sba || []).map((r) => ({ ...r, type: "SBA" as const })),
      ...(meq || []).map((r) => ({ ...r, subject_code: r.course_code, type: "MEQ" as const })),
    ];
    setRows(merged);
  };

  const approveRequest = async (profileId: string) => {
    setApproving(profileId);
    setErr(null);
    const { error } = await supabase
      .from("profiles")
      .update({
        role: "educator",
        requested_role: null,
        approval_status: "approved",
      })
      .eq("id", profileId);
    if (error) {
      setErr("Failed to approve request.");
      setApproving(null);
      return;
    }
    setRequests((prev) => prev.filter((r) => r.id !== profileId));
    setApproving(null);
  };

  if (!allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-600">Loading...</div>
    );
  }

  return (
    <div className="min-h-screen bg-white pt-20 pb-16 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900">Admin: search tests</h1>
        <p className="text-sm text-gray-600 mt-1 mb-6">
          The main view does not load all tests. Search by subject and year only when needed.
        </p>
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setTab("requests")}
            className={`px-4 py-2 rounded border text-sm font-semibold ${
              tab === "requests" ? "bg-slate-900 text-white border-slate-900" : "bg-white"
            }`}
          >
            Staff requests
          </button>
          <button
            type="button"
            onClick={() => setTab("tests")}
            className={`px-4 py-2 rounded border text-sm font-semibold ${
              tab === "tests" ? "bg-slate-900 text-white border-slate-900" : "bg-white"
            }`}
          >
            Subject tests
          </button>
        </div>
        <Link href="/dashboard" className="text-blue-600 text-sm hover:underline block mb-6">
          &larr; Back to staff dashboard
        </Link>

        {tab === "requests" && (
          <div className="border rounded-lg bg-gray-50 p-4">
            <h2 className="font-semibold text-gray-900 mb-3">Waiting for approval</h2>
            {requests.length === 0 ? (
              <p className="text-sm text-gray-600">No pending staff requests.</p>
            ) : (
              <div className="overflow-x-auto border rounded bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 text-left">
                    <tr>
                      <th className="px-3 py-2">Email</th>
                      <th className="px-3 py-2">Requested role</th>
                      <th className="px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="px-3 py-2">{r.email}</td>
                        <td className="px-3 py-2">{r.requested_role || "-"}</td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="px-3 py-1.5 rounded bg-green-700 text-white font-medium disabled:opacity-60"
                            disabled={approving === r.id}
                            onClick={() => void approveRequest(r.id)}
                          >
                            {approving === r.id ? "Approving..." : "Approve as staff"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === "tests" && (
          <>
        <form
          onSubmit={doSearch}
          className="flex flex-col sm:flex-row gap-3 sm:items-end p-4 border rounded-lg bg-gray-50"
        >
          <div>
            <label className="block text-xs font-medium text-gray-600">Subject</label>
            <select
              className="mt-1 border rounded-md px-3 py-2 min-w-[200px] bg-white"
              value={subject}
              onChange={(e) => setSubject((e.target.value as SubjectName) || "")}
            >
              <option value="">— choose —</option>
              {SUBJECTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">Year</label>
            <input
              type="number"
              className="mt-1 border rounded-md px-3 py-2 w-32 bg-white"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-slate-900 text-white rounded-lg font-medium disabled:opacity-50 h-10"
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </form>

        {err && <p className="text-red-600 text-sm mt-3">{err}</p>}

        {searched && !err && !loading && (
          <p className="text-sm text-gray-600 mt-4">
            {rows.length} result{rows.length === 1 ? "" : "s"}.
          </p>
        )}

        {rows.length > 0 && (
          <div className="mt-4 border rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 text-left">
                <tr>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.type}-${r.id}`} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{r.type}</td>
                    <td className="px-3 py-2 font-mono">{r.subject_code}</td>
                    <td className="px-3 py-2">{r.review_status}</td>
                    <td className="px-3 py-2 text-gray-600">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {searched && !loading && rows.length === 0 && !err && (
          <p className="text-gray-500 text-sm mt-4">No tests for that subject and year.</p>
        )}
          </>
        )}
      </div>
    </div>
  );
}
