import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role Supabase client: bypasses RLS, so this is the only place in the repo that can
// write benchmark data. Scripts only — never import it from app/ or from lib/ code that the
// Next.js runtime loads.

let client: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and " +
        "SUPABASE_SERVICE_ROLE_KEY in .env.local. Fetch them with:\n" +
        "  npx supabase projects api-keys --project-ref bfhxbvaosagfrkuhnuvp"
    );
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
