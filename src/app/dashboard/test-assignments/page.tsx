"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type TestGroup = { id: string; name: string; created_at: string };
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
  created_at: string;
};

export default function TestAssignmentsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  const [testGroups, setTestGroups] = useState<TestGroup[]>([]);
  const [tgItems, setTgItems] = useState<Record<string, TestGroupItem[]>>({});
  const [newTgName, setNewTgName] = useState("");
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
  const [rcpType, setRcpType] = useState<"student" | "group">("student");
  const [rcpStudentEmail, setRcpStudentEmail] = useState("");
  const [rcpGroupId, setRcpGroupId] = useState("");

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const { data: s } = await supabase.auth.getSession();
    if (!s.session?.user) {
      router.replace("/login");
      return;
    }
    const { data: p } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", s.session.user.id)
      .maybeSingle();
    const r = p?.role ?? null;
    if (!r || !["admin", "sub_admin"].includes(r)) {
      router.replace("/exam");
      return;
    }
    setRole(r);

    const [{ data: tg }, { data: sg }, { data: asg }] = await Promise.all([
      supabase.from("staff_test_groups").select("id, name, created_at").order("created_at", { ascending: false }),
      supabase.from("staff_student_groups").select("id, name, created_at").order("created_at", { ascending: false }),
      supabase.from("staff_test_assignments").select("id, title, test_group_id, window_start, window_end, created_at").order("created_at", { ascending: false }),
    ]);

    setTestGroups((tg as TestGroup[]) || []);
    setStudentGroups((sg as StudentGroup[]) || []);
    setAssignments((asg as Assignment[]) || []);

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
  }, [router]);

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
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase
      .from("staff_test_groups")
      .insert({ name, created_by: u.user.id })
      .select("id")
      .single();
    if (error) {
      setErr(error.message || "Could not create. Run migration 020.");
      return;
    }
    setNewTgName("");
    setMsg("Test group created.");
    void load();
  };

  const addTestToGroup = async () => {
    setErr(null);
    setMsg(null);
    if (!pickTg) {
      setErr("Choose a test group.");
      return;
    }
    const meq = addMeqId.trim();
    const sba = addSbaId.trim();
    if ((meq && sba) || (!meq && !sba)) {
      setErr("Provide exactly one UUID: either a MEQ test id OR an SBA test id.");
      return;
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
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase
      .from("staff_student_groups")
      .insert({ name, created_by: u.user.id });
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

  const createAssignment = async () => {
    setErr(null);
    setMsg(null);
    if (!asgTg || !asgTitle.trim()) {
      setErr("Choose a test group and enter a title.");
      return;
    }
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data: asg, error: ae } = await supabase
      .from("staff_test_assignments")
      .insert({
        test_group_id: asgTg,
        title: asgTitle.trim(),
        created_by: u.user.id,
        window_start: winStart ? new Date(winStart).toISOString() : null,
        window_end: winEnd ? new Date(winEnd).toISOString() : null,
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
    setMsg("Assignment created with recipient.");
    void load();
  };

  if (!ready) {
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
            Build reusable <strong>test groups</strong> and <strong>student groups</strong>, then create a{" "}
            <strong>season assignment</strong> with an optional time window. Students see assigned exams on the exam
            page when the window is open.
          </p>
          <p className="text-amber-800 text-sm mt-2 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Apply Supabase migration <code className="font-mono">020_practice_snapshots_test_assignments.sql</code>{" "}
            if tables are missing.
          </p>
        </div>

        {msg ? <div className="text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2 text-sm">{msg}</div> : null}
        {err ? <div className="text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2 text-sm">{err}</div> : null}

        <section className="border rounded-lg p-6 space-y-4">
          <h2 className="text-xl font-bold text-gray-900">1. Test groups (bundles)</h2>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-600">New group name</label>
              <input
                className="border rounded px-3 py-2 w-64"
                value={newTgName}
                onChange={(e) => setNewTgName(e.target.value)}
                placeholder="e.g. Spring cardio MEQ+SBA"
              />
            </div>
            <button type="button" className="bg-teal-700 text-white px-4 py-2 rounded font-semibold" onClick={() => void createTestGroup()}>
              Create
            </button>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600">Add MEQ or SBA to group</label>
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
              <input
                className="border rounded px-3 py-2 font-mono text-sm"
                placeholder="MEQ test UUID (from admin or URL /exam/[id])"
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
            </div>
          </div>
          <ul className="text-sm space-y-2 text-gray-700">
            {testGroups.map((g) => (
              <li key={g.id} className="border rounded p-2 bg-gray-50">
                <span className="font-semibold">{g.name}</span>
                <ul className="ml-4 mt-1 font-mono text-xs">
                  {(tgItems[g.id] || []).map((it) => (
                    <li key={it.id}>
                      {it.meq_test_id ? `MEQ ${it.meq_test_id}` : `SBA ${it.sba_test_id}`}
                    </li>
                  ))}
                  {(tgItems[g.id] || []).length === 0 ? <li className="text-gray-500">No tests yet</li> : null}
                </ul>
              </li>
            ))}
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
            <button type="button" className="bg-teal-700 text-white px-4 py-2 rounded font-semibold" onClick={() => void createStudentGroup()}>
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
              <label className="block text-xs font-medium text-gray-600">Window start (optional, local)</label>
              <input type="datetime-local" className="border rounded px-3 py-2 w-full mt-1" value={winStart} onChange={(e) => setWinStart(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600">Window end (optional)</label>
              <input type="datetime-local" className="border rounded px-3 py-2 w-full mt-1" value={winEnd} onChange={(e) => setWinEnd(e.target.value)} />
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
          <ul className="text-sm text-gray-700 space-y-1">
            {assignments.map((a) => (
              <li key={a.id} className="font-mono text-xs border-b pb-1">
                {a.title} — group {a.test_group_id.slice(0, 8)}…
                {a.window_start ? ` | ${a.window_start}` : ""}
                {a.window_end ? ` → ${a.window_end}` : ""}
              </li>
            ))}
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
