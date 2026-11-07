import type { Metadata } from "next";
import { SignInForm } from "./form";
import styles from "./sign-in.module.css";

export const metadata: Metadata = { title: "Sign in to RowVision" };

export default function SignIn() {
  return (
    <main className={styles.page}>
      <svg className={styles.lines} viewBox="0 0 1056 700" preserveAspectRatio="none" aria-hidden="true">
        <path d="M460 -10 C580 130 500 320 1060 280" />
        <path d="M520 -10 C640 120 560 300 1060 240" />
        <path d="M580 -10 C700 110 620 280 1060 200" />
        <path d="M640 -10 C760 100 680 260 1060 160" />
        <path d="M700 -10 C820 90 740 240 1060 120" />
        <path d="M-10 420 C200 360 420 520 1060 400" />
        <path d="M-10 470 C200 410 420 570 1060 450" />
      </svg>
      <div className={styles.content}>
        <p className={styles.logo}>RowVision</p>
        <div>
          <h1 className={styles.headline}>Own your stroke.</h1>
          <p className={styles.lead}>RowVision turns launch footage into something you can act on.</p>
        </div>
        <SignInForm />
      </div>
    </main>
  );
}
