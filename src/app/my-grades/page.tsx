"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/auth/AuthProvider";

type GradedItem = {
  id: string;
  created_at: string;
  human_override_score: number;
  max_score: number | null;
  ai_rationale_feedback: string | null;
  stage_order: number;
  item_order: number;
};

type TestGradeGroup = {
  meq_test_id: string;
  test_display_id: string;
  test_label: string;
  /** Sum of every authored item's max_score in the exam (whole test). */
  exam_full_score: number | null;
  items: GradedItem[];
};

function formatScore(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function caret(expanded: boolean) {
  return expanded ? (
    <span aria-hidden className="inline-block w-6 text-blue-900 font-semibold tabular-nums">
      ▼
    </span>
  ) : (
    <span aria-hidden className="inline-block w-6 text-blue-900 font-semibold tabular-nums">
      ▸
    </span>
  );
}

export default function MyGrades() {
  const { user, loading: authLoading } = useAuth();
  const [groups, setGroups] = useState<TestGradeGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [userError, setUserError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let mounted = true;
    const fetchGrades = async () => {
      setLoading(true);
      setUserError(null);

      if (authLoading) return;
      if (!user?.id) {
        setUserError("You must be logged in to view your grades.");
        setLoading(false);
        return;
      }
      const userId = user.id;

      const { data, error } = await supabase
        .from("meq_stage_responses")
        .select(
          `
          id,
          created_at,
          human_override_score,
          ai_rationale_feedback,
          meq_stage_items (
            sequence_order,
            max_score,
            meq_test_stages!inner(
              sequence_order,
              meq_test_id,
              meq_tests!inner( id, subject, course_code, public_code )
            )
          )
        `
        )
        .eq("user_id", userId)
        .not("human_override_score", "is", null);

      if (error) {
        setUserError("Failed to fetch grades.");
        setLoading(false);
        return;
      }

      type Row = {
        id: string;
        created_at: string;
        human_override_score: number | null;
        ai_rationale_feedback: string | null;
        meq_stage_items?: {
          sequence_order: number;
          max_score: number | null;
          meq_test_stages?: {
            sequence_order: number;
            meq_test_id: string;
            meq_tests: {
              id: string;
              subject: string;
              course_code: string;
              public_code: string | null;
            };
          };
        } | null;
      };

      type Bucket = TestGradeGroup;
      const bucketByTest = new Map<string, Bucket>();

      for (const res of (data as unknown as Row[] | null) || []) {
        const nested = Array.isArray(res.meq_stage_items)
          ? res.meq_stage_items[0]
          : res.meq_stage_items;
        const st = nested?.meq_test_stages;
        const t = st?.meq_tests;
        if (
          typeof st?.meq_test_id !== "string" ||
          typeof res.human_override_score !== "number" ||
          typeof nested?.sequence_order !== "number" ||
          typeof st.sequence_order !== "number" ||
          !t
        ) {
          continue;
        }

        const meq_test_id = st.meq_test_id;
        if (!bucketByTest.has(meq_test_id)) {
          const test_display_id =
            t.public_code?.trim() || `MEQ-${t.id.slice(0, 8)}…`;
          bucketByTest.set(meq_test_id, {
            meq_test_id,
            test_display_id,
            test_label: `${t.subject} (${t.course_code})`,
            exam_full_score: null,
            items: [],
          });
        }
        bucketByTest.get(meq_test_id)!.items.push({
          id: res.id,
          created_at: res.created_at,
          human_override_score: res.human_override_score,
          max_score: typeof nested.max_score === "number" ? nested.max_score : null,
          ai_rationale_feedback: res.ai_rationale_feedback,
          stage_order: st.sequence_order,
          item_order: nested.sequence_order,
        });
      }

      const testIds = [...bucketByTest.keys()];
      const examFullScores = new Map<string, number>();
      if (testIds.length) {
        const { data: stageItems } = await supabase
          .from("meq_test_stages")
          .select("meq_test_id, meq_stage_items ( max_score )")
          .in("meq_test_id", testIds);
        type StageRow = {
          meq_test_id: string;
          meq_stage_items: { max_score: number | null }[] | null;
        };
        for (const row of (stageItems as StageRow[] | null) || []) {
          const tid = row.meq_test_id;
          let add = examFullScores.get(tid) ?? 0;
          for (const it of row.meq_stage_items ?? []) {
            add += typeof it.max_score === "number" ? it.max_score : 0;
          }
          examFullScores.set(tid, add);
        }
      }
      for (const [tid, total] of examFullScores) {
        const bucket = bucketByTest.get(tid);
        if (bucket) bucket.exam_full_score = total > 0 ? total : null;
      }

      const list: TestGradeGroup[] = [...bucketByTest.values()].map((g) => ({
        ...g,
        items: [...g.items].sort((a, b) => {
          if (b.stage_order !== a.stage_order) return b.stage_order - a.stage_order;
          return a.item_order - b.item_order || b.created_at.localeCompare(a.created_at);
        }),
      }));

      list.sort((a, b) => {
        const ad = Math.max(...a.items.map((x) => new Date(x.created_at).getTime()), 0);
        const bd = Math.max(...b.items.map((x) => new Date(x.created_at).getTime()), 0);
        return bd - ad;
      });

      if (mounted) {
        setGroups(list);
        setLoading(false);
      }
    };

    void fetchGrades();

    return () => {
      mounted = false;
    };
  }, [authLoading, user?.id]);

  const anyExpanded = useMemo(() => groups.some((g) => expanded[g.meq_test_id]), [groups, expanded]);

  function toggleExpand(meqTestId: string) {
    setExpanded((prev) => ({ ...prev, [meqTestId]: !prev[meqTestId] }));
  }

  return (
    <div className="flex flex-col items-center min-h-screen bg-white pt-20 pb-10 px-4">
      <h1 className="text-3xl font-bold text-blue-800 mb-2 text-center tracking-tight">
        My examination results
      </h1>
      <p className="text-sm text-gray-600 mb-8 text-center max-w-lg">
        Each row is one exam (<strong>Test ID</strong>). Use the arrow to open every graded stage and its feedback.
      </p>

      {loading ? (
        <div className="flex flex-col items-center mt-16">
          <svg
            className="animate-spin h-8 w-8 text-blue-900 mb-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-30" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <span className="text-blue-800 text-lg font-medium">Loading your grades...</span>
        </div>
      ) : userError ? (
        <div className="bg-red-100 text-red-700 px-6 py-4 rounded shadow mt-8 font-semibold">{userError}</div>
      ) : groups.length === 0 ? (
        <div className="mt-16 bg-yellow-50 border border-yellow-200 text-yellow-800 px-8 py-6 rounded-lg shadow text-lg text-center font-semibold">
          You have not received any MEQ stage grades yet. Keep up the hard work!
        </div>
      ) : (
        <div className="w-full max-w-4xl overflow-x-auto">
          <table className="w-full bg-white shadow-lg rounded-lg overflow-hidden min-w-[42rem]">
            <thead>
              <tr className="bg-blue-100 border-b border-blue-200">
                <th className="py-3 px-3 text-left text-blue-900 font-bold w-10" aria-hidden>
                  {""}
                </th>
                <th className="py-3 px-3 text-left text-blue-900 font-bold">Test ID</th>
                <th className="py-3 px-3 text-left text-blue-900 font-bold">Date</th>
                <th className="py-3 px-3 text-left text-blue-900 font-bold">Score</th>
                <th className="py-3 px-3 text-left text-blue-900 font-bold whitespace-nowrap">Full score</th>
                <th className="py-3 px-3 text-left text-blue-900 font-bold">Feedback</th>
              </tr>
            </thead>
            <tbody>
              {groups.flatMap((g) => {
                const isOpen = !!expanded[g.meq_test_id];
                const latest = Math.max(...g.items.map((x) => new Date(x.created_at).getTime()), 0);
                const sumScores = g.items.reduce((acc, x) => acc + x.human_override_score, 0);
                const roundedSum = formatScore(sumScores);
                const fullExamScore = g.exam_full_score;
                const parentRow = (
                  <tr
                    key={g.meq_test_id}
                    className="border-b border-gray-200 bg-white hover:bg-blue-50/40 cursor-pointer"
                    onClick={() => toggleExpand(g.meq_test_id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleExpand(g.meq_test_id);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? "Collapse" : "Expand"} stages for ${g.test_display_id}`}
                  >
                    <td className="py-3 px-2 align-top text-center">{caret(isOpen)}</td>
                    <td className="py-3 px-3 align-top">
                      <div className="font-mono text-sm font-semibold text-gray-900">{g.test_display_id}</div>
                      <div className="text-xs text-gray-600 mt-0.5">{g.test_label}</div>
                      <div className="text-xs text-blue-800 mt-1 font-medium">
                        {g.items.length} graded part{g.items.length === 1 ? "" : "s"} — tap row to {isOpen ? "hide" : "show"}
                      </div>
                    </td>
                    <td className="py-3 px-3 align-top text-gray-600 text-sm">
                      <span className="text-gray-500 text-xs block">Last graded</span>
                      {new Date(latest).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="py-3 px-3 align-top">
                      <span className="inline-block px-3 py-1 rounded-full bg-blue-100 text-blue-950 font-semibold text-sm">
                        {roundedSum} total
                      </span>
                      <span className="block text-xs text-gray-500 mt-1">sum of parts</span>
                    </td>
                    <td className="py-3 px-3 align-top">
                      {fullExamScore != null ? (
                        <>
                          <span className="inline-block px-3 py-1 rounded-full bg-slate-100 text-slate-900 font-semibold text-sm tabular-nums">
                            {formatScore(fullExamScore)}
                          </span>
                          <span className="block text-xs text-gray-500 mt-1">exam maximum</span>
                        </>
                      ) : (
                        <span className="text-gray-400 text-sm">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3 align-top text-sm text-gray-600 italic">
                      {isOpen ? "See each stage below" : "Open the row for stage-by-stage feedback"}
                    </td>
                  </tr>
                );

                const childRows =
                  isOpen ?
                    g.items.map((item) => (
                      <tr
                        key={`${g.meq_test_id}-${item.id}`}
                        className="border-b border-gray-100 bg-slate-50/90"
                      >
                        <td className="py-3 px-2" aria-hidden />
                        <td className="py-3 px-3 text-sm text-gray-800 font-medium">
                          Stage {item.stage_order}
                          {item.item_order > 1 ? (
                            <span className="text-gray-600"> · Part {item.item_order}</span>
                          ) : null}
                        </td>
                        <td className="py-3 px-3 text-gray-600 text-sm">
                          {new Date(item.created_at).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="py-3 px-3">
                          <span className="inline-block px-3 py-1 rounded-full bg-blue-200 text-blue-950 font-semibold text-base tabular-nums">
                            {item.human_override_score}
                          </span>
                        </td>
                        <td className="py-3 px-3 tabular-nums text-sm">
                          {item.max_score != null ? (
                            <span className="inline-block px-3 py-1 rounded-full bg-slate-100 text-slate-900 font-semibold">
                              {formatScore(item.max_score)}
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          {item.ai_rationale_feedback ? (
                            <div className="bg-blue-50 border border-blue-200 rounded px-4 py-3 text-blue-800 text-sm max-w-md break-words shadow-sm">
                              {item.ai_rationale_feedback}
                            </div>
                          ) : (
                            <span className="italic text-gray-400 text-sm">No feedback</span>
                          )}
                        </td>
                      </tr>
                    ))
                  : [];

                return [parentRow, ...childRows];
              })}
            </tbody>
          </table>
          {!anyExpanded ? (
            <p className="text-xs text-gray-500 mt-3 text-center">Tip: click a row to expand all stages for that exam.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
