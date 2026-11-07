import { Shell } from "@/components/shell";
import { requireViewer } from "@/lib/session";

export default async function Home() {
  const viewer = await requireViewer();
  return (
    <Shell viewer={viewer}>
      <h1 style={{ fontSize: 32 }}>Your clips</h1>
      <p style={{ margin: 0, color: "var(--on-ground-soft)" }}>Your clips will appear here.</p>
    </Shell>
  );
}
