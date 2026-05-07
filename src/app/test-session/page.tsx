"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { supabase } from "@/lib/supabase";

type AssignmentRow = {
  id: string;
  title: string;
  window_start: string | null;
  window_end: string | null;
  test_group_id: string;
};

type GroupItem = {
  test_group_id: string;
  meq_test_id: string | null;
  sba_test_id: string | null;
};

type SessionCard = {
  assignmentId: string;
  key: string;
  assignmentTitle: string;
  windowStart: string | null;
  windowEnd: string | null;
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

export default function TestSessionPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const [authTimedOut, setAuthTimedOut] = useState(false);
  const [cards, setCards] = useState<SessionCard[]>([]);
  const [loading, setLoading] = useState(true);

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
      const studentYear = profile?.medical_student_year ?? null;

      const { data: assigns, error: asgErr } = await supabase
        .from("staff_test_assignments")
        .select("id, title, window_start, window_end, test_group_id")
        .order("created_at", { ascending: false });

      if (asgErr || !assigns?.length) {
        setCards([]);
        setLoading(false);
        return;
      }

      const gids = [...new Set(assigns.map((a) => (a as AssignmentRow).test_group_id))];
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
      for (const a of assigns as AssignmentRow[]) {
        for (const it of byGid.get(a.test_group_id) ?? []) {
          if (it.meq_test_id) meqIds.add(it.meq_test_id);
          if (it.sba_test_id) sbaIds.add(it.sba_test_id);
        }
      }

      const [meqRes, sbaRes] = await Promise.all([
        meqIds.size
          ? supabase
              .from("meq_tests")
              .select("id, subject, course_code, vignette, test_year, test_function, review_status")
              .in("id", [...meqIds])
          : Promise.resolve({ data: [] as Record<string, unknown>[] }),
        sbaIds.size
          ? supabase
              .from("sba_tests")
              .select("id, subject, subject_code, test_year, test_function, review_status")
              .in("id", [...sbaIds])
          : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      ]);

      const meqById = Object.fromEntries(
        ((meqRes as { data: { id: string }[] }).data || []).map((r) => [r.id, r])
      ) as Record<
        string,
        {
          id: string;
          subject: string;
          course_code: string;
          vignette: string | null;
          test_year: number;
          test_function: string;
          review_status: string;
        }
      >;
      const sbaById = Object.fromEntries(
        ((sbaRes as { data: { id: string }[] }).data || []).map((r) => [r.id, r])
      ) as Record<
        string,
        {
          id: string;
          subject: string;
          subject_code: string;
          test_year: number;
          test_function: string;
          review_status: string;
        }
      >;

      const next: SessionCard[] = [];
      for (const a of assigns as AssignmentRow[]) {
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
            next.push({
              assignmentId: a.id,
              key: `${a.id}-meq-${t.id}`,
              assignmentTitle: a.title,
              windowStart: a.window_start,
              windowEnd: a.window_end,
              kind: "MEQ",
              id: t.id,
              subject: t.subject,
              subjectCode: t.course_code,
              preview: buildPreviewMeq(t.vignette ?? ""),
              href: `/exam/${t.id}`,
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
            next.push({
              assignmentId: a.id,
              key: `${a.id}-sba-${t.id}`,
              assignmentTitle: a.title,
              windowStart: a.window_start,
              windowEnd: a.window_end,
              kind: "SBA",
              id: t.id,
              subject: t.subject,
              subjectCode: t.subject_code,
              preview: `Single best answer — ${t.subject} (${t.subject_code}).`,
              href: `/exam/sba/${t.id}`,
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
        <p className="text-teal-800 text-lg font-semibold">Still checking your session…</p>
        <p className="text-gray-600 text-sm mt-2 max-w-md">
          Authentication is taking longer than expected. Re-login or open practice tests while this recovers.
        </p>
        <div className="mt-5 flex items-center gap-3">
          <Link href="/login" className="px-4 py-2 rounded bg-teal-700 text-white font-semibold">
            Re-login
          </Link>
          <Link href="/practice-tests" className="px-4 py-2 rounded border border-teal-300 text-teal-800 font-semibold">
            Practice tests
          </Link>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-teal-700">Checking session…</div>
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
        <p className="text-gray-700 mb-4">Test session lists are only for student accounts.</p>
        <Link href="/practice-tests" className="text-teal-700 font-semibold underline">
          Go to practice tests
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="w-full border-b border-gray-200 px-6 py-6 shadow-sm">
        <h1 className="text-3xl font-bold text-teal-700 tracking-tight">Test session</h1>
        <p className="mt-2 text-sm text-gray-600 max-w-2xl">
          Official exams assigned to you (or your group) by an administrator. Each item must be committee-approved.
          Opens only inside the scheduling window shown below.
        </p>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto mt-10 px-4 pb-16">
        {loading ? (
          <div className="flex justify-center py-24 text-teal-700 font-medium">Loading your session…</div>
        ) : cards.length === 0 ? (
          <div className="text-gray-600 text-center py-16 border border-dashed border-amber-200 rounded-xl bg-amber-50/40">
            <p className="text-lg mb-2">No tests are assigned to you in the current window.</p>
            <p className="text-sm">
              Practice materials are always under{" "}
              <Link href="/practice-tests" className="text-teal-700 font-semibold underline">
                Practice tests
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {groupedByAssignment.map(([assignmentId, items]) => (
              <section key={assignmentId} className="space-y-3">
                <div className="border-l-4 border-amber-500 pl-3">
                  <h2 className="text-lg font-bold text-gray-900">{items[0]?.assignmentTitle ?? "Assignment"}</h2>
                  {items[0]?.windowStart || items[0]?.windowEnd ? (
                    <p className="text-xs text-gray-600 mt-1">
                      Window:{" "}
                      {items[0]?.windowStart
                        ? new Date(items[0].windowStart).toLocaleString()
                        : "open start"}
                      {" · "}
                      {items[0]?.windowEnd
                        ? new Date(items[0].windowEnd).toLocaleString()
                        : "open end"}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-600 mt-1">No fixed window configured.</p>
                  )}
                </div>
                <div className="grid gap-4">
                  {items.map((exam) => (
                    <div
                      key={exam.key}
                      className="bg-white border border-amber-200 rounded-xl p-5 shadow-sm flex flex-col gap-2"
                    >
                      <div className="flex justify-between gap-2">
                        <h3 className="text-xl font-semibold text-teal-900">
                          {exam.subject} ({exam.subjectCode})
                        </h3>
                        <span className="text-xs font-bold bg-amber-200 text-amber-950 px-2 py-0.5 rounded-full shrink-0">
                          {exam.kind}
                        </span>
                      </div>
                      {exam.preview ? <p className="text-gray-700 text-sm line-clamp-2">{exam.preview}</p> : null}
                      <div className="flex justify-end pt-1">
                        <Link
                          href={exam.href}
                          className="bg-amber-700 text-white px-5 py-2 rounded-lg font-semibold text-sm hover:bg-amber-800"
                        >
                          Begin
                        </Link>
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
