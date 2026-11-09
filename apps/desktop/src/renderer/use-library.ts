import { useEffect, useState } from "react";
import type { ClipItem, Space } from "../shared/bridge";

const CHANGED = "rowvision:library-changed";

/** Tell every view of the library to read it again, after something was deleted. */
export function libraryChanged() {
  window.dispatchEvent(new Event(CHANGED));
}

/** The clips and the space they use, read again whenever `when` changes or the library changes. */
export function useLibrary(when: string): { clips: ClipItem[] | null; space: Space | null } {
  const [clips, setClips] = useState<ClipItem[] | null>(null);
  const [space, setSpace] = useState<Space | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const bump = () => setCount((value) => value + 1);
    window.addEventListener(CHANGED, bump);
    return () => window.removeEventListener(CHANGED, bump);
  }, []);

  useEffect(() => {
    let live = true;
    void Promise.all([window.rowvision.listClips(), window.rowvision.getSpace()]).then(([found, used]) => {
      if (!live) return;
      setClips(found);
      setSpace(used);
    });
    return () => { live = false; };
  }, [when, count]);

  return { clips, space };
}
