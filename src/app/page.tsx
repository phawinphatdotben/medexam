"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { getLandingPathForProfile } from "@/lib/role-routing";

export default function Home() {
  const router = useRouter();
  const { user, profile, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    try {
      if (!user) {
        router.replace("/login");
        return;
      }
      if (!profile) {
        router.replace("/login");
        return;
      }
      router.replace(getLandingPathForProfile(profile));
    } catch {
      router.replace("/login");
    }
  }, [loading, user, profile, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <span className="text-teal-700 text-lg font-semibold">Loading...</span>
    </div>
  );
}
