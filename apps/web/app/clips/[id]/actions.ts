"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireViewer } from "@/lib/session";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ToolState = { message?: string; failed?: boolean };

export async function cancel(clip: string) {
  const supabase = await createClient();
  await supabase.rpc("cancel_job", { clip });
  revalidatePath(`/clips/${clip}`);
}

export async function tapAgain(clip: string, tap: { t: number; x: number; y: number }) {
  const supabase = await createClient();
  await supabase.rpc("give_tap", { clip, tap_point: tap });
  revalidatePath(`/clips/${clip}`);
}

export async function saveNote(clip: string, _: ToolState, form: FormData): Promise<ToolState> {
  const supabase = await createClient();
  const note = String(form.get("note") ?? "").trim().slice(0, 200) || null;
  const { error } = await supabase.from("clips").update({ note }).eq("id", clip);
  if (error) return { message: "Your note could not be saved. Try again.", failed: true };
  revalidatePath(`/clips/${clip}`);
  return { message: "Saved." };
}

export async function rerun(clip: string, _: ToolState, form: FormData): Promise<ToolState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rerun_clip", {
    clip,
    boat: String(form.get("boat")),
    rowing_side: String(form.get("side")),
    seat_number: Number(form.get("seat")),
  });
  if (error) {
    const known: Record<string, string> = {
      queue_full: "You already have 2 clips waiting. Try again once one has finished.",
      no_video: "The video has been deleted, so this clip can't be measured again.",
      already_running: "This clip is already being measured.",
      bad_seat: "Check your boat and seat.",
      bad_side: "Check your boat and side.",
    };
    const reason = Object.keys(known).find((key) => error.message.includes(key));
    return { message: reason ? known[reason] : "That didn't work. Try again.", failed: true };
  }
  revalidatePath(`/clips/${clip}`);
  return {};
}

export async function report(clip: string, result: string | null, _: ToolState, form: FormData): Promise<ToolState> {
  const viewer = await requireViewer();
  const supabase = await createClient();
  const { error } = await supabase.from("feedback").insert({
    clip_id: clip,
    result_id: result,
    user_id: viewer.id,
    kind: String(form.get("kind")),
    message: String(form.get("message") ?? "").trim().slice(0, 1000) || null,
  });
  if (error) return { message: "That couldn't be sent. Try again.", failed: true };
  return { message: "Thanks. That will help fix it." };
}

export async function deleteClip(clip: string) {
  const viewer = await requireViewer();
  const supabase = await createClient();
  const { data } = await supabase.from("clips").select("source_path, working_path, user_id, results(frames_path)")
    .eq("id", clip).eq("user_id", viewer.id).maybeSingle();
  if (!data) return;
  const admin = adminClient();
  const frames = data.results.flatMap(({ frames_path: path }) => (path ? [path] : []));
  if (data.source_path) await admin.storage.from("uploads").remove([data.source_path]);
  if (data.working_path) await admin.storage.from("working").remove([data.working_path]);
  if (frames.length) await admin.storage.from("frames").remove(frames);
  const { data: kept } = await admin.from("training_clips").select("path").eq("clip_id", clip).maybeSingle();
  if (kept) await admin.storage.from("training").remove([kept.path]);
  await admin.from("clips").delete().eq("id", clip);
  redirect("/");
}

export async function keepForTraining(clip: string) {
  const viewer = await requireAdmin();
  const admin = adminClient();
  const { data } = await admin.from("clips").select("working_path, user_id").eq("id", clip).single();
  if (!data?.working_path) return;
  const path = `${data.user_id}/${clip}/kept.mp4`;
  // The record goes first, so that the 30-day deletion can never reach a clip part way through.
  await admin.from("training_clips").upsert({ clip_id: clip, path, kept_by: viewer.id });
  const { error } = await admin.storage.from("working").copy(data.working_path, path, { destinationBucket: "training" });
  if (error) {
    await admin.from("training_clips").delete().eq("clip_id", clip);
    throw error;
  }
  revalidatePath(`/clips/${clip}`);
}

export async function stopKeeping(clip: string) {
  await requireAdmin();
  const admin = adminClient();
  const { data } = await admin.from("training_clips").select("path").eq("clip_id", clip).maybeSingle();
  if (data) await admin.storage.from("training").remove([data.path]);
  await admin.from("training_clips").delete().eq("clip_id", clip);
  revalidatePath(`/clips/${clip}`);
}
