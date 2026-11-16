import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const PAGES = ['index', 'how', 'measures', 'accuracy', 'filming', 'boats', 'privacy', 'roadmap', 'faq', 'about', 'download'];
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

export default defineConfig({
  plugins: [chrome],
  // es2022: the film waits for its pose data at the top of the module
  build: { target: 'es2022', rollupOptions: { input: Object.fromEntries(PAGES.map(n => [n, resolve(import.meta.dirname, `${n}.html`)])) } },
});
