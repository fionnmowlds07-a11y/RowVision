import Link from "next/link";
import type { ReactNode } from "react";
import type { Viewer } from "@/lib/session";
import styles from "./shell.module.css";

export function Shell({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <Link href="/" className={styles.logo}>RowVision</Link>
        <nav aria-label="Main" className={styles.nav}>
          <Link href="/">Clips</Link>
          <Link href="/guide">Filming guide</Link>
          <Link href="/settings">Settings</Link>
          {viewer.isAdmin ? <Link href="/admin">Admin</Link> : null}
        </nav>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
