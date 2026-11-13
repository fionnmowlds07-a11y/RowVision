# RowVision marketing site

Static Vite site with four pages: the home page film (`index.html`), How it works, About and Download.

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
