#!/usr/bin/env python3
"""Audit one analysed clip from the desktop app: tracking, seat labels, viewer stepping, metrics.

Usage:
    python3 clip_audit.py CLIP_FOLDER                      # print every table
    python3 clip_audit.py CLIP_FOLDER --render 0 33 300    # also write seat overlays to ./audit_frames

CLIP_FOLDER is the clip's folder in the app's library (on Linux: ~/.config/RowVision/clips/<id>) and
must hold summary.json, frames.json and working.mp4. Needs numpy, plus Pillow for --render, and
ffprobe (and ffmpeg for --render) on PATH, or pass --ffprobe / --ffmpeg.

It reads the saved results only. It never changes the clip, and nothing it prints is meant to be
committed: the clip's poses are keypoint data of real people, which the repository does not hold.
"""

import argparse
import bisect
import collections
import json
import math
import re
import subprocess
import sys
import warnings
from pathlib import Path

import numpy as np

warnings.simplefilter("ignore", RuntimeWarning)

COCO = ["nose", "Leye", "Reye", "Lear", "Rear", "Lsho", "Rsho", "Lelb", "Relb", "Lwri", "Rwri",
        "Lhip", "Rhip", "Lkne", "Rkne", "Lank", "Rank"]
BONES = [(5, 6), (5, 7), (7, 9), (6, 8), (8, 10), (5, 11), (6, 12), (11, 12), (11, 13), (13, 15), (12, 14), (14, 16)]
SEAT_COLOURS = ["#ff5252", "#ffa726", "#ffee58", "#9ccc65", "#26c6da", "#42a5f5", "#ab47bc", "#ffffff"]


def heading(text):
    print(f"\n{'=' * 78}\n{text}\n{'=' * 78}")


def runs(mask):
    """(start, end) pairs, end exclusive, of consecutive True values."""
    out, start = [], None
    for index, value in enumerate(list(mask) + [False]):
        if value and start is None:
            start = index
        if not value and start is not None:
            out.append((start, index))
            start = None
    return out


class Clip:
    def __init__(self, folder, ffprobe):
        self.folder = Path(folder)
        self.summary = json.loads((self.folder / "summary.json").read_text())
        self.frames_data = json.loads((self.folder / "frames.json").read_text())
        self.n = self.summary["frames"]
        self.fps = self.summary["fps"]
        self.shots = self.summary["shots"]
        self.crew = self.frames_data["crew"]
        self.ffprobe = ffprobe

    def poses(self, seat):
        return self.crew[str(seat)]["poses"]

    def centre(self, pose):
        """Body centre: mean of the confident shoulders and hips."""
        points = [pose[i] for i in (5, 6, 11, 12) if pose[i] and pose[i][2] > 0.3]
        if not points:
            return None
        return (sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points))

    def trunk(self, pose):
        if not all(pose[i][2] > 0.3 for i in (5, 6, 11, 12)):
            return None
        shoulders = ((pose[5][0] + pose[6][0]) / 2, (pose[5][1] + pose[6][1]) / 2)
        hips = ((pose[11][0] + pose[12][0]) / 2, (pose[11][1] + pose[12][1]) / 2)
        return math.dist(shoulders, hips)

    def centres(self, seat):
        out = np.full((self.n, 2), np.nan)
        for index, pose in enumerate(self.poses(seat)):
            c = pose and self.centre(pose)
            if c:
                out[index] = c
        return out

    def pts(self):
        """Presentation timestamps of every frame in working.mp4, in seconds."""
        text = subprocess.check_output(
            [self.ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "frame=pts_time",
             "-of", "csv=p=0", str(self.folder / "working.mp4")], text=True)
        return [float(re.match(r"-?[\d.]+", line).group()) for line in text.split()]


