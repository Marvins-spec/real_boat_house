import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let hasLoggedSupabaseConfig = false;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function logSupabaseConfigState() {
  if (hasLoggedSupabaseConfig) return;
  hasLoggedSupabaseConfig = true;

  const urlHost = (() => {
    try {
      return url ? new URL(url).host : "(missing)";
    } catch {
      return "(invalid url)";
    }
  })();

  // Never print secrets; only print presence and short metadata.
  console.info("[supabase-debug] env check", {
    hasUrl: Boolean(url),
    urlHost,
    hasAnonKey: Boolean(anonKey),
    anonKeyLength: anonKey?.length ?? 0,
    runtime: typeof window === "undefined" ? "server" : "browser",
  });
}

/**
 * Returns the browser Supabase client, or null if env is not configured.
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  logSupabaseConfigState();
  if (!url || !anonKey) {
    console.warn("[supabase-debug] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
    return null;
  }
  if (!client) {
    client = createClient(url, anonKey, {
      auth: { persistSession: true },
    });
    console.info("[supabase-debug] Supabase client initialized");
  }
  return client;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}
