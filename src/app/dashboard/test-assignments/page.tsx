"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { TEST_ASSIGNMENT_ROLES } from "@/lib/auth/roles";
import { getAuthUserId } from "@/lib/auth/session";
import { useRoleGate } from "@/hooks/useRoleGate";

function isoToDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

type AssessmentPurpose = "formative" | "summative";

type TestGroup = {
  id: string;
  name: string;
  created_at: string;
  filter_course_code: string | null;
  filter_exam_format: "MEQ" | "SBA" | null;
  filter_assessment_purpose: AssessmentPurpose | null;
};
type TestGroupItem = {
  id: string;
  test_group_id: string;
  meq_test_id: string | null;
  sba_test_id: string | null;
  sort_order: number;
};
type StudentGroup = { id: string; name: string; created_at: string };
type Assignment = {
  id: string;
  title: string;
  test_group_id: string;
  window_start: string | null;
  window_end: string | null;
  exam_time_limit_minutes: number | null;
  created_at: string;
};

type AsgEditDraft = { winStart: string; winEnd: string; examLimit: string };

export default function TestAssignmentsPage() {
  const { ready: accessOk, loading: gateLoading, role } = useRoleGate(TEST_ASSIGNMENT_ROLES, {
    noUserRedirect: "/login",
    wrongRoleRedirect: "/practice-tests",
  });
  const [ready, setReady] = useState(false);

  const [testGroups, setTestGroups] = useState<TestGroup[]>([]);
  const [tgItems, setTgItems] = useState<Record<string, TestGroupItem[]>>({});
  const [newTgName, setNewTgName] = useState("");
  const [newTgCourse, setNewTgCourse] = useState("");
  const [newTgFormat, setNewTgFormat] = useState<"MEQ" | "SBA">("MEQ");
  const [newTgPurpose, setNewTgPurpose] = useState<AssessmentPurpose>("summative");
  const [courses, setCourses] = useState<{ course_code: string; course_title: string | null }[]>([]);

  const [pickTg, setPickTg] = useState<string>("");
  const [addMeqId, setAddMeqId] = useState("");
  const [addSbaId, setAddSbaId] = useState("");

  const [studentGroups, setStudentGroups] = useState<StudentGroup[]>([]);
  const [newSgName, setNewSgName] = useState("");
  const [pickSg, setPickSg] = useState<string>("");
  const [memberEmail, setMemberEmail] = useState("");
  const [sgMembers, setSgMembers] = useState<Record<string, { id: string; email: string }[]>>({});

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [asgTitle, setAsgTitle] = useState("");
  const [asgTg, setAsgTg] = useState("");
  const [winStart, setWinStart] = useState("");
  const [winEnd, setWinEnd] = useState("");
  const [asgExamLimit, setAsgExamLimit] = useState("");
  const [asgEdits, setAsgEdits] = useState<Record<string, AsgEditDraft>>({});
  const [studentNavVisible, setStudentNavVisible] = useState(false);
  const [navDraft, setNavDraft] = useState(false);
  const [navSaving, setNavSaving] = useState(false);
  const [rcpType, setRcpType] = useState<"student" | "group">("student");
  const [rcpStudentEmail, setRcpStudentEmail] = useState("");
  const [rcpGroupId, setRcpGroupId] = useState("");

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    if (!accessOk || gateLoading || !role) return;

    const [{ data: tg }, { data: sg }, { data: asg }, { data: cat }] = await Promise.all([
      supabase
        .from("staff_test_groups")
        .select(
          "id, name, created_at, filter_course_code, filter_exam_format, filter_assessment_purpose",
        )
        .order("created_at", { ascending: false }),
      supabase.from("staff_student_groups").select("id, name, created_at").order("created_at", { ascending: false }),
      supabase
        .from("staff_test_assignments")
        .select("id, title, test_group_id, window_start, window_end, exam_time_limit_minutes, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("course_catalog").select("course_code, course_title").order("course_code").limit(900),
    ]);

    setTestGroups(((tg ?? []) as TestGroup[]) || []);
    setCourses((cat ?? []) as { course_code: string; course_title: string | null }[]);
    setStudentGroups((sg as StudentGroup[]) || []);
    const asgRows = (asg as Assignment[]) || [];
    setAssignments(asgRows);

    const { data: navRow } = await supabase.from("student_ui_settings").select("test_taking_nav_visible").eq("id", 1).maybeSingle();
    const vis = !!(navRow as { test_taking_nav_visible?: boolean } | null)?.test_taking_nav_visible;
    setStudentNavVisible(vis);
    setNavDraft(vis);

    const nextEdits: Record<string, AsgEditDraft> = {};
    for (const a of asgRows) {
      nextEdits[a.id] = {
        winStart: a.window_start ? isoToDatetimeLocalValue(a.window_start) : "",
        winEnd: a.window_end ? isoToDatetimeLocalValue(a.window_end) : "",
        examLimit:
          a.exam_time_limit_minutes != null && Number.isFinite(a.exam_time_limit_minutes)
            ? String(a.exam_time_limit_minutes)
            : "",
      };
    }
    setAsgEdits(nextEdits);

    const tgIds = ((tg as TestGroup[]) || []).map((x) => x.id);
    if (tgIds.length > 0) {
      const { data: items } = await supabase
        .from("staff_test_group_items")
        .select("id, test_group_id, meq_test_id, sba_test_id, sort_order")
        .in("test_group_id", tgIds);
      const by: Record<string, TestGroupItem[]> = {};
      for (const it of (items as TestGroupItem[]) || []) {
        if (!by[it.test_group_id]) by[it.test_group_id] = [];
        by[it.test_group_id]!.push(it);
      }
      setTgItems(by);
    } else {
      setTgItems({});
    }

    const sgIds = ((sg as StudentGroup[]) || []).map((x) => x.id);
    if (sgIds.length > 0) {
      const { data: mems } = await supabase
        .from("staff_student_group_members")
        .select("student_group_id, student_id")
        .in("student_group_id", sgIds);
      const memList = (mems as { student_group_id: string; student_id: string }[]) || [];
      const pids = [...new Set(memList.map((m) => m.student_id))];
      const emailById: Record<string, string> = {};
      if (pids.length > 0) {
        const { data: profs } = await supabase.from("profiles").select("id, email").in("id", pids);
        for (const pr of profs || []) {
          emailById[(pr as { id: string; email: string }).id] = (pr as { id: string; email: string }).email;
        }
      }
      const byM: Record<string, { id: string; email: string }[]> = {};
      for (const row of memList) {
        const em = emailById[row.student_id] || row.student_id;
        if (!byM[row.student_group_id]) byM[row.student_group_id] = [];
        byM[row.student_group_id]!.push({ id: row.student_id, email: em });
      }
      setSgMembers(byM);
    } else {
      setSgMembers({});
    }

    setReady(true);
  }, [accessOk, gateLoading, role]);

  useEffect(() => {
    void load();
  }, [load]);

  const createTestGroup = async () => {
    setErr(null);
    setMsg(null);
    const name = newTgName.trim();
    if (!name) {
      setErr("Name the test group.");
      return;
    }
    if (!newTgCourse.trim()) {
      setErr("Choose a catalog subject code.");
      return;
    }
    const uid = await getAuthUserId();
    if (!uid) return;
    const { error } = await supabase
      .from("staff_test_groups")
      .insert({
        name,
        created_by: uid,
        filter_course_code: newTgCourse.trim(),
        filter_exam_format: newTgFormat,
        filter_assessment_purpose: newTgPurpose,
      })
      .select("id")
      .single();
    if (error) {
      setErr(error.message || "Could not create. Apply migration 037 (bundle filters).");
      return;
    }
    setNewTgName("");
    setNewTgCourse("");
    setNewTgFormat("MEQ");
    setNewTgPurpose("summative");
    setMsg("Test bundle created — open it to see matching tests.");
    void load();
  };

  const addTestToGroup = async () => {
    setErr(null);
    setMsg(null);
    if (!pickTg) {
      setErr("Choose a test group.");
      return;
    }
    const gSel = testGroups.find((x) => x.id === pickTg);
    if (
      gSel?.filter_course_code &&
      gSel?.filter_exam_format &&
      gSel?.filter_assessment_purpose
    ) {
      setErr(
        "This bundle uses catalog scope (subject + format + assessment). Matching tests appear automatically — no UUID attachment.",
      );
      return;
    }
    const meq = addMeqId.trim();
    const sba = addSbaId.trim();
    if ((meq && sba) || (!meq && !sba)) {
      setErr("Provide exactly one UUID: either a MEQ test id OR an SBA test id.");
      return;
    }
    if (meq) {
      const { data: row, error: fe } = await supabase
        .from("meq_tests")
        .select("id, review_status, test_function")
        .eq("id", meq)
        .maybeSingle();
      if (fe || !row) {
        setErr("Could not find that MEQ test, or you have no access.");
        return;
      }
      if (row.test_function !== "real_test") {
        setErr("Test session bundles only accept MEQ rows with Test function = Real test (practice belongs in Practice tests).");
        return;
      }
      if (row.review_status !== "approved") {
        setErr("Only committee-approved tests can be scheduled. Wait for approval or pick another id.");
        return;
      }
    } else if (sba) {
      const { data: row, error: fe } = await supabase
        .from("sba_tests")
        .select("id, review_status, test_function")
        .eq("id", sba)
        .maybeSingle();
      if (fe || !row) {
        setErr("Could not find that SBA test, or you have no access.");
        return;
      }
      if (row.test_function !== "real_test") {
        setErr("Test session bundles only accept SBA rows with Test function = Real test.");
        return;
      }
      if (row.review_status !== "approved") {
        setErr("Only committee-approved tests can be scheduled.");
        return;
      }
    }
    const row: { test_group_id: string; meq_test_id?: string; sba_test_id?: string; sort_order: number } = {
      test_group_id: pickTg,
      sort_order: (tgItems[pickTg]?.length ?? 0),
    };
    if (meq) row.meq_test_id = meq;
    else row.sba_test_id = sba;

    const { error } = await supabase.from("staff_test_group_items").insert(row);
    if (error) {
      setErr(error.message);
      return;
    }
    setAddMeqId("");
    setAddSbaId("");
    setMsg("Test added to group.");
    void load();
  };

  const createStudentGroup = async () => {
    setErr(null);
    setMsg(null);
    const name = newSgName.trim();
    if (!name) {
      setErr("Name the student group.");
      return;
    }
    const uid = await getAuthUserId();
    if (!uid) return;
    const { error } = await supabase
      .from("staff_student_groups")
      .insert({ name, created_by: uid });
    if (error) {
      setErr(error.message);
      return;
    }
    setNewSgName("");
    setMsg("Student group created.");
    void load();
  };

  const addMemberByEmail = async () => {
    setErr(null);
    setMsg(null);
    if (!pickSg) {
      setErr("Choose a student group.");
      return;
    }
    const email = memberEmail.trim().toLowerCase();
    if (!email) {
      setErr("Enter a student email.");
      return;
    }
    const { data: prof, error: pe } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("email", email)
      .maybeSingle();
    if (pe || !prof || prof.role !== "student") {
      setErr("No student profile with that email.");
      return;
    }
    const { error } = await supabase.from("staff_student_group_members").insert({
      student_group_id: pickSg,
      student_id: prof.id,
    });
    if (error) {
      setErr(error.message);
      return;
    }
    setMemberEmail("");
    setMsg("Member added.");
    void load();
  };

  const saveStudentNavFromDraft = async () => {
    setNavSaving(true);
    setErr(null);
    setMsg(null);
    const uid = await getAuthUserId();
    if (!uid) {
      setNavSaving(false);
      return;
    }
    const { error } = await supabase
      .from("student_ui_settings")
      .update({ test_taking_nav_visible: navDraft, updated_by: uid })
      .eq("id", 1);
    setNavSaving(false);
    if (error) setErr(error.message);
    else {
      setStudentNavVisible(navDraft);
      setMsg("Test taking availability saved for students.");
    }
  };

  const saveAssignmentRow = async (id: string) => {
    setErr(null);
    setMsg(null);
    const d = asgEdits[id];
    if (!d) {
      setErr("Internal: missing draft fields for assignment.");
      return;
    }
    if (!d.winStart.trim()) {
      setErr("Each assignment requires a window start.");
      return;
    }
    if (!d.winEnd.trim()) {
      setErr("Each assignment requires a window end.");
      return;
    }
    const startMs = new Date(d.winStart).getTime();
    const endMs = new Date(d.winEnd).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      setErr("Assignment window dates are invalid.");
      return;
    }
    if (endMs < startMs) {
      setErr("Window end must be on or after window start.");
      return;
    }
    const lim = parseInt(d.examLimit.trim(), 10);
    if (Number.isNaN(lim) || lim < 1 || lim > 600) {
      setErr("Exam time limit must be 1–600 minutes.");
      return;
    }
    const { error } = await supabase
      .from("staff_test_assignments")
      .update({
        window_start: new Date(d.winStart).toISOString(),
        window_end: new Date(d.winEnd).toISOString(),
        exam_time_limit_minutes: lim,
      })
      .eq("id", id);
    if (error) setErr(error.message);
    else setMsg(`Assignment scheduling updated (${id.slice(0, 8)}…).`);
    void load();
  };

  const createAssignment = async () => {
    setErr(null);
    setMsg(null);
    if (!asgTg || !asgTitle.trim()) {
      setErr("Choose a test group and enter a title.");
      return;
    }
    if (!winStart.trim() || !winEnd.trim()) {
      setErr("Window start and end are required.");
      return;
    }
    const ws = new Date(winStart).getTime();
    const we = new Date(winEnd).getTime();
    if (Number.isNaN(ws) || Number.isNaN(we)) {
      setErr("Assignment window dates are invalid.");
      return;
    }
    if (we < ws) {
      setErr("Window end must be on or after window start.");
      return;
    }
    const examLim = parseInt(asgExamLimit.trim(), 10);
    if (Number.isNaN(examLim) || examLim < 1 || examLim > 600) {
      setErr("Exam time limit must be between 1 and 600 minutes (overall cap once student begins).");
      return;
    }
    const uid = await getAuthUserId();
    if (!uid) return;
    const { data: asg, error: ae } = await supabase
      .from("staff_test_assignments")
      .insert({
        test_group_id: asgTg,
        title: asgTitle.trim(),
        created_by: uid,
        window_start: new Date(winStart).toISOString(),
        window_end: new Date(winEnd).toISOString(),
        exam_time_limit_minutes: examLim,
      })
      .select("id")
      .single();
    if (ae || !asg) {
      setErr(ae?.message || "Could not create assignment.");
      return;
    }

    if (rcpType === "student") {
      const email = rcpStudentEmail.trim().toLowerCase();
      if (!email) {
        setErr("Enter recipient student email.");
        return;
      }
      const { data: prof } = await supabase.from("profiles").select("id, role").eq("email", email).maybeSingle();
      if (!prof || prof.role !== "student") {
        setErr("Invalid student email.");
        return;
      }
      const { error: re } = await supabase.from("staff_test_assignment_recipients").insert({
        assignment_id: asg.id,
        student_id: prof.id,
      });
      if (re) {
        setErr(re.message);
        return;
      }
    } else {
      if (!rcpGroupId) {
        setErr("Choose a student group.");
        return;
      }
      const { error: re } = await supabase.from("staff_test_assignment_recipients").insert({
        assignment_id: asg.id,
        student_group_id: rcpGroupId,
      });
      if (re) {
        setErr(re.message);
        return;
      }
    }

    setAsgTitle("");
    setWinStart("");
    setWinEnd("");
    setAsgExamLimit("");
    setMsg("Assignment created with recipient.");
    void load();
  };

  if (!accessOk || gateLoading || !ready) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-20">
        <span className="text-gray-600">Loading…</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white pt-20 pb-16 px-4">
      <div className="max-w-4xl mx-auto space-y-10">
        <div>
          <Link href="/dashboard" className="text-blue-600 text-sm hover:underline">
            ← Staff dashboard
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 mt-2">Test season assignments</h1>
          <p className="text-gray-600 text-sm mt-1">
            Build reusable <strong>test groups</strong> (only committee-approved{" "}
            <strong>real</strong> tests) and <strong>student groups</strong>, then create scheduling rows with{" "}
            <strong>required window</strong>, <strong>exam time limit</strong>, and recipient. Students discover
            assigned tests on <strong>Test taking</strong> when you enable that link below.
          </p>
          <p className="text-orange-900 text-sm mt-2 bg-orange-100 border border-orange-300 rounded px-3 py-2">
            Requires migrations <code className="font-mono">020_*</code> (tables), <code className="font-mono">021_*</code>{" "}
            (RLS), <code className="font-mono">033_*</code> (exam minutes), and <code className="font-mono">037_*</code>{" "}
            (scoped bundles + public test ids with MEQ/SBA in the code).
          </p>
        </div>

        {msg ? <div className="text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2 text-sm">{msg}</div> : null}
        {err ? <div className="text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2 text-sm">{err}</div> : null}

        <section className="border rounded-lg p-6 space-y-3 bg-blue-50/60 border-blue-100">
          <h2 className="text-xl font-bold text-gray-900">Student &quot;Test taking&quot; page</h2>
          <p className="text-sm text-gray-700">
            The <strong className="text-blue-950">Test taking</strong> link always appears for students. Use this
            switch to <strong>pause the scheduled-exam list</strong> (students see a short notice instead of assignments).
            Current state:{" "}
            <span className="font-semibold">{studentNavVisible ? "list active" : "list paused"}</span>.
          </p>
          <label className="flex items-start gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" className="mt-1" checked={navDraft} onChange={(e) => setNavDraft(e.target.checked)} />
            <span>Allow students to open and use the Test taking exam list</span>
          </label>
          <button
            type="button"
            disabled={navSaving || navDraft === studentNavVisible}
            className="bg-blue-800 text-white px-4 py-2 rounded font-semibold text-sm disabled:opacity-50"
            onClick={() => void saveStudentNavFromDraft()}
          >
            {navSaving ? "Saving…" : "Save Test taking availability"}
          </button>
        </section>

        <section className="border rounded-lg p-6 space-y-4">
          <h2 className="text-xl font-bold text-gray-900">1. Test groups (bundles)</h2>
          <p className="text-sm text-gray-600">
            New bundles are <strong>scoped</strong>: pick a catalog code, MEQ vs SBA, and whether this bundle is for{" "}
            <strong>formative</strong> or <strong>summative</strong> real tests. Every{" "}
            <strong className="font-medium">approved</strong> real test whose course and assessment purpose match appears
            in the bundle (and in Test taking once scheduled) — no UUID copy/paste.
          </p>
          <div className="grid md:grid-cols-2 gap-4 items-end">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600">Bundle name</label>
                <input
                  className="border rounded px-3 py-2 w-full mt-1"
                  value={newTgName}
                  onChange={(e) => setNewTgName(e.target.value)}
                  placeholder="e.g. Spring cardio summative MEQ"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600">Subject code (catalog)</label>
                <select
                  className="border rounded px-3 py-2 w-full mt-1"
                  value={newTgCourse}
                  onChange={(e) => setNewTgCourse(e.target.value)}
                >
                  <option value="">Select code…</option>
                  {courses.map((c) => (
                    <option key={c.course_code} value={c.course_code}>
                      {c.course_code}
                      {c.course_title ? ` — ${c.course_title}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <span className="block text-xs font-medium text-gray-600">Exam format</span>
                <div className="flex gap-4 mt-2 text-sm">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="newTgFmt"
                      checked={newTgFormat === "MEQ"}
                      onChange={() => setNewTgFormat("MEQ")}
                    />
                    MEQ
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="newTgFmt"
                      checked={newTgFormat === "SBA"}
                      onChange={() => setNewTgFormat("SBA")}
                    />
                    SBA
                  </label>
                </div>
              </div>
              <div>
                <span className="block text-xs font-medium text-gray-600">Bundle track (filters real tests)</span>
                <div className="flex gap-4 mt-2 text-sm">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="newTgPurpose"
                      checked={newTgPurpose === "formative"}
                      onChange={() => setNewTgPurpose("formative")}
                    />
                    Formative
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="newTgPurpose"
                      checked={newTgPurpose === "summative"}
                      onChange={() => setNewTgPurpose("summative")}
                    />
                    Summative
                  </label>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  This only chooses which approved real tests belong in the bundle (same labels as committee purpose on
                  each test — we are not changing the authoring wizard).
                </p>
              </div>
              <button
                type="button"
                className="bg-blue-800 text-white px-4 py-2 rounded font-semibold"
                onClick={() => void createTestGroup()}
              >
                Create bundle
              </button>
            </div>
          </div>
          <div className="border-t pt-4 space-y-2">
            <h3 className="text-sm font-semibold text-gray-800">Legacy: attach by test UUID</h3>
            <p className="text-xs text-gray-600">
              Older bundles keep empty scope fields and still use explicit MEQ/SBA ids (one per row).
            </p>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600">Target group</label>
                <select
                  className="border rounded px-3 py-2 w-full mt-1"
                  value={pickTg}
                  onChange={(e) => setPickTg(e.target.value)}
                >
                  <option value="">Select group…</option>
                  {testGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                {pickTg &&
                testGroups.find((x) => x.id === pickTg)?.filter_course_code ? (
                  <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    Selected bundle is scoped — open it from the list below to see matching tests.
                  </p>
                ) : (
                  <>
                    <input
                      className="border rounded px-3 py-2 font-mono text-sm"
                      placeholder="MEQ UUID · approved · Real test only"
                      value={addMeqId}
                      onChange={(e) => setAddMeqId(e.target.value)}
                    />
                    <input
                      className="border rounded px-3 py-2 font-mono text-sm"
                      placeholder="SBA test UUID (leave MEQ empty if using this)"
                      value={addSbaId}
                      onChange={(e) => setAddSbaId(e.target.value)}
                    />
                    <button
                      type="button"
                      className="bg-gray-800 text-white px-3 py-2 rounded text-sm font-semibold w-fit"
                      onClick={() => void addTestToGroup()}
                    >
                      Add test to group
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
          <ul className="text-sm space-y-2 text-gray-700">
            {testGroups.map((g) => {
              const scoped =
                g.filter_course_code && g.filter_exam_format && g.filter_assessment_purpose;
              return (
                <li key={g.id} className="border rounded p-2 bg-gray-50">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">{g.name}</span>
                    <Link
                      href={`/dashboard/test-assignments/group/${g.id}`}
                      className="text-blue-700 text-xs font-semibold hover:underline"
                    >
                      Open bundle →
                    </Link>
                  </div>
                  {scoped ? (
                    <p className="text-xs text-gray-600 mt-1">
                      <span className="font-mono">{g.filter_course_code}</span> · {g.filter_exam_format} ·{" "}
                      {g.filter_assessment_purpose}
                    </p>
                  ) : (
                    <p className="text-xs text-amber-800 mt-1">Legacy manual UUID list</p>
                  )}
                  <ul className="ml-4 mt-1 font-mono text-xs">
                    {!scoped
                      ? (tgItems[g.id] || []).map((it) => (
                          <li key={it.id}>
                            {it.meq_test_id ? `MEQ ${it.meq_test_id}` : `SBA ${it.sba_test_id}`}
                          </li>
                        ))
                      : null}
                    {!scoped && (tgItems[g.id] || []).length === 0 ? (
                      <li className="text-gray-500">No manual rows</li>
                    ) : null}
                    {scoped ? (
                      <li className="text-gray-600">Tests resolved from scope (see Open bundle)</li>
                    ) : null}
                  </ul>
                </li>
              );
            })}
            {testGroups.length === 0 ? <li className="text-gray-500">No test groups yet.</li> : null}
          </ul>
        </section>

        <section className="border rounded-lg p-6 space-y-4">
          <h2 className="text-xl font-bold text-gray-900">2. Student groups</h2>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-600">New cohort name</label>
              <input
                className="border rounded px-3 py-2 w-64"
                value={newSgName}
                onChange={(e) => setNewSgName(e.target.value)}
                placeholder="e.g. Year 3 Group A"
              />
            </div>
            <button type="button" className="bg-blue-800 text-white px-4 py-2 rounded font-semibold" onClick={() => void createStudentGroup()}>
              Create
            </button>
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <select className="border rounded px-3 py-2" value={pickSg} onChange={(e) => setPickSg(e.target.value)}>
              <option value="">Select group…</option>
              {studentGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <input
              className="border rounded px-3 py-2 w-64"
              placeholder="Student email"
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
            />
            <button
              type="button"
              className="bg-gray-800 text-white px-3 py-2 rounded text-sm font-semibold"
              onClick={() => void addMemberByEmail()}
            >
              Add member
            </button>
          </div>
          <ul className="text-sm space-y-2">
            {studentGroups.map((g) => (
              <li key={g.id} className="border rounded p-2">
                <span className="font-semibold">{g.name}</span>
                <ul className="ml-4 text-xs text-gray-600">
                  {(sgMembers[g.id] || []).map((m) => (
                    <li key={m.id}>
                      {m.email} <span className="font-mono text-gray-400">{m.id}</span>
                    </li>
                  ))}
                  {(sgMembers[g.id] || []).length === 0 ? <li>No members</li> : null}
                </ul>
              </li>
            ))}
          </ul>
        </section>

        <section className="border rounded-lg p-6 space-y-4">
          <h2 className="text-xl font-bold text-gray-900">3. Season assignment</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600">Test group</label>
              <select className="border rounded px-3 py-2 w-full mt-1" value={asgTg} onChange={(e) => setAsgTg(e.target.value)}>
                <option value="">Select…</option>
                {testGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600">Title</label>
              <input
                className="border rounded px-3 py-2 w-full mt-1"
                value={asgTitle}
                onChange={(e) => setAsgTitle(e.target.value)}
                placeholder="e.g. Week 4 session"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600">Window start (required, local)</label>
              <input type="datetime-local" className="border rounded px-3 py-2 w-full mt-1" value={winStart} onChange={(e) => setWinStart(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600">Window end (required)</label>
              <input type="datetime-local" className="border rounded px-3 py-2 w-full mt-1" value={winEnd} onChange={(e) => setWinEnd(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600">Exam time limit (minutes)</label>
              <input
                type="number"
                min={1}
                max={600}
                placeholder="Overall cap once they tap Begin"
                className="border rounded px-3 py-2 w-full mt-1"
                value={asgExamLimit}
                onChange={(e) => setAsgExamLimit(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">Applies to each MEQ or SBA launched from Test taking via this assignment.</p>
            </div>
          </div>
          <div className="border-t pt-4 space-y-2">
            <p className="text-sm text-gray-600">Recipient (add one per assignment creation — repeat to add more):</p>
            <div className="flex gap-4 items-center flex-wrap">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={rcpType === "student"} onChange={() => setRcpType("student")} />
                One student (email)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={rcpType === "group"} onChange={() => setRcpType("group")} />
                Whole student group
              </label>
            </div>
            {rcpType === "student" ? (
              <input
                className="border rounded px-3 py-2 w-full max-w-md"
                placeholder="student@example.edu"
                value={rcpStudentEmail}
                onChange={(e) => setRcpStudentEmail(e.target.value)}
              />
            ) : (
              <select className="border rounded px-3 py-2 w-full max-w-md" value={rcpGroupId} onChange={(e) => setRcpGroupId(e.target.value)}>
                <option value="">Select student group…</option>
                {studentGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <button type="button" className="bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold" onClick={() => void createAssignment()}>
            Create assignment + recipient
          </button>
          <ul className="text-sm text-gray-800 space-y-4">
            {assignments.map((a) => {
              const d = asgEdits[a.id] ?? { winStart: "", winEnd: "", examLimit: "" };
              return (
                <li key={a.id} className="border rounded-lg p-4 space-y-2 bg-gray-50">
                  <div className="font-semibold text-gray-900">{a.title}</div>
                  <div className="font-mono text-xs text-gray-500">assignment {a.id}</div>
                  <div className="grid md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600">Window start</label>
                      <input
                        type="datetime-local"
                        className="border rounded px-2 py-1.5 w-full mt-1 text-xs"
                        value={d.winStart}
                        onChange={(e) =>
                          setAsgEdits((prev) => ({
                            ...prev,
                            [a.id]: { ...d, winStart: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600">Window end</label>
                      <input
                        type="datetime-local"
                        className="border rounded px-2 py-1.5 w-full mt-1 text-xs"
                        value={d.winEnd}
                        onChange={(e) =>
                          setAsgEdits((prev) => ({
                            ...prev,
                            [a.id]: { ...d, winEnd: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600">Exam limit (minutes)</label>
                      <input
                        type="number"
                        min={1}
                        max={600}
                        className="border rounded px-2 py-1.5 w-full mt-1 text-xs"
                        value={d.examLimit}
                        onChange={(e) =>
                          setAsgEdits((prev) => ({
                            ...prev,
                            [a.id]: { ...d, examLimit: e.target.value },
                          }))
                        }
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    className="bg-slate-800 text-white px-4 py-2 rounded text-xs font-semibold"
                    onClick={() => void saveAssignmentRow(a.id)}
                  >
                    Save window &amp; time limit
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <p className="text-xs text-gray-500">
          Signed in as <span className="font-mono">{role}</span>. Sub-admins only manage groups they created; admins can
          see all.
        </p>
      </div>
    </div>
  );
}
