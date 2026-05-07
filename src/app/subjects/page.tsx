"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { SUBJECTS } from "@/lib/subjects";
import { getLandingPathForProfile } from "@/lib/role-routing";

export default function SubjectSelectionPage() {
  const [checking, setChecking] = useState(true);
  const [authTimedOut, setAuthTimedOut] = useState(false);
  const router = useRouter();
  const { user, profile, loading } = useAuth();

  useEffect(() => {
    if (!loading) {
      setAuthTimedOut(false);
      return;
    }
    const timer = setTimeout(() => {
      setAuthTimedOut(true);
    }, 9000);
    return () => clearTimeout(timer);
  }, [loading]);

  useEffect(() => {
    if (loading) return;
    if (!user || !profile) {
      router.replace("/login");
      return;
    }
    const next = getLandingPathForProfile(profile);
    if (next !== "/subjects") {
      router.replace(next);
      return;
    }
    setChecking(false);
  }, [loading, user, profile, router]);

  if (authTimedOut) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white px-4 text-center">
        <p className="text-teal-800 text-lg font-semibold">Still checking your session…</p>
        <p className="text-gray-600 text-sm mt-2 max-w-md">
          The connection to auth is taking too long. You can retry login or continue to practice tests.
        </p>
        <div className="mt-5 flex items-center gap-3">
          <Link href="/login" className="px-4 py-2 rounded bg-teal-700 text-white font-semibold">
            Re-login
          </Link>
          <Link href="/practice-tests" className="px-4 py-2 rounded border border-teal-300 text-teal-800 font-semibold">
            Open practice tests
          </Link>
        </div>
      </div>
    );
  }

  if (loading || checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <span className="text-teal-700 text-lg font-semibold">Checking account...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="w-full border-b border-gray-200 px-6 py-6 shadow-sm">
        <h1 className="text-3xl font-bold text-teal-700 tracking-tight">
          Choose Subject
        </h1>
        <p className="text-gray-600 mt-2">
          Select a subject area, then browse committee-approved{" "}
          <span className="font-medium text-teal-800">practice tests</span> or open your assigned{" "}
          <span className="font-medium text-teal-800">test session</span>.
        </p>
      </header>

      <main className="flex-1 w-full max-w-4xl mx-auto mt-8 px-4 pb-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {SUBJECTS.map((subject) => (
            <Link
              key={subject}
              href={`/practice-tests?subject=${encodeURIComponent(subject)}`}
              className="block rounded-xl border border-teal-200 bg-teal-50 hover:bg-teal-100 px-5 py-4 shadow-sm transition"
            >
              <span className="text-teal-900 font-semibold">{subject}</span>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
