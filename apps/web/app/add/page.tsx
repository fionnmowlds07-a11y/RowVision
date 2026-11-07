import type { Metadata } from "next";
import { Shell } from "@/components/shell";
import { fitSetup, type Setup } from "@/lib/setup";
import { requireViewer } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { AddFlow } from "./add-flow";

export const metadata: Metadata = { title: "Add a video" };

export default async function Add() {
  const viewer = await requireViewer();
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("last_setup").eq("id", viewer.id).single();
  const last = (data?.last_setup ?? {}) as Partial<Setup>;
  const setup = fitSetup({ boat: last.boat ?? "8+", side: last.side ?? "stroke", seat: last.seat ?? 1 });
  return (
    <Shell viewer={viewer}>
      <h1 style={{ fontSize: 32 }}>Add a video</h1>
      <AddFlow
        userId={viewer.id}
        setup={setup}
        connection={{ url: process.env.SUPABASE_PUBLIC_URL ?? process.env.SUPABASE_URL!, anonKey: process.env.SUPABASE_ANON_KEY! }}
      />
    </Shell>
  );
}
