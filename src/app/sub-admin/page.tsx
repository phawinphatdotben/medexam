"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { COMMITTEE_PAGE_ROLES } from "@/lib/auth/roles";
import { useRoleGate } from "@/hooks/useRoleGate";
import { SUBJECTS } from "@/lib/subjects";

type TestRow = {
  id: string;
  kind: "SBA" | "MEQ";
  subject: string;
  subject_code: string;
  test_year: number;
  committee_id: string | null;
  review_status: string;
  created_by: string | null;
};

type ScoreRow = {
  id: string;
  examType: "MEQ" | "SBA";
  subject: string;
  subject_code: string;
  user_id: string;
  score: string;
  created_at: string;
};

type CommitteeScoreRow = {
  id: string;
  test_kind: "MEQ" | "SBA";
  test_id: string;
  committee_id: string;
  reviewer_id: string;
  standard_score: number;
};

export default function SubAdminPage() {
  const { ready: accessOk, loading: gateLoading, userId: myUserId, role: myRole } = useRoleGate(
    COMMITTEE_PAGE_ROLES,
    { noUserRedirect: "/login", wrongRoleRedirect: "/dashboard" },
  );
  const [dataLoaded, setDataLoaded] = useState(false);
  const [myCommitteeIds, setMyCommitteeIds] = useState<string[]>([]);
  const [committees, setCommittees] = useState<
    { id: string; name: string; subject: string | null; test_year: number | null }[]
  >([]);
  const [profiles, setProfiles] = useState<{ id: string; email: string }[]>([]);
  const [tests, setTests] = useState<TestRow[]>([]);
  const [newC, setNewC] = useState({ name: "", subject: "" as string, test_year: "" as string });
  const [addMember, setAddMember] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"review" | "scores">("review");
  const [testCodeSearch, setTestCodeSearch] = useState<string>("");
  const [scoreSubject, setScoreSubject] = useState<string>("");
  const [scoreCodeSearch, setScoreCodeSearch] = useState<string>("");
  const [scoreType, setScoreType] = useState<"ALL" | "MEQ" | "SBA">("ALL");
  const [onlyGraded, setOnlyGraded] = useState(true);
  const [scoreRows, setScoreRows] = useState<ScoreRow[]>([]);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [committeeScores, setCommitteeScores] = useState<Record<string, { average: number | null; count: number; mine: number | null }>>({});
  const [scoreInputs, setScoreInputs] = useState<Record<string, string>>({});
  const normalizedTestCodeSearch = testCodeSearch.trim().toLowerCase();
  const filteredTests = tests.filter((t) =>
    normalizedTestCodeSearch ? t.subject_code.toLowerCase().includes(normalizedTestCodeSearch) : true
  );
  const normalizedScoreCodeSearch = scoreCodeSearch.trim().toLowerCase();
  const filteredScoreRows = scoreRows.filter((r) =>
    normalizedScoreCodeSearch ? r.subject_code.toLowerCase().includes(normalizedScoreCodeSearch) : true
  );
  const roleScopedTests =
    myRole === "educator"
      ? filteredTests.filter((t) => t.committee_id != null && myCommitteeIds.includes(t.committee_id))
      : filteredTests;

  const canEditAwaitingTests = myRole === "sub_admin";

  const load = useCallback(async () => {
    if (!accessOk || gateLoading || !myUserId || !myRole) return;
    setErr(null);
    const { data: c } = await supabase
      .from("committees")
      .select("id, name, subject, test_year")
      .order("name");
    setCommittees(c || []);
    const { data: p } = await supabase
      .from("profiles")
      .select("id, email")
      .order("email", { ascending: true })
      .limit(200);
    setProfiles(p || []);
    const { data: ownMemberships } = await supabase
      .from("committee_members")
      .select("committee_id")
      .eq("profile_id", myUserId);
    const membershipIds = ((ownMemberships as { committee_id: string }[] | null) || []).map((m) => m.committee_id);
    setMyCommitteeIds(membershipIds);

    const { data: sba } = await supabase
      .from("sba_tests")
      .select("id, subject, subject_code, test_year, committee_id, review_status, created_by");
    const { data: meq } = await supabase
      .from("meq_tests")
      .select("id, subject, course_code, test_year, committee_id, review_status, created_by");
    const mergedAll: TestRow[] = [
      ...(sba || []).map((r) => ({ ...r, kind: "SBA" as const })),
      ...(meq || []).map((r) => ({ ...r, subject_code: r.course_code, kind: "MEQ" as const })),
    ];
    const { data: scopedRows } = await supabase
      .from("sub_admin_course_scopes")
      .select("course_code")
      .eq("profile_id", myUserId);
    const scopedCodes = ((scopedRows as { course_code: string }[] | null) || []).map((r) => r.course_code);
    const merged =
      myRole === "sub_admin"
        ? mergedAll.filter((t) => scopedCodes.includes(t.subject_code))
        : mergedAll;
    merged.sort((a, b) => a.subject.localeCompare(b.subject) || a.subject_code.localeCompare(b.subject_code));
    setTests(merged);
    const { data: scoreData } = await supabase
      .from("committee_test_scores")
      .select("id, test_kind, test_id, committee_id, reviewer_id, standard_score")
      .limit(2000);
    const rawScores = (scoreData as CommitteeScoreRow[] | null) || [];
    const nextScores: Record<string, { average: number | null; count: number; mine: number | null }> = {};
    for (const row of merged) {
      const key = `${row.kind}:${row.id}`;
      const rows = rawScores.filter((srow) => srow.test_kind === row.kind && srow.test_id === row.id);
      const count = rows.length;
      const avg = count ? Math.round((rows.reduce((acc, srow) => acc + srow.standard_score, 0) / count) * 10) / 10 : null;
      const mine = rows.find((srow) => srow.reviewer_id === myUserId)?.standard_score ?? null;
      nextScores[key] = { average: avg, count, mine };
    }
    setCommitteeScores(nextScores);
    setDataLoaded(true);
  }, [accessOk, gateLoading, myUserId, myRole]);

  useEffect(() => {
    load();
  }, [load]);

  const createCommittee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newC.name.trim()) return;
    setSaving("committee");
    const year = newC.test_year ? parseInt(newC.test_year, 10) : null;
    const { error } = await supabase
      .from("committees")
      .insert({
        name: newC.name.trim(),
        subject: newC.subject || null,
        test_year: year,
      })
      .select("id")
      .single();
    if (error) {
      setErr(error.message);
    } else {
      setNewC({ name: "", subject: "", test_year: "" });
      load();
    }
    setSaving(null);
  };

  const addToCommittee = async (committeeId: string) => {
    const pid = addMember[committeeId];
    if (!pid) return;
    setSaving(`mem-${committeeId}`);
    const { error } = await supabase
      .from("committee_members")
      .insert({ committee_id: committeeId, profile_id: pid });
    if (error) setErr(error.message);
    setSaving(null);
    setAddMember((a) => ({ ...a, [committeeId]: "" }));
  };

  const updateTest = async (row: TestRow) => {
    if (!canEditAwaitingTests || row.review_status !== "pending_committee") return;
    setSaving(`t-${row.kind}-${row.id}`);
    setErr(null);
    const table = row.kind === "SBA" ? "sba_tests" : "meq_tests";
    const { error } = await supabase
      .from(table)
      .update({
        committee_id: row.committee_id || null,
        review_status: row.review_status,
      })
      .eq("id", row.id);
    if (error) setErr(error.message);
    setSaving(null);
  };

  const saveCommitteeScore = async (row: TestRow) => {
    if (!myUserId || !row.committee_id) return;
    const key = `${row.kind}:${row.id}`;
    const value = Number(scoreInputs[key] ?? "");
    if (!Number.isInteger(value) || value < 10 || value > 100) {
      setErr("Committee score must be an integer from 10 to 100.");
      return;
    }
    setSaving(`score-${key}`);
    setErr(null);
    const { error } = await supabase
      .from("committee_test_scores")
      .upsert(
        {
          test_kind: row.kind,
          test_id: row.id,
          committee_id: row.committee_id,
          reviewer_id: myUserId,
          standard_score: value,
        },
        { onConflict: "test_kind,test_id,reviewer_id" }
      );
    if (error) {
      setErr(error.message || "Failed to save committee score.");
      setSaving(null);
      return;
    }
    await load();
    setSaving(null);
  };

  const loadScores = useCallback(async () => {
    setScoreLoading(true);
    setErr(null);
    const rows: ScoreRow[] = [];

    if (scoreType === "ALL" || scoreType === "MEQ") {
      let q = supabase
        .from("meq_stage_responses")
        .select(
          `
            id, user_id, created_at, human_override_score,
            meq_test_stages!inner(
            meq_tests!inner(subject, course_code)
            )
          `
        )
        .order("created_at", { ascending: false })
        .limit(300);
      if (onlyGraded) q = q.not("human_override_score", "is", null);
      const { data, error } = await q;
      if (error) {
        setErr(error.message);
      } else {
        const mapped = ((data as any[]) || [])
          .map((r) => {
            const test = r?.meq_test_stages?.meq_tests;
            if (!test?.subject) return null;
            if (scoreSubject && test.subject !== scoreSubject) return null;
            return {
              id: r.id as string,
              examType: "MEQ" as const,
              subject: test.subject as string,
              subject_code: (test.course_code as string) || "-",
              user_id: r.user_id as string,
              score:
                r.human_override_score == null ? "Pending" : String(r.human_override_score),
              created_at: r.created_at as string,
            };
          })
          .filter(Boolean) as ScoreRow[];
        rows.push(...mapped);
      }
    }

    if (scoreType === "ALL" || scoreType === "SBA") {
      let q = supabase
        .from("sba_question_responses")
        .select(
          `
            id, user_id, created_at, is_correct,
            sba_test_questions!inner(
              sba_tests!inner(subject, subject_code)
            )
          `
        )
        .order("created_at", { ascending: false })
        .limit(300);
      if (onlyGraded) q = q.not("is_correct", "is", null);
      const { data, error } = await q;
      if (error) {
        setErr((p) => p || error.message);
      } else {
        const mapped = ((data as any[]) || [])
          .map((r) => {
            const test = r?.sba_test_questions?.sba_tests;
            if (!test?.subject) return null;
            if (scoreSubject && test.subject !== scoreSubject) return null;
            return {
              id: r.id as string,
              examType: "SBA" as const,
              subject: test.subject as string,
              subject_code: (test.subject_code as string) || "-",
              user_id: r.user_id as string,
              score:
                r.is_correct == null ? "Pending" : r.is_correct ? "Correct" : "Incorrect",
              created_at: r.created_at as string,
            };
          })
          .filter(Boolean) as ScoreRow[];
        rows.push(...mapped);
      }
    }

    rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    setScoreRows(rows);
    setScoreLoading(false);
  }, [scoreType, scoreSubject, onlyGraded]);

  useEffect(() => {
    if (!dataLoaded || tab !== "scores") return;
    void loadScores();
  }, [dataLoaded, tab, loadScores]);

  if (!accessOk || gateLoading || !dataLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-20 text-gray-600">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pt-20 pb-16 px-4">
      <div className="max-w-5xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Exam review committee</h1>
          <p className="text-sm text-slate-600 mt-1">
            Committee members review assigned tests and provide committee standard scores (10-100).
            Sub-admins manage assignment and awaited review status.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab("review")}
            className={`px-4 py-2 rounded border text-sm font-semibold ${
              tab === "review" ? "bg-slate-900 text-white border-slate-900" : "bg-white"
            }`}
          >
            Assigned tests
          </button>
          <button
            type="button"
            onClick={() => setTab("scores")}
            className={`px-4 py-2 rounded border text-sm font-semibold ${
              tab === "scores" ? "bg-slate-900 text-white border-slate-900" : "bg-white"
            }`}
          >
            View scores
          </button>
        </div>
        <Link href="/dashboard" className="text-blue-600 text-sm hover:underline">
          &larr; Staff dashboard
        </Link>

        {err && (
          <div className="p-3 rounded border border-red-200 bg-red-50 text-red-800 text-sm">
            {err}
          </div>
        )}

        {tab === "review" && (
          <>
        {(myRole === "sub_admin" || myRole === "admin") && (
          <>
        <section className="bg-white border rounded-lg p-6">
          <h2 className="font-semibold text-lg mb-3">New committee</h2>
          <form onSubmit={createCommittee} className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1">
              <label className="text-xs text-gray-600">Name</label>
              <input
                className="w-full border rounded px-2 py-1.5"
                value={newC.name}
                onChange={(e) => setNewC((n) => ({ ...n, name: e.target.value }))}
                placeholder="e.g. IM 2026 Review"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">Subject (blank = all)</label>
              <select
                className="w-full border rounded px-2 py-1.5"
                value={newC.subject}
                onChange={(e) => setNewC((n) => ({ ...n, subject: e.target.value }))}
              >
                <option value="">All subjects</option>
                {SUBJECTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600">Year (blank = any)</label>
              <input
                className="w-28 border rounded px-2 py-1.5"
                value={newC.test_year}
                onChange={(e) => setNewC((n) => ({ ...n, test_year: e.target.value }))}
                placeholder="2026"
              />
            </div>
            <button
              type="submit"
              disabled={saving === "committee"}
              className="px-4 py-2 bg-slate-800 text-white rounded font-medium disabled:opacity-50"
            >
              Create
            </button>
          </form>
        </section>

        <section className="bg-white border rounded-lg p-6">
          <h2 className="font-semibold text-lg mb-3">Committees &amp; members</h2>
          <ul className="space-y-4">
            {committees.length === 0 ? (
              <li className="text-gray-500 text-sm">No committees yet.</li>
            ) : (
              committees.map((c) => (
                <li key={c.id} className="border rounded p-3 text-sm">
                  <div className="font-medium">
                    {c.name}{" "}
                    <span className="text-gray-500 font-normal">
                      ({c.subject || "all subjects"}{" "}
                      {c.test_year != null ? `· ${c.test_year}` : ""})
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 items-center">
                    <select
                      className="border rounded px-2 py-1 min-w-[200px]"
                      value={addMember[c.id] || ""}
                      onChange={(e) =>
                        setAddMember((a) => ({ ...a, [c.id]: e.target.value }))
                      }
                    >
                      <option value="">Add member by user…</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.email}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => addToCommittee(c.id)}
                      className="text-sm text-blue-600 font-medium"
                      disabled={saving === `mem-${c.id}`}
                    >
                      Add
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>
        </section>
          </>
        )}

        <section className="bg-white border rounded-lg p-6 overflow-x-auto">
          <h2 className="font-semibold text-lg mb-3">
            {canEditAwaitingTests ? "Tests in your scope (assign & status)" : "Tests assigned to your exam review committees"}
          </h2>
          <div className="mb-4 max-w-sm">
            <label className="text-xs text-gray-600">Search course code</label>
            <input
              className="w-full border rounded px-2 py-1.5"
              value={testCodeSearch}
              onChange={(e) => setTestCodeSearch(e.target.value)}
              placeholder="e.g. IM101"
            />
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-600">
                <th className="py-2 pr-2">Type</th>
                <th className="py-2 pr-2">Subject / Code / Year</th>
                <th className="py-2 pr-2">Committee</th>
                <th className="py-2 pr-2">Status</th>
                <th className="py-2 pr-2">Committee score</th>
                <th className="py-2">Save</th>
              </tr>
            </thead>
            <tbody>
              {roleScopedTests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-gray-500">
                    No assigned tests match this filter yet.
                  </td>
                </tr>
              ) : (
                roleScopedTests.map((t) => (
                  <tr key={`${t.kind}-${t.id}`} className="border-t">
                    <td className="py-2 pr-2 font-mono text-xs">{t.kind}</td>
                    <td className="py-2 pr-2">
                      {t.subject} <span className="text-gray-500">·</span> {t.subject_code}{" "}
                      <span className="text-gray-500">·</span> {t.test_year}
                    </td>
                    <td className="py-2 pr-2">
                      <select
                        className="border rounded px-1 py-0.5 max-w-[200px] text-xs"
                        value={t.committee_id || ""}
                        disabled={!canEditAwaitingTests || t.review_status !== "pending_committee"}
                        onChange={(e) => {
                          const v = e.target.value || null;
                          setTests((ts) =>
                            ts.map((x) =>
                              x.id === t.id && x.kind === t.kind
                                ? { ...x, committee_id: v }
                                : x
                            )
                          );
                        }}
                      >
                        <option value="">— not assigned —</option>
                        {committees.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <select
                        className="border rounded px-1 py-0.5 text-xs"
                        value={t.review_status}
                        disabled={!canEditAwaitingTests || t.review_status !== "pending_committee"}
                        onChange={(e) => {
                          setTests((ts) =>
                            ts.map((x) =>
                              x.id === t.id && x.kind === t.kind
                                ? { ...x, review_status: e.target.value }
                                : x
                            )
                          );
                        }}
                      >
                        <option value="pending_committee">pending committee</option>
                        <option value="approved">approved (pass)</option>
                        <option value="rejected">rejected</option>
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      {t.committee_id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={10}
                            max={100}
                            className="w-20 border rounded px-1 py-0.5 text-xs"
                            value={scoreInputs[`${t.kind}:${t.id}`] ?? (committeeScores[`${t.kind}:${t.id}`]?.mine?.toString() ?? "")}
                            onChange={(e) => setScoreInputs((prev) => ({ ...prev, [`${t.kind}:${t.id}`]: e.target.value }))}
                            disabled={t.committee_id == null}
                          />
                          <span className="text-xs text-gray-500">
                            avg {committeeScores[`${t.kind}:${t.id}`]?.average ?? "-"} ({committeeScores[`${t.kind}:${t.id}`]?.count ?? 0})
                          </span>
                          <button
                            type="button"
                            onClick={() => saveCommitteeScore(t)}
                            className="text-blue-600 font-medium text-xs"
                            disabled={
                              saving === `score-${t.kind}:${t.id}` ||
                              !t.committee_id ||
                              !myCommitteeIds.includes(t.committee_id)
                            }
                          >
                            Save score
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">Assign committee first</span>
                      )}
                    </td>
                    <td className="py-2">
                      {canEditAwaitingTests ? (
                        <button
                          type="button"
                          onClick={() => updateTest(t)}
                          className="text-blue-600 font-medium text-xs"
                          disabled={saving === `t-${t.kind}-${t.id}` || t.review_status !== "pending_committee"}
                        >
                          Save
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">View only</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
          </>
        )}

        {tab === "scores" && (
          <section className="bg-white border rounded-lg p-6 space-y-4">
            <h2 className="font-semibold text-lg">Scores viewer</h2>
            <p className="text-sm text-gray-600">
              Choose subject, test type, and whether to show only graded results.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-gray-600">Subject</label>
                <select
                  className="w-full border rounded px-2 py-1.5"
                  value={scoreSubject}
                  onChange={(e) => setScoreSubject(e.target.value)}
                >
                  <option value="">All subjects</option>
                  {SUBJECTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-600">Test type</label>
                <select
                  className="w-full border rounded px-2 py-1.5"
                  value={scoreType}
                  onChange={(e) => setScoreType(e.target.value as "ALL" | "MEQ" | "SBA")}
                >
                  <option value="ALL">All</option>
                  <option value="MEQ">MEQ</option>
                  <option value="SBA">SBA</option>
                </select>
              </div>
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={onlyGraded}
                    onChange={(e) => setOnlyGraded(e.target.checked)}
                  />
                  Only graded
                </label>
              </div>
              <div>
                <label className="text-xs text-gray-600">Course code</label>
                <input
                  className="w-full border rounded px-2 py-1.5"
                  value={scoreCodeSearch}
                  onChange={(e) => setScoreCodeSearch(e.target.value)}
                  placeholder="e.g. PEDS"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => void loadScores()}
                  className="px-4 py-2 bg-slate-800 text-white rounded font-medium"
                  disabled={scoreLoading}
                >
                  {scoreLoading ? "Loading..." : "Apply filters"}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto border rounded">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-600 bg-gray-50">
                    <th className="py-2 px-3">Type</th>
                    <th className="py-2 px-3">Subject</th>
                    <th className="py-2 px-3">Code</th>
                    <th className="py-2 px-3">Student</th>
                    <th className="py-2 px-3">Score</th>
                    <th className="py-2 px-3">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredScoreRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-5 px-3 text-gray-500">
                        No score records found for the selected filters.
                      </td>
                    </tr>
                  ) : (
                    filteredScoreRows.map((r) => (
                      <tr key={`${r.examType}-${r.id}`} className="border-t">
                        <td className="py-2 px-3 font-mono text-xs">{r.examType}</td>
                        <td className="py-2 px-3">{r.subject}</td>
                        <td className="py-2 px-3">{r.subject_code}</td>
                        <td className="py-2 px-3 font-mono">{r.user_id}</td>
                        <td className="py-2 px-3">{r.score}</td>
                        <td className="py-2 px-3 text-gray-600">
                          {new Date(r.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
