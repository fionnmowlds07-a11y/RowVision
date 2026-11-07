import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Viewer = {
  id: string;
  email: string;
  isAdmin: boolean;
  displayName: string | null;
  ground: string | null;
  highlight: string | null;
};

/** Return the signed-in athlete. Sends anyone else to sign-in. */
export async function requireViewer(): Promise<Viewer> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const id = data?.claims.sub;
  if (!id) redirect("/sign-in");
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, display_name, ground_colour, highlight_colour")
    .eq("id", id)
    .single();
  return {
    id,
    email: String(data.claims.email ?? ""),
    isAdmin: profile?.is_admin ?? false,
    displayName: profile?.display_name ?? null,
    ground: profile?.ground_colour ?? null,
    highlight: profile?.highlight_colour ?? null,
  };
}

export async function requireAdmin(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!viewer.isAdmin) redirect("/");
  return viewer;
}
