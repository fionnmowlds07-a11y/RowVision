import Link from "next/link";
import { Shell } from "@/components/shell";
import { requireViewer } from "@/lib/session";

export default async function Home() {
  const viewer = await requireViewer();
  return (
    <Shell viewer={viewer}>
      <h1 style={{ fontSize: 32 }}>Your clips</h1>
      <Link className="button primary" href="/add" style={{ alignSelf: "flex-start" }}>Add a video</Link>
    </Shell>
  );
}
