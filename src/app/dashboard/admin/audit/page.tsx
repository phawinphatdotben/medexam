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

/** Normalized AI training export: one row per graded question-at-submission snapshot. */
type MeqAiTrainingJsonExportRecord = {
  log_row_id: string;
  logged_at: string;
  grader_staff_id: string;
  question: {
    course_code: string | null;
    exam_label: string | null;
    stage_order: number | null;
    item_order: number | null;
    prompt_text: string | null;
    rubric_text: string | null;
    max_score: number | null;
  };
  student_answer: string | null;
  grading_result: {
    score_awarded: number | null;
    max_score: number | null;
    staff_feedback: string | null;
  };
  lineage: {
    meq_stage_response_id: string | null;
    meq_stage_id: string | null;
    meq_stage_item_id: string | null;
    purpose: string | null;
    line_json_schema_version: number | null;
  };
  /** Original payload as stored when staff tapped “AI training” (for reproducibility). */
  raw_line_json: Record<string, unknown>;
};

function readStr(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  return String(v);
}

function readNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function normalizeTrainingExportRow(row: TrainingRow): MeqAiTrainingJsonExportRecord {
  const lj = row.line_json;
  const maxPts = readNum(lj.max_score);
  const human = readNum(lj.human_score);
  return {
    log_row_id: row.id,
    logged_at: row.created_at,
    grader_staff_id: row.staff_id,
    question: {
      course_code: readStr(lj.course_code),
      exam_label: readStr(lj.test_label),
      stage_order: readNum(lj.stage_order),
      item_order: readNum(lj.item_order),
      prompt_text: readStr(lj.question_text),
      rubric_text: readStr(lj.rubric_criteria),
      max_score: maxPts,
    },
    student_answer: readStr(lj.student_answer),
    grading_result: {
      score_awarded: human,
      max_score: maxPts,
      staff_feedback: readStr(lj.staff_feedback),
    },
    lineage: {
      meq_stage_response_id: readStr(lj.response_id),
      meq_stage_id: readStr(lj.meq_stage_id),
      meq_stage_item_id: readStr(lj.meq_stage_item_id),
      purpose: readStr(lj.purpose),
      line_json_schema_version: readNum(lj.schema_version),
    },
    raw_line_json: { ...lj },
  };
}

function downloadJson(filename: string, payload: unknown) {
  const body = JSON.stringify(payload, null, 2);
  const blob = new Blob([body], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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
  const [exportBusy, setExportBusy] = useState(false);

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

  const fetchTrainingForExport = useCallback(async () => {
    const pageSize = 1000;
    const merged: TrainingRow[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error: qErr } = await supabase
        .from("meq_ai_training_records")
        .select("id, created_at, staff_id, line_json")
        .order("created_at", { ascending: true })
        .range(from, from + pageSize - 1);
      if (qErr) throw new Error(qErr.message);
      const chunk = ((data || []) as { id: string; created_at: string; staff_id: string; line_json: object }[]).map(
        (row) => ({
          ...row,
          line_json: row.line_json as Record<string, unknown>,
        }),
      );
      merged.push(...chunk);
      if (chunk.length < pageSize) break;
    }
    return merged;
  }, []);

  const handleExportTrainingJson = useCallback(async () => {
    setExportBusy(true);
    setError(null);
    try {
      const rows = await fetchTrainingForExport();
      const records = rows.map(normalizeTrainingExportRow);
      const iso = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
      downloadJson(`meq-ai-training-dataset-${iso}.json`, {
        schema_version: 1 as const,
        exported_at: new Date().toISOString(),
        description:
          "MEQ AI training taps: student free-text answers with staff scores and feedback, one entry per graded question snapshot.",
        record_count: records.length,
        records,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExportBusy(false);
    }
  }, [fetchTrainingForExport]);

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
          Rubric edits by staff are logged here. Staff “AI training” taps on the grading page append rows you can
          export: a structured JSON file with student answers and grading results per question, or JSONL mirroring stored
          <code className="bg-gray-100 px-1">line_json</code>.
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
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="bg-blue-800 text-white font-semibold px-4 py-2 rounded-lg text-sm hover:bg-blue-900 disabled:opacity-50"
                onClick={() => void handleExportTrainingJson()}
                disabled={exportBusy}
              >
                {exportBusy ? "Building JSON…" : "Download training JSON"}
              </button>
              <button
                type="button"
                className="bg-gray-900 text-white font-semibold px-4 py-2 rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50"
                onClick={() =>
                  downloadJsonl(
                    `meq-ai-training-${new Date().toISOString().slice(0, 10)}.jsonl`,
                    training.map((t) => t.line_json)
                  )
                }
                disabled={training.length === 0}
              >
                Download JSONL (preview)
              </button>
            </div>
          </div>
          <p className="text-sm text-gray-600 mb-3">
            <strong>Training JSON</strong> re-fetches all rows (paginated) and emits one object per record with explicit{" "}
            <code className="bg-gray-100 px-1">student_answer</code>, question metadata, and{" "}
            <code className="bg-gray-100 px-1">grading_result</code> (score + feedback), plus{" "}
            <code className="bg-gray-100 px-1">raw_line_json</code> matching the saved payload.{" "}
            <strong>JSONL</strong> downloads only the loaded preview rows exactly as stored.
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
