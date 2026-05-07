import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Sets target user's password to 123456. Requires admin JWT + SUPABASE_SERVICE_ROLE_KEY on server. */
export async function POST(req: NextRequest) {
  if (!url || !anon || !service) {
    return NextResponse.json(
      { error: "Server missing Supabase URL/keys or SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: prof } = await userClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (prof?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden — admin only." }, { status: 403 });
  }

  let body: { userId?: string };
  try {
    body = (await req.json()) as { userId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const targetId = body.userId?.trim();
  if (!targetId) {
    return NextResponse.json({ error: "userId is required." }, { status: 400 });
  }

  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: updErr } = await admin.auth.admin.updateUserById(targetId, {
    password: "123456",
  });

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
