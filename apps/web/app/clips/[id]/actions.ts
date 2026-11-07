"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
