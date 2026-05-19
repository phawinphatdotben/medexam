"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { STAFF_DASHBOARD_ROLES } from "@/lib/auth/roles";
import { useRoleGate } from "@/hooks/useRoleGate";
import {
  type ExamProctorEventRow,
  isFocusWarningEvent,
  PROCTOR_EVENT_LABELS,
  type ExamProctorEventType,
} from "@/lib/exam/examProctor";

type AssignmentOption = { id: string; title: string };

export default function ExamMonitorPage() {
  const { ready, loading: gateLoading } = useRoleGate(STAFF_DASHBOARD_ROLES, {
    noUserRedirect: "/login",
    wrongRoleRedirect: "/dashboard",
  });

  const [assignments, setAssignments] = useState<AssignmentOption[]>([]);
  const [assignmentFilter, setAssignmentFilter] = useState<string>("");
  const [warningsOnly, setWarningsOnly] = useState(false);
  const [events, setEvents] = useState<ExamProctorEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const loadAssignments = useCallback(async () => {
    const { data, error } = await supabase
      .from("staff_test_assignments")
      .select("id, title")
      .order("created_at", { ascending: false })
      .limit(80);
    if (!error && data) {
      setAssignments(data as AssignmentOption[]);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    setErr(null);
    let q = supabase
      .from("exam_proctor_events")
      .select(
        `
        id,
        assignment_id,
        student_id,
        test_kind,
        test_id,
        event_type,
        detail,
        created_at,
        profiles:student_id ( full_name, email, student_id ),
        staff_test_assignments:assignment_id ( title )
      `,
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (assignmentFilter) {
      q = q.eq("assignment_id", assignmentFilter);
    }

    const { data, error } = await q;
    if (error) {
      if (error.message.includes("does not exist") || error.code === "42P01") {
        setErr("Apply database migration 044 (exam_proctor_events) in Supabase, then refresh.");
      } else {
        setErr(error.message);
      }
      setEvents([]);
    } else {
      const normalized = (data ?? []).map((row) => {
        const r = row as Record<string, unknown>;
        const prof = r.profiles;
        const asg = r.staff_test_assignments;
        return {
          ...r,
          profiles: Array.isArray(prof) ? prof[0] : prof,
          staff_test_assignments: Array.isArray(asg) ? asg[0] : asg,
        } as ExamProctorEventRow;
      });
      setEvents(normalized);
    }
    setLastRefresh(new Date());
    setLoading(false);
  }, [assignmentFilter]);

  useEffect(() => {
    if (!ready) return;
    void loadAssignments();
  }, [ready, loadAssignments]);

  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    void loadEvents();
    const id = window.setInterval(() => {
      void loadEvents();
    }, 4000);
    return () => window.clearInterval(id);
  }, [ready, loadEvents]);

  const filtered = useMemo(() => {
    if (!warningsOnly) return events;
    return events.filter((e) => isFocusWarningEvent(e.event_type));
  }, [events, warningsOnly]);

  const warningCount = useMemo(
    () => events.filter((e) => isFocusWarningEvent(e.event_type)).length,
    [events],
  );

  if (gateLoading || !ready) {
    return (
      <div className="min-h-screen flex items-center justify-center text-blue-800">Loading…</div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <header className="bg-white border-b border-gray-200 px-6 py-6 shadow-sm">
        <div className="max-w-6xl mx-auto">
          <Link href="/dashboard" className="text-sm text-blue-700 hover:underline">
            ← Staff dashboard
          </Link>
          <h1 className="text-3xl font-bold text-slate-900 mt-2">Live exam monitor</h1>
          <p className="text-sm text-gray-600 mt-2 max-w-3xl">
            Real-time audit log while students take assigned formal exams: leaving the exam window, exiting
            fullscreen, and timer auto-submits. Refreshes every 4 seconds.
          </p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto mt-8 px-4 space-y-6">
        <div className="flex flex-wrap gap-4 items-end bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold text-gray-700">Assignment</span>
            <select
              className="border border-gray-300 rounded-lg px-3 py-2 min-w-[220px]"
              value={assignmentFilter}
              onChange={(e) => setAssignmentFilter(e.target.value)}
            >
              <option value="">All assignments</option>
              {assignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-800 pb-2">
            <input
              type="checkbox"
              checked={warningsOnly}
              onChange={(e) => setWarningsOnly(e.target.checked)}
              className="h-4 w-4"
            />
            Warnings only (left window / exited fullscreen)
          </label>
          <button
            type="button"
            onClick={() => void loadEvents()}
            className="ml-auto bg-blue-800 text-white font-semibold px-4 py-2 rounded-lg text-sm hover:bg-blue-900"
          >
            Refresh now
          </button>
        </div>

        {err ? (
          <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 px-4 py-3 text-sm">{err}</div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <p className="text-xs font-bold uppercase text-gray-500">Events loaded</p>
            <p className="text-2xl font-bold text-slate-900 tabular-nums">{filtered.length}</p>
          </div>
          <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 shadow-sm">
            <p className="text-xs font-bold uppercase text-amber-800">Focus / fullscreen warnings</p>
            <p className="text-2xl font-bold text-amber-950 tabular-nums">{warningCount}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <p className="text-xs font-bold uppercase text-gray-500">Last refresh</p>
            <p className="text-sm font-medium text-slate-800 mt-1">
              {lastRefresh ? lastRefresh.toLocaleTimeString() : "—"}
            </p>
          </div>
        </div>

        {loading && events.length === 0 ? (
          <p className="text-center text-gray-600 py-12">Loading proctor log…</p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-gray-600 py-12 border border-dashed border-gray-300 rounded-xl bg-white">
            No events yet. Students will appear here when they begin assigned real tests.
          </p>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Assignment</th>
                    <th className="px-4 py-3">Test</th>
                    <th className="px-4 py-3">Event</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((row) => {
                    const warn = isFocusWarningEvent(row.event_type);
                    const label =
                      PROCTOR_EVENT_LABELS[row.event_type as ExamProctorEventType] ?? row.event_type;
                    const student = row.profiles;
                    const asg = row.staff_test_assignments;
                    return (
                      <tr key={row.id} className={warn ? "bg-amber-50/80" : undefined}>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600 tabular-nums">
                          {new Date(row.created_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">
                            {student?.full_name ?? "Unknown"}
                          </div>
                          <div className="text-xs text-gray-500">{student?.email}</div>
                          {student?.student_id ? (
                            <div className="text-xs text-gray-400 font-mono">{student.student_id}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-gray-800">
                          {asg?.title ?? row.assignment_id.slice(0, 8)}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {row.test_kind} · {row.test_id.slice(0, 8)}…
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={
                              warn
                                ? "inline-flex font-semibold text-amber-950 bg-amber-200 px-2 py-0.5 rounded"
                                : "text-slate-800"
                            }
                          >
                            {label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
