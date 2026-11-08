import type { ReactNode } from "react";

/** Marks a screen that keeps the website's look until its desktop design is picked (#150). */
export function Placeholder({ children }: { children: ReactNode }) {
  return <p className="placeholder-note">{children}</p>;
}
