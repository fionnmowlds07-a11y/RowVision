# 1. One working copy for analysis and viewing

**Decision:** the worker makes one H.264 file with one output frame per decoded frame, at a constant rate. Analysis and the browser both use it.

**Why:** real clips have uneven timing and many are HEVC, so a browser cannot be trusted to show the frame an overlay was measured on. One shared file makes frame N the same everywhere.

**Evidence:** `docs/spikes/working-copy.md`. All frames were exact, and scores matched the original within noise on the one clip compared.

**Cost:** the upload is deleted once the copy exists, so a different section needs a new upload.
