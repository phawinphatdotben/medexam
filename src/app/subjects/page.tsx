"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { SUBJECTS } from "@/lib/subjects";
import { getLandingPathForProfile } from "@/lib/role-routing";

export default function SubjectSelectionPage() {
  const [checking, setChecking] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.user) {
        router.replace("/login");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, approval_status, requested_role")
        .eq("id", data.session.user.id)
        .maybeSingle();
      const next = getLandingPathForProfile({
        role: profile?.role ?? "student",
        approval_status: profile?.approval_status ?? "approved",
        requested_role: profile?.requested_role ?? null,
      });
      if (next !== "/subjects") {
        router.replace(next);
        return;
      }
      setChecking(false);
    };

    checkSession();
  }, [router]);

  if (checking) {
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
          Select a subject area, then start your SBA or MEQ questions.
        </p>
      </header>

      <main className="flex-1 w-full max-w-4xl mx-auto mt-8 px-4 pb-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {SUBJECTS.map((subject) => (
            <Link
              key={subject}
              href={`/exam?subject=${encodeURIComponent(subject)}`}
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
