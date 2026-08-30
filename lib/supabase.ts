import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Read-only Supabase client for the app. It uses the anon/publishable key against RLS
// select-only policies, so nothing rendered by the site can write to benchmark data — all
// writes go through scripts/import-results.ts with the service key.
//
// Results are cast to the lib/types.ts contract rather than to generated database types:
// types.ts is the single frozen contract, and a generated file would be a second one to
// keep in sync.

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local, or set USE_FAKE_DATA=true to render " +
        "fixtures with no backend."
    );
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Never serve a cached read. Every page is already `dynamic = "force-dynamic"`, which
    // makes this redundant in production — but a stale Next Data Cache entry was observed in
    // development putting a superseded `answer_substring` on screen, and a wrong
    // pre-registered answer key is the one thing this site must never display. The guarantee
    // belongs on the client that fetches the data, not on each route that happens to use it.
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
  return client;
}
