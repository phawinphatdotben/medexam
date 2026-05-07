"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { STAFF_DASHBOARD_ROLES } from "@/lib/auth/roles";
import { getSessionUserId } from "@/lib/auth/session";
import { useRoleGate } from "@/hooks/useRoleGate";

type StageRow = {
  id: string;
  sequence_order: number;
  question_text: string;
  rubric_criteria: string | null;
  max_score: number | null;
};

export default function EditMeqRubricPage() {
  const { id: testId } = useParams<{ id: string }>();
  const router = useRouter();
  const { ready: accessOk, loading: gateLoading, role: staffRole } = useRoleGate(STAFF_DASHBOARD_ROLES, {
    noUserRedirect: "/login",
    wrongRoleRedirect: "/practice-tests",
  });
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [testLabel, setTestLabel] = useState("");
  const [meqTestId, setMeqTestId] = useState<string | null>(null);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { rubric: string; max: string }>>({});
  const [userId, setUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessOk || gateLoading || !staffRole) return;
    setLoading(true);
    setError(null);
    const uid = await getSessionUserId();
    if (!uid) {
      router.replace("/login");
      return;
    }
    setUserId(uid);
    const admin = staffRole === "admin";

    const { data: test, error: te } = await supabase
      .from("meq_tests")
      .select("id, subject, course_code, created_by")
      .eq("id", testId)
      .maybeSingle();

    if (te || !test) {
      setError("Test not found.");
      setLoading(false);
      setReady(true);
      return;
    }

    if (!admin && test.created_by !== uid) {
      router.replace("/dashboard/my-tests");
      return;
    }

    setMeqTestId(test.id);
    setTestLabel(`${test.subject} (${test.course_code})`);

    const { data: st, error: se } = await supabase
      .from("meq_test_stages")
      .select("id, sequence_order, question_text, rubric_criteria, max_score")
      .eq("meq_test_id", testId)
      .order("sequence_order", { ascending: true });

    if (se) {
      setError("Could not load stages.");
      setLoading(false);
      setReady(true);
      return;
    }

    const rows = (st || []) as StageRow[];
    setStages(rows);
    const d: Record<string, { rubric: string; max: string }> = {};
    for (const r of rows) {
      d[r.id] = {
        rubric: r.rubric_criteria ?? "",
        max: r.max_score != null ? String(r.max_score) : "",
      };
    }
    setDrafts(d);
    setLoading(false);
    setReady(true);
  }, [testId, router, accessOk, gateLoading, staffRole]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateDraft = (stageId: string, field: "rubric" | "max", value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [stageId]: { ...prev[stageId]!, [field]: value },
    }));
  };

  const handleSave = async () => {
    if (!userId || !meqTestId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    for (const st of stages) {
      const cur = drafts[st.id];
      if (!cur) continue;
      const prevRub = st.rubric_criteria ?? "";
      const prevMax = st.max_score ?? 0;
      const newRub = cur.rubric.trim();
      const maxNum = parseInt(cur.max, 10);
      if (!newRub) {
        setError(`Stage ${st.sequence_order}: rubric cannot be empty.`);
        setSaving(false);
        return;
      }
      if (isNaN(maxNum) || maxNum < 1 || maxNum > 100) {
        setError(`Stage ${st.sequence_order}: max score must be 1–100.`);
        setSaving(false);
        return;
      }
      if (newRub === prevRub && maxNum === prevMax) continue;

      const { error: upErr } = await supabase
        .from("meq_test_stages")
        .update({ rubric_criteria: newRub, max_score: maxNum })
        .eq("id", st.id);
      if (upErr) {
        setError(upErr.message || "Failed to update a stage.");
        setSaving(false);
        return;
      }

      const { error: logErr } = await supabase.from("meq_rubric_revision_log").insert({
        meq_stage_id: st.id,
        meq_test_id: meqTestId,
        editor_id: userId,
        previous_rubric_criteria: prevRub || null,
        new_rubric_criteria: newRub,
        previous_max_score: prevMax,
        new_max_score: maxNum,
      });
      if (logErr) {
        setError("Stage updated but audit log failed. Check permissions / migration 019.");
        setSaving(false);
        void load();
        return;
      }
    }

    setSuccess("Rubric saved. Admins can review changes under Admin → Audit log.");
    setSaving(false);
    void load();
  };

  if (!ready || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-20">
        <span className="text-gray-600">Loading…</span>
      </div>
    );
  }

  if (error && !stages.length && !testLabel) {
    return (
      <div className="min-h-screen pt-20 px-4">
        <div className="max-w-lg mx-auto text-red-700">{error}</div>
        <Link href="/dashboard/my-tests" className="block mt-4 text-blue-600 underline">
          Back to my tests
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white pt-20 pb-16 px-4">
      <div className="max-w-3xl mx-auto">
        <Link href="/dashboard/my-tests" className="text-blue-600 hover:underline text-sm">
          ← My tests
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-4 mb-1">Edit rubric</h1>
        <p className="text-gray-600 text-sm mb-6">{testLabel}</p>
        <p className="text-sm text-gray-500 mb-6">
          Changes apply to future grading. Previous student submissions stay as submitted; staff
          should be aware that displayed rubric text updates for all viewers.
        </p>

        {success ? (
          <div className="mb-4 p-3 rounded border border-green-200 bg-green-50 text-green-900 text-sm">
            {success}
          </div>
        ) : null}
        {error ? (
          <div className="mb-4 p-3 rounded border border-red-200 bg-red-50 text-red-800 text-sm">
            {error}
          </div>
        ) : null}

        <div className="space-y-8">
          {stages.map((st) => (
            <section key={st.id} className="border rounded-lg p-4 space-y-3">
              <div className="text-sm font-semibold text-teal-800">Stage {st.sequence_order}</div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap border-l-2 border-gray-200 pl-2">
                {st.question_text}
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700">Rubric criteria</label>
                <textarea
                  className="mt-1 w-full border rounded-md px-3 py-2 min-h-[100px]"
                  value={drafts[st.id]?.rubric ?? ""}
                  onChange={(e) => updateDraft(st.id, "rubric", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Max score</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="mt-1 w-full border rounded-md px-3 py-2 max-w-xs"
                  value={drafts[st.id]?.max ?? ""}
                  onChange={(e) => updateDraft(st.id, "max", e.target.value)}
                />
              </div>
            </section>
          ))}
        </div>

        <div className="mt-8 flex justify-end">
          <button
            type="button"
            disabled={saving || stages.length === 0}
            onClick={() => void handleSave()}
            className="bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save rubric changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
