"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/auth/AuthProvider";

interface GradedResponse {
  id: string;
  created_at: string;
  human_override_score: number | null;
  ai_rationale_feedback: string | null;
  test_label: string;
}

export default function MyGrades() {
  const { user, loading: authLoading } = useAuth();
  const [gradedResponses, setGradedResponses] = useState<GradedResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [userError, setUserError] = useState<string | null>(null);

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
          meq_test_stages!inner(
            meq_test_id,
            meq_tests!inner( subject, course_code )
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
        meq_test_stages: {
          meq_test_id: string;
          meq_tests: { subject: string; course_code: string };
        };
      };

      const flattened: GradedResponse[] = ((data as unknown as Row[] | null) || []).map((res) => {
        const t = res.meq_test_stages.meq_tests;
        return {
          id: res.id,
          created_at: res.created_at,
          human_override_score: res.human_override_score,
          ai_rationale_feedback: res.ai_rationale_feedback,
          test_label: `${t.subject} (${t.course_code}) — stage`,
        };
      });

      flattened.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      if (mounted) {
        setGradedResponses(flattened);
        setLoading(false);
      }
    };

    void fetchGrades();

    return () => {
      mounted = false;
    };
  }, [authLoading, user?.id]);

  return (
    <div className="flex flex-col items-center min-h-screen bg-white pt-20 pb-10 px-4">
      <h1 className="text-3xl font-bold text-blue-800 mb-8 text-center tracking-tight">
        My examination results
      </h1>

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
        <div className="bg-red-100 text-red-700 px-6 py-4 rounded shadow mt-8 font-semibold">
          {userError}
        </div>
      ) : gradedResponses.length === 0 ? (
        <div className="mt-16 bg-yellow-50 border border-yellow-200 text-yellow-800 px-8 py-6 rounded-lg shadow text-lg text-center font-semibold">
          You have not received any MEQ stage grades yet. Keep up the hard work!
        </div>
      ) : (
        <div className="w-full max-w-3xl">
          <table className="w-full bg-white shadow-lg rounded-lg overflow-hidden">
            <thead>
              <tr className="bg-blue-100 border-b border-blue-200">
                <th className="py-3 px-4 text-left text-blue-900 font-bold">Test</th>
                <th className="py-3 px-4 text-left text-blue-900 font-bold">Date</th>
                <th className="py-3 px-4 text-left text-blue-900 font-bold">Score</th>
                <th className="py-3 px-4 text-left text-blue-900 font-bold">Feedback</th>
              </tr>
            </thead>
            <tbody>
              {gradedResponses.map((resp) => (
                <tr key={resp.id} className="border-b last:border-0 hover:bg-blue-100/20">
                  <td className="py-3 px-4 font-medium text-gray-900">{resp.test_label}</td>
                  <td className="py-3 px-4 text-gray-600">
                    {new Date(resp.created_at).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="py-3 px-4">
                    {resp.human_override_score !== null ? (
                      <span className="inline-block px-3 py-1 rounded-full bg-blue-200 text-blue-950 font-semibold text-base">
                        {resp.human_override_score}
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {resp.ai_rationale_feedback ? (
                      <div className="bg-blue-50 border border-blue-200 rounded px-4 py-3 text-blue-800 text-base max-w-xs break-words shadow-sm">
                        {resp.ai_rationale_feedback}
                      </div>
                    ) : (
                      <span className="italic text-gray-400">No feedback</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
