"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { COMMITTEE_PAGE_ROLES } from "@/lib/auth/roles";
import { useRoleGate } from "@/hooks/useRoleGate";
import { committeeScopesMatchTest, type CommitteePurpose } from "@/lib/committeeScope";

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

type ScopedTestRow = {
  id: string;
  kind: "MEQ" | "SBA";
  subject: string;
  subject_code: string;
  test_year: number;
  test_function: "practice" | "real_test";
  assessment_purpose: "formative" | "summative";
  review_status: string;
  committee_id: string | null;
  public_code: string | null;
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
  const [scopedTests, setScopedTests] = useState<ScopedTestRow[]>([]);
  const [testsLoading, setTestsLoading] = useState(false);

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

  const loadScopedTests = useCallback(async () => {
    if (!committee) return;
    setTestsLoading(true);
    setErr(null);
    const cc = committee.course_code;
    const y = committee.test_year;
    const { data: meq, error: e1 } = await supabase
      .from("meq_tests")
      .select(
        "id, subject, course_code, test_year, test_function, assessment_purpose, review_status, committee_id, public_code",
      )
      .eq("course_code", cc)
      .eq("test_year", y);
    const { data: sba, error: e2 } = await supabase
      .from("sba_tests")
      .select(
        "id, subject, subject_code, test_year, test_function, assessment_purpose, review_status, committee_id, public_code",
      )
      .eq("subject_code", cc)
      .eq("test_year", y);
    setTestsLoading(false);
    if (e1 || e2) {
      setErr(e1?.message || e2?.message || "Could not load tests.");
      setScopedTests([]);
      return;
    }
    const merged: ScopedTestRow[] = [
      ...((meq || []) as Record<string, unknown>[]).map((r) => ({
        id: r.id as string,
        kind: "MEQ" as const,
        subject: r.subject as string,
        subject_code: r.course_code as string,
        test_year: r.test_year as number,
        test_function: r.test_function as "practice" | "real_test",
        assessment_purpose: r.assessment_purpose as "formative" | "summative",
        review_status: r.review_status as string,
        committee_id: (r.committee_id as string | null) ?? null,
        public_code: (r.public_code as string | null) ?? null,
      })),
      ...((sba || []) as Record<string, unknown>[]).map((r) => ({
        id: r.id as string,
        kind: "SBA" as const,
        subject: r.subject as string,
        subject_code: r.subject_code as string,
        test_year: r.test_year as number,
        test_function: r.test_function as "practice" | "real_test",
        assessment_purpose: r.assessment_purpose as "formative" | "summative",
        review_status: r.review_status as string,
        committee_id: (r.committee_id as string | null) ?? null,
        public_code: (r.public_code as string | null) ?? null,
      })),
    ].filter((t) =>
      committeeScopesMatchTest({
        committeeCourseCode: committee.course_code,
        committeeYear: committee.test_year,
        committeePurpose: committee.purpose,
        testCourseCode: t.subject_code,
        testYear: t.test_year,
        testFunction: t.test_function,
        assessmentPurpose: t.assessment_purpose,
      }),
    );
    merged.sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) || a.subject.localeCompare(b.subject) || a.id.localeCompare(b.id),
    );
    setScopedTests(merged);
  }, [committee]);

  useEffect(() => {
    void loadScopedTests();
  }, [loadScopedTests]);

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
            Use the test list below and the main <strong>Assigned tests</strong> tab to open Angoff and committee
            scores. Everything listed here matches this group&apos;s code, year, and formative/summative track.
          </p>
        </section>

        {committee && (
        <section className="bg-white border rounded-lg p-6 overflow-x-auto">
          <h2 className="font-semibold text-lg mb-1">Tests in this group</h2>
          <p className="text-xs text-gray-600 mb-4">
            MEQ and SBA exams that share this committee&apos;s catalog code ({committee.course_code}), year (
            {committee.test_year}), and track ({committee.purpose === "formative" ? "formative" : "summative"}).
            Assignment shows whether this group is linked on the test row (sub-admins set that on{" "}
            <Link href="/sub-admin" className="text-blue-600 hover:underline">
              Assigned tests
            </Link>
            ).
          </p>
          {testsLoading ? (
            <p className="text-sm text-gray-500">Loading tests…</p>
          ) : scopedTests.length === 0 ? (
            <p className="text-sm text-gray-500">No matching tests yet. Create an MEQ or SBA with this course code.</p>
          ) : (
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b text-gray-600">
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Test ID</th>
                  <th className="py-2 pr-3">Subject / track</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Linked to this group</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {scopedTests.map((t) => {
                  const assignedHere = t.committee_id === committeeId;
                  const assignedElsewhere = t.committee_id != null && t.committee_id !== committeeId;
                  const linkKind = t.kind === "MEQ" ? "meq" : "sba";
                  return (
                    <tr key={`${t.kind}-${t.id}`} className="border-t">
                      <td className="py-2 pr-3 font-mono text-xs">{t.kind}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{t.public_code || "—"}</td>
                      <td className="py-2 pr-3">
                        <div className="font-medium text-gray-900">{t.subject}</div>
                        <div className="text-xs text-gray-500">
                          {t.test_function === "practice"
                            ? "Practice · formative"
                            : `Real test · ${t.assessment_purpose}`}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-xs">{t.review_status}</td>
                      <td className="py-2 pr-3">
                        {assignedHere ? (
                          <span className="text-green-800 font-medium text-xs">Yes</span>
                        ) : assignedElsewhere ? (
                          <span className="text-amber-800 text-xs">Another committee</span>
                        ) : (
                          <span className="text-gray-500 text-xs">Not assigned</span>
                        )}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-col gap-1">
                          <Link
                            href={`/sub-admin/test-review/${linkKind}/${t.id}`}
                            className="text-blue-600 font-medium text-xs hover:underline whitespace-nowrap"
                          >
                            Full review
                          </Link>
                          <Link
                            href={`/sub-admin/angoff/${linkKind}/${t.id}`}
                            className="text-blue-600 font-medium text-xs hover:underline whitespace-nowrap"
                          >
                            Angoff
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
        )}

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
