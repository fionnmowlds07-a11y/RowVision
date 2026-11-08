// Bundles the main process and the preload. The page is built by Vite.
import { build } from "esbuild";

const shared = { bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], sourcemap: false, logLevel: "warning" };

await Promise.all([
  build({ ...shared, entryPoints: ["src/main/main.ts"], outfile: "dist/main/main.js" }),
  build({ ...shared, entryPoints: ["src/preload/preload.ts"], outfile: "dist/preload/preload.js" }),
]);
