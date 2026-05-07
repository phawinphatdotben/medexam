"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type ProfileInfo = {
  id: string;
  email: string;
  full_name: string | null;
  profile_year: string | null;
  staff_id: string | null;
  student_id: string | null;
  medical_student_year: number | null;
  role: string;
  approval_status: string | null;
  requested_role: string | null;
  institution: string | null;
};

const EMPTY_NEW_FIELDS: Pick<
  ProfileInfo,
  "full_name" | "profile_year" | "staff_id" | "student_id" | "medical_student_year"
> = {
  full_name: null,
  profile_year: null,
  staff_id: null,
  student_id: null,
  medical_student_year: null,
};

const EMPTY_APPROVAL_FIELDS: Pick<ProfileInfo, "approval_status" | "requested_role"> = {
  approval_status: "approved",
  requested_role: null,
};

export default function ProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileInfo | null>(null);
  const [hasExtendedColumns, setHasExtendedColumns] = useState(true);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwNotice, setPwNotice] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);

      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) {
        router.replace("/login");
        return;
      }

      const { data, error: pErr } = await supabase
        .from("profiles")
        .select("id, email, full_name, profile_year, staff_id, student_id, medical_student_year, role, approval_status, requested_role, institution")
        .eq("id", user.id)
        .maybeSingle();

      if (!mounted) return;
      if (!pErr && data) {
        setProfile(data as ProfileInfo);
        setHasExtendedColumns(true);
        setLoading(false);
        return;
      }

      // Fallback 1: schema without newest profile fields
      const { data: basic, error: basicErr } = await supabase
        .from("profiles")
        .select("id, email, role, approval_status, requested_role, institution")
        .eq("id", user.id)
        .maybeSingle();
      if (!mounted) return;
      if (!basicErr && basic) {
        setHasExtendedColumns(false);
        setNotice("New profile fields are not available yet. Please run migration 008.");
        setProfile({ ...(basic as ProfileInfo), ...EMPTY_NEW_FIELDS });
        setLoading(false);
        return;
      }

      // Fallback 2: older schema without approval columns
      const { data: older, error: olderErr } = await supabase
        .from("profiles")
        .select("id, email, role, institution")
        .eq("id", user.id)
        .maybeSingle();
      if (!mounted) return;
      if (!olderErr && older) {
        setHasExtendedColumns(false);
        setNotice("Profile loaded in compatibility mode. Please run migrations 005 and 008.");
        setProfile({
          ...(older as ProfileInfo),
          ...EMPTY_APPROVAL_FIELDS,
          ...EMPTY_NEW_FIELDS,
        });
        setLoading(false);
        return;
      }

      // Fallback 3: no profile row yet -> create one
      const { data: inserted, error: insertErr } = await supabase
        .from("profiles")
        .insert({
          id: user.id,
          email: user.email || "",
          role: "student",
        })
        .select("id, email, role, institution")
        .maybeSingle();
      if (!mounted) return;
      if (!insertErr && inserted) {
        setHasExtendedColumns(false);
        setNotice("Profile initialized. Please run migrations 005 and 008 for all fields.");
        setProfile({
          ...(inserted as ProfileInfo),
          ...EMPTY_APPROVAL_FIELDS,
          ...EMPTY_NEW_FIELDS,
        });
        setLoading(false);
        return;
      }

      {
        // Keep generic message but we now exhausted compatibility fallbacks.
        setError(
          [
            "Could not load profile.",
            pErr ? `full: ${pErr.message}` : null,
            basicErr ? `basic: ${basicErr.message}` : null,
            olderErr ? `older: ${olderErr.message}` : null,
            insertErr ? `insert: ${insertErr.message}` : null,
          ]
            .filter(Boolean)
            .join(" ")
        );
        setLoading(false);
        return;
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white pt-20">
        <span className="text-gray-600">Loading profile...</span>
      </div>
    );
  }

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    if (!hasExtendedColumns) {
      setError("Please run migration 008 first before editing new profile fields.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);

    const { error: uErr } = await supabase
      .from("profiles")
      .update({
        email: profile.email || null,
        full_name: profile.full_name || null,
        profile_year: profile.profile_year || null,
        staff_id: profile.staff_id || null,
        student_id: profile.student_id || null,
        medical_student_year:
          profile.medical_student_year == null || Number.isNaN(profile.medical_student_year)
            ? null
            : profile.medical_student_year,
      })
      .eq("id", profile.id);

    if (uErr) {
      setError(`Could not save profile: ${uErr.message}`);
    } else {
      setNotice("Profile updated.");
    }
    setSaving(false);
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwNotice(null);
    if (!profile) return;
    if (newPassword.length < 6) {
      setPwError("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPwError("New passwords do not match.");
      return;
    }
    setPwSaving(true);
    const email = profile.email;
    if (!email) {
      setPwError("Missing email on profile.");
      setPwSaving(false);
      return;
    }
    const { error: signErr } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    });
    if (signErr) {
      setPwError("Current password is incorrect.");
      setPwSaving(false);
      return;
    }
    const { error: updErr } = await supabase.auth.updateUser({ password: newPassword });
    if (updErr) {
      setPwError(updErr.message);
      setPwSaving(false);
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setPwNotice("Password changed successfully.");
    setPwSaving(false);
  };

  return (
    <div className="min-h-screen bg-white pt-20 pb-12 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-teal-800 mb-6">My Profile</h1>
        {error ? (
          <div className="p-3 rounded border border-red-200 bg-red-50 text-red-700">{error}</div>
        ) : (
          <form onSubmit={saveProfile} className="border rounded-lg p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Name</label>
              <input
                className="mt-1 w-full border rounded px-3 py-2"
                value={profile?.full_name || ""}
                onChange={(e) =>
                  setProfile((p) => (p ? { ...p, full_name: e.target.value } : p))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Year</label>
              <input
                className="mt-1 w-full border rounded px-3 py-2"
                value={profile?.profile_year || ""}
                onChange={(e) =>
                  setProfile((p) => (p ? { ...p, profile_year: e.target.value } : p))
                }
                placeholder="e.g. 2026"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Staff ID</label>
              <input
                className="mt-1 w-full border rounded px-3 py-2"
                value={profile?.staff_id || ""}
                onChange={(e) =>
                  setProfile((p) => (p ? { ...p, staff_id: e.target.value } : p))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Student ID</label>
              <input
                className="mt-1 w-full border rounded px-3 py-2"
                value={profile?.student_id || ""}
                onChange={(e) =>
                  setProfile((p) => (p ? { ...p, student_id: e.target.value } : p))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <input
                type="email"
                className="mt-1 w-full border rounded px-3 py-2"
                value={profile?.email || ""}
                onChange={(e) =>
                  setProfile((p) => (p ? { ...p, email: e.target.value } : p))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Year of medical student</label>
              <input
                type="number"
                min={1}
                className="mt-1 w-full border rounded px-3 py-2"
                value={profile?.medical_student_year ?? ""}
                onChange={(e) =>
                  setProfile((p) =>
                    p
                      ? {
                          ...p,
                          medical_student_year:
                            e.target.value === "" ? null : Number(e.target.value),
                        }
                      : p
                  )
                }
              />
            </div>

            <div className="pt-2 border-t text-sm text-gray-700 space-y-1">
              <p><span className="font-semibold">Role:</span> {profile?.role || "-"}</p>
              <p><span className="font-semibold">Approval Status:</span> {profile?.approval_status || "approved"}</p>
              <p><span className="font-semibold">Requested Role:</span> {profile?.requested_role || "-"}</p>
              <p><span className="font-semibold">Institution:</span> {profile?.institution || "-"}</p>
            </div>

            {notice ? (
              <div className="p-3 rounded border border-green-200 bg-green-50 text-green-700 text-sm">
                {notice}
              </div>
            ) : null}
            <button
              type="submit"
              disabled={saving}
              className="bg-teal-600 hover:bg-teal-700 text-white px-5 py-2 rounded font-semibold disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save profile"}
            </button>
          </form>
        )}

        {profile ? (
          <div className="mt-10 border rounded-lg p-6 space-y-4">
            <h2 className="text-xl font-bold text-gray-900">Change password</h2>
            <p className="text-sm text-gray-600">
              Re-enter your current password, then choose a new one. You will stay signed in.
            </p>
            <form onSubmit={(e) => void changePassword(e)} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Current password</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  className="mt-1 w-full border rounded px-3 py-2"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  disabled={pwSaving}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">New password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  className="mt-1 w-full border rounded px-3 py-2"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                  disabled={pwSaving}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Confirm new password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  className="mt-1 w-full border rounded px-3 py-2"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  required
                  minLength={6}
                  disabled={pwSaving}
                />
              </div>
              {pwError ? (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{pwError}</div>
              ) : null}
              {pwNotice ? (
                <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">
                  {pwNotice}
                </div>
              ) : null}
              <button
                type="submit"
                disabled={pwSaving}
                className="bg-gray-900 hover:bg-gray-800 text-white px-5 py-2 rounded font-semibold disabled:opacity-60"
              >
                {pwSaving ? "Updating…" : "Update password"}
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}