def coverage(clip):
    heading("1. Pose coverage per seat (share of frames that have a pose), overall and per shot")
    head = " | ".join(f"{s['kind']} {s['start']}-{s['end']}" for s in clip.shots)
    print(f"seat |  all  | {head}")
    for seat in range(1, 9):
        poses = clip.poses(seat)
        row = [f"{sum(1 for p in poses if p) / clip.n:5.1%}"]
        for shot in clip.shots:
            length = shot["end"] - shot["start"]
            row.append(f"{sum(1 for i in range(shot['start'], shot['end']) if poses[i]) / length:6.1%}")
        print(f"  {seat}  | " + " | ".join(row))
    print("\nTracked runs and gaps (frames) for the end seats and one middle seat:")
    for seat in (8, 7, 6, 1, 4):
        have = [bool(p) for p in clip.poses(seat)]
        print(f" seat {seat}: tracked {runs(have)}")
        print(f"         gaps    {[(a, b, b - a) for a, b in runs([not h for h in have])]}")


def identity(clip):
    heading("2. Identity checks: far-boat intrusion, duplicates, order, teleports")
    centres = np.stack([clip.centres(s) for s in range(1, 9)])
    trunks = []
    for seat in range(1, 9):
        values = [clip.trunk(p) for p in clip.poses(seat) if p]
        trunks.append(np.median([v for v in values if v]))
    trunk_px = float(np.median(trunks))
    print(f"median trunk length {trunk_px:.0f}px (per seat {[round(float(t)) for t in trunks]})")
    height = np.nanmedian(centres[:, :, 1], axis=0)
    print("\nSuspects: centre more than 1 trunk off the crew's median height, or trunk under 70% of the")
    print("clip median. Height is a strong sign of the other boat; a small trunk can also just mean the")
    print("boat is receding, so check the late frames by eye before counting them.")
    for seat in range(1, 9):
        sizes = np.full(clip.n, np.nan)
        for index, pose in enumerate(clip.poses(seat)):
            size = pose and clip.trunk(pose)
            if size:
                sizes[index] = size
        off = np.abs((centres[seat - 1, :, 1] - height) / trunk_px) > 1.0
        bad = (off | (sizes < 0.7 * trunk_px)) & np.isfinite(centres[seat - 1, :, 0])
        long = [r for r in runs(bad) if r[1] - r[0] >= 3]
        print(f" seat {seat}: height-off {int(np.nansum(off & np.isfinite(centres[seat - 1, :, 0]))):3d}"
              f" | any suspect {int(bad.sum()):3d} | runs>=3 {long[:8]}{' ...' if len(long) > 8 else ''}")
    gaps = [centres[a + 1, i, 0] - centres[a, i, 0] for i in range(clip.n) for a in range(7)
            if np.isfinite(centres[a, i, 0]) and np.isfinite(centres[a + 1, i, 0])]
    usual = float(np.median(gaps))
    print(f"\nUsual spacing between neighbouring seats: {usual:.0f}px ({usual / trunk_px:.2f} trunks)")
    print("Neighbours both tracked: frames out of order (x decreases) / closer than half the usual spacing")
    for a in range(7):
        both = order = close = 0
        for i in range(clip.n):
            x1, x2 = centres[a, i, 0], centres[a + 1, i, 0]
            if np.isfinite(x1) and np.isfinite(x2):
                both += 1
                if x2 < x1:
                    order += 1
                elif x2 - x1 < 0.5 * usual:
                    close += 1
        print(f" seats {a + 1}->{a + 2}: both {both:4d} | out of order {order:3d} | too close {close:3d}")
    print("\nCentre jumps over 1.5 trunks between consecutive frames:")
    for seat in range(1, 9):
        jumps = np.where(np.linalg.norm(np.diff(centres[seat - 1], axis=0), axis=1) / trunk_px > 1.5)[0]
        print(f" seat {seat}: {len(jumps)} {jumps[:8].tolist()}")
    return centres, trunk_px


