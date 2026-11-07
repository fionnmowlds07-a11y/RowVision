import "@fontsource-variable/bricolage-grotesque/wght.css";
import "@fontsource-variable/dm-sans/wght.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "RowVision",
  description: "See your stroke, measured from launch footage.",
  appleWebApp: { capable: true, title: "RowVision", statusBarStyle: "black" },
  icons: { apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#070b09",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
