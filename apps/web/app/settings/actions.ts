"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isColour } from "@/lib/colours";
import { requireViewer } from "@/lib/session";
import { adminClient } from "@/lib/supabase/admin";
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

/** Removes every file and row. Rows go with the user, and files must go first. */
export async function deleteAccount(form: FormData) {
  const viewer = await requireViewer();
  if (String(form.get("confirm")).trim().toLowerCase() !== "delete") return;
  const admin = adminClient();
  const { data: clips } = await admin
    .from("clips")
    .select("source_path, working_path, results(frames_path), training_clips(path)")
    .eq("user_id", viewer.id);
  const paths = (values: (string | null | undefined)[]) => values.filter((value): value is string => Boolean(value));
  const all = clips ?? [];
  const groups: [string, string[]][] = [
    ["uploads", paths(all.map((clip) => clip.source_path))],
    ["working", paths(all.map((clip) => clip.working_path))],
    ["frames", paths(all.flatMap((clip) => clip.results.map((result) => result.frames_path)))],
    ["training", paths(all.flatMap((clip) => [clip.training_clips].flat().map((kept) => kept?.path)))],
  ];
  for (const [bucket, names] of groups) {
    if (names.length) await admin.storage.from(bucket).remove(names);
  }
  await admin.auth.admin.deleteUser(viewer.id);
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}

export async function saveColours(ground: string | null, highlight: string | null) {
  const viewer = await requireViewer();
  if ((ground && !isColour(ground)) || (highlight && !isColour(highlight))) return;
  const supabase = await createClient();
  await supabase.from("profiles").update({ ground_colour: ground, highlight_colour: highlight }).eq("id", viewer.id);
  revalidatePath("/", "layout");
}
