import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let singleton: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (singleton) return singleton;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Add them under Vercel → Project Settings → Environment Variables (then redeploy)."
    );
  }
  singleton = createClient(url, key);
  return singleton;
}

/**
 * Lazily creates the browser Supabase client on first property access so static
 * generation (e.g. `/_not-found`) does not require env at module load time.
 * NEXT_PUBLIC_* must still be set on Vercel so the client bundle works at runtime.
 */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, _receiver) {
    const client = getSupabase();
    const value = Reflect.get(client, prop, client) as unknown;
    if (typeof value === "function") {
      return (value as (...a: unknown[]) => unknown).bind(client);
    }
    return value;
  },
});
