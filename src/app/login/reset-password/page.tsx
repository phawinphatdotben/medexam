"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setRecovery(true);
      }
    });

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setRecovery(true);
      }
    });

    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (hash.includes("type=recovery") || hash.includes("access_token")) {
      setRecovery(true);
    }

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    setDone(true);
    await supabase.auth.signOut();
    setTimeout(() => router.replace("/login"), 2000);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-blue-50 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg px-8 py-10">
        <h1 className="text-2xl font-bold text-teal-800 mb-2">Set new password</h1>
        {!recovery && !done ? (
          <p className="text-sm text-gray-600 mb-4">
            Open the link from your reset email (it must point to this page). If you already clicked the email, wait a
            moment or{" "}
            <Link href="/login/forgot-password" className="text-teal-700 underline">
              request a new link
            </Link>
            .
          </p>
        ) : null}
        {done ? (
          <p className="text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2 text-sm">
            Password updated. Redirecting to login…
          </p>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="space-y-4">
            <div>
              <label htmlFor="np" className="block text-gray-700 font-medium mb-1">
                New password
              </label>
              <input
                id="np"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                className="block w-full border border-gray-300 rounded px-4 py-3 outline-none focus:ring-2 focus:ring-teal-200"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            <div>
              <label htmlFor="npc" className="block text-gray-700 font-medium mb-1">
                Confirm new password
              </label>
              <input
                id="npc"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                className="block w-full border border-gray-300 rounded px-4 py-3 outline-none focus:ring-2 focus:ring-teal-200"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={loading}
              />
            </div>
            {error ? (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
            ) : null}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3 rounded disabled:opacity-60"
            >
              {loading ? "Saving…" : "Update password"}
            </button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-gray-600">
          <Link href="/login" className="text-teal-700 font-semibold hover:underline">
            Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}
