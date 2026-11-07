import { NextResponse, type NextRequest } from "next/server";
import { deleteExpired } from "@/lib/retention";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Run on a schedule by the web host, so that deletion never depends on the worker's computer. */
export async function POST(request: NextRequest) {
  const secret = process.env.RETENTION_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  const admin = adminClient();
  const deleted = await deleteExpired({
    expired: async () => {
      const { data, error } = await admin.rpc("expired_clips");
      if (error) throw error;
      return data ?? [];
    },
    remove: async (bucket, paths) => {
      const { error } = await admin.storage.from(bucket).remove(paths);
      if (error) throw error;
    },
    mark: async (clip) => {
      await admin.from("clips").update({ video_deleted_at: new Date().toISOString(), working_path: null }).eq("id", clip);
      await admin.from("results").update({ frames_path: null }).eq("clip_id", clip);
    },
  });
  return NextResponse.json({ deleted });
}
