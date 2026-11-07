import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 32 }}>Your clips</h1>
      <p style={{ color: "var(--on-ground-soft)" }}>Signed in as {String(data?.claims.email ?? "")}.</p>
    </main>
  );
}
