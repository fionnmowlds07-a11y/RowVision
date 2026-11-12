import sys, json, cv2, numpy as np
from rtmlib import Body
src,out=sys.argv[1:3]
m=Body(mode="performance",backend="onnxruntime",device="cpu")
cap=cv2.VideoCapture(src);fps=cap.get(5);W=int(cap.get(3));H=int(cap.get(4))
fr=[];prev=None
while True:
    ok,f=cap.read()
    if not ok:break
    kp,sc=m(f);best=None
    for p,s in zip(kp,sc):
        if (s>0.3).sum()<8:continue
        h=(p[11]+p[12])/2
        key=-np.linalg.norm(h-prev) if prev is not None else s.sum()
        if best is None or key>best[0]:best=(key,p,s,h)
    if best:prev=best[3];fr.append([[round(float(x)/W,4),round(float(y)/H,4),round(float(c),2)] for (x,y),c in zip(best[1],best[2])])
    else:fr.append(None)
json.dump({"fps":fps,"w":W,"h":H,"frames":fr},open(out,"w"),separators=(",",":"))
print(len(fr),sum(x is not None for x in fr))
