"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { COMMITTEE_PAGE_ROLES } from "@/lib/auth/roles";
import { useRoleGate } from "@/hooks/useRoleGate";
import type { CommitteePurpose } from "@/lib/committeeScope";

type CommitteeRow = {
  id: string;
  name: string;
  subject: string | null;
  test_year: number;
  course_code: string;
  purpose: CommitteePurpose;
};

type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  doctor_id: string | null;
};

export default function CommitteeDetailPage() {
  const params = useParams();
  const committeeId = typeof params.id === "string" ? params.id : "";
  const { ready: accessOk, loading: gateLoading, userId: myUserId, role: myRole } = useRoleGate(
    COMMITTEE_PAGE_ROLES,
    { noUserRedirect: "/login", wrongRoleRedirect: "/dashboard" },
  );

  const [committee, setCommittee] = useState<CommitteeRow | null>(null);
  const [members, setMembers] = useState<ProfileRow[]>([]);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<ProfileRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const canManage = myRole === "sub_admin" || myRole === "admin";

  const loadCommittee = useCallback(async () => {
    if (!committeeId || !accessOk) return;
    const { data, error } = await supabase
      .from("committees")
      .select("id, name, subject, test_year, course_code, purpose")
      .eq("id", committeeId)
      .maybeSingle();
    if (error || !data) {
      setErr(error?.message || "Committee not found.");
      setCommittee(null);
      return;
    }
    setCommittee(data as CommitteeRow);
  }, [committeeId, accessOk]);

  const loadMembers = useCallback(async () => {
    if (!committeeId || !accessOk) return;
    const { data: cm, error: e1 } = await supabase
      .from("committee_members")
      .select("profile_id")
      .eq("committee_id", committeeId);
    if (e1) {
      setErr(e1.message);
      return;
    }
    const ids = ((cm as { profile_id: string }[] | null) || []).map((r) => r.profile_id);
    if (ids.length === 0) {
      setMembers([]);
      return;
    }
    const { data: profs, error: e2 } = await supabase
      .from("profiles")
      .select("id, email, full_name, doctor_id")
      .in("id", ids)
      .order("email");
    if (e2) setErr(e2.message);
    setMembers(((profs as ProfileRow[]) || []).sort((a, b) => a.email.localeCompare(b.email)));
  }, [committeeId, accessOk]);

  useEffect(() => {
    void loadCommittee();
  }, [loadCommittee]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    const t = window.setTimeout(async () => {
      setSearching(true);
      setErr(null);
      const pat = `%${q.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
      const roles = ["educator", "admin", "sub_admin"];
      const sel = "id, email, full_name, doctor_id";
      const [em, nm] = await Promise.all([
        supabase.from("profiles").select(sel).in("role", roles).ilike("email", pat).limit(30),
        supabase.from("profiles").select(sel).in("role", roles).ilike("full_name", pat).limit(30),
      ]);
      setSearching(false);
      const errMsg = em.error?.message || nm.error?.message;
      if (errMsg) {
        setErr(errMsg);
        setSearchResults([]);
        return;
      }
      const map = new Map<string, ProfileRow>();
      for (const r of [...((em.data as ProfileRow[]) || []), ...((nm.data as ProfileRow[]) || [])]) {
        map.set(r.id, r);
      }
      const memberIds = new Set(members.map((m) => m.id));
      setSearchResults([...map.values()].filter((r) => !memberIds.has(r.id)));
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, members]);

  const dutySummary = useMemo(() => {
    if (!committee) return "";
    const track =
      committee.purpose === "formative"
        ? "Practice / formative-style MEQ & SBA tests"
        : "Real-test / summative MEQ & SBA examinations";
    return `${track} for catalog code ${committee.course_code}, academic year ${committee.test_year}.`;
  }, [committee]);

  const addMember = async (profileId: string) => {
    if (!canManage || !committeeId) return;
    setSaving(`add-${profileId}`);
    setErr(null);
    const { error } = await supabase.from("committee_members").insert({
      committee_id: committeeId,
      profile_id: profileId,
    });
    setSaving(null);
    if (error) {
      setErr(error.message);
      return;
    }
    setSearch("");
    setSearchResults([]);
    await loadMembers();
  };

  const removeMember = async (profileId: string) => {
    if (!canManage || !committeeId) return;
    setSaving(`rm-${profileId}`);
    setErr(null);
    const { error } = await supabase
      .from("committee_members")
      .delete()
      .eq("committee_id", committeeId)
      .eq("profile_id", profileId);
    setSaving(null);
    if (error) {
      setErr(error.message);
      return;
    }
    await loadMembers();
  };

  if (!accessOk || gateLoading || !myUserId) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-20 text-gray-600">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pt-20 pb-16 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <Link href="/sub-admin" className="text-blue-600 text-sm hover:underline">
          &larr; Exam review committee
        </Link>

        <div>
          <h1 className="text-2xl font-bold text-slate-900">Committee group</h1>
          {committee && (
            <p className="text-slate-600 text-sm mt-2">
              <span className="font-semibold">{committee.name}</span>
              <span className="text-slate-500">
                {" "}
                · Code <span className="font-mono">{committee.course_code}</span> · Year{" "}
                {committee.test_year} ·{" "}
                {committee.purpose === "formative" ? "Formative" : "Summative"}
              </span>
            </p>
          )}
        </div>

        <section className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-950">
          <p className="font-semibold">Your duties (for members)</p>
          <p className="mt-1">{dutySummary || "Loading…"}</p>
          <p className="mt-2 text-blue-900/90">
            Review assigned tests on the Assigned tests tab, complete Modified Angoff where needed, and record
            holistic committee scores when appropriate.
          </p>
        </section>

        {err && (
          <div className="p-3 rounded border border-red-200 bg-red-50 text-red-800 text-sm">{err}</div>
        )}

        <section className="bg-white border rounded-lg p-6 space-y-4">
          <h2 className="font-semibold text-lg">Members ({members.length})</h2>
          <ul className="divide-y border rounded-md">
            {members.length === 0 ? (
              <li className="px-3 py-4 text-sm text-gray-500">No members yet.</li>
            ) : (
              members.map((m) => (
                <li key={m.id} className="px-3 py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div>
                    <div className="font-medium text-gray-900">{m.full_name || "—"}</div>
                    <div className="text-gray-600">{m.email}</div>
                    {m.doctor_id && (
                      <div className="text-xs text-gray-500">Doctor ID: {m.doctor_id}</div>
                    )}
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      disabled={saving === `rm-${m.id}` || m.id === myUserId}
                      onClick={() => void removeMember(m.id)}
                      className="text-red-700 text-xs font-medium hover:underline disabled:opacity-40"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))
            )}
          </ul>
        </section>

        {canManage && (
          <section className="bg-white border rounded-lg p-6 space-y-3">
            <h2 className="font-semibold text-lg">Assign educator / staff</h2>
            <p className="text-xs text-gray-600">
              Search by name or email (educators, admins, sub-admins). All educators may serve on committees.
            </p>
            <input
              className="w-full border rounded-md px-3 py-2 text-sm"
              placeholder="Type at least 2 characters…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {searching && <p className="text-xs text-gray-500">Searching…</p>}
            <ul className="border rounded-md divide-y max-h-64 overflow-y-auto">
              {searchResults.length === 0 && search.trim().length >= 2 && !searching ? (
                <li className="px-3 py-3 text-sm text-gray-500">No matches (or already on this committee).</li>
              ) : (
                searchResults.map((r) => (
                  <li key={r.id} className="px-3 py-2 flex items-center justify-between gap-2 text-sm">
                    <div>
                      <span className="font-medium">{r.full_name || r.email}</span>
                      <span className="text-gray-500 block text-xs">{r.email}</span>
                    </div>
                    <button
                      type="button"
                      disabled={saving === `add-${r.id}`}
                      onClick={() => void addMember(r.id)}
                      className="text-blue-700 font-medium text-xs shrink-0"
                    >
                      Add
                    </button>
                  </li>
                ))
              )}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
