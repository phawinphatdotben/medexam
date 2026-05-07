"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type ExamListItem = {
  id: string;
  kind: "MEQ" | "SBA";
  subject: string;
  subjectCode: string;
  preview: string;
  href: string;
  sortKey: string;
};

function buildPreviewMeq(vignette: string) {
  if (!vignette?.trim()) return "";
  return vignette.slice(0, 180) + (vignette.length > 180 ? "…" : "");
}

function ExamLobbyInner() {
  const [exams, setExams] = useState<ExamListItem[]>([]);
  const [assignedExams, setAssignedExams] = useState<ExamListItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [subjectCodeSearch, setSubjectCodeSearch] = useState("");
  const searchParams = useSearchParams();
  const selectedSubject = searchParams.get("subject");
  const normalizedCodeSearch = subjectCodeSearch.trim().toLowerCase();
  const filteredExams = exams.filter((exam) =>
    normalizedCodeSearch ? exam.subjectCode.toLowerCase().includes(normalizedCodeSearch) : true
  );
  const filteredAssigned = assignedExams.filter((exam) =>
    normalizedCodeSearch ? exam.subjectCode.toLowerCase().includes(normalizedCodeSearch) : true
  );

  useEffect(() => {
    const fetchExams = async () => {
      if (!selectedSubject) {
        setExams([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) {
        setExams([]);
        setLoading(false);
        return;
      }
      const { data: p } = await supabase
        .from("profiles")
        .select("medical_student_year, role")
        .eq("id", uid)
        .maybeSingle();
      const studentYear = p?.medical_student_year ?? null;
      const role = p?.role ?? "student";

      let meqQ = supabase
        .from("meq_tests")
        .select("id, subject, course_code, vignette, created_at")
        .eq("review_status", "approved")
        .order("created_at", { ascending: false });

      let sbaQ = supabase
        .from("sba_tests")
        .select("id, subject, subject_code, created_at")
        .eq("review_status", "approved")
        .order("created_at", { ascending: false });

      meqQ = meqQ.eq("subject", selectedSubject);
      sbaQ = sbaQ.eq("subject", selectedSubject);
      if (role === "student" && studentYear != null) {
        meqQ = meqQ.eq("test_year", studentYear);
        sbaQ = sbaQ.eq("test_year", studentYear);
      }

      const [meqRes, sbaRes] = await Promise.all([meqQ, sbaQ]);

      const list: ExamListItem[] = [];
      const assignedList: ExamListItem[] = [];

      if (role === "student") {
        const { data: items, error: asgErr } = await supabase.from("staff_test_group_items").select("meq_test_id, sba_test_id");
        if (!asgErr && items && items.length > 0) {
          const meqIds = [...new Set(items.map((i) => i.meq_test_id).filter(Boolean))] as string[];
          const sbaIds = [...new Set(items.map((i) => i.sba_test_id).filter(Boolean))] as string[];

          if (meqIds.length > 0) {
            let mq = supabase
              .from("meq_tests")
              .select("id, subject, course_code, vignette, created_at")
              .eq("review_status", "approved")
              .eq("subject", selectedSubject)
              .in("id", meqIds);
            if (studentYear != null) mq = mq.eq("test_year", studentYear);
            const { data: meqA } = await mq;
            for (const row of meqA || []) {
              assignedList.push({
                id: row.id,
                kind: "MEQ",
                subject: row.subject,
                subjectCode: row.course_code,
                preview: buildPreviewMeq(row.vignette),
                href: `/exam/${row.id}`,
                sortKey: row.created_at ?? row.id,
              });
            }
          }
          if (sbaIds.length > 0) {
            let sq = supabase
              .from("sba_tests")
              .select("id, subject, subject_code, created_at")
              .eq("review_status", "approved")
              .eq("subject", selectedSubject)
              .in("id", sbaIds);
            if (studentYear != null) sq = sq.eq("test_year", studentYear);
            const { data: sbaA } = await sq;
            for (const row of sbaA || []) {
              assignedList.push({
                id: row.id,
                kind: "SBA",
                subject: row.subject,
                subjectCode: row.subject_code,
                preview: `Single best answer — ${row.subject} (${row.subject_code}).`,
                href: `/exam/sba/${row.id}`,
                sortKey: row.created_at ?? row.id,
              });
            }
          }
        }
      }

      assignedList.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));

      if (meqRes.data) {
        for (const row of meqRes.data) {
          list.push({
            id: row.id,
            kind: "MEQ",
            subject: row.subject,
            subjectCode: row.course_code,
            preview: buildPreviewMeq(row.vignette),
            href: `/exam/${row.id}`,
            sortKey: row.created_at ?? row.id,
          });
        }
      }
      if (sbaRes.data) {
        for (const row of sbaRes.data) {
          list.push({
            id: row.id,
            kind: "SBA",
            subject: row.subject,
            subjectCode: row.subject_code,
            preview: `Single best answer — ${row.subject} (${row.subject_code}).`,
            href: `/exam/sba/${row.id}`,
            sortKey: row.created_at ?? row.id,
          });
        }
      }

      list.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
      if (meqRes.error || sbaRes.error) {
        setExams([]);
        setAssignedExams([]);
      } else {
        setExams(list);
        setAssignedExams(assignedList);
      }
      setLoading(false);
    };

    void fetchExams();
  }, [selectedSubject]);

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="w-full border-b border-gray-200 px-6 py-6 shadow-sm">
        <h1 className="text-3xl font-bold text-teal-700 tracking-tight">
          Available Clinical Examinations
        </h1>
        {selectedSubject ? (
          <p className="mt-2 text-sm text-gray-600">
            Subject: <span className="font-semibold text-teal-800">{selectedSubject}</span>
          </p>
        ) : null}
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto mt-10 px-4">
        {!selectedSubject ? (
          <div className="text-center py-16">
            <p className="text-gray-600 text-lg mb-4">Please choose a subject first.</p>
            <Link
              href="/subjects"
              className="inline-block bg-teal-600 text-white px-5 py-2 rounded-lg font-semibold hover:bg-teal-700"
            >
              Go to subject selection
            </Link>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-24">
            <svg
              className="animate-spin h-8 w-8 text-teal-600 mr-3"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-30"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-80"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
            <span className="text-teal-700 text-lg font-medium">Loading exams...</span>
          </div>
        ) : exams.length === 0 ? (
          <div className="text-gray-500 text-center py-16 text-lg">
            No exams available at this time.
          </div>
        ) : (
          <div className="space-y-5">
            {filteredAssigned.length > 0 ? (
              <section className="border border-amber-200 bg-amber-50/80 rounded-xl p-5 space-y-3">
                <h2 className="text-lg font-bold text-amber-900">Assigned for this season</h2>
                <p className="text-sm text-amber-950/80">
                  Your admin scheduled these for you (active assignment window). They also appear below if the
                  subject matches.
                </p>
                <div className="grid gap-4">
                  {filteredAssigned.map((exam) => (
                    <div
                      key={`asg-${exam.kind}-${exam.id}`}
                      className="bg-white border border-amber-300 rounded-lg p-4 flex flex-col gap-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-lg font-semibold text-teal-900">
                          {exam.subject} ({exam.subjectCode})
                        </h3>
                        <span className="text-xs font-bold bg-amber-200 text-amber-950 px-2 py-0.5 rounded-full">
                          Assigned · {exam.kind}
                        </span>
                      </div>
                      {exam.preview ? (
                        <p className="text-gray-700 text-sm line-clamp-2">{exam.preview}</p>
                      ) : null}
                      <div className="flex justify-end">
                        <Link
                          href={exam.href}
                          className="bg-amber-700 text-white px-5 py-2 rounded-lg font-semibold text-sm hover:bg-amber-800"
                        >
                          Open
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            <div>
              <label htmlFor="subject-code-search" className="block text-sm font-medium text-gray-700 mb-1">
                Search by course code
              </label>
              <input
                id="subject-code-search"
                type="text"
                value={subjectCodeSearch}
                onChange={(e) => setSubjectCodeSearch(e.target.value)}
                placeholder="e.g. PEDS101"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300"
              />
            </div>
            {filteredExams.length === 0 ? (
              <div className="text-gray-500 text-center py-10 text-base border border-dashed border-gray-300 rounded-lg">
                No exams match this course code.
              </div>
            ) : null}
            <div className="grid gap-6">
              {filteredExams.map((exam) => (
              <div
                key={`${exam.kind}-${exam.id}`}
                className="bg-gray-50 border border-teal-200 rounded-xl shadow-sm p-6 flex flex-col gap-3 hover:shadow-md transition"
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-2xl font-semibold text-teal-800 mb-1">
                    {exam.subject} ({exam.subjectCode})
                  </h2>
                  <span className="text-xs font-bold tracking-wide bg-teal-100 text-teal-800 px-2.5 py-1 rounded-full">
                    {exam.kind}
                  </span>
                </div>
                {exam.preview ? (
                  <p className="text-gray-700 mb-3 line-clamp-3">{exam.preview}</p>
                ) : null}
                <div className="flex justify-end">
                  <Link
                    href={exam.href}
                    className="bg-teal-600 text-white px-6 py-2 rounded-lg font-semibold shadow hover:bg-teal-700 transition border border-teal-700 text-base"
                  >
                    Start Exam
                  </Link>
                </div>
              </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function ExamLobbyPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-teal-700">Loading…</div>
      }
    >
      <ExamLobbyInner />
    </Suspense>
  );
}
