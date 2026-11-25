// The report pages shown on reports.html, made by the desktop app's own report code.
//
//   node pipeline/make_reports.mjs stats                     the made-up sample crew, into public/reports (kept in git)
//   node pipeline/make_reports.mjs frames <clip folder> <seat> <seats> <boat>   real pictures, into public/media/reports (never in git)
//
// Needs apps/desktop installed, Chromium and pdftocairo (poppler).
import { execFileSync } from 'node:child_process';
import { createReadStream, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const here = import.meta.dirname, desktop = resolve(here, '../../desktop'), web = resolve(here, '../../web'), site = resolve(here, '..');
const need = createRequire(join(desktop, 'package.json'));
const { build } = need('esbuild'), { chromium } = need('playwright');
const temp = mkdtempSync(join(tmpdir(), 'rowvision-reports-'));
const font = name => `data:font/woff2;base64,${readFileSync(join(site, `node_modules/@fontsource-variable/${name}/files/${name}-latin-wght-normal.woff2`)).toString('base64')}`;
const FONTS = [{ family: 'Bricolage Grotesque Variable', src: font('bricolage-grotesque') }, { family: 'DM Sans Variable', src: font('dm-sans') }];
const bundle = (entry, outfile, extra) => build({ entryPoints: [join(here, entry)], outfile, bundle: true, alias: { '@': web }, logLevel: 'error', ...extra });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium' });

async function stats() {
  const out = join(site, 'public/reports');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(temp, 'entry.ts'), `export { sampleStats } from ${JSON.stringify(join(here, 'sample-crew.ts'))}; export { statsDocument, statsPages } from ${JSON.stringify(join(desktop, 'src/renderer/stats-report.ts'))};`);
  await build({ entryPoints: [join(temp, 'entry.ts')], outfile: join(temp, 'stats.mjs'), bundle: true, format: 'esm', platform: 'node', alias: { '@': web }, logLevel: 'error' });
  const { sampleStats, statsDocument, statsPages } = await import(join(temp, 'stats.mjs'));
  const sample = sampleStats(), page = await browser.newPage();
  await page.setContent(statsDocument(sample, readFileSync(join(desktop, 'src/renderer/stats.css'), 'utf8'), FONTS));
  await page.evaluate(() => document.fonts.ready);
  const pdf = join(out, 'sample-statistics.pdf');
  await page.pdf({ path: pdf, printBackground: true, preferCSSPageSize: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
  statsPages(sample).forEach((_, n) => execFileSync('pdftocairo', ['-svg', '-f', n + 1, '-l', n + 1, pdf, join(out, `statistics-${n + 1}.svg`)].map(String)));
}

async function frames(clip, seat, seats, boat) {
  const out = join(site, 'public/media/reports');
  mkdirSync(out, { recursive: true });
  await bundle('report-frames-entry.ts', join(temp, 'frames.js'), { format: 'iife' });
  const faces = FONTS.map(f => `@font-face{font-family:"${f.family}";src:url(${f.src}) format("woff2");font-weight:100 1000}`).join('');
  const css = readFileSync(join(desktop, 'src/renderer/report.css'), 'utf8');
  const server = createServer((req, res) => {
    const name = req.url.replace(/^\/clip\//, '');
    if (['summary.json', 'frames.json', 'working.mp4'].includes(name)) {
      const file = join(clip, name), size = statSync(file).size, m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? ''), from = m ? +m[1] : 0, to = m && m[2] ? +m[2] : size - 1;
      res.writeHead(m ? 206 : 200, { 'content-type': name.endsWith('mp4') ? 'video/mp4' : 'application/json', 'accept-ranges': 'bytes', 'content-length': to - from + 1, ...(m && { 'content-range': `bytes ${from}-${to}/${size}` }) });
      createReadStream(file, { start: from, end: to }).pipe(res);
    } else if (req.url === '/frames.js') res.end(readFileSync(join(temp, 'frames.js')));
    else { res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><meta charset="utf-8"><style>${faces}body{margin:0;font-family:"DM Sans Variable"}#sheet{width:840px}${css}</style><b style="font-family:'Bricolage Grotesque Variable'">.</b><div id="sheet"></div><script src="/frames.js"></script>`); }
  }).listen(0, '127.0.0.1');
  const page = await browser.newPage({ viewport: { width: 840, height: 1188 }, deviceScaleFactor: 1.5 });
  page.on('pageerror', e => console.error(e));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(() => document.fonts.ready);
  const layouts = await page.evaluate(([seat, seats, boat]) => window.makeReport(seat, seats, boat), [+seat, +seats, boat]);
  for (const { id, pages } of layouts) {
    await page.evaluate(html => { document.getElementById('sheet').innerHTML = html; return Promise.all([...document.images].map(i => i.decode())); }, pages[0]);
    await page.locator('.rvr-sheet').screenshot({ path: join(out, `pair-${id}.jpg`), type: 'jpeg', quality: 84 });
  }
  server.close();
}

const [what, ...rest] = process.argv.slice(2);
try { await (what === 'frames' ? frames(...rest) : stats()); } finally { await browser.close(); rmSync(temp, { recursive: true, force: true }); }
