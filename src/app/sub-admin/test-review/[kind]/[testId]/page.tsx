"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { COMMITTEE_PAGE_ROLES } from "@/lib/auth/roles";
import { getSessionUserId } from "@/lib/auth/session";
import { useRoleGate } from "@/hooks/useRoleGate";

type Kind = "meq" | "sba";

type MeqStageDetail = {
  id: string;
  sequence_order: number;
  stage_information: string | null;
  question_text: string;
  rubric_criteria: string | null;
  max_score: number | null;
};

type SbaQDetail = {
  id: string;
  sequence_order: number;
  stem: string;
  options: unknown;
};

type MeqStageDraft = {
  stage_information: string;
  question_text: string;
  rubric_criteria: string;
  max_score: string;
};

type SbaQDraft = {
  stem: string;
  optionsJson: string;
};

export default function CommitteeTestReviewPage() {
  const params = useParams();
  const rawKind = typeof params.kind === "string" ? params.kind.toLowerCase() : "";
  const testId = typeof params.testId === "string" ? params.testId : "";
  const kind: Kind | null = rawKind === "meq" || rawKind === "sba" ? rawKind : null;

  const { ready: accessOk, loading: gateLoading, role: myRole } = useRoleGate(COMMITTEE_PAGE_ROLES, {
    noUserRedirect: "/login",
    wrongRoleRedirect: "/dashboard",
  });

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [meqMeta, setMeqMeta] = useState<{
    vignette: string;
    first_page_stem: string;
    time_limit_minutes: number | null;
  } | null>(null);
  const [meqOverviewDraft, setMeqOverviewDraft] = useState({
    time_limit_minutes: "",
    first_page_stem: "",
    vignette: "",
  });
  const [meqStages, setMeqStages] = useState<MeqStageDetail[]>([]);
  const [stageDrafts, setStageDrafts] = useState<Record<string, MeqStageDraft>>({});
  const [sbaMeta, setSbaMeta] = useState<{ subject: string; subject_code: string } | null>(null);
  const [sbaQuestions, setSbaQuestions] = useState<SbaQDetail[]>([]);
  const [sbaDrafts, setSbaDrafts] = useState<Record<string, SbaQDraft>>({});

  const [savingOverview, setSavingOverview] = useState(false);
  const [savingStageId, setSavingStageId] = useState<string | null>(null);
  const [savingQuestionId, setSavingQuestionId] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  const canEdit = myRole === "admin" || myRole === "sub_admin";
  const isEducatorOnly = myRole === "educator";

  const load = useCallback(async () => {
    if (!accessOk || gateLoading || !kind || !testId) return;
    setLoading(true);
    setErr(null);
    setOkMessage(null);

    if (kind === "meq") {
      const { data: test, error: te } = await supabase
        .from("meq_tests")
        .select("id, subject, course_code, vignette, first_page_stem, time_limit_minutes")
        .eq("id", testId)
        .maybeSingle();
      if (te || !test) {
        setErr("MEQ test not found.");
        setLoading(false);
        return;
      }
      setLabel(`${test.subject} · ${test.course_code}`);
      setMeqMeta({
        vignette: test.vignette ?? "",
        first_page_stem: test.first_page_stem ?? "",
        time_limit_minutes: test.time_limit_minutes,
      });
      setMeqOverviewDraft({
        time_limit_minutes:
          test.time_limit_minutes != null ? String(test.time_limit_minutes) : "",
        first_page_stem: test.first_page_stem ?? "",
        vignette: test.vignette ?? "",
      });
      const { data: st, error: se } = await supabase
        .from("meq_test_stages")
        .select("id, sequence_order, stage_information, question_text, rubric_criteria, max_score")
        .eq("meq_test_id", testId)
        .order("sequence_order", { ascending: true });
      if (se) {
        setErr(se.message);
        setLoading(false);
        return;
      }
      const rows = (st as MeqStageDetail[]) || [];
      setMeqStages(rows);
      const d: Record<string, MeqStageDraft> = {};
      for (const s of rows) {
        d[s.id] = {
          stage_information: s.stage_information ?? "",
          question_text: s.question_text,
          rubric_criteria: s.rubric_criteria ?? "",
          max_score: s.max_score != null ? String(s.max_score) : "",
        };
      }
      setStageDrafts(d);
    } else {
      const { data: test, error: te } = await supabase
        .from("sba_tests")
        .select("id, subject, subject_code")
        .eq("id", testId)
        .maybeSingle();
      if (te || !test) {
        setErr("SBA test not found.");
        setLoading(false);
        return;
      }
      setSbaMeta({ subject: test.subject, subject_code: test.subject_code });
      setLabel(`${test.subject} · ${test.subject_code}`);
      const { data: qs, error: qe } = await supabase
        .from("sba_test_questions")
        .select("id, sequence_order, stem, options")
        .eq("sba_test_id", testId)
        .order("sequence_order", { ascending: true });
      if (qe) {
        setErr(qe.message);
        setLoading(false);
        return;
      }
      const rows = (qs as SbaQDetail[]) || [];
      setSbaQuestions(rows);
      const qd: Record<string, SbaQDraft> = {};
      for (const q of rows) {
        qd[q.id] = {
          stem: q.stem,
          optionsJson: JSON.stringify(q.options ?? [], null, 2),
        };
      }
      setSbaDrafts(qd);
    }
    setLoading(false);
  }, [accessOk, gateLoading, kind, testId]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveMeqOverview = async () => {
    if (!canEdit || kind !== "meq" || !testId) return;
    setSavingOverview(true);
    setErr(null);
    setOkMessage(null);
    const tl = parseInt(meqOverviewDraft.time_limit_minutes, 10);
    if (meqOverviewDraft.time_limit_minutes.trim() && (isNaN(tl) || tl < 1)) {
      setErr("Overall time (minutes) must be a positive number or empty.");
      setSavingOverview(false);
      return;
    }
    const { error } = await supabase
      .from("meq_tests")
      .update({
        first_page_stem: meqOverviewDraft.first_page_stem.trim(),
        vignette: meqOverviewDraft.vignette.trim(),
        time_limit_minutes: meqOverviewDraft.time_limit_minutes.trim() ? tl : null,
      })
      .eq("id", testId);
    setSavingOverview(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setOkMessage("Case overview saved.");
    void load();
  };

  const saveMeqStage = async (stageId: string) => {
    if (!canEdit || kind !== "meq" || !testId) return;
    const draft = stageDrafts[stageId];
    const prev = meqStages.find((s) => s.id === stageId);
    if (!draft || !prev) return;

    setSavingStageId(stageId);
    setErr(null);
    setOkMessage(null);

    const newRub = draft.rubric_criteria.trim();
    if (!newRub) {
      setErr(`Stage ${prev.sequence_order}: rubric cannot be empty.`);
      setSavingStageId(null);
      return;
    }
    const maxNum = parseInt(draft.max_score, 10);
    if (isNaN(maxNum) || maxNum < 1 || maxNum > 100) {
      setErr(`Stage ${prev.sequence_order}: max score must be 1–100.`);
      setSavingStageId(null);
      return;
    }
    const qText = draft.question_text.trim();
    if (!qText) {
      setErr(`Stage ${prev.sequence_order}: question text is required.`);
      setSavingStageId(null);
      return;
    }

    const prevRub = prev.rubric_criteria ?? "";
    const prevMax = prev.max_score ?? 0;

    const { error: upErr } = await supabase
      .from("meq_test_stages")
      .update({
        stage_information: draft.stage_information.trim() || null,
        question_text: qText,
        rubric_criteria: newRub,
        max_score: maxNum,
      })
      .eq("id", stageId);

    if (upErr) {
      setErr(upErr.message);
      setSavingStageId(null);
      return;
    }

    const editorId = await getSessionUserId();
    if (editorId && (newRub !== prevRub || maxNum !== prevMax)) {
      const { error: logErr } = await supabase.from("meq_rubric_revision_log").insert({
        meq_stage_id: stageId,
        meq_test_id: testId,
        editor_id: editorId,
        previous_rubric_criteria: prevRub || null,
        new_rubric_criteria: newRub,
        previous_max_score: prevMax,
        new_max_score: maxNum,
      });
      if (logErr) {
        setErr("Stage saved but audit log failed: " + logErr.message);
        setSavingStageId(null);
        void load();
        return;
      }
    }

    setOkMessage(`Stage ${prev.sequence_order} saved.`);
    setSavingStageId(null);
    void load();
  };

  const saveSbaQuestion = async (questionId: string) => {
    if (!canEdit || kind !== "sba") return;
    const draft = sbaDrafts[questionId];
    const prev = sbaQuestions.find((q) => q.id === questionId);
    if (!draft || !prev) return;

    setSavingQuestionId(questionId);
    setErr(null);
    setOkMessage(null);

    const stem = draft.stem.trim();
    if (!stem) {
      setErr(`Question ${prev.sequence_order}: stem is required.`);
      setSavingQuestionId(null);
      return;
    }

    let optionsParsed: unknown;
    try {
      optionsParsed = JSON.parse(draft.optionsJson);
    } catch {
      setErr(`Question ${prev.sequence_order}: options must be valid JSON.`);
      setSavingQuestionId(null);
      return;
    }
    if (!Array.isArray(optionsParsed) || optionsParsed.length === 0) {
      setErr(`Question ${prev.sequence_order}: options must be a non-empty JSON array.`);
      setSavingQuestionId(null);
      return;
    }
    for (const o of optionsParsed) {
      if (!o || typeof o !== "object" || !("id" in o) || !("text" in o)) {
        setErr(`Question ${prev.sequence_order}: each option needs id and text.`);
        setSavingQuestionId(null);
        return;
      }
    }

    const { error } = await supabase
      .from("sba_test_questions")
      .update({
        stem,
        options: optionsParsed,
      })
      .eq("id", questionId);

    setSavingQuestionId(null);
    if (error) {
      setErr(error.message);
      return;
    }
    setOkMessage(`Question ${prev.sequence_order} saved.`);
    void load();
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
        <p className="text-red-700">Invalid URL. Use /sub-admin/test-review/meq/… or …/sba/…</p>
        <Link href="/sub-admin" className="text-blue-600 text-sm mt-4 inline-block">
          Back
        </Link>
      </div>
    );
  }

  const angoffHref = `/sub-admin/angoff/${kind}/${testId}`;

  const renderMeqOverview = () => {
    if (!meqMeta) return null;
    if (!canEdit) {
      return (
        <section className="bg-white border rounded-lg p-5 text-sm space-y-3">
          <h2 className="font-semibold text-lg">Case overview</h2>
          {meqMeta.time_limit_minutes != null && (
            <p>
              <span className="font-medium text-slate-700">Overall time (minutes):</span>{" "}
              {meqMeta.time_limit_minutes}
            </p>
          )}
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              First page instructions
            </div>
            <p className="mt-1 whitespace-pre-wrap text-slate-800">{meqMeta.first_page_stem}</p>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Vignette</div>
            <p className="mt-1 whitespace-pre-wrap text-slate-800">{meqMeta.vignette}</p>
          </div>
        </section>
      );
    }
    return (
      <section className="bg-white border rounded-lg p-5 text-sm space-y-4">
        <h2 className="font-semibold text-lg">Case overview</h2>
        <p className="text-xs text-slate-600">
          Save once after editing instructions or vignette (applies to the whole MEQ).
        </p>
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Overall time (minutes)
          </label>
          <input
            type="number"
            min={1}
            className="mt-1 w-full max-w-xs border rounded-md px-3 py-2"
            value={meqOverviewDraft.time_limit_minutes}
            onChange={(e) =>
              setMeqOverviewDraft((d) => ({ ...d, time_limit_minutes: e.target.value }))
            }
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">
            First page instructions
          </label>
          <textarea
            className="mt-1 w-full border rounded-md px-3 py-2 min-h-[80px]"
            value={meqOverviewDraft.first_page_stem}
            onChange={(e) =>
              setMeqOverviewDraft((d) => ({ ...d, first_page_stem: e.target.value }))
            }
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Vignette
          </label>
          <textarea
            className="mt-1 w-full border rounded-md px-3 py-2 min-h-[120px]"
            value={meqOverviewDraft.vignette}
            onChange={(e) => setMeqOverviewDraft((d) => ({ ...d, vignette: e.target.value }))}
          />
        </div>
        <button
          type="button"
          disabled={savingOverview}
          onClick={() => void saveMeqOverview()}
          className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {savingOverview ? "Saving…" : "Save case overview"}
        </button>
      </section>
    );
  };

  const renderMeqStage = (st: MeqStageDetail) => {
    const d = stageDrafts[st.id];
    if (!d) return null;

    if (!canEdit) {
      return (
        <section key={st.id} className="bg-white border rounded-lg p-5 text-sm space-y-3">
          <div className="font-semibold text-slate-900">
            Stage {st.sequence_order}
            {st.max_score != null && (
              <span className="text-slate-500 font-normal"> · Max score {st.max_score}</span>
            )}
          </div>
          {st.stage_information ? (
            <div>
              <div className="text-xs font-semibold text-slate-500">Stage information</div>
              <p className="mt-1 whitespace-pre-wrap text-slate-800">{st.stage_information}</p>
            </div>
          ) : null}
          <div>
            <div className="text-xs font-semibold text-slate-500">Question</div>
            <p className="mt-1 whitespace-pre-wrap text-slate-800">{st.question_text}</p>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500">Rubric</div>
            <p className="mt-1 whitespace-pre-wrap border-l-2 border-slate-200 pl-3 text-slate-800">
              {st.rubric_criteria || "—"}
            </p>
          </div>
        </section>
      );
    }

    return (
      <section key={st.id} className="bg-white border rounded-lg p-5 text-sm space-y-4">
        <div className="font-semibold text-slate-900">
          Stage {st.sequence_order}
          <span className="text-slate-500 font-normal text-xs ml-2">
            Save this stage separately after edits.
          </span>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500">Stage information</label>
          <textarea
            className="mt-1 w-full border rounded-md px-3 py-2 min-h-[72px]"
            value={d.stage_information}
            onChange={(e) =>
              setStageDrafts((prev) => ({
                ...prev,
                [st.id]: { ...d, stage_information: e.target.value },
              }))
            }
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500">Question</label>
          <textarea
            className="mt-1 w-full border rounded-md px-3 py-2 min-h-[100px]"
            value={d.question_text}
            onChange={(e) =>
              setStageDrafts((prev) => ({
                ...prev,
                [st.id]: { ...d, question_text: e.target.value },
              }))
            }
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500">Rubric (grading criteria)</label>
          <textarea
            className="mt-1 w-full border rounded-md px-3 py-2 min-h-[120px]"
            value={d.rubric_criteria}
            onChange={(e) =>
              setStageDrafts((prev) => ({
                ...prev,
                [st.id]: { ...d, rubric_criteria: e.target.value },
              }))
            }
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500">Max score</label>
          <input
            type="number"
            min={1}
            max={100}
            className="mt-1 w-full max-w-xs border rounded-md px-3 py-2"
            value={d.max_score}
            onChange={(e) =>
              setStageDrafts((prev) => ({
                ...prev,
                [st.id]: { ...d, max_score: e.target.value },
              }))
            }
          />
        </div>
        <button
          type="button"
          disabled={savingStageId === st.id}
          onClick={() => void saveMeqStage(st.id)}
          className="px-4 py-2 bg-blue-900 text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {savingStageId === st.id ? "Saving…" : `Save stage ${st.sequence_order}`}
        </button>
      </section>
    );
  };

  const renderSbaQuestion = (q: SbaQDetail) => {
    const d = sbaDrafts[q.id];
    if (!d) return null;

    if (!canEdit) {
      return (
        <section key={q.id} className="bg-white border rounded-lg p-5 text-sm space-y-3">
          <div className="font-semibold text-slate-900">Question {q.sequence_order}</div>
          <p className="whitespace-pre-wrap text-slate-800">{q.stem}</p>
          <div className="text-xs font-semibold text-slate-500">Options</div>
          <ul className="list-disc pl-5 space-y-1 text-slate-800">
            {Array.isArray(q.options)
              ? (q.options as { id?: string; text?: string }[]).map((o, i) => (
                  <li key={o.id || i}>
                    <span className="font-mono text-xs text-slate-500">{o.id ?? "?"}.</span> {o.text ?? ""}
                  </li>
                ))
              : null}
          </ul>
        </section>
      );
    }

    return (
      <section key={q.id} className="bg-white border rounded-lg p-5 text-sm space-y-4">
        <div className="font-semibold text-slate-900">
          Question {q.sequence_order}
          <span className="text-slate-500 font-normal text-xs ml-2">
            Save this item after changing stem or options.
          </span>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500">Stem</label>
          <textarea
            className="mt-1 w-full border rounded-md px-3 py-2 min-h-[100px]"
            value={d.stem}
            onChange={(e) =>
              setSbaDrafts((prev) => ({
                ...prev,
                [q.id]: { ...d, stem: e.target.value },
              }))
            }
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500">
            Options (JSON array of objects, each with id and text)
          </label>
          <textarea
            className="mt-1 w-full border rounded-md px-3 py-2 font-mono text-xs min-h-[160px]"
            value={d.optionsJson}
            onChange={(e) =>
              setSbaDrafts((prev) => ({
                ...prev,
                [q.id]: { ...d, optionsJson: e.target.value },
              }))
            }
          />
        </div>
        <button
          type="button"
          disabled={savingQuestionId === q.id}
          onClick={() => void saveSbaQuestion(q.id)}
          className="px-4 py-2 bg-blue-900 text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {savingQuestionId === q.id ? "Saving…" : `Save question ${q.sequence_order}`}
        </button>
      </section>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 pt-20 pb-16 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <Link href="/sub-admin" className="text-blue-600 text-sm hover:underline">
            &larr; Exam review committee
          </Link>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link
              href={angoffHref}
              className="px-3 py-1.5 rounded border border-slate-300 bg-white font-medium text-slate-800 hover:bg-slate-50"
            >
              Modified Angoff
            </Link>
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-slate-900">Test review</h1>
          <p className="text-slate-600 text-sm mt-1">
            {kind.toUpperCase()} · {label || testId}
          </p>
        </div>

        {isEducatorOnly && (
          <div className="rounded border border-amber-200 bg-amber-50 text-amber-950 px-4 py-3 text-sm">
            <strong>Committee view:</strong> read-only content below. Use{" "}
            <Link href={angoffHref} className="font-semibold underline">
              Modified Angoff
            </Link>{" "}
            for ratings.
          </div>
        )}

        {canEdit && (
          <div className="rounded border border-blue-200 bg-blue-50 text-blue-950 px-4 py-3 text-sm">
            <strong>Admin / sub-admin:</strong> save each block with its own button — case overview once; each
            MEQ stage separately (question, rubric, max score); each SBA question separately (stem + options
            JSON).
          </div>
        )}

        {okMessage && (
          <div className="p-3 rounded border border-green-200 bg-green-50 text-green-900 text-sm">
            {okMessage}
          </div>
        )}

        {err && (
          <div className="p-3 rounded border border-red-200 bg-red-50 text-red-800 text-sm">{err}</div>
        )}

        {loading ? (
          <p className="text-slate-600">Loading…</p>
        ) : kind === "meq" && meqMeta ? (
          <div className="space-y-6">
            {renderMeqOverview()}
            {meqStages.map((st) => renderMeqStage(st))}
          </div>
        ) : kind === "sba" && sbaMeta ? (
          <div className="space-y-6">
            <section className="bg-white border rounded-lg p-5 text-sm">
              <h2 className="font-semibold text-lg mb-2">SBA · {sbaMeta.subject}</h2>
              <p className="text-slate-600">Code {sbaMeta.subject_code}</p>
            </section>
            {sbaQuestions.map((q) => renderSbaQuestion(q))}
          </div>
        ) : (
          <p className="text-slate-600">No content loaded.</p>
        )}
      </div>
    </div>
  );
}
