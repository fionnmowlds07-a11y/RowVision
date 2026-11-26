import { Colours } from "@/app/settings/colours";
import type { Colours as Saved } from "../shared/bridge";
import { ModelsCard } from "./models-card";
import { SpeedCard } from "./speed-card";
import { TargetsCard } from "./targets-card";
import { UpdatesCard } from "./updates-card";

type Props = { colours: Saved; save: (ground: string | null, highlight: string | null) => Promise<void> };

export function SettingsPage({ colours, save }: Props) {
  return (
    <>
      <h1 style={{ fontSize: 32 }}>Settings</h1>
      <p style={{ margin: 0, color: "var(--on-ground-soft)" }}>Saved on this computer. There is no account.</p>
      <Colours key={`${colours.ground}-${colours.highlight}`} ground={colours.ground} highlight={colours.highlight} save={save} />
      <TargetsCard />
      <SpeedCard />
      <ModelsCard />
      <UpdatesCard />
    </>
  );
}
