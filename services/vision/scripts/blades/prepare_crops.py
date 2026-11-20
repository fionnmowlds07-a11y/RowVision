"""Cut a crop around each labelled rower, scaled by body size and mirrored to face right."""
import glob,json,os,sys
import cv2,numpy as np
sys.path.insert(0,'/app')
from rowvision.blades import blade_faces_camera
W,H=256,128; SPAN_X=14.0; SPAN_Y=7.0; Y_SHIFT=1.0
L=json.load(open('/private/labels/blades.json'))
newest={}
for f in sorted(glob.glob('/private/preview/results/*.json'),key=os.path.getmtime):
    d=json.load(open(f))
    if d.get('rower') and d.get('settings'): newest[d['settings']['clip']]={'facing':d['facing'],'side':d['settings']['side']}
rows=[]
for k,r in L.items():
    n=newest.get(r['clip'])
    if n is None or not blade_faces_camera(n['side'],n['facing'] or 0): continue
    if not r.get('hip') or not r.get('trunk'): continue
    rows.append((k,r,n))
print('rows',len(rows))
off=np.array([[(r['blade'][0]-r['hip'][0])*n['facing']/r['trunk'],(r['blade'][1]-r['hip'][1])/r['trunk']] for k,r,n in rows if r['blade']])
print('offset trunks x',np.percentile(off[:,0],[0,5,50,95,100]).round(1),'y',np.percentile(off[:,1],[0,5,50,95,100]).round(1))
med={}
for k,r,n in rows: med.setdefault(r['clip'],[]).append(r['trunk'])
med={c:float(np.median(v)) for c,v in med.items()}
print({c[4:19]:round(v,1) for c,v in med.items()})
out=dict(img=[],blade=[],state=[],hands=[],clip=[],trunk=[])
byclip={}
for row in rows: byclip.setdefault(row[1]['clip'],[]).append(row)
for clip,items in byclip.items():
    p=f'/videos/{clip}' if os.path.exists(f'/videos/{clip}') else f'/private/uploads/{clip}'
    cap=cv2.VideoCapture(p)
    for k,r,n in sorted(items,key=lambda x:x[1]['frame']):
        cap.set(cv2.CAP_PROP_POS_FRAMES,r['frame']); ok,fr=cap.read()
        if not ok: print('bad',k); continue
        t=med[clip]; F=n['facing'] or 1
        cx,cy=r['hip'][0],r['hip'][1]+Y_SHIFT*t
        sx=W/(SPAN_X*t); sy=H/(SPAN_Y*t)
        # video -> crop, with mirroring so the rower faces right
        M=np.array([[sx*F,0,W/2-sx*F*cx],[0,sy,H/2-sy*cy]],dtype=np.float32)
        im=cv2.warpAffine(fr,M,(W,H),flags=cv2.INTER_AREA if sx<1 else cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
        tr=lambda p:(M@np.array([p[0],p[1],1.0])).tolist()
        out['img'].append(im); out['state'].append({'air':0,'water':1,'hidden':2}[r['state']])
        out['blade'].append(tr(r['blade']) if r['blade'] else [-1,-1]); out['hands'].append(tr(r['hands']) if r['hands'] else [-1,-1])
        out['clip'].append(clip); out['trunk'].append(t)
np.savez_compressed('/private/train/crops.npz',img=np.array(out['img'],np.uint8),blade=np.array(out['blade'],np.float32),state=np.array(out['state']),hands=np.array(out['hands'],np.float32),clip=np.array(out['clip']),trunk=np.array(out['trunk'],np.float32))
b=np.array(out['blade']); s=np.array(out['state']); print(len(b),'inside',((b[:,0]>=0)&(b[:,0]<W)&(b[:,1]>=0)&(b[:,1]<H))[s<2].mean().round(3))
# Contact sheet to confirm crops and labels agree.
idx=np.linspace(0,len(b)-1,24).astype(int); tiles=[]
for i in idx:
    im=out['img'][i].copy()
    if s[i]<2: cv2.drawMarker(im,tuple(int(v) for v in b[i]),(0,255,255) if s[i]==0 else (0,0,255),cv2.MARKER_CROSS,14,2)
    h=out['hands'][i]
    if h[0]>=0: cv2.circle(im,(int(h[0]),int(h[1])),4,(255,255,0),1)
    tiles.append(im)
cv2.imwrite('/private/review/blades/crops.jpg',np.vstack([np.hstack(tiles[i:i+4]) for i in range(0,24,4)]))
