"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { isRoleAllowed } from "@/lib/auth/roles";

type RoleGateOptions = {
  /** When not signed in (default `/login`). */
  noUserRedirect?: string;
  /** When signed in but role not in `allowedRoles` (required). */
  wrongRoleRedirect: string;
};

/**
 * Redirects unless auth is resolved and profile role is allowed.
 */
export function useRoleGate(
  allowedRoles: readonly string[],
  { noUserRedirect = "/login", wrongRoleRedirect }: RoleGateOptions,
) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  const role = profile?.role ?? null;
  const rolesKey = useMemo(() => allowedRoles.join(","), [allowedRoles]);

  const ready =
    !loading &&
    !!user &&
    !!role &&
    isRoleAllowed(role, allowedRoles);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace(noUserRedirect);
      return;
    }
    if (!isRoleAllowed(role, allowedRoles)) {
      router.replace(wrongRoleRedirect);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rolesKey fingerprints `allowedRoles`
  }, [loading, user, role, router, noUserRedirect, wrongRoleRedirect, rolesKey]);

  return {
    ready,
    loading,
    user,
    profile,
    userId: user?.id ?? null,
    role,
  };
}
