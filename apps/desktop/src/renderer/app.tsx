import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { colourVariables } from "@/lib/colours";
import type { Colours } from "../shared/bridge";
import { AddPage } from "./add-page";
import { AnalysisPage } from "./analysis-page";
import { ClipPage } from "./clip-page";
import { ClipsPage } from "./clips-page";
import { GuidePage } from "./guide-page";
import { useRoute } from "./route";
import { SettingsPage } from "./settings-page";
import { SideMenu } from "./side-menu";
import { useAnalysis } from "./use-analysis";
import { useLibrary } from "./use-library";
import styles from "./shell.module.css";

export function App() {
  const route = useRoute();
  const analysis = useAnalysis();
  const running = analysis?.running ?? null;
  // Read the library again when the page changes or a clip moves through analysis, not on every percent.
  const { clips, space } = useLibrary([window.location.hash, running?.id, analysis?.waiting.length].join("|"));
  const [colours, setColours] = useState<Colours>({ ground: null, highlight: null });

  useEffect(() => {
    void window.rowvision.getColours().then(setColours);
  }, []);

  const save = useCallback(async (ground: string | null, highlight: string | null) => {
    setColours(await window.rowvision.setColours({ ground, highlight }));
  }, []);

  let page: ReactNode;
  if (route.page === "clip") page = <ClipPage key={route.id} id={route.id} />;
  else if (route.page === "add") page = <AddPage />;
  else if (route.page === "analysis") page = <AnalysisPage key={route.id} id={route.id} />;
  else if (route.page === "settings") page = <SettingsPage colours={colours} save={save} />;
  else if (route.page === "guide") page = <GuidePage />;
  else page = <ClipsPage clips={clips} />;

  return (
    <div className={styles.shell} style={colourVariables(colours.ground, colours.highlight) as CSSProperties}>
      <SideMenu route={route} running={running} clips={clips} space={space} />
      <main className={styles.main}>{page}</main>
    </div>
  );
}
