import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Four real pages, so each has its own address, title and headings.
export default defineConfig({
  // es2022: the film waits for its pose data at the top of the module
  build: { target: 'es2022', rollupOptions: { input: Object.fromEntries(['index', 'how', 'about', 'download'].map(n => [n, resolve(import.meta.dirname, `${n}.html`)])) } },
});
