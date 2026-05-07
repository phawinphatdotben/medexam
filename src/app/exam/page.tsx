"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Historical URL: exams by subject lived here.
 * Practice listings now live under /practice-tests; real tests show on /test-session for students.
 */
function ExamLegacyRedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const q = searchParams.toString();
    router.replace(q ? `/practice-tests?${q}` : "/practice-tests");
  }, [router, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white text-teal-700 font-medium">
      Redirecting to practice tests…
    </div>
  );
}

export default function ExamLobbyRedirectPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-white text-teal-700">
          Loading…
        </div>
      }
    >
      <ExamLegacyRedirectInner />
    </Suspense>
  );
}
