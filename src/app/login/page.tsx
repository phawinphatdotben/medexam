"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getLandingPathForProfile } from "@/lib/role-routing";

export default function AuthPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [signupRole, setSignupRole] = useState<"student" | "staff">("student");
  const [studentYear, setStudentYear] = useState("1");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const router = useRouter();

  const routeByRole = useCallback(async (userId: string) => {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, approval_status, requested_role")
      .eq("id", userId)
      .maybeSingle();
    const next = getLandingPathForProfile({
      role: profile?.role ?? "student",
      approval_status: profile?.approval_status ?? "approved",
      requested_role: profile?.requested_role ?? null,
    });
    router.replace(next);
  }, [router]);

  useEffect(() => {
    const checkExistingSession = async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) return;
      await routeByRole(user.id);
    };
    void checkExistingSession();
  }, [routeByRole]);

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      if (mode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        if (data.user) {
          await routeByRole(data.user.id);
        } else {
          router.replace("/subjects");
        }
      } else {
        if (password !== confirmPassword) {
          setError("Passwords do not match.");
          setLoading(false);
          return;
        }
        // signup mode
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              // Keep DB role as student by default; staff requests must be approved by admin.
              role: "student",
              requested_role: signupRole === "staff" ? "educator" : "student",
              profile_year: signupRole === "student" ? studentYear : null,
              medical_student_year: signupRole === "student" ? Number(studentYear) : null,
            },
          },
        });
        if (error) throw error;
        // Optionally auto-login after signup:
        if (!data.user) {
          setError(
            "Account created! Please check your email for confirmation, then log in."
          );
        } else {
          if (signupRole === "staff") {
            await supabase.auth.signOut();
            setMode("login");
            setPassword("");
            setConfirmPassword("");
            setNotice("Staff registration submitted. Please wait for administration approval.");
          } else {
            await routeByRole(data.user.id);
          }
        }
      }
    } catch (err: unknown) {
      const raw =
        err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string"
          ? (err as { message: string }).message
          : "Authentication failed. Please try again.";
      if (
        raw.includes("Failed to execute 'fetch'") ||
        raw.includes("Invalid value") ||
        raw.includes("NEXT_PUBLIC_SUPABASE")
      ) {
        setError(
          "App cannot reach Supabase. In Vercel → your project → Settings → Environment Variables, set NEXT_PUBLIC_SUPABASE_URL (https://….supabase.co) and NEXT_PUBLIC_SUPABASE_ANON_KEY, save, then Redeploy. No quotes around values."
        );
      } else {
        setError(raw);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-blue-50">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg px-10 py-10">
        <div className="flex mb-8">
          <button
            className={`flex-1 py-2 font-semibold text-lg rounded-l-2xl border-r focus:outline-none ${
              mode === "login"
                ? "text-teal-700 bg-teal-50"
                : "text-gray-400 bg-white"
            }`}
            onClick={() => {
              setMode("login");
              setError(null);
            }}
            type="button"
            disabled={loading}
          >
            Login
          </button>
          <button
            className={`flex-1 py-2 font-semibold text-lg rounded-r-2xl focus:outline-none ${
              mode === "signup"
                ? "text-teal-700 bg-teal-50"
                : "text-gray-400 bg-white"
            }`}
            onClick={() => {
              setMode("signup");
              setError(null);
            }}
            type="button"
            disabled={loading}
          >
            Create Account
          </button>
        </div>
        <form className="space-y-6" onSubmit={handleAuth}>
          <div>
            <label className="block text-gray-700 font-medium mb-1" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              className="block w-full border border-gray-300 rounded px-4 py-3 text-lg focus:ring-2 focus:ring-teal-200 shadow-sm outline-none"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              disabled={loading}
            />
          </div>
          <div>
            <div className="flex justify-between items-end mb-1">
              <label className="block text-gray-700 font-medium" htmlFor="password">
                Password
              </label>
              {mode === "login" ? (
                <a
                  href="/login/forgot-password"
                  className="text-sm text-teal-700 font-semibold hover:underline"
                >
                  Forgot password?
                </a>
              ) : null}
            </div>
            <input
              id="password"
              name="password"
              className="block w-full border border-gray-300 rounded px-4 py-3 text-lg focus:ring-2 focus:ring-teal-200 shadow-sm outline-none"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              disabled={loading}
            />
          </div>
          {mode === "signup" && (
            <div>
              <label className="block text-gray-700 font-medium mb-1" htmlFor="signup-role">
                Role
              </label>
              <select
                id="signup-role"
                name="signup-role"
                className="block w-full border border-gray-300 rounded px-4 py-3 text-lg focus:ring-2 focus:ring-teal-200 shadow-sm outline-none bg-white"
                value={signupRole}
                onChange={(e) => setSignupRole(e.target.value as "student" | "staff")}
                disabled={loading}
              >
                <option value="student">Student</option>
                <option value="staff">Staff</option>
              </select>
            </div>
          )}
          {mode === "signup" && signupRole === "student" && (
            <div>
              <label className="block text-gray-700 font-medium mb-1" htmlFor="student-year">
                Year of medical student
              </label>
              <select
                id="student-year"
                name="student-year"
                className="block w-full border border-gray-300 rounded px-4 py-3 text-lg focus:ring-2 focus:ring-teal-200 shadow-sm outline-none bg-white"
                value={studentYear}
                onChange={(e) => setStudentYear(e.target.value)}
                disabled={loading}
              >
                {[1, 2, 3, 4, 5, 6, 7].map((y) => (
                  <option key={y} value={String(y)}>
                    Year {y}
                  </option>
                ))}
              </select>
            </div>
          )}
          {mode === "signup" && (
            <div>
              <label className="block text-gray-700 font-medium mb-1" htmlFor="confirm-password">
                Confirm Password
              </label>
              <input
                id="confirm-password"
                name="confirm-password"
                className="block w-full border border-gray-300 rounded px-4 py-3 text-lg focus:ring-2 focus:ring-teal-200 shadow-sm outline-none"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required={mode === "signup"}
                autoComplete="new-password"
                disabled={loading}
              />
            </div>
          )}
          {notice && (
            <div className="bg-blue-50 border border-blue-300 rounded px-4 py-3 text-blue-700 text-sm">
              {notice}
            </div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-300 rounded px-4 py-3 text-red-700 text-sm">{error}</div>
          )}
          <button
            type="submit"
            className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold text-lg py-4 rounded transition disabled:opacity-60 disabled:cursor-not-allowed shadow"
            disabled={loading}
          >
            {loading
              ? mode === "login"
                ? "Signing In..."
                : "Creating Account..."
              : mode === "login"
              ? "Sign In"
              : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}