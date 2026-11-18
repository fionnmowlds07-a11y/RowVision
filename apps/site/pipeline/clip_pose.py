"""Pose for one rower through a section of a clip.

  python -I pipeline/clip_pose.py <video> <out.json> <start s> <end s> [best|left|right] [performance|balanced]

The last word says who to follow from the first frame: the clearest person, or the one furthest left or right
(stroke seat in a boat whose crew faces right is `right`). After that the same rower is followed by their hips.
Frame i of the output is the video at start + i / fps.
"""
import sys, json, cv2, numpy as np
from rtmlib import Body
src, out, t0, t1 = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]); who = sys.argv[5] if len(sys.argv) > 5 else 'best'; mode = sys.argv[6] if len(sys.argv) > 6 else 'performance'
m = Body(mode=mode, backend='onnxruntime', device='cpu')
cap = cv2.VideoCapture(src); fps = cap.get(5); W = int(cap.get(3)); H = int(cap.get(4))
cap.set(cv2.CAP_PROP_POS_FRAMES, round(t0*fps)); n = round((t1-t0)*fps); fr = []; prev = None; big = None
for _ in range(n):
    ok, f = cap.read()
    if not ok: break
    kp, sc = m(f); best = None
    for p, s in zip(kp, sc):
        if (s > .3).sum() < 8: continue
        h = (p[11]+p[12])/2; size = np.linalg.norm((p[5]+p[6])/2-h)
        if prev is not None:
            # the same rower is close to where they were and about the same size: a crew passing behind is smaller
            if abs(size-big) > .35*big: continue
            key = -np.linalg.norm(h-prev)
        elif who == 'left': key = -h[0] if size > H*.03 else -1e9
        elif who == 'right': key = h[0] if size > H*.03 else -1e9
        else: key = size*s.mean()
        if best is None or key > best[0]: best = (key, p, s, h, size)
    if best and (prev is None or np.linalg.norm(best[3]-prev) < W*.08):
        prev = best[3]; big = best[4] if big is None else big*.9+best[4]*.1; fr.append([[round(float(x)/W, 4), round(float(y)/H, 4), round(float(c), 2)] for (x, y), c in zip(best[1], best[2])])
    else: fr.append(None)
json.dump({'fps': fps, 'w': W, 'h': H, 'start': t0, 'frames': fr}, open(out, 'w'), separators=(',', ':'))
print(out, len(fr), sum(x is not None for x in fr))
