# RowVision marketing site

Static Vite site. `npm run dev` to work on it, `npm run build` for `dist/`.

Media is not committed (the repo ignores all video). Put clips in `public/media/`:

- `scull.mp4` — hero, scroll scene, Why and About (owner's own sculling, no blur needed)
- `eight.mp4` — How it works (crew with every face except 3 seat blurred)

Pose data for each clip lives in `public/data/`. Make it with the scripts in `pipeline/` (rtmlib, onnxruntime, opencv; run with `python -I`).