def seat_positions(clip, frames):
    heading("3. Centre x of each seat on chosen frames (compare with a picture; '.' = no pose)")
    print("frame | " + " ".join(f"s{s:>4}" for s in range(1, 9)))
    for frame in frames:
        cells = []
        for seat in range(1, 9):
            pose = clip.poses(seat)[frame]
            c = pose and clip.centre(pose)
            cells.append(f"{c[0]:5.0f}" if c else "    .")
        print(f"{frame:5d} | " + " ".join(cells))


def viewer_stepping(clip):
    heading("4. Viewer frame mapping and stepping, simulated on the real timestamps")
    times = clip.pts()
    n, fps = len(times), clip.fps
    deltas = collections.Counter(round((b - a) * 15360) for a, b in zip(times, times[1:]))
    print(f"frames in file {n} (summary says {clip.n}); analysis fps {fps:.6f}")
    print(f"timestamp spacing in 1/15360 s ticks (512 = 1/30 s, 768 = 1/20 s): {dict(deltas.most_common(5))}")
    dev = [times[i] * fps - i for i in range(n)]
    print(f"time x fps minus frame number: min {min(dev):+.3f} max {max(dev):+.3f} frames")

    def clamp(value):
        return min(max(round(value), 0), clip.n - 1)

    def seek(target):  # viewer: currentTime = (target + 0.5) / fps; the browser shows the frame in effect
        return max(bisect.bisect_right(times, (clamp(target) + 0.5) / fps + 1e-9) - 1, 0)

    current = lambda i: clamp(math.floor(times[i] * fps + 0.01))  # viewer.tsx line 66 today
    fixed = lambda i: clamp(round(times[i] * fps))  # proposed
    for name, label in (("today: floor(t*fps+0.01)", current), ("proposed: round(t*fps)", fixed)):
        wrong = sum(1 for i in range(n) if label(i) != i)
        fwd = sum(1 for L in range(1, n - 2) if label(seek(L + 1)) <= L)
        back = sum(1 for L in range(1, n - 2) if label(seek(L - 1)) >= L)
        print(f"\n{name}\n  frames whose label is not their true number: {wrong} of {n}"
              f"\n  'Forward 1' does not advance the label from {fwd} of {n - 3} starting labels"
              f"\n  'Back 1' does not retreat from {back}")
    catch = clip.summary["rower"]["catches"][0]
    true = seek(catch)
    print(f"\nJump to the first catch ({catch}): picture is frame {true}; label today {current(true)}, proposed {fixed(true)}")
    label, path = current(seek(catch)), []
    for _ in range(5):
        frame = seek(label + 1)
        label = current(frame)
        path.append((frame, label))
    print(f"5 presses of Forward 1 from there (true frame, label) today: {path}")


def metrics(clip):
    heading("5. Which per-stroke numbers exist, and which are shared by the whole crew")
    crew = clip.summary["crew"]
    first = crew[0]
    print("Same catch frames for every seat:", all(c["catches"] == first["catches"] for c in crew),
          "| same finish frames:", all(c["finishes"] == first["finishes"] for c in crew))
    gaps = collections.Counter(b - a for a, b in zip(first["catches"], first["catches"][1:]))
    print("catch-to-catch frames:", dict(sorted(gaps.items())))
    names = ["catch_lean_deg", "finish_lean_deg", "catch_knee_deg", "finish_knee_deg", "finish_elbow_deg",
             "catch_elbow_deg", "body_swing_deg", "legs_lead", "arms_break", "stroke_length",
             "drive_share", "drive_s", "recovery_s", "ratio"]
    print(f"\nstrokes with a value, out of {len(first['strokes'])}")
    print("seat | " + " ".join(f"{m[:9]:>9}" for m in names))
    for entry in crew:
        print(f"  {entry['seat']}  | " + " ".join(
            f"{sum(1 for s in entry['strokes'] if s.get(m) is not None):9d}" for m in names))
    print("\nDistinct values in the timing fields across all strokes (a measurement per stroke would vary):")
    for entry in crew:
        distinct = {m: len({round(s[m], 6) for s in entry["strokes"] if s.get(m) is not None})
                    for m in ("drive_s", "recovery_s", "drive_share", "ratio")}
        print(f"  seat {entry['seat']}: {distinct}")
    print("\nAngle readouts available (non-null / frames with a pose):")
    for seat in range(1, 9):
        have = sum(1 for p in clip.poses(seat) if p)
        angles = clip.crew[str(seat)]["angles"]
        print(f"  seat {seat}: " + " | ".join(
            f"{k} {sum(1 for v in angles[k] if v is not None)}/{have}" for k in angles))
    print("\nRatings and evidence per seat:")
    for entry in crew:
        rating, evidence = entry["rating"], entry["evidence"]
        overall = clip.summary["crew_summary"]["seats"][entry["seat"] - 1]["overall"]
        print(f"  seat {entry['seat']}: accuracy {rating['accuracy']:.0f} {rating['band']:5s} | coverage "
              f"{evidence['coverage']:.2f} agreement {evidence['agreement']:.2f} trunk {evidence['trunk_px']:.0f}px"
              f" | overall {overall if overall is None else round(overall)} | warnings {rating['warnings']}")


