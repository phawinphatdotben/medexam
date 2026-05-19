"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BeginRealTestButton } from "@/components/exam/BeginRealTestButton";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { supabase } from "@/lib/supabase";

type AssignmentRow = {
  id: string;
  title: string;
  window_start: string | null;
  window_end: string | null;
  exam_time_limit_minutes: number | null;
  test_group_id: string;
};

type GroupItem = {
  test_group_id: string;
  meq_test_id: string | null;
  sba_test_id: string | null;
};

type StaffTestGroupFilters = {
  id: string;
  filter_course_code: string | null;
  filter_exam_format: string | null;
  filter_assessment_purpose: string | null;
};

type SessionCard = {
  assignmentId: string;
  key: string;
  assignmentTitle: string;
  windowStart: string | null;
  windowEnd: string | null;
  examMinutes: number | null;
  kind: "MEQ" | "SBA";
  id: string;
  subject: string;
  subjectCode: string;
  preview: string;
  href: string;
};

function buildPreviewMeq(vignette: string) {
  if (!vignette?.trim()) return "";
  return vignette.slice(0, 160) + (vignette.length > 160 ? "…" : "");
}

export default function TestTakingPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const [authTimedOut, setAuthTimedOut] = useState(false);
  const [cards, setCards] = useState<SessionCard[]>([]);
  const [loading, setLoading] = useState(true);
  /** When false in student_ui_settings, show a notice instead of loading assignments (navbar link stays). */
  const [adminPausedTestTaking, setAdminPausedTestTaking] = useState(false);

  const isStudent = profile?.role === "student";

  useEffect(() => {
    if (!authLoading) {
      setAuthTimedOut(false);
      return;
    }
    const timer = setTimeout(() => {
      setAuthTimedOut(true);
    }, 9000);
    return () => clearTimeout(timer);
  }, [authLoading]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!isStudent) {
      setLoading(false);
      setCards([]);
      return;
    }

    const run = async () => {
      setLoading(true);
      setAdminPausedTestTaking(false);

      const settingsRes = await supabase
        .from("student_ui_settings")
        .select("test_taking_nav_visible")
        .eq("id", 1)
        .maybeSingle();

      if (
        !settingsRes.error &&
        settingsRes.data &&
        settingsRes.data.test_taking_nav_visible === false
      ) {
        setAdminPausedTestTaking(true);
        setCards([]);
        setLoading(false);
        return;
      }

      const studentYear = profile?.medical_student_year ?? null;

      const { data: assigns, error: asgErr } = await supabase
        .from("staff_test_assignments")
        .select("id, title, window_start, window_end, exam_time_limit_minutes, test_group_id")
        .order("created_at", { ascending: false });

      if (asgErr || !assigns?.length) {
        setCards([]);
        setLoading(false);
        return;
      }

      const gids = [...new Set(assigns.map((a) => (a as AssignmentRow).test_group_id))];
      const { data: groupRows } = await supabase
        .from("staff_test_groups")
        .select("id, filter_course_code, filter_exam_format, filter_assessment_purpose")
        .in("id", gids);
      const groupMetaById = new Map<string, StaffTestGroupFilters>();
      for (const gr of (groupRows as StaffTestGroupFilters[]) || []) {
        groupMetaById.set(gr.id, gr);
      }

      const { data: items } = await supabase
        .from("staff_test_group_items")
        .select("test_group_id, meq_test_id, sba_test_id")
        .in("test_group_id", gids);

      const byGid = new Map<string, GroupItem[]>();
      for (const row of (items as GroupItem[]) || []) {
        const list = byGid.get(row.test_group_id) ?? [];
        list.push(row);
        byGid.set(row.test_group_id, list);
      }

      const meqIds = new Set<string>();
      const sbaIds = new Set<string>();
      const meqCriteriaKeys = new Map<string, { course: string; purpose: string }>();
      const sbaCriteriaKeys = new Map<string, { course: string; purpose: string }>();

      for (const a of assigns as AssignmentRow[]) {
        const meta = groupMetaById.get(a.test_group_id);
        if (
          meta?.filter_course_code &&
          meta.filter_exam_format &&
          meta.filter_assessment_purpose
        ) {
          const k = `${meta.filter_course_code}\0${meta.filter_assessment_purpose}`;
          if (meta.filter_exam_format === "MEQ") {
            meqCriteriaKeys.set(k, {
              course: meta.filter_course_code,
              purpose: meta.filter_assessment_purpose,
            });
          } else if (meta.filter_exam_format === "SBA") {
            sbaCriteriaKeys.set(k, {
              course: meta.filter_course_code,
              purpose: meta.filter_assessment_purpose,
            });
          }
        } else {
          for (const it of byGid.get(a.test_group_id) ?? []) {
            if (it.meq_test_id) meqIds.add(it.meq_test_id);
            if (it.sba_test_id) sbaIds.add(it.sba_test_id);
          }
        }
      }

      type MeqRow = {
        id: string;
        subject: string;
        course_code: string;
        vignette: string | null;
        test_year: number;
        test_function: string;
        review_status: string;
      };
      type SbaRow = {
        id: string;
        subject: string;
        subject_code: string;
        test_year: number;
        test_function: string;
        review_status: string;
      };

      const meqKeyList = [...meqCriteriaKeys.keys()];
      const sbaKeyList = [...sbaCriteriaKeys.keys()];
      const empty = Promise.resolve({ data: [] as Record<string, unknown>[] });

      const bundleResults = await Promise.all([
        meqIds.size
          ? supabase
              .from("meq_tests")
              .select("id, subject, course_code, vignette, test_year, test_function, review_status")
              .in("id", [...meqIds])
          : empty,
        sbaIds.size
          ? supabase
              .from("sba_tests")
              .select("id, subject, subject_code, test_year, test_function, review_status")
              .in("id", [...sbaIds])
          : empty,
        ...meqKeyList.map((k) => {
          const v = meqCriteriaKeys.get(k)!;
          return supabase
            .from("meq_tests")
            .select("id, subject, course_code, vignette, test_year, test_function, review_status")
            .eq("course_code", v.course)
            .eq("assessment_purpose", v.purpose)
            .eq("test_function", "real_test")
            .eq("review_status", "approved");
        }),
        ...sbaKeyList.map((k) => {
          const v = sbaCriteriaKeys.get(k)!;
          return supabase
            .from("sba_tests")
            .select("id, subject, subject_code, test_year, test_function, review_status")
            .eq("subject_code", v.course)
            .eq("assessment_purpose", v.purpose)
            .eq("test_function", "real_test")
            .eq("review_status", "approved");
        }),
      ]);

      const meqRes = bundleResults[0] as { data: MeqRow[] };
      const sbaRes = bundleResults[1] as { data: SbaRow[] };
      const meqOffset = 2;
      const sbaOffset = 2 + meqKeyList.length;

      const meqById = Object.fromEntries((meqRes.data || []).map((r) => [r.id, r])) as Record<string, MeqRow>;
      const sbaById = Object.fromEntries((sbaRes.data || []).map((r) => [r.id, r])) as Record<string, SbaRow>;

      const meqRowsByCriteriaKey = new Map<string, MeqRow[]>();
      for (let i = 0; i < meqKeyList.length; i++) {
        const res = bundleResults[meqOffset + i] as { data: MeqRow[] };
        meqRowsByCriteriaKey.set(meqKeyList[i]!, res.data || []);
      }
      const sbaRowsByCriteriaKey = new Map<string, SbaRow[]>();
      for (let j = 0; j < sbaKeyList.length; j++) {
        const res = bundleResults[sbaOffset + j] as { data: SbaRow[] };
        sbaRowsByCriteriaKey.set(sbaKeyList[j]!, res.data || []);
      }

      const next: SessionCard[] = [];
      for (const a of assigns as AssignmentRow[]) {
        const meta = groupMetaById.get(a.test_group_id);
        if (
          meta?.filter_course_code &&
          meta.filter_exam_format &&
          meta.filter_assessment_purpose
        ) {
          const critKey = `${meta.filter_course_code}\0${meta.filter_assessment_purpose}`;
          const qAssign = `assignment=${encodeURIComponent(a.id)}`;
          if (meta.filter_exam_format === "MEQ") {
            for (const t of meqRowsByCriteriaKey.get(critKey) ?? []) {
              if (studentYear != null && t.test_year !== studentYear) continue;
              next.push({
                assignmentId: a.id,
                key: `${a.id}-meq-scope-${t.id}`,
                assignmentTitle: a.title,
                windowStart: a.window_start,
                windowEnd: a.window_end,
                examMinutes: a.exam_time_limit_minutes,
                kind: "MEQ",
                id: t.id,
                subject: t.subject,
                subjectCode: t.course_code,
                preview: buildPreviewMeq(t.vignette ?? ""),
                href: `/exam/${t.id}?${qAssign}`,
              });
            }
          } else if (meta.filter_exam_format === "SBA") {
            for (const t of sbaRowsByCriteriaKey.get(critKey) ?? []) {
              if (studentYear != null && t.test_year !== studentYear) continue;
              next.push({
                assignmentId: a.id,
                key: `${a.id}-sba-scope-${t.id}`,
                assignmentTitle: a.title,
                windowStart: a.window_start,
                windowEnd: a.window_end,
                examMinutes: a.exam_time_limit_minutes,
                kind: "SBA",
                id: t.id,
                subject: t.subject,
                subjectCode: t.subject_code,
                preview: `Single best answer — ${t.subject} (${t.subject_code}).`,
                href: `/exam/sba/${t.id}?${qAssign}`,
              });
            }
          }
          continue;
        }

        const groupItems = byGid.get(a.test_group_id) ?? [];
        for (const it of groupItems) {
          if (it.meq_test_id) {
            const t = meqById[it.meq_test_id];
            if (
              !t ||
              t.review_status !== "approved" ||
              t.test_function !== "real_test" ||
              (studentYear != null && t.test_year !== studentYear)
            )
              continue;
            const q = `assignment=${encodeURIComponent(a.id)}`;
            next.push({
              assignmentId: a.id,
              key: `${a.id}-meq-${t.id}`,
              assignmentTitle: a.title,
              windowStart: a.window_start,
              windowEnd: a.window_end,
              examMinutes: a.exam_time_limit_minutes,
              kind: "MEQ",
              id: t.id,
              subject: t.subject,
              subjectCode: t.course_code,
              preview: buildPreviewMeq(t.vignette ?? ""),
              href: `/exam/${t.id}?${q}`,
            });
          }
          if (it.sba_test_id) {
            const t = sbaById[it.sba_test_id];
            if (
              !t ||
              t.review_status !== "approved" ||
              t.test_function !== "real_test" ||
              (studentYear != null && t.test_year !== studentYear)
            )
              continue;
            const q = `assignment=${encodeURIComponent(a.id)}`;
            next.push({
              assignmentId: a.id,
              key: `${a.id}-sba-${t.id}`,
              assignmentTitle: a.title,
              windowStart: a.window_start,
              windowEnd: a.window_end,
              examMinutes: a.exam_time_limit_minutes,
              kind: "SBA",
              id: t.id,
              subject: t.subject,
              subjectCode: t.subject_code,
              preview: `Single best answer — ${t.subject} (${t.subject_code}).`,
              href: `/exam/sba/${t.id}?${q}`,
            });
          }
        }
      }

      setCards(next);
      setLoading(false);
    };

    void run();
  }, [authLoading, user, profile?.role, profile?.medical_student_year, isStudent, router]);

  const groupedByAssignment = useMemo(() => {
    const map = new Map<string, SessionCard[]>();
    for (const c of cards) {
      const list = map.get(c.assignmentId) ?? [];
      list.push(c);
      map.set(c.assignmentId, list);
    }
    return [...map.entries()].sort(([, aa], [, bb]) =>
      (aa[0]?.assignmentTitle ?? "").localeCompare(bb[0]?.assignmentTitle ?? ""),
    );
  }, [cards]);

  if (authTimedOut) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4 text-center">
        <p className="text-blue-900 text-lg font-semibold">Still checking your session…</p>
        <p className="text-gray-600 text-sm mt-2 max-w-md">
          Authentication is taking longer than expected. Re-login or open practice tests while this recovers.
        </p>
        <div className="mt-5 flex items-center gap-3">
          <Link href="/login" className="px-4 py-2 rounded bg-blue-800 text-white font-semibold">
            Re-login
          </Link>
          <Link href="/practice-tests" className="px-4 py-2 rounded border border-blue-400 text-blue-900 font-semibold">
            Practice tests
          </Link>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-blue-800">Checking session…</div>
    );
  }

  if (user && !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-600 px-4 text-center">
        Your profile record is missing — contact administration.
      </div>
    );
  }

  if (!isStudent) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4">
        <p className="text-gray-700 mb-4">Test taking lists are only for student accounts.</p>
        <Link href="/practice-tests" className="text-blue-800 font-semibold underline">
          Go to practice tests
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="w-full border-b border-gray-200 px-6 py-6 shadow-sm">
        <h1 className="text-3xl font-bold text-blue-800 tracking-tight">Test taking</h1>
        <p className="mt-2 text-sm text-gray-600 max-w-2xl">
          Official exams assigned to you by an administrator. Each item opens only during the scheduling window shown.
          When you tap <strong>Begin</strong>, the exam opens in a separate secure window — stay in that window until you
          submit. Allow pop-ups for this site if your browser blocks the exam window.
        </p>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto mt-10 px-4 pb-16">
        {adminPausedTestTaking ? (
          <div className="text-center py-16 border border-amber-200 rounded-xl bg-amber-50 px-4 space-y-3">
            <p className="text-lg font-semibold text-amber-950">Scheduled exams are paused</p>
            <p className="text-sm text-gray-700 max-w-md mx-auto">
              Your school has temporarily turned off the Test taking list. Practice materials stay available under{" "}
              <Link href="/practice-tests" className="text-blue-800 font-semibold underline">
                Practice tests
              </Link>
              . If this is unexpected, contact your course administrator.
            </p>
          </div>
        ) : loading ? (
          <div className="flex justify-center py-24 text-blue-800 font-medium">Loading your tests…</div>
        ) : cards.length === 0 ? (
          <div className="text-gray-600 text-center py-16 border border-dashed border-orange-300 rounded-xl bg-orange-100/40">
            <p className="text-lg mb-2">No tests are assigned to you right now.</p>
            <p className="text-sm">
              Practice materials stay under{" "}
              <Link href="/practice-tests" className="text-blue-800 font-semibold underline">
                Practice tests
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {groupedByAssignment.map(([assignmentId, items]) => (
              <section key={assignmentId} className="space-y-3">
                <div className="border-l-4 border-orange-800 pl-3">
                  <h2 className="text-lg font-bold text-gray-900">{items[0]?.assignmentTitle ?? "Assignment"}</h2>
                  {items[0]?.windowStart || items[0]?.windowEnd ? (
                    <p className="text-xs text-gray-600 mt-1">
                      Window:{" "}
                      {items[0]?.windowStart
                        ? new Date(items[0].windowStart).toLocaleString()
                        : "open start"}
                      {" · "}
                      {items[0]?.windowEnd ? new Date(items[0].windowEnd).toLocaleString() : "open end"}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-600 mt-1">No fixed window configured on this assignment.</p>
                  )}
                  {items[0]?.examMinutes != null ? (
                    <p className="text-xs font-semibold text-blue-950 mt-1">
                      Time allowed once you begin: <span className="tabular-nums">{items[0].examMinutes}</span> min
                      overall (configured on the assignment; falls back to the test defaults if omitted).
                    </p>
                  ) : (
                    <p className="text-xs text-gray-500 mt-1">
                      Assignment does not override exam length — MEQ/SBA test timer settings apply if configured.
                    </p>
                  )}
                </div>
                <div className="grid gap-4">
                  {items.map((exam) => (
                    <div
                      key={exam.key}
                      className="bg-white border border-orange-300 rounded-xl p-5 shadow-sm flex flex-col gap-2"
                    >
                      <div className="flex justify-between gap-2">
                        <h3 className="text-xl font-semibold text-blue-950">
                          {exam.subject} ({exam.subjectCode})
                        </h3>
                        <span className="text-xs font-bold bg-orange-300 text-orange-950 px-2 py-0.5 rounded-full shrink-0">
                          {exam.kind}
                        </span>
                      </div>
                      {exam.preview ? <p className="text-gray-700 text-sm line-clamp-2">{exam.preview}</p> : null}
                      <div className="flex justify-end pt-1">
                        <BeginRealTestButton href={exam.href} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
