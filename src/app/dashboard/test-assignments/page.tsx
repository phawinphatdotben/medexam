"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { TEST_ASSIGNMENT_ROLES } from "@/lib/auth/roles";
import { getAuthUserId } from "@/lib/auth/session";
import { useRoleGate } from "@/hooks/useRoleGate";
import { type BundleTrack, rowMatchesBundleTrack } from "@/lib/staff/testBundle";

function isoToDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

type AssessmentPurpose = "formative" | "summative";

type BundleSelectionScope = {
  course_code: string;
  test_year: number;
  exam_format: "MEQ" | "SBA";
  track: BundleTrack;
};

type TestGroup = {
  id: string;
  name: string;
  created_at: string;
  filter_course_code: string | null;
  filter_exam_format: "MEQ" | "SBA" | null;
  filter_assessment_purpose: AssessmentPurpose | null;
  bundle_selection_scope: BundleSelectionScope | null;
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

type BundleCand =
  | {
      kind: "MEQ";
      id: string;
      subject: string;
      code: string;
      public_code: string | null;
      test_year: number;
      review_status: string;
      test_function: string;
      assessment_purpose: string;
    }
  | {
      kind: "SBA";
      id: string;
      subject: string;
      code: string;
      public_code: string | null;
      test_year: number;
      review_status: string;
      test_function: string;
      assessment_purpose: string;
    };

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
  const [newTgYear, setNewTgYear] = useState(String(new Date().getFullYear()));
  /** Practice pool vs scheduled real exams */
  const [newTgBucket, setNewTgBucket] = useState<"practice" | "real">("real");
  const [newTgRealPurpose, setNewTgRealPurpose] = useState<AssessmentPurpose>("summative");
  const [newTgFormat, setNewTgFormat] = useState<"MEQ" | "SBA">("MEQ");

  const resolvedBundleTrack = (): BundleTrack =>
    newTgBucket === "practice" ? "practice" : newTgRealPurpose === "formative" ? "formative" : "summative";
  const [courses, setCourses] = useState<{ course_code: string; course_title: string | null }[]>([]);

  const [bundleCandidates, setBundleCandidates] = useState<BundleCand[]>([]);
  const [selectedBundleKeys, setSelectedBundleKeys] = useState<Set<string>>(() => new Set());
  const [loadingBundleCandidates, setLoadingBundleCandidates] = useState(false);
  const [creatingBundle, setCreatingBundle] = useState(false);

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
          "id, name, created_at, filter_course_code, filter_exam_format, filter_assessment_purpose, bundle_selection_scope",
        )
        .order("created_at", { ascending: false }),
      supabase.from("staff_student_groups").select("id, name, created_at").order("created_at", { ascending: false }),
      supabase
        .from("staff_test_assignments")
        .select("id, title, test_group_id, window_start, window_end, exam_time_limit_minutes, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("course_catalog").select("course_code, course_title").order("course_code").limit(900),
    ]);

    setTestGroups(
      (((tg ?? []) as unknown[]) || []).map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id: r.id as string,
          name: r.name as string,
          created_at: r.created_at as string,
          filter_course_code: (r.filter_course_code as string | null) ?? null,
          filter_exam_format: (r.filter_exam_format as "MEQ" | "SBA" | null) ?? null,
          filter_assessment_purpose: (r.filter_assessment_purpose as AssessmentPurpose | null) ?? null,
          bundle_selection_scope:
            r.bundle_selection_scope && typeof r.bundle_selection_scope === "object"
              ? (r.bundle_selection_scope as BundleSelectionScope)
              : null,
        };
      }),
    );
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

  const loadBundleCandidates = async () => {
    setErr(null);
    setMsg(null);
    const code = newTgCourse.trim();
    const y = parseInt(newTgYear, 10);
    if (!code) {
      setErr("Choose a catalog subject code.");
      return;
    }
    if (!Number.isFinite(y) || y < 2000 || y > 2100) {
      setErr("Enter a valid year between 2000 and 2100.");
      return;
    }
    const tr = resolvedBundleTrack();
    setLoadingBundleCandidates(true);
    setBundleCandidates([]);
    setSelectedBundleKeys(new Set());
    let nextList: BundleCand[] = [];
    try {
      if (newTgFormat === "MEQ") {
        const { data, error } = await supabase
          .from("meq_tests")
          .select(
            "id, subject, course_code, public_code, test_year, review_status, test_function, assessment_purpose",
          )
          .eq("course_code", code)
          .eq("test_year", y)
          .order("public_code", { ascending: true });
        if (error) {
          setErr(error.message);
          return;
        }
        const rows = (data || []) as {
          id: string;
          subject: string;
          course_code: string;
          public_code: string | null;
          test_year: number;
          review_status: string;
          test_function: string;
          assessment_purpose: string;
        }[];
        nextList = rows
          .filter((r) => rowMatchesBundleTrack(r, tr))
          .map((r) => ({
            kind: "MEQ" as const,
            id: r.id,
            subject: r.subject,
            code: r.course_code,
            public_code: r.public_code,
            test_year: r.test_year,
            review_status: r.review_status,
            test_function: r.test_function,
            assessment_purpose: r.assessment_purpose,
          }));
      } else {
        const { data, error } = await supabase
          .from("sba_tests")
          .select(
            "id, subject, subject_code, public_code, test_year, review_status, test_function, assessment_purpose",
          )
          .eq("subject_code", code)
          .eq("test_year", y)
          .order("public_code", { ascending: true });
        if (error) {
          setErr(error.message);
          return;
        }
        const rows = (data || []) as {
          id: string;
          subject: string;
          subject_code: string;
          public_code: string | null;
          test_year: number;
          review_status: string;
          test_function: string;
          assessment_purpose: string;
        }[];
        nextList = rows
          .filter((r) => rowMatchesBundleTrack(r, tr))
          .map((r) => ({
            kind: "SBA" as const,
            id: r.id,
            subject: r.subject,
            code: r.subject_code,
            public_code: r.public_code,
            test_year: r.test_year,
            review_status: r.review_status,
            test_function: r.test_function,
            assessment_purpose: r.assessment_purpose,
          }));
      }
      setBundleCandidates(nextList);
      setMsg(
        nextList.length === 0
          ? "No tests match these filters (check year, track, and code)."
          : `Found ${nextList.length} matching test(s). Select rows to include, then create the bundle.`,
      );
    } finally {
      setLoadingBundleCandidates(false);
    }
  };

  const toggleBundleKey = (key: string) => {
    setSelectedBundleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllBundleCandidates = () => {
    setSelectedBundleKeys(new Set(bundleCandidates.map((c) => `${c.kind}:${c.id}`)));
  };

  const clearBundleSelection = () => setSelectedBundleKeys(new Set());

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
    const y = parseInt(newTgYear, 10);
    if (!Number.isFinite(y) || y < 2000 || y > 2100) {
      setErr("Enter a valid year between 2000 and 2100.");
      return;
    }
    if (selectedBundleKeys.size === 0) {
      setErr('Click "Show matching tests" and select at least one exam for this bundle.');
      return;
    }
    const uid = await getAuthUserId();
    if (!uid) return;
    const tr = resolvedBundleTrack();
    const scope: BundleSelectionScope = {
      course_code: newTgCourse.trim(),
      test_year: y,
      exam_format: newTgFormat,
      track: tr,
    };
    setCreatingBundle(true);
    try {
      const { data: inserted, error } = await supabase
        .from("staff_test_groups")
        .insert({
          name,
          created_by: uid,
          filter_course_code: null,
          filter_exam_format: null,
          filter_assessment_purpose: null,
          bundle_selection_scope: scope,
        })
        .select("id")
        .single();
      if (error) {
        setErr(
          error.message.includes("bundle_selection_scope")
            ? "Apply database migration 040 (bundle_selection_scope column), then try again."
            : error.message || "Could not create bundle.",
        );
        return;
      }
      const gid = (inserted as { id: string }).id;
      const orderedKeys = [...selectedBundleKeys].sort();
      const itemRows = orderedKeys.map((key, sort_order) => {
        const [kind, id] = key.split(":");
        if (kind === "MEQ") return { test_group_id: gid, meq_test_id: id, sort_order };
        return { test_group_id: gid, sba_test_id: id, sort_order };
      });
      const { error: itemErr } = await supabase.from("staff_test_group_items").insert(itemRows);
      if (itemErr) {
        setErr(itemErr.message || "Bundle created but attaching tests failed — remove the empty group or fix in SQL.");
        void load();
        return;
      }
      setNewTgName("");
      setNewTgCourse("");
      setNewTgYear(String(new Date().getFullYear()));
      setNewTgBucket("real");
      setNewTgRealPurpose("summative");
      setNewTgFormat("MEQ");
      setBundleCandidates([]);
      setSelectedBundleKeys(new Set());
      setMsg(`Test bundle created with ${orderedKeys.length} exam(s).`);
      void load();
    } finally {
      setCreatingBundle(false);
    }
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
          <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
            <h1 className="text-3xl font-bold text-gray-900">Test season assignments</h1>
            <Link
              href="/dashboard/exam-monitor"
              className="text-sm font-semibold text-orange-900 bg-orange-100 px-3 py-1.5 rounded-lg hover:bg-orange-200 shrink-0"
            >
              Live exam monitor →
            </Link>
          </div>
          <p className="text-gray-600 text-sm mt-1">
            Build reusable <strong>test groups</strong> (pick exams by code, year, and track — pending or approved) and{" "}
            <strong>student groups</strong>, then create scheduling rows with <strong>required window</strong>,{" "}
            <strong>exam time limit</strong>, and recipient. Students only launch <strong>approved</strong> tests from{" "}
            <strong>Test taking</strong>; pending rows stay queued until committee approval.
          </p>
          <p className="text-orange-900 text-sm mt-2 bg-orange-100 border border-orange-300 rounded px-3 py-2">
            Requires migrations <code className="font-mono">020_*</code> (tables), <code className="font-mono">021_*</code>{" "}
            (RLS), <code className="font-mono">033_*</code> (exam minutes), <code className="font-mono">037_*</code>{" "}
            (public ids), and <code className="font-mono">040_*</code> (bundle selection snapshot — optional metadata).
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
            Set <strong>name</strong>, <strong>catalog code</strong>, <strong>year</strong>, <strong>track</strong>, and{" "}
            <strong>exam format</strong>, then load matching tests (pending or approved). Select one or more rows and
            create the bundle — only those exams are included when you schedule an assignment. Older{" "}
            <strong>auto-scoped</strong> bundles (subject + format + assessment, no manual picks) still work unchanged.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600">Name</label>
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
              <div>
                <label className="block text-xs font-medium text-gray-600">Year</label>
                <input
                  type="number"
                  className="border rounded px-3 py-2 w-full mt-1 max-w-[11rem]"
                  min={2000}
                  max={2100}
                  value={newTgYear}
                  onChange={(e) => setNewTgYear(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <span className="block text-xs font-medium text-gray-600">Track</span>
                <div className="flex flex-col gap-2 mt-2 text-sm">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="newTgBucket"
                      checked={newTgBucket === "practice"}
                      onChange={() => setNewTgBucket("practice")}
                    />
                    Practice pool
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="newTgBucket"
                      checked={newTgBucket === "real"}
                      onChange={() => setNewTgBucket("real")}
                    />
                    Real exam
                  </label>
                </div>
              </div>
              {newTgBucket === "real" ? (
                <div>
                  <span className="block text-xs font-medium text-gray-600">Formative / Summative</span>
                  <div className="flex gap-4 mt-2 text-sm">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="newTgRealPurpose"
                        checked={newTgRealPurpose === "formative"}
                        onChange={() => setNewTgRealPurpose("formative")}
                      />
                      Formative
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="newTgRealPurpose"
                        checked={newTgRealPurpose === "summative"}
                        onChange={() => setNewTgRealPurpose("summative")}
                      />
                      Summative
                    </label>
                  </div>
                </div>
              ) : null}
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
              <button
                type="button"
                className="bg-slate-700 text-white px-4 py-2 rounded font-semibold text-sm disabled:opacity-50"
                disabled={loadingBundleCandidates}
                onClick={() => void loadBundleCandidates()}
              >
                {loadingBundleCandidates ? "Loading…" : "Show matching tests"}
              </button>
            </div>
          </div>

          {bundleCandidates.length > 0 ? (
            <div className="border rounded-lg overflow-hidden space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-gray-50 text-sm">
                <span>
                  {selectedBundleKeys.size} of {bundleCandidates.length} selected
                </span>
                <div className="flex gap-2">
                  <button type="button" className="text-blue-800 text-xs font-semibold underline" onClick={selectAllBundleCandidates}>
                    Select all
                  </button>
                  <button type="button" className="text-gray-700 text-xs font-semibold underline" onClick={clearBundleSelection}>
                    Clear
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 text-left sticky top-0">
                    <tr>
                      <th className="px-3 py-2 w-10" />
                      <th className="px-3 py-2">Public ID</th>
                      <th className="px-3 py-2">Subject</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Function</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bundleCandidates.map((c) => {
                      const key = `${c.kind}:${c.id}`;
                      return (
                        <tr key={key} className="border-t">
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={selectedBundleKeys.has(key)}
                              onChange={() => toggleBundleKey(key)}
                            />
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{c.public_code ?? "—"}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium">{c.subject}</div>
                            <div className="text-xs text-gray-500">
                              {c.kind} · {c.code}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs">{c.review_status}</td>
                          <td className="px-3 py-2 text-xs">
                            {c.test_function === "practice" ? "Practice" : `Real · ${c.assessment_purpose}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-3 pb-3">
                <button
                  type="button"
                  className="bg-blue-800 text-white px-4 py-2 rounded font-semibold text-sm disabled:opacity-50"
                  disabled={creatingBundle || selectedBundleKeys.size === 0}
                  onClick={() => void createTestGroup()}
                >
                  {creatingBundle ? "Creating…" : `Create bundle (${selectedBundleKeys.size} test${selectedBundleKeys.size === 1 ? "" : "s"})`}
                </button>
              </div>
            </div>
          ) : null}

          <ul className="text-sm space-y-2 text-gray-700">
            {testGroups.map((g) => {
              const scoped =
                g.filter_course_code && g.filter_exam_format && g.filter_assessment_purpose;
              const picked = !scoped && g.bundle_selection_scope;
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
                      Auto-scoped · <span className="font-mono">{g.filter_course_code}</span> · {g.filter_exam_format} ·{" "}
                      {g.filter_assessment_purpose}
                    </p>
                  ) : picked ? (
                    <p className="text-xs text-gray-600 mt-1">
                      Picked tests ·{" "}
                      <span className="font-mono">{g.bundle_selection_scope?.course_code}</span> · year{" "}
                      {g.bundle_selection_scope?.test_year} · {g.bundle_selection_scope?.exam_format} · track{" "}
                      {g.bundle_selection_scope?.track}
                    </p>
                  ) : (
                    <p className="text-xs text-amber-800 mt-1">Older bundle (no scope snapshot)</p>
                  )}
                  <ul className="ml-4 mt-1 font-mono text-xs">
                    {!scoped
                      ? (tgItems[g.id] || []).map((it) => (
                          <li key={it.id}>
                            {it.meq_test_id ? `MEQ ${it.meq_test_id}` : `SBA ${it.sba_test_id}`}
                          </li>
                        ))
                      : null}
                    {!scoped && (tgItems[g.id] || []).length === 0 && !picked ? (
                      <li className="text-gray-500">No rows listed (legacy empty)</li>
                    ) : null}
                    {!scoped && picked && (tgItems[g.id] || []).length === 0 ? (
                      <li className="text-gray-500">Open bundle for test list</li>
                    ) : null}
                    {scoped ? (
                      <li className="text-gray-600">Tests resolved from auto-scope (see Open bundle)</li>
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
