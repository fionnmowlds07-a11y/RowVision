import type { Metadata } from "next";
import Link from "next/link";
import styles from "./guide.module.css";
import { GuideSteps } from "./steps";

export const metadata: Metadata = {
  title: "How to film a good clip",
  description: "Five things that make RowVision's measurements more accurate.",
};

export default function Guide() {
  return (
    <main className={styles.page}>
      <Link href="/" className={styles.logo}>RowVision</Link>
      <h1 className={styles.title}>How to film a good clip</h1>
      <p className={styles.lead}>Five things make the biggest difference. Share this page with whoever films from the launch.</p>
      <GuideSteps />
      <Link className="button primary" href="/add">Add a video</Link>
    </main>
  );
}
