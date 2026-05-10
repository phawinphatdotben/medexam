"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { COMMITTEE_PAGE_ROLES } from "@/lib/auth/roles";
import { useRoleGate } from "@/hooks/useRoleGate";

type MeqStageRow = {
  id: string;
  sequence_order: number;
  question_text: string;
  max_score: number | null;
};

type SbaQuestionRow = {
  id: string;
  sequence_order: number;
  stem: string;
};

type AngoffDbRow = {
  reviewer_id: string;
  round: number;
  meq_stage_id: string | null;
  sba_question_id: string | null;
  p_correct: number;
};

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function preview(text: string, max = 140): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

export default function ModifiedAngoffPage() {
  const router = useRouter();
  const params = useParams();
  const rawKind = typeof params.kind === "string" ? params.kind.toLowerCase() : "";
  const testId = typeof params.testId === "string" ? params.testId : "";
  const kind = rawKind === "meq" || rawKind === "sba" ? rawKind : null;

  const { ready: accessOk, loading: gateLoading, userId: myUserId, role: myRole } = useRoleGate(
    COMMITTEE_PAGE_ROLES,
    { noUserRedirect: "/login", wrongRoleRedirect: "/dashboard" },
  );

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [committeeId, setCommitteeId] = useState<string | null>(null);
  const [testLabel, setTestLabel] = useState("");
  const [myCommitteeIds, setMyCommitteeIds] = useState<string[]>([]);
  const [round, setRound] = useState<1 | 2>(1);
  const [meqStages, setMeqStages] = useState<MeqStageRow[]>([]);
  const [sbaQuestions, setSbaQuestions] = useState<SbaQuestionRow[]>([]);
  const [allRatings, setAllRatings] = useState<AngoffDbRow[]>([]);
  const [inputs, setInputs] = useState<Record<string, string>>({});

  const itemIds = useMemo(() => {
    if (kind === "meq") return meqStages.map((s) => s.id);
    if (kind === "sba") return sbaQuestions.map((q) => q.id);
    return [];
  }, [kind, meqStages, sbaQuestions]);

  const canSubmit =
    !!committeeId &&
    !!myUserId &&
    (myRole === "admin" ||
      myRole === "sub_admin" ||
      (committeeId != null && myCommitteeIds.includes(committeeId)));

  const load = useCallback(async () => {
    if (!accessOk || gateLoading || !kind || !testId || !myUserId) return;
    setLoading(true);
    setErr(null);

    const { data: memberships } = await supabase
      .from("committee_members")
      .select("committee_id")
      .eq("profile_id", myUserId);
    setMyCommitteeIds(((memberships as { committee_id: string }[] | null) || []).map((m) => m.committee_id));

    if (kind === "meq") {
      const { data: test, error: te } = await supabase
        .from("meq_tests")
        .select("id, subject, course_code, committee_id")
        .eq("id", testId)
        .maybeSingle();
      if (te || !test) {
        setErr("MEQ test not found.");
        setLoading(false);
        return;
      }
      setCommitteeId(test.committee_id);
      setTestLabel(`${test.subject} · ${test.course_code}`);
      const { data: stages, error: se } = await supabase
        .from("meq_test_stages")
        .select("id, sequence_order, question_text, max_score")
        .eq("meq_test_id", testId)
        .order("sequence_order", { ascending: true });
      if (se) {
        setErr(se.message);
        setLoading(false);
        return;
      }
      setMeqStages((stages as MeqStageRow[]) || []);
      const ids = ((stages as MeqStageRow[]) || []).map((s) => s.id);
      if (ids.length === 0) {
        setAllRatings([]);
        setLoading(false);
        return;
      }
      const { data: ratings, error: re } = await supabase
        .from("committee_angoff_ratings")
        .select("reviewer_id, round, meq_stage_id, sba_question_id, p_correct")
        .in("meq_stage_id", ids);
      if (re) {
        setErr(re.message);
        setLoading(false);
        return;
      }
      setAllRatings((ratings as AngoffDbRow[]) || []);
    } else {
      const { data: test, error: te } = await supabase
        .from("sba_tests")
        .select("id, subject, subject_code, committee_id")
        .eq("id", testId)
        .maybeSingle();
      if (te || !test) {
        setErr("SBA test not found.");
        setLoading(false);
        return;
      }
      setCommitteeId(test.committee_id);
      setTestLabel(`${test.subject} · ${test.subject_code}`);
      const { data: qs, error: qe } = await supabase
        .from("sba_test_questions")
        .select("id, sequence_order, stem")
        .eq("sba_test_id", testId)
        .order("sequence_order", { ascending: true });
      if (qe) {
        setErr(qe.message);
        setLoading(false);
        return;
      }
      setSbaQuestions((qs as SbaQuestionRow[]) || []);
      const ids = ((qs as SbaQuestionRow[]) || []).map((q) => q.id);
      if (ids.length === 0) {
        setAllRatings([]);
        setLoading(false);
        return;
      }
      const { data: ratings, error: re } = await supabase
        .from("committee_angoff_ratings")
        .select("reviewer_id, round, meq_stage_id, sba_question_id, p_correct")
        .in("sba_question_id", ids);
      if (re) {
        setErr(re.message);
        setLoading(false);
        return;
      }
      setAllRatings((ratings as AngoffDbRow[]) || []);
    }
    setLoading(false);
  }, [accessOk, gateLoading, kind, testId, myUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!myUserId || itemIds.length === 0) return;
    const mine = allRatings.filter((r) => r.reviewer_id === myUserId && r.round === round);
    const next: Record<string, string> = {};
    for (const id of itemIds) {
      const row =
        kind === "meq"
          ? mine.find((r) => r.meq_stage_id === id)
          : mine.find((r) => r.sba_question_id === id);
      next[id] = row ? String(row.p_correct) : "";
    }
    setInputs(next);
  }, [allRatings, round, myUserId, itemIds, kind]);

  const panelStats = useMemo(() => {
    const byItem: Record<string, number[]> = {};
    for (const id of itemIds) byItem[id] = [];
    const judgeSet = new Set<string>();
    for (const r of allRatings) {
      if (r.round !== round) continue;
      const id = kind === "meq" ? r.meq_stage_id : r.sba_question_id;
      if (!id || !byItem[id]) continue;
      judgeSet.add(r.reviewer_id);
      byItem[id]!.push(Number(r.p_correct));
    }
    const mean: Record<string, number> = {};
    for (const id of itemIds) {
      const arr = byItem[id] || [];
      mean[id] =
        arr.length === 0
          ? NaN
          : Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10000) / 10000;
    }
    return { mean, countJudges: judgeSet.size };
  }, [allRatings, round, itemIds, kind]);

  const mySumSba = useMemo(() => {
    if (kind !== "sba") return 0;
    let s = 0;
    for (const id of itemIds) {
      const v = parseFloat(inputs[id] || "");
      if (!Number.isNaN(v)) s += clamp01(v);
    }
    return Math.round(s * 1000) / 1000;
  }, [kind, itemIds, inputs]);

  const panelSumSba = useMemo(() => {
    if (kind !== "sba") return 0;
    let s = 0;
    for (const id of itemIds) {
      const m = panelStats.mean[id];
      if (Number.isFinite(m)) s += m as number;
    }
    return Math.round(s * 1000) / 1000;
  }, [kind, itemIds, panelStats.mean]);

  const mySumMeq = useMemo(() => {
    if (kind !== "meq") return 0;
    let s = 0;
    for (const st of meqStages) {
      const max = st.max_score ?? 10;
      const v = parseFloat(inputs[st.id] || "");
      if (!Number.isNaN(v)) s += clamp01(v) * max;
    }
    return Math.round(s * 100) / 100;
  }, [kind, meqStages, inputs]);

  const panelSumMeq = useMemo(() => {
    if (kind !== "meq") return 0;
    let s = 0;
    for (const st of meqStages) {
      const max = st.max_score ?? 10;
      const m = panelStats.mean[st.id];
      if (Number.isFinite(m)) s += (m as number) * max;
    }
    return Math.round(s * 100) / 100;
  }, [kind, meqStages, panelStats.mean]);

  const save = async () => {
    if (!kind || !committeeId || !myUserId || !canSubmit) return;
    setSaving(true);
    setErr(null);

    const rows: Record<string, unknown>[] = [];
    for (const id of itemIds) {
      const raw = parseFloat(inputs[id] ?? "");
      if (Number.isNaN(raw)) {
        setErr(`Enter a valid P for every item (0–1). Problem at item ${id.slice(0, 8)}…`);
        setSaving(false);
        return;
      }
      const p = clamp01(raw);
      const base = {
        committee_id: committeeId,
        reviewer_id: myUserId,
        round,
        p_correct: p,
      };
      if (kind === "meq") {
        rows.push({ ...base, meq_stage_id: id });
      } else {
        rows.push({ ...base, sba_question_id: id });
      }
    }

    const col = kind === "meq" ? "meq_stage_id" : "sba_question_id";
    const del = supabase
      .from("committee_angoff_ratings")
      .delete()
      .eq("reviewer_id", myUserId)
      .eq("round", round)
      .in(col, itemIds);

    const { error: delErr } = await del;
    if (delErr) {
      setErr(delErr.message);
      setSaving(false);
      return;
    }

    if (rows.length > 0) {
      const { error: insErr } = await supabase.from("committee_angoff_ratings").insert(rows);
      if (insErr) {
        setErr(insErr.message);
        setSaving(false);
        return;
      }
    }

    await load();
    setSaving(false);
  };

  if (!accessOk || gateLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-20 text-gray-600">
        Loading...
      </div>
    );
  }

  if (!kind) {
    return (
      <div className="min-h-screen pt-20 px-4">
        <p className="text-red-700">Invalid test type. Use /sub-admin/angoff/meq/… or …/sba/…</p>
        <Link href="/sub-admin" className="text-blue-600 text-sm mt-4 inline-block">
          Back to committee
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pt-20 pb-16 px-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Modified Angoff</h1>
            <p className="text-slate-600 text-sm mt-1">
              {kind.toUpperCase()} · {testLabel || testId}
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push("/sub-admin")}
            className="text-sm text-blue-700 hover:underline"
          >
            ← Exam review committee
          </button>
        </div>

        {!committeeId && !loading && (
          <div className="rounded border border-amber-300 bg-amber-50 text-amber-950 px-4 py-3 text-sm">
            This test has no committee assigned yet. Assign a committee on the committee page before
            recording Angoff ratings.
          </div>
        )}

        <section className="bg-white border rounded-lg p-5 text-sm text-slate-700 space-y-2">
          <p>
            <span className="font-semibold">Borderline candidate:</span> minimally competent — safe to
            practice at the expected level. For each item, enter{" "}
            <span className="font-mono">P</span> (0–1): probability that such a candidate would achieve{" "}
            <strong>full credit</strong> (SBA: correct option; MEQ: full rubric marks on that stage).
          </p>
          <p className="text-slate-500">
            Round 2 is typically used after panel discussion. Saved values replace your ratings for this
            round only.
          </p>
        </section>

        <div className="flex gap-2 items-center flex-wrap">
          <span className="text-sm font-medium text-slate-700">Round</span>
          {([1, 2] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRound(r)}
              className={`px-3 py-1.5 rounded border text-sm font-medium ${
                round === r ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-300"
              }`}
            >
              {r}
            </button>
          ))}
          <span className="text-xs text-slate-500 ml-2">
            Judges this round: {panelStats.countJudges}
          </span>
        </div>

        {err && (
          <div className="p-3 rounded border border-red-200 bg-red-50 text-red-800 text-sm">{err}</div>
        )}

        {loading ? (
          <p className="text-slate-600">Loading items…</p>
        ) : kind === "meq" && meqStages.length === 0 ? (
          <p className="text-slate-600">No stages found for this MEQ.</p>
        ) : kind === "sba" && sbaQuestions.length === 0 ? (
          <p className="text-slate-600">No questions found for this SBA.</p>
        ) : (
          <>
            <div className="overflow-x-auto border rounded-lg bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-left text-slate-600">
                    <th className="py-2 px-3">#</th>
                    <th className="py-2 px-3">Item</th>
                    {kind === "meq" && <th className="py-2 px-3">Max pts</th>}
                    <th className="py-2 px-3">Your P</th>
                    <th className="py-2 px-3">Panel mean P</th>
                  </tr>
                </thead>
                <tbody>
                  {kind === "meq"
                    ? meqStages.map((st) => (
                        <tr key={st.id} className="border-t">
                          <td className="py-2 px-3 font-mono text-xs">{st.sequence_order}</td>
                          <td className="py-2 px-3 max-w-md">{preview(st.question_text)}</td>
                          <td className="py-2 px-3">{st.max_score ?? "—"}</td>
                          <td className="py-2 px-3">
                            <input
                              type="number"
                              min={0}
                              max={1}
                              step={0.05}
                              className="w-24 border rounded px-2 py-1"
                              value={inputs[st.id] ?? ""}
                              onChange={(e) =>
                                setInputs((prev) => ({ ...prev, [st.id]: e.target.value }))
                              }
                              disabled={!canSubmit}
                            />
                          </td>
                          <td className="py-2 px-3 font-mono text-xs">
                            {Number.isFinite(panelStats.mean[st.id]) ? panelStats.mean[st.id] : "—"}
                          </td>
                        </tr>
                      ))
                    : sbaQuestions.map((q) => (
                        <tr key={q.id} className="border-t">
                          <td className="py-2 px-3 font-mono text-xs">{q.sequence_order}</td>
                          <td className="py-2 px-3 max-w-md">{preview(q.stem)}</td>
                          <td className="py-2 px-3">
                            <input
                              type="number"
                              min={0}
                              max={1}
                              step={0.05}
                              className="w-24 border rounded px-2 py-1"
                              value={inputs[q.id] ?? ""}
                              onChange={(e) =>
                                setInputs((prev) => ({ ...prev, [q.id]: e.target.value }))
                              }
                              disabled={!canSubmit}
                            />
                          </td>
                          <td className="py-2 px-3 font-mono text-xs">
                            {Number.isFinite(panelStats.mean[q.id]) ? panelStats.mean[q.id] : "—"}
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>

            <section className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm space-y-1">
              {kind === "sba" ? (
                <>
                  <p>
                    <span className="font-semibold">Your ΣP</span> (expected items correct at your
                    judgments): <span className="font-mono">{mySumSba}</span>
                  </p>
                  <p>
                    <span className="font-semibold">Panel mean ΣP</span> (mean P summed across items):{" "}
                    <span className="font-mono">{panelSumSba}</span>
                  </p>
                </>
              ) : (
                <>
                  <p>
                    <span className="font-semibold">Your expected total points</span> (Σ P × max stage
                    score): <span className="font-mono">{mySumMeq}</span>
                  </p>
                  <p>
                    <span className="font-semibold">Panel mean expected total</span>:{" "}
                    <span className="font-mono">{panelSumMeq}</span>
                  </p>
                </>
              )}
            </section>

            <div className="flex gap-3 items-center">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !canSubmit || !committeeId}
                className="px-5 py-2.5 bg-slate-900 text-white rounded-lg font-medium disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save my ratings for this round"}
              </button>
              {!canSubmit && committeeId && (
                <span className="text-xs text-slate-500">
                  You must be on this test&apos;s committee (or admin / sub-admin) to save.
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
