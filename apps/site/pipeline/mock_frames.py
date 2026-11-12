"""Frames for the mock-ups, cut from the owner's own sculling clip. Output goes to mockups/private/, which git ignores.

  python -I pipeline/mock_frames.py public/media/scull.mp4 public/data/pose-scull.json mockups/private

a/NNN.webp  one stroke as a darkroom print: tight crop that follows the rower, black-and-green, water burned down
c/NNN.jpg   the same stroke as shot, whole frame, for the phone-shaped frame
meta.json   which pose frame each picture is, and where each crop sits in the full frame
"""
import sys, json, os, cv2, numpy as np
src, pose, out = sys.argv[1:4]
FIRST, LAST, STEP = 105, 199, 4          # pose frames of one stroke, catch to catch; the pose is every 4th video frame
CW, CH = 720, 420
d = json.load(open(pose)); F = np.array(d['frames']); W, H = d['w'], d['h']
P = F[:, :, :2] * [W, H]
LIMBS = [(5,7),(7,9),(6,8),(8,10),(5,6),(5,11),(6,12),(11,12),(11,13),(13,15),(12,14),(14,16),(0,5),(0,6)]
def smooth(a, k=4):
    o = np.empty_like(a)
    for i in range(len(a)):
        lo, hi = max(0, i-k), min(len(a), i+k+1); w = (k+1-np.abs(np.arange(lo, hi)-i))[:, None]
        o[i] = (a[lo:hi]*w).sum(0)/w.sum()
    return o
centre = smooth((P[:, [15,16]].mean(1) + P[:, [11,12]].mean(1))/2 - [0, 55])
os.makedirs(f'{out}/a', exist_ok=True); os.makedirs(f'{out}/c', exist_ok=True)
cap = cv2.VideoCapture(src); meta = []
yy, xx = np.mgrid[0:CH, 0:CW]
edge = np.clip(np.minimum(np.minimum(xx, CW-1-xx)/150, np.minimum(yy, CH-1-yy)/90), 0, 1)
edge = edge*edge*(3-2*edge)
for n, i in enumerate(range(FIRST, LAST+1)):
    cap.set(cv2.CAP_PROP_POS_FRAMES, STEP*i); ok, f = cap.read()
    if not ok: break
    x0 = int(np.clip(centre[i,0]-CW/2, 0, W-CW)); y0 = int(np.clip(centre[i,1]-CH/2, 0, H-CH))
    c = f[y0:y0+CH, x0:x0+CW]; p = P[i]-[x0, y0]
    # where the rower and the boat are, as a soft dodge: the body from the pose, the hull as the bright band at the feet
    m = np.zeros((CH, CW), np.float32)
    for a, b in LIMBS: cv2.line(m, tuple(p[a].astype(int)), tuple(p[b].astype(int)), 1, 46)
    cv2.circle(m, tuple(p[0].astype(int)), 34, 1, -1)
    hy = int(p[[15,16],1].mean()); m[hy-14:hy+30, :] = np.maximum(m[hy-14:hy+30, :], .8)
    m = cv2.GaussianBlur(m, (0,0), 24)
    g = cv2.cvtColor(c, cv2.COLOR_BGR2GRAY).astype(np.float32)/255
    g = np.clip((g-.06)*1.25, 0, 1)
    g = g*g*(3-2*g)                                  # a hard paper grade
    g = g*(.24+.76*np.clip(m*1.25, 0, 1))*edge          # burn the water down, leave the rower and hull exposed
    # black to green to near-white, like a toned print
    lo, mid, hi = np.array([0,0,0.]), np.array([108,200,48.]), np.array([225,255,232.])   # BGR
    t = g[..., None]; rgb = np.where(t < .6, lo+(mid-lo)*(t/.6), mid+(hi-mid)*((t-.6)/.4))
    cv2.imwrite(f'{out}/a/{n:03d}.webp', rgb.astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 82])
    cv2.imwrite(f'{out}/c/{n:03d}.jpg', cv2.resize(f, (1280, 720), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 80])
    sharp = float(cv2.Laplacian(cv2.cvtColor(c, cv2.COLOR_BGR2GRAY), cv2.CV_32F).var())
    meta.append({'pose': i, 'x0': x0, 'y0': y0, 'sharp': round(sharp)})
json.dump({'first': FIRST, 'cw': CW, 'ch': CH, 'w': W, 'h': H, 'frames': meta}, open(f'{out}/meta.json', 'w'), separators=(',', ':'))
print(len(meta), 'frames')
