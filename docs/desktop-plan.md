# Desktop app plan

Decided by the owner on 7 November 2026. See `docs/adr/0005-desktop-app-first.md`. The work is in the GitHub milestone "10 Desktop app".

## What stays the same

The analysis engine, working copy, scoring, results, frame viewer, 3D model, colours and the look in `DESIGN.md`.

## What changes

| Area | Website | Desktop app |
|---|---|---|
| Where analysis runs | Worker on one machine | The user's computer |
| Storage | Supabase | A folder on the user's computer |
| Sign-in | Emailed code | None |
| Waiting | Shared queue, result email | One clip analysed at a time, others wait in a queue, with a desktop notification |
| Keeping video | Deleted after 30 days | Kept until the user deletes it, with the space used shown |
| Training clips | Admin copies them | The user presses a send button for each clip |
| Admin page, "Something wrong?" | In the app | Reports go with a sent clip |

## Screens picked

Picked by the owner on 8 November 2026 from the mock-ups in #150:

- First run: option A, three steps (where clips are kept, colours, model download). Built in #175; the download itself waits for #157.
- Clip library: option B, a table with a side menu and the space used.
- Analysis running: option A, its own screen with stages, cancel, a notification when done, and a list of clips waiting next.
- Sending a clip: option A.

Sent clips cannot be removed from the app afterwards, so no "Remove sent clip" button.

## How it fits together

- `apps/desktop`: Electron, with a React page that reuses the web app's results, viewer, 3D model and logic.
- The engine runs as a separate bundled program, without needing Python installed. It reports progress as lines of JSON, and can be cancelled.
- Each clip is a folder holding the working copy, the summary and the per-frame data.
- The web app and worker keep working, so the owner can still preview.

## Open questions

- Where testers download the app, as the repo is private.
- What receives training clips. It must not put storage keys inside the app, and it may not be deployed without asking the owner.
- Whether the Windows GPU option makes analysis fast enough to matter.

## Order

1. #134 goes first for the scores, on a night when the laptop is free. Desktop work that does not touch scores can run alongside it.
2. Prove the engine can be bundled and run on Linux and Windows.
3. Build the app, then the installers.
4. Test on real Windows laptops.
5. Android speed test, then decide on Android.