def strokes_by_run(clip, seat=8):
    heading(f"6. Seat {seat}: reported strokes grouped by the tracked run they fall in")
    have = [bool(p) for p in clip.poses(seat)]
    found = runs(have)
    strokes = clip.summary["crew"][seat - 1]["strokes"]
    groups = collections.defaultdict(list)
    for stroke in strokes:
        label = next((f"run {a}-{b}" for a, b in found if a <= stroke["catch_frame"] < b), "no pose at the catch")
        groups[label].append(stroke)
    for label, items in groups.items():
        def stat(name):
            values = [s[name] for s in items if s.get(name) is not None]
            return (len(values), float(np.mean(values)) if values else float("nan"),
                    float(np.std(values)) if values else float("nan"))
        cl, fl = stat("catch_lean_deg"), stat("finish_lean_deg")
        print(f"  {label:24s} strokes {len(items):2d} | catch lean n={cl[0]:2d} mean {cl[1]:6.1f} sd {cl[2]:4.1f}"
              f" | finish lean n={fl[0]:2d} mean {fl[1]:6.1f} sd {fl[2]:4.1f}")
    print("Check each run against the picture (--render) before trusting its numbers as this seat's.")


def joints(clip, trunk_px):
    heading("7. Keypoint confidence and left/right separation (L is the far side when the crew faces right)")
    names = {"sho": (5, 6), "elb": (7, 8), "wri": (9, 10), "hip": (11, 12), "kne": (13, 14), "ank": (15, 16)}
    print("mean score   | " + " ".join(f"{n + 'L':>6}{n + 'R':>6}" for n in names))
    for seat in range(1, 9):
        poses = [p for p in clip.poses(seat) if p]
        print(f"  seat {seat}    | " + " ".join(
            f"{np.mean([p[a][2] for p in poses]):6.2f}{np.mean([p[b][2] for p in poses]):6.2f}"
            for a, b in names.values()))
    print("\nShare of tracked frames where the left and right joint are within 0.35 trunk of each other:")
    for seat in range(1, 9):
        poses = [p for p in clip.poses(seat) if p]
        knees = np.mean([math.dist(p[13][:2], p[14][:2]) < 0.35 * trunk_px for p in poses])
        shoulders = np.mean([math.dist(p[5][:2], p[6][:2]) < 0.35 * trunk_px for p in poses])
        print(f"  seat {seat}: knees {knees:5.1%} | shoulders {shoulders:5.1%}")


def views(clip):
    heading("8. Camera angle estimate per shot (SIDE_ON up to 25 deg, OBLIQUE up to 60 deg)")
    values = np.array(clip.frames_data["views"], dtype=float)
    for shot in clip.shots:
        v = values[shot["start"]:shot["end"]]
        print(f"  {shot['kind']:8s} {shot['start']:4d}-{shot['end']:4d}: mean {np.nanmean(v):5.1f} "
              f"min {np.nanmin(v):5.1f} max {np.nanmax(v):5.1f} share>25 {np.nanmean(v > 25):4.0%}")
    print(f"  summary view_deg {clip.summary['view_deg']:.2f}; frames estimated above 25: {int(np.nansum(values > 25))}")


