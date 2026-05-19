"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  EXAM_MONITOR_ROLES,
  GRADING_ROLES,
  isRoleAllowed,
  STAFF_DASHBOARD_ROLES,
} from "@/lib/auth/roles";
import { isRealExamSessionActive } from "@/lib/exam/realTestLock";

type NavItem = {
  href: string;
  label: string;
  /** Highlight when this matches current route */
  isActive: (pathname: string) => boolean;
};

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, profile, loading } = useAuth();
  const userRole = profile?.role ?? null;
  const showNavLinks = !loading && !!user;
  const canStaffDashboard = isRoleAllowed(userRole, STAFF_DASHBOARD_ROLES);
  const canGrade = isRoleAllowed(userRole, GRADING_ROLES);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hideForRealExam, setHideForRealExam] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => setHideForRealExam(isRealExamSessionActive());
    sync();
    window.addEventListener("meq-real-exam-session-change", sync);
    return () => window.removeEventListener("meq-real-exam-session-change", sync);
  }, []);

  const items = useMemo((): NavItem[] => {
    const out: NavItem[] = [];
    if (canStaffDashboard) {
      out.push({
        href: "/dashboard",
        label: "Staff",
        isActive: (p) => p === "/dashboard",
      });
    }
    if (canGrade && userRole !== "sub_admin") {
      out.push({
        href: "/dashboard/grade",
        label: "Grade",
        isActive: (p) => p.startsWith("/dashboard/grade"),
      });
    }
    if (isRoleAllowed(userRole, EXAM_MONITOR_ROLES)) {
      out.push({
        href: "/dashboard/exam-monitor",
        label: "Exam monitor",
        isActive: (p) => p.startsWith("/dashboard/exam-monitor"),
      });
    }
    if (userRole === "sub_admin") {
      out.push({
        href: "/dashboard/test-assignments",
        label: "Test assignments",
        isActive: (p) => p.startsWith("/dashboard/test-assignments"),
      });
      out.push({
        href: "/sub-admin",
        label: "Sub-Admin",
        isActive: (p) => p.startsWith("/sub-admin"),
      });
    }
    if (userRole === "admin") {
      out.push({
        href: "/dashboard/test-assignments",
        label: "Test assignments",
        isActive: (p) => p.startsWith("/dashboard/test-assignments"),
      });
      out.push({
        href: "/admin/tests",
        label: "Admin search",
        isActive: (p) => p.startsWith("/admin/tests"),
      });
      out.push({
        href: "/dashboard/admin/audit",
        label: "Audit log",
        isActive: (p) => p.startsWith("/dashboard/admin/audit"),
      });
    }
    out.push({
      href: "/my-grades",
      label: "My Grades",
      isActive: (p) => p.startsWith("/my-grades"),
    });
    if (userRole === "student") {
      out.push({
        href: "/practice-tests",
        label: "Practice tests",
        isActive: (p) => p.startsWith("/practice-tests"),
      });
      out.push({
        href: "/test-taking",
        label: "Test taking",
        isActive: (p) => p.startsWith("/test-taking") || p.startsWith("/test-session"),
      });
    }
    out.push({
      href: "/subjects",
      label: "Subjects",
      isActive: (p) => p.startsWith("/subjects"),
    });
    out.push({
      href: "/profile",
      label: "Profile",
      isActive: (p) => p.startsWith("/profile"),
    });
    return out;
  }, [canStaffDashboard, canGrade, userRole]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
      const t = window.setTimeout(() => {
        panelRef.current?.querySelector<HTMLElement>("a[href]")?.focus();
      }, 50);
      return () => {
        window.clearTimeout(t);
        document.body.style.overflow = "";
      };
    }
    document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const handleSignOut = async () => {
    setMobileOpen(false);
    await supabase.auth.signOut();
    router.push("/login");
  };

  const desktopLinkClass = (active: boolean) =>
    [
      "rounded-md px-2.5 py-1.5 font-semibold transition whitespace-nowrap",
      active
        ? "bg-blue-100 text-blue-950 ring-1 ring-blue-200"
        : "text-blue-800 hover:text-blue-950 hover:bg-blue-50/80",
    ].join(" ");

  const mobileLinkClass = (active: boolean) =>
    [
      "flex min-h-[48px] items-center w-full text-left px-4 text-[15px] font-semibold border-b border-gray-100 transition active:bg-blue-100",
      active ? "bg-blue-50 text-blue-950 border-l-4 border-l-blue-800 pl-3" : "text-blue-900 hover:bg-blue-50/90",
    ].join(" ");

  const menuBtnClass =
    "xl:hidden inline-flex items-center justify-center rounded-lg border-2 border-blue-900 bg-white p-3 text-blue-900 shadow-sm hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 shrink-0 touch-manipulation";

  const showDrawer = showNavLinks && mobileOpen;

  if (hideForRealExam) {
    return null;
  }

  return (
    <nav
      className="w-full bg-white/95 backdrop-blur-sm border-b border-gray-100 shadow-sm fixed top-0 left-0 z-30"
      aria-label="Main"
    >
      <div className="max-w-7xl mx-auto px-3 sm:px-6 h-[4rem] min-h-[4rem] flex items-center gap-2 sm:gap-3">
        {/* Title: truncates; never steals space from the menu + actions on the right */}
        <a
          href="/"
          className="text-[15px] sm:text-lg xl:text-xl font-bold text-blue-900 tracking-tight hover:text-blue-950 transition min-w-0 flex-1 truncate xl:max-w-[min(340px,40vw)] 2xl:max-w-md"
        >
          Medical Examination Platform
        </a>

        <div className="hidden xl:flex flex-1 min-w-0 items-center justify-center gap-x-1 gap-y-2 text-sm flex-wrap px-2 py-1">
          {showNavLinks &&
            items.map((item) => (
              <a key={item.href + item.label} href={item.href} className={desktopLinkClass(item.isActive(pathname))}>
                {item.label}
              </a>
            ))}
        </div>

        {/* Menu stays beside Sign out so it cannot be pushed off-screen by a long title */}
        <div className="flex items-center gap-2 shrink-0">
          {showNavLinks && (
            <button
              type="button"
              className={menuBtnClass}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav-menu"
              aria-haspopup="dialog"
              aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
              onClick={() => setMobileOpen((o) => !o)}
            >
              {mobileOpen ? (
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          )}
          {loading ? null : user ? (
            <>
              <span
                className="text-gray-600 text-sm font-medium hidden 2xl:inline max-w-[200px] truncate"
                title={user.email}
              >
                {user.email}
              </span>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="bg-blue-900 hover:bg-blue-950 active:bg-blue-950 text-white px-3 py-2.5 rounded-lg font-semibold shadow-md transition text-sm whitespace-nowrap touch-manipulation min-h-[44px] min-w-[88px]"
              >
                Sign Out
              </button>
            </>
          ) : (
            <a
              href="/login"
              className="bg-blue-900 hover:bg-blue-950 text-white px-3 py-2.5 rounded-lg font-semibold shadow-md transition text-sm min-h-[44px] inline-flex items-center"
            >
              Login
            </a>
          )}
        </div>
      </div>

      {showDrawer && (
        <>
          <button
            type="button"
            className="xl:hidden fixed inset-0 top-16 z-40 bg-black/45 backdrop-blur-[1px] transition-opacity"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
          <div
            ref={panelRef}
            id="mobile-nav-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="xl:hidden fixed left-0 right-0 top-16 z-50 max-h-[min(calc(100dvh-4rem),640px)] overflow-y-auto overscroll-contain bg-white border-b border-gray-200 shadow-xl ring-1 ring-black/5 motion-safe:transition-[opacity,transform] motion-safe:duration-150"
          >
            <div className="max-w-7xl mx-auto px-3 pt-3 pb-2 border-b border-gray-100 bg-slate-50/90">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Signed in</p>
              <p className="text-sm text-slate-900 font-medium truncate mt-0.5" title={user.email ?? undefined}>
                {user.email}
              </p>
              {profile?.role && (
                <p className="text-xs text-slate-600 mt-1 capitalize">
                  Role: {profile.role.replace(/_/g, " ")}
                </p>
              )}
            </div>
            <nav className="max-w-7xl mx-auto py-1" aria-label="Mobile pages">
              {items.map((item) => (
                <a
                  key={item.href + item.label}
                  href={item.href}
                  className={mobileLinkClass(item.isActive(pathname))}
                  onClick={() => setMobileOpen(false)}
                >
                  {item.label}
                </a>
              ))}
            </nav>
            <div className="max-w-7xl mx-auto px-3 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-gray-100 bg-slate-50/50">
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="w-full min-h-[48px] rounded-lg bg-blue-900 hover:bg-blue-950 text-white font-semibold text-[15px] shadow-md touch-manipulation"
              >
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </nav>
  );
}
