"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export async function saveName(form: FormData) {
  const viewer = await requireViewer();
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  const supabase = await createClient();
  await supabase.from("profiles").update({ display_name: name || null }).eq("id", viewer.id);
  revalidatePath("/settings");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