def frame_detail(clip, spots):
    heading("9. Per-seat detail on chosen (seat, frame) pairs: angles, scores and separations only")
    for seat, frame in spots:
        pose = clip.poses(seat)[frame]
        angles = clip.crew[str(seat)]["angles"]
        shown = {k: (None if angles[k][frame] is None else round(angles[k][frame])) for k in angles}
        if not pose:
            print(f"  seat {seat} frame {frame}: no pose; angles {shown}")
            continue
        trunk = clip.trunk(pose) or float("nan")
        sep = lambda a, b: round(math.dist(pose[a][:2], pose[b][:2]) / trunk, 2)
        scores = {COCO[j]: round(pose[j][2], 2) for j in (5, 6, 13, 14, 15, 16)}
        print(f"  seat {seat} frame {frame}: angles {shown} trunk {trunk:.0f}px | L-R sep in trunks: "
              f"shoulder {sep(5, 6)} knee {sep(13, 14)} ankle {sep(15, 16)} | scores {scores}")


def render(clip, frames, ffmpeg, out):
    from PIL import Image, ImageDraw, ImageFont

    out.mkdir(exist_ok=True)
    video = clip.folder / "working.mp4"
    font = ImageFont.load_default(size=34)
    for frame in frames:
        raw = out / f"raw_{frame}.png"
        subprocess.run([ffmpeg, "-v", "error", "-y", "-ss", f"{(frame + 0.5) / clip.fps:.4f}", "-i", str(video),
                        "-frames:v", "1", "-vf", "scale=1600:-2", str(raw)], check=True)
        image = Image.open(raw).convert("RGB")
        scale = image.width / json.loads((clip.folder / "video.json").read_text())["width"]
        draw = ImageDraw.Draw(image)
        for seat in range(1, 9):
            pose = clip.poses(seat)[frame]
            if not pose:
                continue
            colour = SEAT_COLOURS[seat - 1]
            for a, b in BONES:
                if pose[a][2] > 0.3 and pose[b][2] > 0.3:
                    draw.line([pose[a][0] * scale, pose[a][1] * scale, pose[b][0] * scale, pose[b][1] * scale],
                              fill=colour, width=3)
            c = clip.centre(pose)
            if c:
                draw.text((c[0] * scale - 8, c[1] * scale - 34), str(seat), fill=colour, stroke_width=3,
                          stroke_fill="black", font=font)
        image.save(out / f"seats_{frame}.png")
        print("wrote", out / f"seats_{frame}.png")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("clip", help="the clip's folder in the app's library")
    parser.add_argument("--ffprobe", default="ffprobe")
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--render", type=int, nargs="*", help="frames to draw the seat overlay on")
    args = parser.parse_args()
    clip = Clip(args.clip, args.ffprobe)
    print(f"clip {clip.folder.name}: {clip.n} frames at {clip.fps:.4f} fps, shots {[(s['kind'], s['start'], s['end']) for s in clip.shots]}")
    coverage(clip)
    _, trunk_px = identity(clip)
    seat_positions(clip, [0, 20, 33, 60, 150, 300, 400, 500, 600, 689, 800, 1000, 1200, 1500, 1750])
    try:
        viewer_stepping(clip)
    except (OSError, subprocess.CalledProcessError) as error:
        print(f"\n(section 4 skipped: could not run {clip.ffprobe}: {error})", file=sys.stderr)
    metrics(clip)
    strokes_by_run(clip, 8)
    joints(clip, trunk_px)
    views(clip)
    frame_detail(clip, [(3, 33), (3, 34), (5, 33), (5, 34), (6, 221), (6, 222)])
    if args.render:
        render(clip, args.render, args.ffmpeg, Path("audit_frames"))


if __name__ == "__main__":
    main()
