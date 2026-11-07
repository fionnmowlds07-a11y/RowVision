import { createClient } from "@supabase/supabase-js";

/** Bypasses row-level security. Server code only, and only after checking who is asking. */
export function adminClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
