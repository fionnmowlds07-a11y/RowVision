"""Fit the home page stroke to real sculling.

Input: a pose file from single_pose.py run on side-on footage of a sculler (17 COCO points per frame).
Output: src/stroke-data.js, three curves over one stroke cycle, each 0 at the catch position and 1 at the
finish position: legs (seat travel), back (trunk swing) and arms (draw), plus the share of the cycle
spent on the drive.

  python fit_stroke.py elite_pose.json ../src/stroke-data.js
"""
import json
import sys

import numpy as np

src, out = sys.argv[1:3]
P = json.load(open(src))
fps, ar = P["fps"], P["w"] / P["h"]
F = np.array([f if f else [[np.nan] * 3] * 17 for f in P["frames"]], float)
F[..., 0] *= ar                                   # square pixels
conf = np.nan_to_num(F[..., 2])
side = 0 if conf[:, [5, 7, 9, 11, 13, 15]].sum() >= conf[:, [6, 8, 10, 12, 14, 16]].sum() else 1
SH, EL, WR, HP, KN, AN = [i + side for i in (5, 7, 9, 11, 13, 15)]
ok = conf[:, [SH, EL, WR, HP, KN, AN]].mean(1) > 0.3
xy = F[..., :2]


def smooth(a, k=5):
    k |= 1
    w = np.hanning(k + 2)[1:-1]; w /= w.sum()
    return np.convolve(np.pad(a, k // 2, mode="edge"), w, mode="valid")


def angle(a, b, c):
    u, v = a - b, c - b
    return np.degrees(np.arccos(np.clip((u * v).sum(1) / (np.linalg.norm(u, axis=1) * np.linalg.norm(v, axis=1) + 1e-9), -1, 1)))


raw = {k: np.nan_to_num(xy[:, i]) for k, i in dict(sh=SH, el=EL, wr=WR, hp=HP, kn=KN, an=AN).items()}
# The clip may be slow motion, so find the stroke period first (autocorrelation of the knee angle).
k0 = angle(raw["hp"], raw["kn"], raw["an"]); k0 = k0 - k0.mean()
ac = np.correlate(k0, k0, "full")[len(k0) - 1:]
lo = max(int(fps * 1.2), int(np.argmax(ac < 0)))       # skip past the first dip so lag 0 is not picked
period_f = lo + int(np.argmax(ac[lo:len(k0) * 2 // 3]))
win = max(5, period_f // 30)
pts = {k: np.stack([smooth(v[:, 0], win), smooth(v[:, 1], win)], 1) for k, v in raw.items()}
facing = np.sign(np.nanmedian(pts["an"][ok, 0] - pts["hp"][ok, 0]))   # +1 if the stern is to the right
knee = angle(pts["hp"], pts["kn"], pts["an"])
elbow = angle(pts["sh"], pts["el"], pts["wr"])
lean = np.degrees(np.arctan2((pts["sh"][:, 0] - pts["hp"][:, 0]) * facing, pts["hp"][:, 1] - pts["sh"][:, 1]))

# Catches: the knees at their tightest, once per period.
half = period_f // 2
ks = smooth(knee, win * 2)
catches = [i for i in range(len(ks)) if ks[i] == ks[max(0, i - half):i + half + 1].min() and ks[i] < np.percentile(ks, 25)]
N = 64
cycles = []
for a, b in zip(catches, catches[1:]):
    if not (0.75 * period_f < b - a < 1.3 * period_f) or ok[a:b].mean() < 0.85:
        continue
    t = np.linspace(a, b, N, endpoint=False)
    cycles.append([np.interp(t, np.arange(len(v)), v) for v in (knee, lean, elbow)])
cycles = np.array(cycles)
period = period_f / fps
knee_c, lean_c, elbow_c = np.median(cycles, 0)
print(f"{len(cycles)} strokes used; one stroke lasts {period:.1f} s in the clip (slow motion if that is long)")


def lowpass(v, harmonics=6):
    f = np.fft.rfft(v); f[harmonics + 1:] = 0
    return np.fft.irfft(f, len(v))


def unit(v, lo, hi):
    return np.clip((v - lo) / (hi - lo), 0, 1)


# Angles to distances, so the curves are travel rather than joint angle.
TH, CA, UP, FO = 0.52, 0.461, 0.293, 0.284
seat = np.sqrt(TH**2 + CA**2 - 2 * TH * CA * np.cos(np.radians(knee_c)))
draw = np.sqrt(UP**2 + FO**2 - 2 * UP * FO * np.cos(np.radians(elbow_c)))
seat, lean_s, draw = lowpass(seat), lowpass(lean_c), lowpass(draw)
# With the legs down the knees are half hidden by the oar and gunwale and the estimate wobbles; the seat is
# simply at backstops there, so take the level of that plateau as "legs down".
flat = np.median(seat[seat > seat.min() + 0.8 * (seat.max() - seat.min())])
legs = lowpass(unit(seat, seat.min(), flat), 8)
legs = unit(legs, legs.min(), 0.985)
back = unit(-lean_s, -lean_s.max(), -lean_s.min())
arms = unit(-draw, -draw.max(), -draw.min())
# Start the cycle where the legs begin to go down, and call the drive over when the hands stop coming in.
shift = int(np.argmin(lowpass(seat)))
legs, back, arms = (np.roll(v, -shift) for v in (legs, back, arms))
# Recovery slide. Near the catch the hands and oar handle pass in front of the knees and the knee estimate
# lags and then jumps, which would read as rushing the slide. The data is trusted for WHEN the seat leaves
# backstops; the slide from there to the catch is a steady roll that eases out and eases in to the catch.
start = max(i for i in range(N // 2, N) if legs[i] > 0.97)
u = (np.arange(start, N + 1) - start) / (N - start)
ramp = 0.22                                           # share of the slide spent speeding up, and slowing down
vmax = 1 / (1 - ramp)
prof = np.where(u < ramp, vmax * u * u / (2 * ramp), np.where(u > 1 - ramp, 1 - vmax * (1 - u) ** 2 / (2 * ramp), vmax * (u - ramp / 2)))
legs[start:] = 1 - prof[:-1]
legs[:3] = np.minimum(legs[:3], [0.0, 0.05, 0.16])   # and it leaves the catch from rest
legs = np.clip(lowpass(legs, 10), 0, 1)
drive = float(np.argmax(arms)) / N
print(f"knee {knee_c.min():.0f}-{knee_c.max():.0f} deg, lean {lean_c.max():+.0f} to {lean_c.min():+.0f} deg, elbow {elbow_c.min():.0f}-{elbow_c.max():.0f} deg, drive {drive:.2f} of the cycle")
for name, v in (("legs", legs), ("back", back), ("arms", arms)):
    print(name, " ".join(f"{x:.2f}" for x in v[::4]))

fmt = lambda v: "[" + ",".join(f"{x:.4f}".rstrip("0").rstrip(".") for x in v) + "]"
open(out, "w").write(
    "// Stroke curves over one cycle, fitted to side-on footage of an elite sculler by pipeline/fit_stroke.py.\n"
    "// Each runs from 0 (catch position) to 1 (finish position); index 0 is the catch.\n"
    f"export const CURVES = {{ drive: {drive:.3f}, legs: {fmt(legs)}, back: {fmt(back)}, arms: {fmt(arms)} }};\n")
print("wrote", out)
