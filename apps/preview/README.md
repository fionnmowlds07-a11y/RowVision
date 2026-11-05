# Local preview

A page for checking tracking by eye. Pick a clip, say what boat and seat it is, and step through it frame by frame with limb lines drawn on, jumping between catches and finishes. It runs on your own machine only, and has no accounts, scores, database or cloud.

## Start it

Needs Docker and the `rowvision-vision:dev` image. From the repository root:

```sh
apps/preview/start.sh
```

Then open <http://127.0.0.1:8765>. Press Ctrl+C in the terminal to stop.

| Setting | Default | Meaning |
|---|---|---|
| `ROWVISION_VIDEOS` | `~/CompVisionRowing/videos` | Folder of clips (read only) |
| `ROWVISION_PRIVATE` | `~/CompVisionRowing/private` | Model weights, saved detections and results |
| `PREVIEW_PORT` | `8765` | Port on 127.0.0.1 |

## Using it

- **Left and Right** step one frame, and with **Shift** ten.
- **C** and **F** jump to the next catch or finish, and with **Shift** the previous one.
- **L** hides the limb lines.
- The bar under the video shows catches on top and finishes below. Click or drag it to move.
- Cyan lines are the rower's left side and magenta the right, so a left/right swap is easy to spot. Dashed lines are joints the model scored below 0.3.

Only the chosen seat has limb lines. Only complete strokes have markers, so a catch or finish in a stroke cut off by the clip edge or a gap is not marked.

## How it works

- `rowvision_preview/jobs.py` calls `scout()` and `analyse()` in a background thread, one job at a time. Starting a job or pressing Cancel stops the last one. Progress comes from watching which frame the analysis reads.
- If the analysis needs a boat choice, the job stops and keeps the boats it found, and carries on after the tap.
- Coarse detections saved by `services/vision/scripts/cache_detections.py` in `private/detections/` are used when they match the clip, which skips the first pass.
- Results are saved to `private/preview/results/` as JSON and reused. The file name includes a hash of the analysis code, so results from older code are never shown as current.
- `rowvision_preview/clips.py` serves frames from the same decoder as the analysis, not a browser video element. Real clips have variable timing, so a browser cannot be trusted to show the frame a pose was measured on. Seeking takes most of a second, so the open clip is decoded once into memory, and nothing is written to disk.

## Privacy

Real footage must never be committed. Results hold keypoints from real athletes, so they only go in `private/`, which is ignored by git. Tests use generated data.

The port is published on 127.0.0.1 only. Inside its container the server listens on all interfaces, because Docker could not reach it otherwise, but the host side accepts connections from this machine alone. Requests for any other hostname are refused, so a website cannot reach the page through DNS rebinding.

## Tests

From `apps/preview`, with the vision package installed:

```sh
ruff check . && mypy && pytest --cov=rowvision_preview --cov-fail-under=90
node --test tests/logic.test.mjs
```
