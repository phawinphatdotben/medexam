"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { STAFF_DASHBOARD_ROLES } from "@/lib/auth/roles";
import { getAuthUserId } from "@/lib/auth/session";
import { useRoleGate } from "@/hooks/useRoleGate";
import { downloadCsv, rowToCsvLine } from "@/lib/csvDownload";
import { parseSbaQuestionsCsv } from "@/lib/parseSbaQuestionsCsv";
import { SUBJECTS, type SubjectName } from "@/lib/subjects";

type OptionRow = { id: string; text: string };

type QuestionDraft = {
  stem: string;
  image_url: string;
  options: OptionRow[];
  correct_option_id: string;
};

const LETTERS = "ABCDEFGHIJKLMNOP".split("");

const emptyQuestion = (): QuestionDraft => ({
  stem: "",
  image_url: "",
  options: [
    { id: "A", text: "" },
    { id: "B", text: "" },
  ],
  correct_option_id: "A",
});

export default function CreateSbaTestPage() {
  const router = useRouter();
  const { ready: accessOk, loading: gateLoading } = useRoleGate(STAFF_DASHBOARD_ROLES, {
    noUserRedirect: "/login",
    wrongRoleRedirect: "/practice-tests",
  });
  const [depsReady, setDepsReady] = useState(false);
  const [subject, setSubject] = useState<SubjectName>(SUBJECTS[0]!);
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
  const [questions, setQuestions] = useState<QuestionDraft[]>([emptyQuestion()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const applyImportedQuestions = (csvText: string) => {
    const result = parseSbaQuestionsCsv(csvText);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    const mapped = result.rows.map((r) => ({
      stem: r.stem,
      image_url: r.image_url,
      options: r.options,
      correct_option_id: r.correct_option_id,
    }));
    setQuestions((prev) => [...prev, ...mapped]);
  };

  const updateQuestion = (i: number, next: Partial<QuestionDraft>) => {
    setQuestions((prev) =>
      prev.map((q, j) => (j === i ? { ...q, ...next } : q))
    );
  };

  const addOption = (qIdx: number) => {
    setQuestions((prev) => {
      const q = prev[qIdx];
      if (!q) return prev;
      const used = new Set(q.options.map((o) => o.id));
      const letter = LETTERS.find((L) => !used.has(L));
      if (!letter) return prev;
      return prev.map((qq, j) =>
        j === qIdx
          ? { ...qq, options: [...qq.options, { id: letter, text: "" }] }
          : qq
      );
    });
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!subjectCode.trim()) {
      setError("Course code is required.");
      return;
    }
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]!;
      if (!q.stem.trim()) {
        setError(`Question ${i + 1}: stem is required.`);
        return;
      }
      const filled = q.options.filter((o) => o.text.trim());
      if (filled.length < 2) {
        setError(`Question ${i + 1}: add at least two choices.`);
        return;
      }
      if (!q.options.some((o) => o.id === q.correct_option_id && o.text.trim())) {
        setError(`Question ${i + 1}: mark a correct choice that has text.`);
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
      .from("sba_tests")
      .insert({
        subject,
        subject_code: normalizedCourseCode,
        test_function: testFunction,
        assessment_purpose: testFunction === "practice" ? "formative" : assessmentPurpose,
        department_id: departmentId || null,
        test_year: testYear,
        created_by: userIdSubmit,
        review_status: "pending_committee",
      })
      .select("id, public_code")
      .single();

    if (testErr || !testRow) {
      setSaving(false);
      setError(
        testErr?.message ||
          "Could not create test. Apply migration 002 in Supabase and ensure tables exist."
      );
      return;
    }

    const testId = testRow.id;
    const publicCode = (testRow as { id: string; public_code: string | null }).public_code ?? null;
    const rows = questions.map((q, order) => ({
      sba_test_id: testId,
      sequence_order: order + 1,
      stem: q.stem.trim(),
      image_url: q.image_url.trim() || null,
      options: q.options
        .filter((o) => o.text.trim())
        .map((o) => ({ id: o.id, text: o.text.trim() })),
      correct_option_id: q.correct_option_id,
    }));

    const { error: qErr } = await supabase.from("sba_test_questions").insert(rows);
    if (qErr) {
      setSaving(false);
      setError(qErr.message || "Test created but questions failed to save.");
      return;
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
        <h1 className="text-3xl font-bold text-blue-900 mb-1">Create SBA test</h1>
        <p className="text-gray-600 text-sm mb-4">
          Each question gets a new UUID in the database. Committee status starts as &quot;pending
          committee&quot;.
        </p>
        <div className="rounded-lg border border-blue-300 bg-blue-100/90 px-4 py-3 text-sm text-blue-950 mb-8 space-y-2">
          <p>
            <span className="font-semibold">Pool & committee:</span> Staff-authored tests stay in the pool until
            approved. Students never see unapproved content.
          </p>
          <p>
            <span className="font-semibold">Real vs practice:</span> After approval, practice tests are open to all
            students for self-study. Real tests are delivered only through{" "}
            <strong>Test assignments</strong> (admin / sub-admin) into each student&apos;s{" "}
            <strong>Test session</strong>.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-8">
          <section className="border border-gray-200 rounded-lg p-6 space-y-4">
            <h2 className="font-semibold text-lg text-gray-900">Test details</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700">Subject</label>
              <select
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={subject}
                onChange={(e) => setSubject(e.target.value as SubjectName)}
              >
                {SUBJECTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
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
                placeholder="e.g. IM-2026-A"
                required
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
          </section>

          <section className="border border-gray-200 rounded-lg p-4 space-y-2 bg-gray-50/80">
            <h2 className="font-semibold text-gray-900">Bulk import (CSV)</h2>
            <p className="text-xs text-gray-600">
              Download the template, then fill one row per question. Each import <strong>adds</strong>{" "}
              those rows after your current draft questions (nothing is removed).
            </p>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center flex-wrap">
              <button
                type="button"
                className="text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-800 shadow-sm w-fit"
                onClick={() =>
                  downloadCsv("sba-questions-template.csv", [
                    rowToCsvLine(["stem", "image_url", "correct_option_id", "A", "B", "C", "D"]),
                    rowToCsvLine([
                      "Example: What is the most appropriate next step?",
                      "",
                      "B",
                      "First answer choice",
                      "Second answer choice",
                      "Third choice (optional)",
                      "",
                    ]),
                  ])
                }
              >
                Download CSV template
              </button>
              <label className="text-sm text-gray-700 flex items-center gap-2 cursor-pointer">
                <span className="font-medium">Import CSV</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="text-sm text-gray-800 max-w-[220px]"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      const t = typeof reader.result === "string" ? reader.result : "";
                      applyImportedQuestions(t);
                    };
                    reader.readAsText(f);
                  }}
                />
              </label>
            </div>
            <p className="text-xs text-gray-500">
              Required header columns: stem (or question_text), correct_option_id (or correct), and at
              least two choice columns named A, B, … Add image_url for optional picture URLs. Extra
              columns E–P are supported if you add them to the header row.
            </p>
          </section>

          {questions.map((q, qIdx) => (
            <section
              key={qIdx}
              className="border border-blue-300 rounded-lg p-6 space-y-4 bg-blue-100/30"
            >
              <h2 className="font-semibold text-lg text-blue-950">Question {qIdx + 1}</h2>
              <div>
                <label className="block text-sm font-medium text-gray-700">Question text</label>
                <textarea
                  className="mt-1 w-full border rounded-md px-3 py-2 min-h-[100px]"
                  value={q.stem}
                  onChange={(e) => updateQuestion(qIdx, { stem: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Picture (URL)
                </label>
                <input
                  type="url"
                  className="mt-1 w-full border rounded-md px-3 py-2"
                  value={q.image_url}
                  onChange={(e) => updateQuestion(qIdx, { image_url: e.target.value })}
                  placeholder="https://"
                />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-gray-700">Choices</label>
                  <button
                    type="button"
                    onClick={() => addOption(qIdx)}
                    className="text-sm text-blue-800 font-medium hover:underline"
                  >
                    + Add choice
                  </button>
                </div>
                <ul className="mt-2 space-y-2">
                  {q.options.map((o) => (
                    <li key={o.id} className="flex items-start gap-2">
                      <input
                        type="radio"
                        name={`correct-${qIdx}`}
                        checked={q.correct_option_id === o.id}
                        onChange={() => updateQuestion(qIdx, { correct_option_id: o.id })}
                        className="mt-2"
                        title="Correct"
                      />
                      <span className="mt-1 w-6 font-mono font-bold">{o.id}.</span>
                      <input
                        className="flex-1 border rounded-md px-2 py-1.5"
                        value={o.text}
                        onChange={(e) => {
                          setQuestions((prev) =>
                            prev.map((qq, j) => {
                              if (j !== qIdx) return qq;
                              return {
                                ...qq,
                                options: qq.options.map((opt) =>
                                  opt.id === o.id
                                    ? { ...opt, text: e.target.value }
                                    : opt
                                ),
                              };
                            })
                          );
                        }}
                        placeholder="Option text"
                      />
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ))}

          <button
            type="button"
            onClick={() => setQuestions((prev) => [...prev, emptyQuestion()])}
            className="w-full border border-dashed border-gray-300 py-3 rounded-lg text-gray-600 hover:bg-gray-50"
          >
            + Add another question
          </button>

          {error && (
            <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded p-3">
              {error}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-900 text-white font-semibold px-8 py-3 rounded-lg shadow disabled:opacity-50"
            >
              {saving ? "Saving..." : "Submit for committee review"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
