"use client";

import type { User } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/lib/supabase";
import type { AppRole, ApprovalStatus } from "@/lib/role-routing";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";

/** Profile fields loaded once per session for routing and nav. */
export type AuthProfile = {
  role: AppRole;
  approval_status: ApprovalStatus;
  requested_role: string | null;
  medical_student_year: number | null;
};
type AuthProfileRow = {
  role: string | null;
  approval_status: string | null;
  requested_role: string | null;
  medical_student_year: number | null;
};

type AuthContextValue = {
  user: User | null;
  profile: AuthProfile | null;
  loading: boolean;
  /** Reload session + profile; returns the profile row (or null). */
  refresh: () => Promise<AuthProfile | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const id = setTimeout(() => {
        clearTimeout(id);
        reject(new Error(`${label} timeout`));
      }, ms);
    }),
  ]);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<AuthProfile | null> => {
    setLoading(true);
    try {
      const {
        data: { session },
      } = await withTimeout(supabase.auth.getSession(), 8000, "auth.getSession");
      const u = session?.user ?? null;
      setUser(u);
      if (!u) {
        setProfile(null);
        return null;
      }
      const profileRes = await withTimeout<PostgrestSingleResponse<AuthProfileRow | null>>(
        supabase
          .from("profiles")
          .select("role, approval_status, requested_role, medical_student_year")
          .eq("id", u.id)
          .maybeSingle(),
        8000,
        "profiles.select",
      );
      const { data: row, error } = profileRes;
      if (error || !row) {
        setProfile(null);
        return null;
      }
      const next: AuthProfile = {
        role: (row.role ?? "student") as AppRole,
        approval_status: (row.approval_status ?? "approved") as ApprovalStatus,
        requested_role: row.requested_role ?? null,
        medical_student_year: row.medical_student_year ?? null,
      };
      setProfile(next);
      return next;
    } catch {
      // Fail closed to prevent permanent loading spinners when network/auth hangs.
      setUser(null);
      setProfile(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void refresh();
    });
    return () => subscription.unsubscribe();
  }, [refresh]);

  const value = useMemo(
    () => ({ user, profile, loading, refresh }),
    [user, profile, loading, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>.");
  }
  return ctx;
}
