"use server";

import { revalidatePath } from "next/cache";
import { isEmail, normaliseEmail } from "@/lib/auth";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type AddState = { error?: string };

export async function addEmail(_: AddState, form: FormData): Promise<AddState> {
  const admin = await requireAdmin();
  const email = normaliseEmail(String(form.get("email") ?? ""));
  if (!isEmail(email)) return { error: "Enter a full email address." };
  const note = String(form.get("note") ?? "").trim().slice(0, 200) || null;
  const supabase = await createClient();
  const { error } = await supabase.from("approved_emails").insert({ email, note, added_by: admin.id });
  if (error?.code === "23505") return { error: "That email is already on the list." };
  if (error) return { error: "That email could not be added. Try again." };
  revalidatePath("/admin");
  return {};
}

export async function removeEmail(form: FormData) {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.from("approved_emails").delete().eq("email", String(form.get("email")));
  revalidatePath("/admin");
}
