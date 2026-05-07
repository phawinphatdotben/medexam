"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { ADMIN_ONLY_ROLES } from "@/lib/auth/roles";
import { useRoleGate } from "@/hooks/useRoleGate";

type RubricLog = {
  id: string;
  created_at: string;
  editor_id: string;
  previous_rubric_criteria: string | null;
  new_rubric_criteria: string | null;
  previous_max_score: number | null;
  new_max_score: number | null;
  meq_test_id: string;
  meq_stage_id: string;
};

type TrainingRow = {
  id: string;
  created_at: string;
  staff_id: string;
  line_json: Record<string, unknown>;
};

function downloadJsonl(filename: string, lines: Record<string, unknown>[]) {
  const body = lines.map((o) => JSON.stringify(o)).join("\n") + (lines.length ? "\n" : "");
  const blob = new Blob([body], { type: "application/x-ndjson;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminAuditPage() {
  const { ready: accessOk, loading: gateLoading } = useRoleGate(ADMIN_ONLY_ROLES, {
    noUserRedirect: "/login",
    wrongRoleRedirect: "/practice-tests",
  });
  const [loading, setLoading] = useState(true);
  const [rubricLogs, setRubricLogs] = useState<RubricLog[]>([]);
  const [training, setTraining] = useState<TrainingRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessOk || gateLoading) return;
    setLoading(true);
    setError(null);

    const [rRes, tRes] = await Promise.all([
      supabase
        .from("meq_rubric_revision_log")
        .select(
          "id, created_at, editor_id, previous_rubric_criteria, new_rubric_criteria, previous_max_score, new_max_score, meq_test_id, meq_stage_id"
        )
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("meq_ai_training_records")
        .select("id, created_at, staff_id, line_json")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    if (rRes.error) {
      setError(rRes.error.message || "Could not load rubric log. Apply migration 019.");
    } else {
      setRubricLogs((rRes.data as RubricLog[]) || []);
    }
    if (tRes.error) {
      setError((e) => e || tRes.error?.message || "Could not load AI training records.");
    } else {
      setTraining(
        ((tRes.data as { id: string; created_at: string; staff_id: string; line_json: object }[]) || []).map(
          (row) => ({
            ...row,
            line_json: row.line_json as Record<string, unknown>,
          })
        )
      );
    }
    setLoading(false);
  }, [accessOk, gateLoading]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!accessOk || gateLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white pt-20">
        <span className="text-gray-700">Loading audit log…</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col pt-16">
      <header className="w-full border-b border-gray-200 px-8 py-6">
        <Link href="/dashboard/admin" className="text-sm text-blue-700 hover:underline">
          ← Admin (users)
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">Audit &amp; AI training export</h1>
        <p className="text-gray-600 text-sm mt-1">
          Rubric edits by staff are logged here. AI grading buttons append one JSON object per line for
          future fine-tuning exports.
        </p>
      </header>
      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-8 space-y-12">
        {error ? (
          <div className="bg-orange-100 border border-orange-300 text-orange-950 rounded p-4 text-sm">{error}</div>
        ) : null}

        <section>
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <h2 className="text-xl font-bold text-gray-900">Rubric change log</h2>
          </div>
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2">When (UTC)</th>
                  <th className="px-3 py-2">Editor</th>
                  <th className="px-3 py-2">Scores</th>
                  <th className="px-3 py-2">Change</th>
                </tr>
              </thead>
              <tbody>
                {rubricLogs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-gray-500">
                      No rubric edits recorded yet.
                    </td>
                  </tr>
                ) : (
                  rubricLogs.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-3 py-2 whitespace-nowrap align-top">
                        {new Date(r.created_at).toISOString().slice(0, 19).replace("T", " ")}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs align-top break-all">{r.editor_id}</td>
                      <td className="px-3 py-2 align-top whitespace-nowrap">
                        {r.previous_max_score} → {r.new_max_score}
                      </td>
                      <td className="px-3 py-2 align-top text-gray-800">
                        <div className="text-xs text-red-800 line-clamp-3 whitespace-pre-wrap">
                          {r.previous_rubric_criteria || "(empty)"}
                        </div>
                        <div className="text-xs text-green-800 line-clamp-3 whitespace-pre-wrap mt-1">
                          {r.new_rubric_criteria || ""}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <h2 className="text-xl font-bold text-gray-900">AI grading training rows</h2>
            <button
              type="button"
              className="bg-gray-900 text-white font-semibold px-4 py-2 rounded-lg text-sm hover:bg-gray-800"
              onClick={() =>
                downloadJsonl(
                  `meq-ai-training-${new Date().toISOString().slice(0, 10)}.jsonl`,
                  training.map((t) => t.line_json)
                )
              }
              disabled={training.length === 0}
            >
              Download JSONL
            </button>
          </div>
          <p className="text-sm text-gray-600 mb-3">
            Each row mirrors the JSON stored in <code className="bg-gray-100 px-1">line_json</code>. Retrain
            or evaluate models offline with this export.
          </p>
          <div className="border rounded-lg overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-100 sticky top-0">
                <tr>
                  <th className="px-2 py-2">When</th>
                  <th className="px-2 py-2">Staff</th>
                  <th className="px-2 py-2">Preview</th>
                </tr>
              </thead>
              <tbody>
                {training.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-gray-500">
                      No training rows yet. Staff can add them from the Grade page.
                    </td>
                  </tr>
                ) : (
                  training.map((t) => (
                    <tr key={t.id} className="border-t align-top">
                      <td className="px-2 py-2 whitespace-nowrap">
                        {new Date(t.created_at).toISOString().slice(0, 19)}
                      </td>
                      <td className="px-2 py-2 font-mono break-all">{t.staff_id}</td>
                      <td className="px-2 py-2 font-mono text-[11px] max-w-xl">
                        {JSON.stringify(t.line_json).slice(0, 240)}
                        {JSON.stringify(t.line_json).length > 240 ? "…" : ""}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
