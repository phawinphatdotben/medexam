"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ADMIN_ONLY_ROLES } from "@/lib/auth/roles";
import { useRoleGate } from "@/hooks/useRoleGate";
import {
  exportFormativeCorpusArrays,
  fetchAiPipelineConfig,
  processAiSyncQueue,
  refreshMlStudentVectors,
  runFormativePipelineBatch,
  updateAiPipelineConfig,
} from "@/lib/ai/pipelineService";
import type { FormativeCorpusExport, MeqAiPipelineConfig } from "@/lib/ai/types";

export default function AdminAiPipelinePage() {
  const { ready, loading: gateLoading } = useRoleGate(ADMIN_ONLY_ROLES, {
    noUserRedirect: "/login",
    wrongRoleRedirect: "/dashboard",
  });

  const [config, setConfig] = useState<MeqAiPipelineConfig | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [corpusPreview, setCorpusPreview] = useState<FormativeCorpusExport | null>(null);
  const [courseFilter, setCourseFilter] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await fetchAiPipelineConfig();
    if (error) setErr(error.message);
    else {
      setConfig(data);
      setErr(null);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    void load();
  }, [ready, load]);

  const saveConfig = async () => {
    if (!config) return;
    setBusy(true);
    const { error } = await updateAiPipelineConfig({
      formative_capture_enabled: config.formative_capture_enabled,
      summative_capture_enabled: config.summative_capture_enabled,
      auto_enqueue_on_lock: config.auto_enqueue_on_lock,
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setStatus("Pipeline configuration saved.");
  };

  const runBatch = async () => {
    setBusy(true);
    setStatus(null);
    const { queue, refresh, corpus, error } = await runFormativePipelineBatch({
      queueLimit: 300,
      courseCode: courseFilter.trim() || null,
      exportLimit: 2000,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setCorpusPreview(corpus);
    setStatus(
      `Queue: ${queue?.processed ?? 0} processed, ${queue?.failed ?? 0} failed. Vectors: ${refresh?.vector_groups_upserted ?? 0} groups. Export: ${corpus?.vectors?.length ?? 0} vector rows.`,
    );
  };

  const runQueueOnly = async () => {
    setBusy(true);
    const { result, error } = await processAiSyncQueue(200);
    setBusy(false);
    if (error) setErr(error.message);
    else setStatus(`Sync queue: ${result?.processed ?? 0} processed, ${result?.failed ?? 0} failed.`);
  };

  const runVectorsOnly = async () => {
    setBusy(true);
    const { result, error } = await refreshMlStudentVectors({
      assessmentPhase: "formative",
      courseCode: courseFilter.trim() || null,
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setStatus(`Refreshed ${result?.vector_groups_upserted ?? 0} student vector groups.`);
  };

  const runExportOnly = async () => {
    setBusy(true);
    const { corpus, error } = await exportFormativeCorpusArrays({
      courseCode: courseFilter.trim() || null,
      limit: 2000,
    });
    setBusy(false);
    if (error) setErr(error.message);
    else {
      setCorpusPreview(corpus);
      setStatus(`Exported ${corpus?.vectors?.length ?? 0} clustered vector rows.`);
    }
  };

  if (gateLoading || !ready) {
    return (
      <div className="min-h-screen flex items-center justify-center text-blue-800 pt-20">Loading…</div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20 pt-16">
      <header className="bg-white border-b border-gray-200 px-8 py-6">
        <Link href="/dashboard/admin" className="text-sm text-blue-700 hover:underline">
          ← Admin
        </Link>
        <h1 className="text-3xl font-bold text-slate-900 mt-2">AI data pipeline</h1>
        <p className="text-sm text-gray-600 mt-2 max-w-3xl">
          Formative-assessment ground truth for future AI precision grading. Requires migration{" "}
          <code className="bg-gray-100 px-1 text-xs">045_ai_data_pipeline.sql</code>. Students write interaction
          events during exams; locked responses enqueue into training records; vectors cluster by task category.
        </p>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {err ? (
          <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 px-4 py-3 text-sm">{err}</div>
        ) : null}
        {status ? (
          <div className="rounded-lg border border-green-200 bg-green-50 text-green-900 px-4 py-3 text-sm">{status}</div>
        ) : null}

        {config ? (
          <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">Pipeline configuration</h2>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config.formative_capture_enabled}
                onChange={(e) =>
                  setConfig({ ...config, formative_capture_enabled: e.target.checked })
                }
              />
              Capture formative assessments (recommended for research phase)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config.summative_capture_enabled}
                onChange={(e) =>
                  setConfig({ ...config, summative_capture_enabled: e.target.checked })
                }
              />
              Capture summative / real tests
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config.auto_enqueue_on_lock}
                onChange={(e) => setConfig({ ...config, auto_enqueue_on_lock: e.target.checked })}
              />
              Auto-enqueue locked responses for training sync
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveConfig()}
              className="bg-blue-800 text-white font-semibold px-4 py-2 rounded-lg text-sm hover:bg-blue-900 disabled:opacity-50"
            >
              Save configuration
            </button>
          </section>
        ) : null}

        <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Batch jobs</h2>
          <label className="block text-sm">
            <span className="font-semibold text-gray-700">Optional course code filter</span>
            <input
              className="mt-1 w-full max-w-xs border border-gray-300 rounded-lg px-3 py-2"
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
              placeholder="e.g. MED301"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void runBatch()}
              className="bg-orange-800 text-white font-semibold px-4 py-2 rounded-lg text-sm hover:bg-orange-900 disabled:opacity-50"
            >
              Run full formative pipeline
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runQueueOnly()}
              className="border border-gray-300 font-semibold px-4 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              Process sync queue
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runVectorsOnly()}
              className="border border-gray-300 font-semibold px-4 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              Refresh ML vectors
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runExportOnly()}
              className="border border-gray-300 font-semibold px-4 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              Export corpus preview
            </button>
          </div>
        </section>

        {corpusPreview ? (
          <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 mb-2">Export preview</h2>
            <p className="text-sm text-gray-600 mb-3">
              {corpusPreview.vectors.length} vector groups · schema v{corpusPreview.schema_version}
            </p>
            <pre className="text-xs bg-slate-900 text-slate-100 p-4 rounded-lg overflow-auto max-h-96">
              {JSON.stringify(corpusPreview, null, 2)}
            </pre>
          </section>
        ) : null}
      </main>
    </div>
  );
}
