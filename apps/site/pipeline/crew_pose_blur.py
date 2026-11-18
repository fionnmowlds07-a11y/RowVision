import sys, json, cv2, numpy as np
from rtmlib import Body
src, out_vid, out_json = sys.argv[1:4]
m = Body(mode="performance", backend="onnxruntime", device="cpu")
cap = cv2.VideoCapture(src); fps = cap.get(5); W=int(cap.get(3)); H=int(cap.get(4))
vw = cv2.VideoWriter(out_vid, cv2.VideoWriter_fourcc(*"mp4v"), fps, (W,H))
frames=[]; prev=None
def hip(p): return (p[11]+p[12])/2
while True:
    ok, f = cap.read()
    if not ok: break
    kp, sc = m(f)
    ppl=[(p,s) for p,s in zip(kp,sc) if (s>0.3).sum()>=8]
    if prev is None:
        order=sorted(ppl,key=lambda q:hip(q[0])[0]); tgt=order[2] if len(order)>2 else None
    else:
        tgt=min(ppl,key=lambda q:np.linalg.norm(hip(q[0])-prev)) if ppl else None
        if tgt is not None and np.linalg.norm(hip(tgt[0])-prev)>W*0.05: tgt=None
    if tgt is not None: prev=hip(tgt[0])
    for p,s in ppl:
        if tgt is not None and p is tgt[0]: continue
        head=p[:5][s[:5]>0.2]
        if not len(head): head=p[5:7]
        sh=np.linalg.norm(p[5]-p[6]); r=int(max(30,sh*1.0)); cx,cy=head.mean(0).astype(int)
        x0,y0,x1,y1=max(cx-r,0),max(cy-int(r*1.4),0),min(cx+r,W),min(cy+r,H)
        if x1>x0 and y1>y0: f[y0:y1,x0:x1]=cv2.GaussianBlur(f[y0:y1,x0:x1],(0,0),r/2)
    frames.append(None if tgt is None else [[round(float(x)/W,4),round(float(y)/H,4),round(float(c),2)] for (x,y),c in zip(*tgt)])
    vw.write(f)
vw.release()
json.dump({"fps":fps,"w":W,"h":H,"frames":frames},open(out_json,"w"),separators=(",",":"))
print(len(frames),"frames; tracked",sum(x is not None for x in frames))
