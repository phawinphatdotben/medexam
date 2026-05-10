"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { STAFF_DASHBOARD_ROLES } from "@/lib/auth/roles";
import { getSessionUserId } from "@/lib/auth/session";
import { useRoleGate } from "@/hooks/useRoleGate";

type StageItemRow = {
  id: string;
  sequence_order: number;
  question_text: string;
  rubric_criteria: string | null;
  max_score: number | null;
};

type StageRow = {
  id: string;
  sequence_order: number;
  question_text: string;
  rubric_criteria: string | null;
  max_score: number | null;
  meq_stage_items: StageItemRow[] | null;
};

function normalizeItems(stage: StageRow): StageItemRow[] {
  const raw = stage.meq_stage_items;
  const arr = Array.isArray(raw) ? raw : [];
  return [...arr].sort((a, b) => a.sequence_order - b.sequence_order);
}

function aggregateShellFromParts(parts: StageItemRow[]) {
  const question_text = parts
    .map((p, idx) => `Part ${idx + 1}: ${p.question_text}`)
    .join("\n\n");
  const rubric_criteria = parts
    .map((p, idx) =>
      typeof p.max_score === "number"
        ? `Part ${idx + 1} (max ${p.max_score} pts)\n${p.rubric_criteria ?? ""}`
        : `Part ${idx + 1}\n${p.rubric_criteria ?? ""}`,
    )
    .join("\n\n\n");
  const max_score = parts.reduce((n, p) => n + (typeof p.max_score === "number" ? p.max_score : 0), 0);
  return { question_text, rubric_criteria, max_score };
}

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
    const subAdmin = staffRole === "sub_admin";

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

    let subAdminInScope = false;
    if (subAdmin) {
      const { data: scopeRow } = await supabase
        .from("sub_admin_course_scopes")
        .select("course_code")
        .eq("profile_id", uid)
        .eq("course_code", test.course_code)
        .maybeSingle();
      subAdminInScope = !!scopeRow;
    }

    if (!admin && test.created_by !== uid && !(subAdmin && subAdminInScope)) {
      router.replace("/dashboard/my-tests");
      return;
    }

    setMeqTestId(test.id);
    setTestLabel(`${test.subject} (${test.course_code})`);

    const { data: st, error: se } = await supabase
      .from("meq_test_stages")
      .select(
        "id, sequence_order, question_text, rubric_criteria, max_score, meq_stage_items ( id, sequence_order, question_text, rubric_criteria, max_score )",
      )
      .eq("meq_test_id", testId)
      .order("sequence_order", { ascending: true });

    if (se) {
      setError(se.message.includes("meq_stage_items") ? "Run migration 036 to edit authored parts." : "Could not load stages.");
      setLoading(false);
      setReady(true);
      return;
    }

    const rows = (st || []) as StageRow[];
    const d: Record<string, { rubric: string; max: string }> = {};

    setStages(rows);

    for (const r of rows) {
      const items = normalizeItems(r);
      if (items.length) {
        for (const it of items) {
          d[it.id] = {
            rubric: it.rubric_criteria ?? "",
            max: it.max_score != null ? String(it.max_score) : "",
          };
        }
      } else {
        d[r.id] = {
          rubric: r.rubric_criteria ?? "",
          max: r.max_score != null ? String(r.max_score) : "",
        };
      }
    }

    setDrafts(d);
    setLoading(false);
    setReady(true);
  }, [testId, router, accessOk, gateLoading, staffRole]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateDraft = (id: string, field: "rubric" | "max", value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? { rubric: "", max: "" }),
        [field]: value,
      },
    }));
  };

  const handleSave = async () => {
    if (!userId || !meqTestId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    for (const st of stages) {
      const items = normalizeItems(st);
      if (!items.length) {
        const cur = drafts[st.id];
        if (!cur) continue;
        const newRub = cur.rubric.trim();
        const maxNum = parseInt(cur.max, 10);
        if (!newRub) {
          setError(`Stage ${st.sequence_order}: rubric cannot be empty.`);
          setSaving(false);
          return;
        }
        if (isNaN(maxNum) || maxNum < 1 || maxNum > 1000) {
          setError(`Stage ${st.sequence_order}: max score must be 1–1000.`);
          setSaving(false);
          return;
        }
        const prevRub = st.rubric_criteria ?? "";
        const prevMax = typeof st.max_score === "number" ? st.max_score : 0;
        if (newRub === prevRub && maxNum === prevMax) continue;
        const { error: upErr } = await supabase
          .from("meq_test_stages")
          .update({ rubric_criteria: newRub, max_score: maxNum })
          .eq("id", st.id);
        if (upErr) {
          setError(upErr.message || "Failed to update stage.");
          setSaving(false);
          return;
        }
        await supabase.from("meq_rubric_revision_log").insert({
          meq_stage_id: st.id,
          meq_test_id: meqTestId,
          editor_id: userId,
          previous_rubric_criteria: prevRub || null,
          new_rubric_criteria: newRub,
          previous_max_score: prevMax,
          new_max_score: maxNum,
        });
        continue;
      }

      const nextParts: StageItemRow[] = [];
      for (const it of items) {
        const d = drafts[it.id];
        const newRub = (d?.rubric ?? "").trim();
        const maxNum = parseInt(d?.max ?? "", 10);
        if (!newRub) {
          setError(`Stage ${st.sequence_order}, part ${it.sequence_order}: rubric cannot be empty.`);
          setSaving(false);
          return;
        }
        if (isNaN(maxNum) || maxNum < 1 || maxNum > 100) {
          setError(`Stage ${st.sequence_order}, part ${it.sequence_order}: max score must be 1–100.`);
          setSaving(false);
          return;
        }
        nextParts.push({ ...it, rubric_criteria: newRub, max_score: maxNum });
      }

      let anyItemMutation = false;
      for (let i = 0; i < items.length; i++) {
        const o = items[i]!;
        const n = nextParts[i]!;
        if ((o.rubric_criteria ?? "") !== (n.rubric_criteria ?? "") || (o.max_score ?? -1) !== (n.max_score ?? -2)) {
          anyItemMutation = true;
          const { error: upErr } = await supabase
            .from("meq_stage_items")
            .update({ rubric_criteria: n.rubric_criteria, max_score: n.max_score })
            .eq("id", o.id);
          if (upErr) {
            setError(upErr.message || `Could not save part ${o.sequence_order}.`);
            setSaving(false);
            return;
          }
        }
      }

      const aggregated = aggregateShellFromParts(nextParts);
      const prevRub = st.rubric_criteria ?? "";
      const prevMax = typeof st.max_score === "number" ? st.max_score : 0;
      if (
        anyItemMutation &&
        (aggregated.rubric_criteria !== prevRub ||
          aggregated.max_score !== prevMax ||
          aggregated.question_text.trim() !== (st.question_text ?? "").trim())
      ) {
        const { error: upSt } = await supabase
          .from("meq_test_stages")
          .update({
            question_text: aggregated.question_text,
            rubric_criteria: aggregated.rubric_criteria,
            max_score: aggregated.max_score,
          })
          .eq("id", st.id);
        if (upSt) {
          setError(upSt.message || "Failed syncing stage summary.");
          setSaving(false);
          return;
        }
        await supabase.from("meq_rubric_revision_log").insert({
          meq_stage_id: st.id,
          meq_test_id: meqTestId,
          editor_id: userId,
          previous_rubric_criteria: prevRub || null,
          new_rubric_criteria: aggregated.rubric_criteria,
          previous_max_score: prevMax,
          new_max_score: aggregated.max_score,
        });
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
          Multi-part stages list each authored prompt independently. Saving updates each graded line item and refreshes the
          stage-level summary committees see.
        </p>

        {success ? (
          <div className="mb-4 p-3 rounded border border-green-200 bg-green-50 text-green-900 text-sm">
            {success}
          </div>
        ) : null}
        {error ? (
          <div className="mb-4 p-3 rounded border border-red-200 bg-red-50 text-red-800 text-sm">{error}</div>
        ) : null}

        <div className="space-y-8">
          {stages.map((st) => {
            const items = normalizeItems(st);
            if (!items.length) {
              const curDraft = drafts[st.id] ?? { rubric: "", max: "" };
              return (
                <section key={st.id} className="border rounded-lg p-4 space-y-3">
                  <div className="text-sm font-semibold text-blue-900">Stage {st.sequence_order}</div>
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                    No authored parts found — run migration 036 or recreate this MEQ using the authoring wizard.
                  </p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap border-l-2 border-gray-200 pl-2">
                    {st.question_text}
                  </p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Rubric (stage rollup)</label>
                    <textarea
                      className="mt-1 w-full border rounded-md px-3 py-2 min-h-[100px]"
                      value={curDraft.rubric}
                      onChange={(e) => updateDraft(st.id, "rubric", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Max score</label>
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      className="mt-1 w-full border rounded-md px-3 py-2 max-w-xs"
                      value={curDraft.max}
                      onChange={(e) => updateDraft(st.id, "max", e.target.value)}
                    />
                  </div>
                </section>
              );
            }
            return (
              <section key={st.id} className="border rounded-lg p-4 space-y-4">
                <div className="text-sm font-semibold text-blue-900">Stage {st.sequence_order}</div>
                {items.map((it) => (
                  <div key={it.id} className="border border-slate-100 rounded-md p-3 bg-slate-50/50 space-y-2">
                    <div className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                      Part {it.sequence_order}
                    </div>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{it.question_text}</p>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Rubric</label>
                      <textarea
                        className="mt-1 w-full border rounded-md px-3 py-2 min-h-[100px] bg-white"
                        value={drafts[it.id]?.rubric ?? ""}
                        onChange={(e) => updateDraft(it.id, "rubric", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Max score (part)</label>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        className="mt-1 w-full border rounded-md px-3 py-2 max-w-xs bg-white"
                        value={drafts[it.id]?.max ?? ""}
                        onChange={(e) => updateDraft(it.id, "max", e.target.value)}
                      />
                    </div>
                  </div>
                ))}
              </section>
            );
          })}
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
