# Intake

Receives clips athletes choose to send from the desktop app (#156). The app asks for a send, gets one-time upload links (one per file, usable once, for an hour), uploads the working copy and `meta.json`, then marks it done. The app never holds storage keys.

This is the local stand-in, saving to a folder. A hosted version would hand out Cloudflare R2 presigned links instead. Nothing is deployed and no account is made without the owner's go-ahead.

- `npm start` runs it on `127.0.0.1:8787`, saving to `received/` (`INTAKE_FOLDER`, `PORT`).
- `GET /admin/sends` with `Authorization: Bearer $INTAKE_ADMIN_TOKEN` lists what came in, for the owner.
- Point the app at it with `ROWVISION_SEND_URL=http://127.0.0.1:8787`. Without it, the Send button does not show.
- `npm test` runs its tests.
