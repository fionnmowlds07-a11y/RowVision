import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { requireViewer } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export default async function Clip({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireViewer();
  const supabase = await createClient();
  const { data: clip } = await supabase.from("clips").select("id, boat_class, seat").eq("id", id).maybeSingle();
  if (!clip) notFound();
  return (
    <Shell viewer={viewer}>
      <h1 style={{ fontSize: 32 }}>Your clip</h1>
      <p style={{ margin: 0 }}>{clip.boat_class} seat {clip.seat}</p>
    </Shell>
  );
}
