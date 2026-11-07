# 5. A Windows and Linux app comes first

**Decision:** RowVision ships first as a desktop app for Windows and Linux, built with Electron, with analysis running on the user's own computer. The website stays in the repo as the owner's preview. Android follows only if a speed test on a real phone is good enough.

**Why:** coaches and athletes mostly have laptops, and most testers use Windows. It costs nothing to run, needs no hosting or home PC, and footage stays on the user's computer unless they choose to send it.

**Why Electron:** the frame viewer needs Chromium's exact frame reporting and H.264 playback, and Electron brings the same Chromium to both systems. Tauri would use a different browser on each one.

**Cost:** Macs and iPhones are left out. There is no admin view, and fixes reach people only when they install a new version. Unsigned Windows apps show a security warning. Speed depends on each user's computer. Training clips arrive only when someone presses send.
