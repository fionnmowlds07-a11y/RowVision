import path from "node:path";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const here = import.meta.dirname;
const web = path.resolve(here, "../web");

/**
 * The results, viewer and logic are imported straight from the web app. Their packages
 * (React, three) must still come from this app, so there is one React and CI need not install the web app.
 */
function packagesFromHere(): Plugin {
  const anchor = path.join(here, "src/renderer/main.tsx");
  return {
    name: "packages-from-desktop",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || !importer.startsWith(web) || source.startsWith(".") || source.startsWith("/") || source.startsWith("@/") || source.startsWith("\0")) return null;
      return this.resolve(source, anchor, { ...options, skipSelf: true });
    },
  };
}

export default defineConfig({
  root: path.join(here, "src/renderer"),
  base: "./",
  plugins: [packagesFromHere(), react()],
  resolve: {
    alias: { "@": web },
    dedupe: ["react", "react-dom", "three"],
  },
  build: {
    outDir: path.join(here, "dist/renderer"),
    emptyOutDir: true,
    target: "chrome140",
    // Nothing inlined as data: addresses, so the page's rules can stay strict.
    assetsInlineLimit: 0,
    // The 3D model is three.js, loaded only when opened.
    chunkSizeWarningLimit: 700,
  },
  test: {
    root: here,
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
