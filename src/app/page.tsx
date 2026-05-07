"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getLandingPathForProfile } from "@/lib/role-routing";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    const bootstrap = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user;
      if (!mounted) return;

      if (!user) {
        router.replace("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role, approval_status, requested_role")
        .eq("id", user.id)
        .maybeSingle();

      if (!mounted) return;
      router.replace(
        getLandingPathForProfile({
          role: profile?.role ?? "student",
          approval_status: profile?.approval_status ?? "approved",
          requested_role: profile?.requested_role ?? null,
        })
      );
    };

    void bootstrap();
    return () => {
      mounted = false;
    };
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <span className="text-teal-700 text-lg font-semibold">Loading...</span>
    </div>
  );
}
