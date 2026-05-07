"use client";

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function PendingApprovalPage() {
  const router = useRouter();

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white px-4">
      <div className="max-w-lg w-full border border-amber-200 bg-amber-50 rounded-xl shadow-sm p-8 text-center">
        <h1 className="text-2xl font-bold text-amber-900 mb-2">Waiting for Administration Approval</h1>
        <p className="text-amber-900/90">
          Your staff registration request is pending. You will get staff access automatically after an administrator approves your account.
        </p>
        <button
          type="button"
          onClick={signOut}
          className="mt-6 bg-amber-700 text-white font-semibold px-6 py-2 rounded-lg hover:bg-amber-800"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

