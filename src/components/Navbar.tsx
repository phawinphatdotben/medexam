"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function Navbar() {
  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [roleLoading, setRoleLoading] = useState(true);
  const router = useRouter();

  // Get user and role on mount
  useEffect(() => {
    let mounted = true;

    const fetchRole = async (userId: string | null) => {
      if (!userId) {
        if (mounted) {
          setUserRole(null);
          setRoleLoading(false);
        }
        return;
      }

      setRoleLoading(true);
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle();

      if (mounted) {
        setUserRole(profile?.role ?? null);
        setRoleLoading(false);
      }
    };

    const fetchUserAndRole = async () => {
      setLoading(true);
      const { data } = await supabase.auth.getSession();
      const currentUser = data?.session?.user ?? null;

      if (mounted) {
        setUser(currentUser);
        setLoading(false);
      }

      await fetchRole(currentUser?.id ?? null);
    };

    fetchUserAndRole();

    // Listen for auth changes
    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const sessionUser = session?.user ?? null;
        if (mounted) {
          setUser(sessionUser);
        }

        await fetchRole(sessionUser?.id ?? null);
      }
    );

    return () => {
      mounted = false;
      listener?.subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setUserRole(null);
    router.push("/login");
  };

  return (
    <nav className="w-full bg-white border-b border-gray-100 shadow-sm fixed top-0 left-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between">
        {/* Left: Logo/Title */}
        <a
          href="/"
          className="text-2xl font-bold text-teal-700 tracking-tight hover:text-teal-800 transition"
        >
          Medical Examination Plateform
        </a>
        {/* Center: Navigation Links */}
        <div className="flex-1 flex justify-center">
          {!loading && !roleLoading && user && (
            <div className="flex gap-6">
              {(userRole === "admin" || userRole === "educator" || userRole === "sub_admin") && (
                <a
                  href="/dashboard"
                  className="text-teal-700 hover:text-teal-900 px-2 py-1 font-semibold transition"
                >
                  Staff
                </a>
              )}
              {(userRole === "admin" || userRole === "educator") && (
                <a
                  href="/dashboard/grade"
                  className="text-teal-700 hover:text-teal-900 px-2 py-1 font-semibold transition"
                >
                  Grade
                </a>
              )}
              {userRole === "sub_admin" && (
                <a
                  href="/dashboard/test-assignments"
                  className="text-teal-700 hover:text-teal-900 px-2 py-1 font-semibold transition"
                >
                  Test assignments
                </a>
              )}
              {userRole === "sub_admin" && (
                <a
                  href="/sub-admin"
                  className="text-teal-700 hover:text-teal-900 px-2 py-1 font-semibold transition"
                >
                  Sub-Admin
                </a>
              )}
              {userRole === "admin" && (
                <>
                  <a
                    href="/dashboard/test-assignments"
                    className="text-teal-700 hover:text-teal-900 px-2 py-1 font-semibold transition"
                  >
                    Test assignments
                  </a>
                  <a
                    href="/admin/tests"
                    className="text-teal-700 hover:text-teal-900 px-2 py-1 font-semibold transition"
                  >
                    Admin search
                  </a>
                  <a
                    href="/dashboard/admin/audit"
                    className="text-teal-700 hover:text-teal-900 px-2 py-1 font-semibold transition"
                  >
                    Audit log
                  </a>
                </>
              )}
              <a
                href="/my-grades"
                className="text-teal-700 hover:text-teal-900 px-2 py-1 font-semibold transition"
              >
                My Grades
              </a>
              <a
                href="/subjects"
                className="text-teal-700 hover:text-teal-900 px-2 py-1 font-semibold transition"
              >
                Subjects
              </a>
              <a
                href="/profile"
                className="text-teal-700 hover:text-teal-900 px-2 py-1 font-semibold transition"
              >
                Profile
              </a>
            </div>
          )}
        </div>
        {/* Right: Auth buttons/info */}
        <div className="flex items-center gap-4">
          {loading ? null : user ? (
            <>
              <span className="text-gray-700 font-medium hidden sm:inline">
                {user.email}
              </span>
              <button
                onClick={handleSignOut}
                className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded font-semibold shadow transition"
              >
                Sign Out
              </button>
            </>
          ) : (
            <a
              href="/login"
              className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded font-semibold shadow transition"
            >
              Login
            </a>
          )}
        </div>
      </div>
    </nav>
  );
}