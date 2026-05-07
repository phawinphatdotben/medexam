"use client";

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/auth/AuthProvider";
import { GRADING_ROLES, isRoleAllowed, STAFF_DASHBOARD_ROLES } from "@/lib/auth/roles";

export default function Navbar() {
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  const userRole = profile?.role ?? null;
  const showNavLinks = !loading && !!user;
  const canStaffDashboard = isRoleAllowed(userRole, STAFF_DASHBOARD_ROLES);
  const canGrade = isRoleAllowed(userRole, GRADING_ROLES);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <nav className="w-full bg-white border-b border-gray-100 shadow-sm fixed top-0 left-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between">
        <a
          href="/"
          className="text-2xl font-bold text-blue-800 tracking-tight hover:text-blue-900 transition"
        >
          Medical Examination Plateform
        </a>
        <div className="flex-1 flex justify-center">
          {showNavLinks && (
            <div className="flex gap-6">
              {canStaffDashboard && (
                <a href="/dashboard" className="text-blue-800 hover:text-blue-950 px-2 py-1 font-semibold transition">
                  Staff
                </a>
              )}
              {canGrade && userRole !== "sub_admin" && (
                <a href="/dashboard/grade" className="text-blue-800 hover:text-blue-950 px-2 py-1 font-semibold transition">
                  Grade
                </a>
              )}
              {userRole === "sub_admin" && (
                <a
                  href="/dashboard/test-assignments"
                  className="text-blue-800 hover:text-blue-950 px-2 py-1 font-semibold transition"
                >
                  Test assignments
                </a>
              )}
              {userRole === "sub_admin" && (
                <a href="/sub-admin" className="text-blue-800 hover:text-blue-950 px-2 py-1 font-semibold transition">
                  Sub-Admin
                </a>
              )}
              {userRole === "admin" && (
                <>
                  <a
                    href="/dashboard/test-assignments"
                    className="text-blue-800 hover:text-blue-950 px-2 py-1 font-semibold transition"
                  >
                    Test assignments
                  </a>
                  <a href="/admin/tests" className="text-blue-800 hover:text-blue-950 px-2 py-1 font-semibold transition">
                    Admin search
                  </a>
                  <a href="/dashboard/admin/audit" className="text-blue-800 hover:text-blue-950 px-2 py-1 font-semibold transition">
                    Audit log
                  </a>
                </>
              )}
              <a href="/my-grades" className="text-blue-800 hover:text-blue-950 px-2 py-1 font-semibold transition">
                My Grades
              </a>
              {userRole === "student" && (
                <>
                  <a
                    href="/practice-tests"
                    className="text-blue-800 hover:text-blue-950 px-2 py-1 font-semibold transition"
                  >
                    Practice tests
                  </a>
                  <a
                    href="/test-session"
                    className="text-blue-800 hover:text-blue-950 px-2 py-1 font-semibold transition"
                  >
                    Test session
                  </a>
                </>
              )}
              <a href="/subjects" className="text-blue-800 hover:text-blue-950 px-2 py-1 font-semibold transition">
                Subjects
              </a>
              <a href="/profile" className="text-blue-800 hover:text-blue-950 px-2 py-1 font-semibold transition">
                Profile
              </a>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4">
          {loading ? null : user ? (
            <>
              <span className="text-gray-700 font-medium hidden sm:inline">{user.email}</span>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="bg-blue-900 hover:bg-blue-800 text-white px-4 py-2 rounded font-semibold shadow transition"
              >
                Sign Out
              </button>
            </>
          ) : (
            <a href="/login" className="bg-blue-900 hover:bg-blue-800 text-white px-4 py-2 rounded font-semibold shadow transition">
              Login
            </a>
          )}
        </div>
      </div>
    </nav>
  );
}
