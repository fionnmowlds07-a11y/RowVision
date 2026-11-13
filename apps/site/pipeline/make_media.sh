#!/usr/bin/env bash
# Cut the site's clips and still frames from the owner's footage. Run from apps/site:
#
#   bash pipeline/make_media.sh ../../videos
#
# Everything lands in public/media/, which git ignores: the footage shows real people and never goes in the repo.
# The pose files in public/data/ were made from the same cuts with pipeline/clip_pose.py, so start and length must not change:
#   pair      34 s to 50 s of VID-20250921-WA0000, following the rower furthest right (stroke seat)
#   single-a   2 s to 20 s of VID-20251027-WA0013
#   single-b   0 s to 10.9 s of VID-20251027-WA0009
#   bank      10 s to 24 s of PXL_20251115_113706067~2
set -euo pipefail
V="${1:?folder holding the source videos}"; O=public/media; mkdir -p "$O"
cut() { ffmpeg -v error -y -ss "$2" -t "$3" -i "$V/$1" -an -vf "${5:-null}" -c:v libx264 -preset slow -crf 26 -g 12 -pix_fmt yuv420p -movflags +faststart "$O/$4.mp4"; }
cut "VID-20250921-WA0000.mp4" 34 16 pair
cut "VID-20250921-WA0000.mp4" 17 10 astern
cut "VID-20250921-WA0000.mp4" 0.5 9 far
cut "VID-20251027-WA0013.mp4" 2 18 single-a
cut "VID-20251027-WA0009.mp4" 0 10.9 single-b
cut "PXL_20251115_113706067~2.mp4" 10 14 bank scale=960:540
# the first picture the hero shows, before any video has loaded
ffmpeg -v error -y -ss 2 -i "$O/pair.mp4" -frames:v 1 -q:v 4 "$O/pair-poster.jpg"
du -sh "$O"
