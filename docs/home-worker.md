# Running the worker on the home PC

The worker only connects outward, so the router needs no changes. It works the same on any machine.

## What you need there

- Docker. On Windows, use Docker Desktop with WSL 2.
- Current NVIDIA drivers, and the NVIDIA Container Toolkit, for the GPU.
- A copy of this repository.
- One visit, or someone at the house, for the first setup.

## Setup

1. Turn on disk encryption, as footage passes through this machine. Use LUKS on Linux or BitLocker on Windows.
2. Turn off sleep, and set "Restore on AC power loss" to on in the BIOS, so that it comes back after a power cut.
3. Install remote access, so that it can be fixed from Limerick. Tailscale's free plan is for non-commercial use.
4. Create a `.env` file beside `compose.yaml`. It never goes in git.

   ```
   DATABASE_URL=...
   SUPABASE_URL=...
   SUPABASE_SERVICE_KEY=...
   SMTP_HOST=...
   SMTP_PORT=...
   APP_URL=...
   WORKER_ID=home-pc
   ```

5. Start it. `restart: unless-stopped` brings it back after a restart.

   ```bash
   docker compose up -d --build worker
   ```

   The models download once, on the first clip.

## The GPU

`services/worker/Dockerfile.gpu` builds an image that uses the GTX 1650. **It has not been run on real hardware yet.** Before relying on it:

1. Build it and run it with `--gpus all`.
2. Analyse the same clip on GPU and CPU.
3. Compare the time, the memory used, and the scores. The card has 4 GB.

On CPU alone, that PC is estimated to take about 11 minutes for a 32-second clip.

## Checking on it

The admin page shows when the worker was last seen. If it stops, clips wait in the queue, athletes see that analysis is paused, and a job left half done goes back in the queue by itself. It has one retry, then fails with a plain message.

## What to know

- Electricity is roughly €10 to €20 a month if it is always on. This is an estimate.
- If the power or broadband drops, analysis pauses until it returns. Nothing is lost.
- Analysis takes all the CPU while it runs, so the PC will be slow for anything else.
