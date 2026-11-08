import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { colourVariables } from "@/lib/colours";
import shellStyles from "@/components/shell.module.css";
import type { Colours } from "../shared/bridge";
import { AddPage } from "./add-page";
import { ClipPage } from "./clip-page";
import { ClipsPage } from "./clips-page";
import { useRoute } from "./route";
import { SettingsPage } from "./settings-page";

export function App() {
  const route = useRoute();
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
  else if (route.page === "settings") page = <SettingsPage colours={colours} save={save} />;
  else page = <ClipsPage />;

  return (
    <div className={shellStyles.shell} style={colourVariables(colours.ground, colours.highlight) as CSSProperties}>
      <header className={shellStyles.bar}>
        <a href="#/" className={shellStyles.logo}>RowVision</a>
        <nav aria-label="Main" className={shellStyles.nav}>
          <a href="#/">Clips</a>
          <a href="#/settings">Settings</a>
        </nav>
      </header>
      <main className={shellStyles.main}>{page}</main>
    </div>
  );
}
