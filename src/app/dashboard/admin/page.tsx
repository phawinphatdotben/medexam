"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface ProfileRow {
  id: string;
  email: string;
  role: string;
  requested_role: string | null;
  approval_status: "pending" | "approved" | "rejected";
}

export default function AdminRoleManagementPage() {
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [user, setUser] = useState<any>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "pending">("all");
  const [courseCodes, setCourseCodes] = useState<string[]>([]);
  const [scopeMap, setScopeMap] = useState<Record<string, string[]>>({});
  const [scopeAssign, setScopeAssign] = useState<{ userId: string; courseCode: string }>({
    userId: "",
    courseCode: "",
  });
  const [pwResetting, setPwResetting] = useState<string | null>(null);

  const router = useRouter();

  // Security check for admin-only access
  useEffect(() => {
    let mounted = true;
    const checkAdmin = async () => {
      setLoading(true);

      // 1. Get user session
      const { data: userData } = await supabase.auth.getUser();
      const currentUser = userData?.user ?? null;
      setUser(currentUser);

      if (!currentUser || !currentUser.id) {
        router.replace("/exam");
        return;
      }

      // 2. Check profile role
      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", currentUser.id)
        .maybeSingle();

      if (
        profileErr ||
        !profile ||
        !profile.role ||
        profile.role !== "admin"
      ) {
        router.replace("/exam");
        return;
      }

      setMyRole(profile.role);
      setLoading(false);
    };

    checkAdmin();

    return () => {
      mounted = false;
    };
  }, [router]);

  // Fetch all profiles
  useEffect(() => {
    if (loading) return;
    let mounted = true;
    const fetchProfiles = async () => {
      setError(null);
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, role, requested_role, approval_status")
        .order("email", { ascending: true });
      if (error) {
        setError("Failed to fetch users.");
        setProfiles([]);
      } else if (mounted) {
        setProfiles(data || []);
      }
      const { data: catalog } = await supabase
        .from("course_catalog")
        .select("course_code")
        .order("course_code", { ascending: true })
        .limit(2000);
      if (mounted) {
        const codes = ((catalog as { course_code: string }[] | null) || []).map((r) => r.course_code);
        setCourseCodes(codes);
        if (!scopeAssign.courseCode && codes[0]) {
          setScopeAssign((prev) => ({ ...prev, courseCode: codes[0]! }));
        }
      }
      const { data: scopes } = await supabase
        .from("sub_admin_course_scopes")
        .select("profile_id, course_code");
      if (mounted) {
        const nextScopeMap: Record<string, string[]> = {};
        for (const row of (scopes as { profile_id: string; course_code: string }[] | null) || []) {
          if (!nextScopeMap[row.profile_id]) {
            nextScopeMap[row.profile_id] = [];
          }
          nextScopeMap[row.profile_id]!.push(row.course_code);
        }
        for (const key of Object.keys(nextScopeMap)) {
          nextScopeMap[key]!.sort((a, b) => a.localeCompare(b));
        }
        setScopeMap(nextScopeMap);
      }
    };
    fetchProfiles();
    return () => {
      mounted = false;
    };
  }, [loading]);

  // Handler to update user role
  const updateRole = async (userId: string, newRole: string) => {
    setUpdating(userId);
    setError(null);
    // Don't allow self-demotion (prevent admin demoting own self from admin)
    if (userId === user?.id && newRole !== "admin") {
      setError("You cannot remove your own admin privileges.");
      setUpdating(null);
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        role: newRole,
        approval_status: "approved",
        requested_role: null,
      })
      .eq("id", userId);

    if (error) {
      setError(
        "Failed to update role. Please try again."
      );
    } else {
      setProfiles((prev) =>
        prev.map((profile) =>
          profile.id === userId
            ? {
                ...profile,
                role: newRole,
                approval_status: "approved",
                requested_role: null,
              }
            : profile
        )
      );
    }
    setUpdating(null);
  };

  const approveStaff = async (userId: string) => {
    setUpdating(userId);
    setError(null);
    const { error } = await supabase
      .from("profiles")
      .update({
        role: "educator",
        approval_status: "approved",
        requested_role: null,
      })
      .eq("id", userId);

    if (error) {
      setError("Failed to approve user. Please try again.");
      setUpdating(null);
      return;
    }

    setProfiles((prev) =>
      prev.map((p) =>
        p.id === userId
          ? { ...p, role: "educator", approval_status: "approved", requested_role: null }
          : p
      )
    );
    setUpdating(null);
  };

  const resetPasswordToDefault = async (targetUserId: string) => {
    setPwResetting(targetUserId);
    setError(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setError("Not signed in — refresh the page and try again.");
      setPwResetting(null);
      return;
    }
    const res = await fetch("/api/admin/reset-user-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userId: targetUserId }),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
    if (!res.ok) {
      setError(payload.error || "Could not reset password. Check server has SUPABASE_SERVICE_ROLE_KEY.");
    }
    setPwResetting(null);
  };

  const pendingProfiles = profiles.filter(
    (p) => p.approval_status === "pending" && p.requested_role === "educator"
  );
  const subAdmins = profiles.filter((p) => p.role === "sub_admin");
  const visibleProfiles = tab === "pending" ? pendingProfiles : profiles;

  const assignSubAdminScope = async () => {
    if (!scopeAssign.userId || !scopeAssign.courseCode) {
      setError("Choose a sub-admin and course code for scope assignment.");
      return;
    }
    setUpdating("scope");
    setError(null);
    const { error: scErr } = await supabase
      .from("sub_admin_course_scopes")
      .insert({
        profile_id: scopeAssign.userId,
        course_code: scopeAssign.courseCode,
      });
    if (scErr) {
      setError(scErr.message || "Failed to assign sub-admin scope.");
      setUpdating(null);
      return;
    }
    setScopeMap((prev) => {
      const current = prev[scopeAssign.userId] || [];
      if (current.includes(scopeAssign.courseCode)) return prev;
      return {
        ...prev,
        [scopeAssign.userId]: [...current, scopeAssign.courseCode].sort((a, b) => a.localeCompare(b)),
      };
    });
    setUpdating(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <span className="text-black text-lg font-semibold">
          Loading...
        </span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="w-full border-b border-gray-200 shadow-sm px-8 py-6">
        <a href="/dashboard/admin/audit" className="text-sm text-blue-700 hover:underline block mb-2">
          Rubric &amp; AI training audit log →
        </a>
        <h1 className="text-3xl font-bold text-black tracking-tight">
          User Role Management
        </h1>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-3xl mx-auto mt-12 px-6">
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 rounded-lg px-5 py-3 mb-6 text-base font-semibold text-center">
            {error}
          </div>
        )}
        <div className="bg-white border border-gray-200 shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
            <h3 className="font-semibold text-black mb-3">Sub-admin course-code scope assignment</h3>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs font-semibold text-gray-600">Sub-admin</label>
                <select
                  className="border border-gray-400 rounded px-3 py-2 bg-white text-black"
                  value={scopeAssign.userId}
                  onChange={(e) => setScopeAssign((prev) => ({ ...prev, userId: e.target.value }))}
                >
                  <option value="">-- select user --</option>
                  {subAdmins.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.email}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600">Course code</label>
                <select
                  className="border border-gray-400 rounded px-3 py-2 bg-white text-black"
                  value={scopeAssign.courseCode}
                  onChange={(e) => setScopeAssign((prev) => ({ ...prev, courseCode: e.target.value }))}
                >
                  <option value="">-- select code --</option>
                  {courseCodes.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="border border-blue-700 bg-blue-700 text-white rounded px-3 py-2 font-semibold"
                disabled={updating === "scope"}
                onClick={() => void assignSubAdminScope()}
              >
                {updating === "scope" ? "Assigning..." : "Assign scope"}
              </button>
            </div>
          </div>
          <div className="px-6 py-4 border-b border-gray-100">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-bold text-black">
                {tab === "pending" ? "Waiting for Approval" : "Registered Users"}
              </h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTab("all")}
                  className={`px-4 py-2 rounded border text-sm font-semibold ${
                    tab === "all"
                      ? "bg-black text-white border-black"
                      : "bg-white text-black border-gray-300"
                  }`}
                >
                  All users
                </button>
                <button
                  type="button"
                  onClick={() => setTab("pending")}
                  className={`px-4 py-2 rounded border text-sm font-semibold ${
                    tab === "pending"
                      ? "bg-black text-white border-black"
                      : "bg-white text-black border-gray-300"
                  }`}
                >
                  Waiting for approval ({pendingProfiles.length})
                </button>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-6 py-3 text-black font-semibold border-b border-gray-200">
                    Email Address
                  </th>
                  <th className="px-6 py-3 text-black font-semibold border-b border-gray-200">
                    Current Role
                  </th>
                  <th className="px-6 py-3 text-black font-semibold border-b border-gray-200">
                    Request Status
                  </th>
                  <th className="px-6 py-3 text-black font-semibold border-b border-gray-200">
                    Actions
                  </th>
                  <th className="px-6 py-3 text-black font-semibold border-b border-gray-200">
                    Assign Scope
                  </th>
                  <th className="px-6 py-3 text-black font-semibold border-b border-gray-200">
                    Password
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleProfiles.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-6 py-5 text-center text-black"
                    >
                      {tab === "pending" ? "No pending staff approvals." : "No users found."}
                    </td>
                  </tr>
                ) : (
                  visibleProfiles.map((profile) => (
                    <tr
                      key={profile.id}
                      className="hover:bg-gray-50 transition"
                    >
                      <td className="px-6 py-4 border-b border-gray-100 text-black font-medium">
                        {profile.email}
                      </td>
                      <td className="px-6 py-4 border-b border-gray-100 text-black">
                        {profile.role}
                      </td>
                      <td className="px-6 py-4 border-b border-gray-100 text-black">
                        {profile.approval_status}
                        {profile.requested_role ? ` (${profile.requested_role})` : ""}
                      </td>
                      <td className="px-6 py-4 border-b border-gray-100">
                        {tab === "pending" ? (
                          <button
                            type="button"
                            className="border border-green-700 bg-green-700 text-white rounded px-3 py-2 font-semibold"
                            disabled={updating === profile.id}
                            onClick={() => approveStaff(profile.id)}
                          >
                            Approve as staff
                          </button>
                        ) : (
                          <select
                            className="border border-gray-400 rounded px-3 py-2 bg-white text-black font-semibold shadow focus:outline-none"
                            value={profile.role}
                            disabled={updating === profile.id}
                            onChange={(e) =>
                              updateRole(profile.id, e.target.value)
                            }
                          >
                            <option value="student">student</option>
                            <option value="educator">educator</option>
                            <option value="sub_admin">sub_admin</option>
                            <option value="admin">admin</option>
                          </select>
                        )}
                        {updating === profile.id && (
                          <span className="ml-2 text-black text-sm">
                            Updating...
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 border-b border-gray-100 text-black">
                        {profile.role === "sub_admin" ? (
                          (scopeMap[profile.id] || []).length > 0 ? (
                            <span className="text-sm">{scopeMap[profile.id]!.join(", ")}</span>
                          ) : (
                            <span className="text-gray-400 text-sm">No scope assigned</span>
                          )
                        ) : (
                          <span className="text-gray-300 text-sm">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 border-b border-gray-100">
                        <button
                          type="button"
                          className="border border-amber-700 bg-amber-700 text-white rounded px-3 py-1.5 text-sm font-semibold whitespace-nowrap"
                          disabled={pwResetting === profile.id}
                          onClick={() => void resetPasswordToDefault(profile.id)}
                          title="Sets this user’s password to 123456"
                        >
                          {pwResetting === profile.id ? "Resetting…" : "Set password to 123456"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}