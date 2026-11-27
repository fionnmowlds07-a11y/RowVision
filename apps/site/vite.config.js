import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';

const PAGES = ['index', 'how', 'measures', 'accuracy', 'filming', 'boats', 'reports', 'privacy', 'terms', 'licences', 'code-signing', 'download'];
const part = name => readFileSync(resolve(import.meta.dirname, 'partials', `${name}.html`), 'utf8');

// Every page shares one header and footer. They are written into the HTML when it is served or built,
// so each page is still a whole page without script. The link to the page being read is marked.
const chrome = {
  name: 'site-chrome',
  transformIndexHtml: {
    order: 'pre',
    handler(html, ctx) {
      const here = '/' + ctx.path.replace(/^\//, '').replace(/^index\.html$/, '');
      const mark = s => s.replaceAll(`href="${here}"`, `href="${here}" aria-current="page"`);
      return html.replace('<!--head-->', part('head')).replace('<!--nav-->', mark(part('nav'))).replace('<!--foot-->', mark(part('foot')));
    },
  },
};

// The download buttons go to /get/<file>, where worker/index.js counts the click and sends the browser on.
// It finds the installer addresses in downloads.json, written here from .env so they are set in one place.
const downloads = {
  name: 'download-addresses',
  generateBundle() {
    const env = loadEnv('production', import.meta.dirname, 'VITE_');
    const files = { deb: env.VITE_DEB_URL, appimage: env.VITE_LINUX_URL, windows: env.VITE_WINDOWS_URL };
    for (const [file, url] of Object.entries(files)) if (!url) this.error(`No address for the ${file} download in .env`);
    this.emitFile({ type: 'asset', fileName: 'downloads.json', source: JSON.stringify(files) });
  },
};

// The report photos are footage, so like the clips they are never in git and are served from the bucket.
const media = {
  name: 'media-address',
  configResolved(c) { media.base = c.env.VITE_MEDIA_BASE ?? ''; },
  transformIndexHtml: { order: 'pre', handler: html => html.replaceAll('%MEDIA%', media.base) },
};

export default defineConfig({
  plugins: [chrome, media, downloads],
  // es2022: the film waits for its pose data at the top of the module
  build: { target: 'es2022', rollupOptions: { input: Object.fromEntries(PAGES.map(n => [n, resolve(import.meta.dirname, `${n}.html`)])) } },
});
