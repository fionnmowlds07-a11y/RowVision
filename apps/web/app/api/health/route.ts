import { NextResponse, type NextRequest } from "next/server";
import { deepHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("deep") !== "1") {
    return NextResponse.json({ status: "ok" });
  }
  const health = await deepHealth(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_ANON_KEY ?? "");
  return NextResponse.json(health, { status: health.status === "ok" ? 200 : 503 });
}
