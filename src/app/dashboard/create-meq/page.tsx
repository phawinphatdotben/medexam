"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { STAFF_DASHBOARD_ROLES } from "@/lib/auth/roles";
import { getAuthUserId } from "@/lib/auth/session";
import { useRoleGate } from "@/hooks/useRoleGate";
import { SUBJECTS, type SubjectName } from "@/lib/subjects";
import { downloadCsv, rowToCsvLine } from "@/lib/csvDownload";
import { parseMeqStagesCsv } from "@/lib/parseMeqStagesCsv";

type ItemDraft = {
  question_text: string;
  rubric_criteria: string;
  max_score: string;
  media_url: string;
};

type StageDraft = {
  sequence_order: number;
  time_limit_minutes: string;
  /** Shown once at this stage (labs, extra data). */
  stage_information: string;
  /** Typed questions graded together before the learner advances. */
  items: ItemDraft[];
};

function blankItemDraft(): ItemDraft {
  return { question_text: "", rubric_criteria: "", max_score: "10", media_url: "" };
}

export default function CreateMeqTestPage() {
  const router = useRouter();
  const { ready: accessOk, loading: gateLoading } = useRoleGate(STAFF_DASHBOARD_ROLES, {
    noUserRedirect: "/login",
    wrongRoleRedirect: "/practice-tests",
  });
  const [depsReady, setDepsReady] = useState(false);
  const [subject, setSubject] = useState<SubjectName>(SUBJECTS[0]!);
  const [subjectSearch, setSubjectSearch] = useState("");
  const [subjectCode, setSubjectCode] = useState("");
  const [subjectCodeSearch, setSubjectCodeSearch] = useState("");
  const [codeSuggestions, setCodeSuggestions] = useState<
    { code: string; hint: string }[]
  >([]);
  const [testFunction, setTestFunction] = useState<"practice" | "real_test">("real_test");
  const [assessmentPurpose, setAssessmentPurpose] = useState<"formative" | "summative">("summative");
  const [testYear, setTestYear] = useState(new Date().getFullYear());
  const [departmentId, setDepartmentId] = useState<string>("");
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [timeLimitOverall, setTimeLimitOverall] = useState("60");
  const [firstPageStem, setFirstPageStem] = useState(
    "Time limit for this exam (minutes) is set below. Read the case and answer each stage in order."
  );
  const [vignette, setVignette] = useState("");
  const [stages, setStages] = useState<StageDraft[]>([
    {
      sequence_order: 1,
      time_limit_minutes: "15",
      stage_information: "",
      items: [blankItemDraft()],
    },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalizedSubjectSearch = subjectSearch.trim().toLowerCase();
  const filteredSubjects = SUBJECTS.filter((s) =>
    normalizedSubjectSearch ? s.toLowerCase().includes(normalizedSubjectSearch) : true
  );

  const load = useCallback(async () => {
    if (!accessOk || gateLoading) return;
    const { data: deps } = await supabase.from("departments").select("id, name").order("name");
    setDepartments(deps || []);
    if (deps?.[0]) setDepartmentId(deps[0].id);
    setDepsReady(true);
  }, [accessOk, gateLoading]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const run = async () => {
      const q = subjectCodeSearch.trim();
      if (q.length < 2) {
        setCodeSuggestions([]);
        return;
      }
      const normalizedQuery = q.toLowerCase().replace(/\s+/g, "");
      const seed = q.split(/\s+/)[0] || q;
      const { data } = await supabase
        .from("course_catalog")
        .select("course_code, course_title, year_level")
        .or(`course_code.ilike.*${seed}*,course_title.ilike.*${seed}*`)
        .order("year_level", { ascending: true })
        .limit(80);
      const fromCatalog = (data as { course_code: string; course_title: string; year_level: number }[] | null) || [];
      const merged = fromCatalog
        .filter((row) => {
          const codeNorm = row.course_code.toLowerCase().replace(/\s+/g, "");
          const titleNorm = row.course_title.toLowerCase().replace(/\s+/g, "");
          return codeNorm.includes(normalizedQuery) || titleNorm.includes(normalizedQuery);
        })
        .sort((a, b) => {
          const aNorm = a.course_code.toLowerCase().replace(/\s+/g, "");
          const bNorm = b.course_code.toLowerCase().replace(/\s+/g, "");
          const aStarts = aNorm.startsWith(normalizedQuery) ? 0 : 1;
          const bStarts = bNorm.startsWith(normalizedQuery) ? 0 : 1;
          if (aStarts !== bStarts) return aStarts - bStarts;
          return aNorm.localeCompare(bNorm);
        })
        .slice(0, 12)
        .map((row) => ({
          code: row.course_code,
          hint: `Catalog · Year ${row.year_level} · ${row.course_title}`,
        }));
      setCodeSuggestions(merged);
    };
    void run();
  }, [subjectCodeSearch]);

  const applyImportedStages = (csvText: string) => {
    const result = parseMeqStagesCsv(csvText);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    const mapped: StageDraft[] = result.rows.map((r) => ({
      sequence_order: r.sequence_order,
      time_limit_minutes: r.time_limit_minutes,
      stage_information: r.stage_information,
      items: [
        {
          question_text: r.question_text,
          rubric_criteria: r.rubric_criteria,
          max_score: r.max_score,
          media_url: r.media_url,
        },
      ],
    }));
    mapped.sort((a, b) => a.sequence_order - b.sequence_order);
    const normalized = mapped.map((s, i) => ({ ...s, sequence_order: i + 1 }));
    setStages(normalized);
  };

  const addStage = () => {
    setStages((prev) => [
      ...prev,
      {
        sequence_order: prev.length + 1,
        time_limit_minutes: "15",
        stage_information: "",
        items: [blankItemDraft()],
      },
    ]);
  };

  const updateStageShell = (i: number, field: "time_limit_minutes" | "stage_information", value: string) => {
    setStages((prev) => prev.map((s, j) => (j === i ? { ...s, [field]: value } : s)));
  };

  const updateStageItem = (stageIdx: number, itemIdx: number, field: keyof ItemDraft, value: string) => {
    setStages((prev) =>
      prev.map((s, j) =>
        j === stageIdx
          ? {
              ...s,
              items: s.items.map((it, k) =>
                k === itemIdx ? { ...it, [field]: value } : it,
              ),
            }
          : s,
      ),
    );
  };

  const addQuestionToStage = (stageIdx: number) => {
    setStages((prev) =>
      prev.map((s, j) => (j === stageIdx ? { ...s, items: [...s.items, blankItemDraft()] } : s)),
    );
  };

  const removeQuestionFromStage = (stageIdx: number, itemIdx: number) => {
    setStages((prev) =>
      prev.map((s, j) =>
        j === stageIdx && s.items.length > 1
          ? {
              ...s,
              items: s.items.filter((_, k) => k !== itemIdx),
            }
          : s,
      ),
    );
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!subjectCode.trim() || !vignette.trim()) {
      setError("Course code and case vignette are required.");
      return;
    }
    const overall = parseInt(timeLimitOverall, 10);
    if (isNaN(overall) || overall < 1) {
      setError("Overall time limit must be a positive number (minutes).");
      return;
    }
    for (let i = 0; i < stages.length; i++) {
      const st = stages[i]!;
      if (!st.items.length) {
        setError(`Stage ${i + 1}: add at least one question.`);
        return;
      }
      const tl = parseInt(st.time_limit_minutes, 10);
      if (isNaN(tl) || tl < 1) {
        setError(`Stage ${i + 1}: time limit (minutes) must be a positive number.`);
        return;
      }
      let partSum = 0;
      for (let pi = 0; pi < st.items.length; pi++) {
        const it = st.items[pi]!;
        if (!it.question_text.trim()) {
          setError(`Stage ${i + 1}, part ${pi + 1}: question text is required.`);
          return;
        }
        if (!it.rubric_criteria.trim()) {
          setError(`Stage ${i + 1}, part ${pi + 1}: rubric criteria is required.`);
          return;
        }
        const mx = parseInt(it.max_score, 10);
        if (isNaN(mx) || mx < 1 || mx > 100) {
          setError(`Stage ${i + 1}, part ${pi + 1}: max score must be between 1 and 100.`);
          return;
        }
        partSum += mx;
      }
      if (partSum > 1000) {
        setError(`Stage ${i + 1}: combined part max (${partSum}) exceeds the database cap of 1000 — reduce scoring.`);
        return;
      }
    }

    const normalizedCourseCode = subjectCode.trim().toUpperCase();
    const { data: courseMatch, error: courseMatchError } = await supabase
      .from("course_catalog")
      .select("course_code")
      .ilike("course_code", normalizedCourseCode)
      .maybeSingle();
    if (courseMatchError || !courseMatch) {
      setError("Course code must match an item in the course catalog. Please pick from suggestions.");
      return;
    }

    setSaving(true);
    const userIdSubmit = await getAuthUserId();
    if (!userIdSubmit) {
      setSaving(false);
      setError("Not signed in.");
      return;
    }

    const { data: testRow, error: testErr } = await supabase
      .from("meq_tests")
      .insert({
        subject,
        course_code: normalizedCourseCode,
        test_function: testFunction,
        assessment_purpose: testFunction === "practice" ? "formative" : assessmentPurpose,
        department_id: departmentId || null,
        test_year: testYear,
        time_limit_minutes: overall,
        first_page_stem: firstPageStem.trim(),
        vignette: vignette.trim(),
        created_by: userIdSubmit,
        review_status: "pending_committee",
      })
      .select("id, public_code")
      .single();

    if (testErr || !testRow) {
      setSaving(false);
      setError(
        testErr?.message ||
          "Could not create MEQ test. Apply migration 002 in Supabase and ensure tables exist."
      );
      return;
    }

    const testId = testRow.id;
    const publicCode = (testRow as { id: string; public_code: string | null }).public_code ?? null;

    const stageRows = stages.map((s, i) => {
      const parts = s.items.map((it, pi) => ({
        qi: pi + 1,
        qt: it.question_text.trim(),
        rub: it.rubric_criteria.trim(),
        mx: parseInt(it.max_score, 10),
        mu: it.media_url.trim(),
      }));
      const question_text = parts.map((p) => `Part ${p.qi}: ${p.qt}`).join("\n\n");
      const rubric_criteria = parts
        .map((p) => `Part ${p.qi} (max ${p.mx} pts)\n${p.rub}`)
        .join("\n\n\n");
      const max_score = parts.reduce((n, p) => n + p.mx, 0);
      const firstMedia = parts.find((p) => p.mu)?.mu;
      return {
        meq_test_id: testId,
        sequence_order: i + 1,
        time_limit_minutes: parseInt(s.time_limit_minutes, 10),
        stage_information: s.stage_information.trim() || null,
        question_text,
        rubric_criteria,
        max_score,
        media_urls: firstMedia ? [firstMedia] : [],
      };
    });

    const { error: stErr } = await supabase.from("meq_test_stages").insert(stageRows);

    if (stErr) {
      setSaving(false);
      setError(stErr.message || "MEQ created but stages failed to save.");
      return;
    }

    const { data: insertedStages, error: refetchErr } = await supabase
      .from("meq_test_stages")
      .select("id, sequence_order")
      .eq("meq_test_id", testId)
      .order("sequence_order", { ascending: true });

    if (refetchErr || !insertedStages || insertedStages.length !== stages.length) {
      setSaving(false);
      setError(refetchErr?.message || "MEQ stages could not be reloaded after insert.");
      return;
    }

    for (let si = 0; si < stages.length; si++) {
      const row = insertedStages[si];
      const s = stages[si];
      if (!row?.id || !s) continue;
      const itemsPayload = s.items.map((it, pi) => ({
        meq_stage_id: row.id,
        sequence_order: pi + 1,
        question_text: it.question_text.trim(),
        rubric_criteria: it.rubric_criteria.trim(),
        max_score: parseInt(it.max_score, 10),
        media_urls: it.media_url.trim() ? [it.media_url.trim()] : [],
      }));
      const { error: itErr } = await supabase.from("meq_stage_items").insert(itemsPayload);
      if (itErr) {
        setSaving(false);
        setError(
          itErr.message.includes("relation") || itErr.code === "42P01"
            ? "Run migration 036 (meq_stage_items) before creating tests with authored parts."
            : itErr.message || "Stage saved but nested questions failed.",
        );
        return;
      }
    }

    setSaving(false);
    const q = publicCode ? `?created=${encodeURIComponent(publicCode)}` : "";
    router.push(`/dashboard/my-tests${q}`);
  };

  if (!accessOk || gateLoading || !depsReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-gray-600">Loading...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white pt-20 pb-16 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <Link href="/dashboard/create" className="text-blue-600 hover:underline text-sm">
            &larr; Back
          </Link>
        </div>
        <h1 className="text-3xl font-bold text-blue-900 mb-1">Create MEQ test</h1>
        <p className="text-gray-600 text-sm mb-4">
          First page shows the overall time limit and case. Inside each chronological stage students may answer
          one or more graded free-text prompts together before advancing; each stage has its own countdown.
        </p>
        <div className="rounded-lg border border-blue-300 bg-blue-100/90 px-4 py-3 text-sm text-blue-950 mb-8 space-y-2">
          <p>
            <span className="font-semibold">Pool & committee:</span> New tests submit as pending until the review
            committee approves them. Nothing is visible to students until it is approved.
          </p>
          <p>
            <span className="font-semibold">Real vs practice:</span> Approved <em>practice</em> tests appear in
            practice browse for all students. Approved <em>real</em> tests (formative or summative)
            only appear in a student&apos;s <strong>Test session</strong> after an admin or sub-admin
            assigns them to people or groups.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-8">
          <section className="border border-gray-200 rounded-lg p-6 space-y-4">
            <h2 className="font-semibold text-lg">Test details</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700">Subject</label>
              <input
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={subjectSearch}
                onChange={(e) => setSubjectSearch(e.target.value)}
                placeholder="Search subject..."
              />
              <select
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={subject}
                onChange={(e) => setSubject(e.target.value as SubjectName)}
              >
                {filteredSubjects.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {filteredSubjects.length === 0 ? (
                <p className="mt-1 text-xs text-gray-500">No subject matches your search.</p>
              ) : null}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Course code</label>
              <input
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={subjectCode}
                onChange={(e) => {
                  setSubjectCode(e.target.value);
                  setSubjectCodeSearch(e.target.value);
                }}
                required
                placeholder="e.g. PED-2026-MEQ-1"
              />
              {codeSuggestions.length > 0 && (
                <div className="mt-2 border rounded-md bg-white max-h-52 overflow-auto">
                  {codeSuggestions.map((row) => (
                    <button
                      key={`${row.code}-${row.hint}`}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-b-0"
                      onClick={() => {
                        setSubjectCode(row.code);
                        setSubjectCodeSearch(row.code);
                        setCodeSuggestions([]);
                      }}
                    >
                      <div className="text-sm font-semibold">{row.code}</div>
                      <div className="text-xs text-gray-600">{row.hint}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Test function</label>
              <select
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={testFunction}
                onChange={(e) => setTestFunction(e.target.value as "practice" | "real_test")}
              >
                <option value="practice">Practice</option>
                <option value="real_test">Real test</option>
              </select>
            </div>
            {testFunction === "real_test" && (
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Real test classification
                </label>
                <select
                  className="mt-1 w-full border rounded-md px-3 py-2"
                  value={assessmentPurpose}
                  onChange={(e) =>
                    setAssessmentPurpose(e.target.value as "formative" | "summative")
                  }
                >
                  <option value="summative">Summative (high-stakes)</option>
                  <option value="formative">Formative (scheduled real exam)</option>
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  Matches committee groups: formative vs summative. Practice exams are always
                  formative.
                </p>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Year</label>
                <input
                  type="number"
                  className="mt-1 w-full border rounded-md px-3 py-2"
                  value={testYear}
                  onChange={(e) => setTestYear(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Department</label>
                <select
                  className="mt-1 w-full border rounded-md px-3 py-2"
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Overall time limit (minutes) — shown on first page
              </label>
              <input
                type="number"
                min={1}
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={timeLimitOverall}
                onChange={(e) => setTimeLimitOverall(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                First page instructions (optional)
              </label>
              <textarea
                className="mt-1 w-full border rounded-md px-3 py-2 min-h-[80px]"
                value={firstPageStem}
                onChange={(e) => setFirstPageStem(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Case vignette (first page)
              </label>
              <textarea
                className="mt-1 w-full border rounded-md px-3 py-2 min-h-[120px]"
                value={vignette}
                onChange={(e) => setVignette(e.target.value)}
                required
                placeholder="Clinical scenario stem..."
              />
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h2 className="font-semibold text-lg">Stages</h2>
              <div className="flex flex-col gap-2 items-start">
                <label className="text-sm font-medium text-gray-700">
                  Import stages from CSV
                </label>
                <button
                  type="button"
                  className="text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-800 shadow-sm"
                  onClick={() =>
                    downloadCsv("meq-stages-template.csv", [
                      rowToCsvLine([
                        "sequence_order",
                        "time_limit_minutes",
                        "stage_information",
                        "question_text",
                        "rubric_criteria",
                        "max_score",
                        "media_url",
                      ]),
                      rowToCsvLine([
                        "1",
                        "15",
                        "Optional: labs or extra context for this stage.",
                        "What is the most likely diagnosis?",
                        "Award points for systematic reasoning and final diagnosis.",
                        "10",
                        "",
                      ]),
                    ])
                  }
                >
                  Download CSV template
                </button>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="text-sm text-gray-800"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      const t = typeof reader.result === "string" ? reader.result : "";
                      applyImportedStages(t);
                    };
                    reader.readAsText(f);
                  }}
                />
                <p className="text-xs text-gray-500 max-w-md">
                  Header row (optional): stage, time_limit_minutes, stage_information, question_text,
                  rubric_criteria, max_score, media_url — or use seven fixed columns in that order.
                </p>
              </div>
            </div>
            {stages.map((st, i) => (
              <div
                key={i}
                className="border border-blue-200 rounded-lg p-4 bg-blue-50/30 space-y-4"
              >
                <h3 className="font-medium text-blue-900">Stage {i + 1}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm text-gray-700">Time limit (minutes, whole stage)</label>
                    <input
                      type="number"
                      min={1}
                      className="mt-1 w-full border rounded-md px-3 py-2"
                      value={st.time_limit_minutes}
                      onChange={(e) => updateStageShell(i, "time_limit_minutes", e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm text-gray-700">
                    Stage information (e.g. new labs, data for this step)
                  </label>
                  <textarea
                    className="mt-1 w-full border rounded-md px-3 py-2 min-h-[72px]"
                    value={st.stage_information}
                    onChange={(e) => updateStageShell(i, "stage_information", e.target.value)}
                    placeholder="Optional — content revealed once at this stage before the prompts."
                  />
                </div>
                {st.items.map((item, ii) => (
                  <div
                    key={ii}
                    className="border border-slate-200 rounded-md bg-white/80 p-3 space-y-3"
                  >
                    <div className="flex justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-800">
                        Prompt {ii + 1}
                        {st.items.length > 1 ? ` of ${st.items.length}` : ""}{" "}
                        <span className="font-normal text-slate-600">— answered together on one screen</span>
                      </span>
                      {st.items.length > 1 ? (
                        <button
                          type="button"
                          className="text-xs text-red-700 hover:underline"
                          onClick={() => removeQuestionFromStage(i, ii)}
                        >
                          Remove prompt
                        </button>
                      ) : null}
                    </div>
                    <div>
                      <label className="text-sm text-gray-700">Media URL (optional)</label>
                      <input
                        type="url"
                        className="mt-1 w-full border rounded-md px-3 py-2"
                        value={item.media_url}
                        onChange={(e) => updateStageItem(i, ii, "media_url", e.target.value)}
                        placeholder="https://"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-gray-700">Question (student answer)</label>
                      <textarea
                        className="mt-1 w-full border rounded-md px-3 py-2 min-h-[100px]"
                        value={item.question_text}
                        onChange={(e) => updateStageItem(i, ii, "question_text", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-sm text-gray-700">Rubric</label>
                      <textarea
                        className="mt-1 w-full border rounded-md px-3 py-2 min-h-[72px]"
                        value={item.rubric_criteria}
                        onChange={(e) => updateStageItem(i, ii, "rubric_criteria", e.target.value)}
                        placeholder="Marking criteria for this prompt."
                      />
                    </div>
                    <div>
                      <label className="text-sm text-gray-700">Max score (1-100)</label>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        className="mt-1 w-full border rounded-md px-3 py-2"
                        value={item.max_score}
                        onChange={(e) => updateStageItem(i, ii, "max_score", e.target.value)}
                      />
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addQuestionToStage(i)}
                  className="text-sm border border-dashed border-slate-300 rounded-md px-3 py-2 text-slate-700 hover:bg-slate-50 w-full sm:w-auto"
                >
                  + Add another graded prompt in this stage
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addStage}
              className="w-full border border-dashed border-gray-300 py-3 rounded-lg text-gray-600"
            >
              + Add stage
            </button>
          </section>

          {error && (
            <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded p-3">
              {error}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-700 text-white font-semibold px-8 py-3 rounded-lg disabled:opacity-50"
            >
              {saving ? "Saving..." : "Submit for committee review"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
