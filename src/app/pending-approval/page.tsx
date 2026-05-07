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
      <div className="max-w-lg w-full border border-orange-300 bg-orange-100 rounded-xl shadow-sm p-8 text-center">
        <h1 className="text-2xl font-bold text-orange-950 mb-2">Waiting for Administration Approval</h1>
        <p className="text-orange-950/90">
          Your staff registration request is pending. You will get staff access automatically after an administrator approves your account.
        </p>
        <button
          type="button"
          onClick={signOut}
          className="mt-6 bg-orange-800 text-white font-semibold px-6 py-2 rounded-lg hover:bg-orange-900"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

