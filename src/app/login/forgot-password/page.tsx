"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${origin}/login/reset-password`,
    });
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    setMessage(
      "If an account exists for that email, you will receive a link to reset your password. " +
        "Add this site to Supabase Auth → URL Configuration → Redirect URLs if links fail."
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-100 to-blue-50 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg px-8 py-10">
        <h1 className="text-2xl font-bold text-blue-900 mb-2">Forgot password</h1>
        <p className="text-sm text-gray-600 mb-6">
          Enter your email and we will send you a link to choose a new password.
        </p>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-gray-700 font-medium mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              className="block w-full border border-gray-300 rounded px-4 py-3 outline-none focus:ring-2 focus:ring-blue-300"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
          </div>
          {error ? (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
          ) : null}
          {message ? (
            <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">{message}</div>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-900 hover:bg-blue-800 text-white font-semibold py-3 rounded disabled:opacity-60"
          >
            {loading ? "Sending…" : "Send reset link"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-gray-600">
          <Link href="/login" className="text-blue-800 font-semibold hover:underline">
            Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}
