# RowVision marketing site

Static Vite site with twelve pages: the home page film (`index.html`), How it works, What it measures, Accuracy, Filming, Boats and crews, Reports to print, Your video, Where it is now, Questions, About and Download.

Every page shares one header and footer, kept in `partials/` and written into the HTML by a small plugin in `vite.config.js`, so each page is whole without script. To add a page, add its name to `PAGES` there and link it from `partials/nav.html` and `partials/foot.html`.

Three pages have something to try, each fed by real figures and none by invented ones:

- `src/explorer.js` (What it measures): one rower's tracked joints from `public/data/pose-pair.json`, with the angles worked out as you drag.
- `src/dial.js` (Accuracy): a camera moved round a boat, using the engine's own limits of 25° and 60° off side-on.
- `src/seats.js` (Boats and crews): the engine's rule for which rower each seat is timed against.

If the engine's limits, messages or follow rule change, change them here too.

```
npm install
npm run dev        # work on it
npm run build      # dist/
npm run preview    # serve dist/
```

## The film

The home page is one pinned stage driven by scroll position (`src/film.js`). Scrolling is the browser's own: nothing takes over the wheel, the keys or touch.

- Without script, the page is ordinary headings and text read top to bottom.
- With reduced motion, it is the same page with one still frame for each beat.
- On a phone the film is shorter and keeps every other frame of the scrubbed stroke.
- If frames keep arriving late, the moving water and frame blending are dropped.

## Footage

The clips show real people and are never committed: git ignores `public/media/`. Make them from the source videos with

```
bash pipeline/make_media.sh ../../videos
```

The pose files in `public/data/` were read from the same cuts with `pipeline/clip_pose.py` (rtmlib, onnxruntime, opencv; run with `python -I`), so the start and length of a cut must not change without re-reading its pose.

The clips are cleared for the owner's own preview only. Ask before any of them go on a public site.

## Report pages

`reports.html` shows pages printed by the app's own report code. `pipeline/make_reports.mjs` makes them again after a report changes:

- `node pipeline/make_reports.mjs stats` prints the statistics sheet of a made-up crew (`pipeline/sample-crew.ts`) into `public/reports/`, which is in git. The numbers quoted in `reports.html` are read off it, so check them when it changes. It must stay labelled as made up.
- `node pipeline/make_reports.mjs frames <clip folder> <seat> <seats> <boat>` prints the photo report of one real rower into `public/media/reports/`, which is never in git. Only use a clip cleared for the public site.

## Going live

The site is live at https://rowvision.app on Cloudflare's free plan.

- **Pages:** `wrangler.jsonc` here. `npm run build`, delete `dist/media/`, then `npx wrangler deploy`.
- **Clips:** in the R2 bucket `rowvision-downloads` under `media/`, served at `downloads.rowvision.app`. `src/film.js` reads them from `VITE_MEDIA_BASE` (in `.env`, which git ignores). Each clip is fetched whole and played from memory so scrolling never waits on a seek. A clip must keep its start and length, or its pose file goes out of step.
- **Report photos:** in the same bucket under `media/reports/` (`npx wrangler r2 object put rowvision-downloads/media/reports/<name>.jpg --file public/media/reports/<name>.jpg --remote`). `%MEDIA%` in a page becomes `VITE_MEDIA_BASE`. Upload before anyone opens the page, as Cloudflare keeps a missing file as missing for four hours; a fresh name gets round it.
- **Linux installer:** `RowVision-<version>.AppImage` in the same bucket; the download button reads `VITE_LINUX_URL`. It is over the 300 MB limit of the dashboard and `wrangler r2 object put`, so it goes up through R2's S3 API with a short-lived R2 token.
- **Download counts:** the buttons link to `/get/deb` and `/get/appimage`. `worker/index.js` adds a row (time, file, country; no IP) to the D1 database `rowvision-downloads`, then redirects to the installer. Link previews and HEAD requests are not counted. The addresses go into `dist/downloads.json` from `VITE_DEB_URL` and `VITE_LINUX_URL` at build time. A new database needs `npx wrangler d1 execute rowvision-downloads --remote --file worker/schema.sql` once. To see the counts, open Cloudflare dashboard → Storage & Databases → D1 → rowvision-downloads → Console, or run:

  ```sh
  npx wrangler d1 execute rowvision-downloads --remote --command \
    "SELECT substr(at,1,10) AS day, file, count(*) AS n FROM downloads GROUP BY day, file ORDER BY day DESC"
  ```

  These are clicks on a download button, not people: one person can download twice.
