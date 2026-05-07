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
  const navLinkClass =
    "text-blue-800 hover:text-blue-950 px-2 py-1 font-semibold transition whitespace-nowrap";

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <nav className="w-full bg-white border-b border-gray-100 shadow-sm fixed top-0 left-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
        <a
          href="/"
          className="text-lg sm:text-xl font-bold text-blue-800 tracking-tight hover:text-blue-900 transition whitespace-nowrap shrink-0"
        >
          Medical Examination Plateform
        </a>
        <div className="flex-1 min-w-0 overflow-x-auto">
          {showNavLinks && (
            <div className="flex items-center justify-center gap-4 text-sm min-w-max px-2">
              {canStaffDashboard && (
                <a href="/dashboard" className={navLinkClass}>
                  Staff
                </a>
              )}
              {canGrade && userRole !== "sub_admin" && (
                <a href="/dashboard/grade" className={navLinkClass}>
                  Grade
                </a>
              )}
              {userRole === "sub_admin" && (
                <a
                  href="/dashboard/test-assignments"
                  className={navLinkClass}
                >
                  Test assignments
                </a>
              )}
              {userRole === "sub_admin" && (
                <a href="/sub-admin" className={navLinkClass}>
                  Sub-Admin
                </a>
              )}
              {userRole === "admin" && (
                <>
                  <a
                    href="/dashboard/test-assignments"
                    className={navLinkClass}
                  >
                    Test assignments
                  </a>
                  <a href="/admin/tests" className={navLinkClass}>
                    Admin search
                  </a>
                  <a href="/dashboard/admin/audit" className={navLinkClass}>
                    Audit log
                  </a>
                </>
              )}
              <a href="/my-grades" className={navLinkClass}>
                My Grades
              </a>
              {userRole === "student" && (
                <>
                  <a
                    href="/practice-tests"
                    className={navLinkClass}
                  >
                    Practice tests
                  </a>
                  <a
                    href="/test-session"
                    className={navLinkClass}
                  >
                    Test session
                  </a>
                </>
              )}
              <a href="/subjects" className={navLinkClass}>
                Subjects
              </a>
              <a href="/profile" className={navLinkClass}>
                Profile
              </a>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {loading ? null : user ? (
            <>
              <span className="text-gray-700 font-medium hidden xl:inline max-w-[220px] truncate">{user.email}</span>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="bg-blue-900 hover:bg-blue-800 text-white px-3 py-2 rounded font-semibold shadow transition"
              >
                Sign Out
              </button>
            </>
          ) : (
            <a href="/login" className="bg-blue-900 hover:bg-blue-800 text-white px-3 py-2 rounded font-semibold shadow transition">
              Login
            </a>
          )}
        </div>
      </div>
    </nav>
  );
}
