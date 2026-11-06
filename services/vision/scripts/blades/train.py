"""Train the blade detector with whole clips held out, and report accuracy on unseen clips."""
import json,math,sys,time
import cv2,numpy as np,torch,torch.nn as nn,torch.nn.functional as F
torch.set_num_threads(4); torch.manual_seed(0); rng=np.random.default_rng(0)
D=np.load('/private/train/crops.npz'); img,blade,state,hands,clip=D['img'],D['blade'],D['state'],D['hands'],D['clip']
W,H=256,128; PX_PER_TRUNK=W/14.0; S=2; SIG=3.0
EPOCHS=int(sys.argv[1]) if len(sys.argv)>1 else 50
yy,xx=np.mgrid[0:H//S,0:W//S].astype(np.float32); Y2,X2=np.mgrid[0:H,0:W].astype(np.float32)
def spot(p,x,y,s): return np.exp(-((x-p[0])**2+(y-p[1])**2)/(2*s*s)).astype(np.float32)
def sample(i,aug):
    im=img[i].astype(np.float32)/255; b=blade[i].copy(); h=hands[i].copy()
    if aug:
        s=rng.uniform(.85,1.2); tx,ty=rng.uniform(-18,18),rng.uniform(-10,10)
        M=np.array([[s,0,W/2*(1-s)+tx],[0,s,H/2*(1-s)+ty]],np.float32)
        im=cv2.warpAffine(im,M,(W,H),borderMode=cv2.BORDER_REPLICATE)
        if state[i]<2: b=M@np.array([b[0],b[1],1],np.float32)
        if h[0]>=0: h=M@np.array([h[0],h[1],1],np.float32)
        im=np.clip(im*rng.uniform(.7,1.3)+rng.uniform(-.1,.1),0,1); im=im*rng.uniform(.85,1.15,3).astype(np.float32); im=np.clip(im,0,1)
        if rng.random()<.5:
            k=int(rng.choice([3,5])); im=cv2.GaussianBlur(im,(k,k),0)
        im=np.clip(im+rng.normal(0,.015,im.shape).astype(np.float32),0,1)
    hc=spot(h,X2,Y2,6) if h[0]>=0 else np.zeros((H,W),np.float32)
    x=np.concatenate([im.transpose(2,0,1),hc[None]],0)
    inside=state[i]<2 and 0<=b[0]<W and 0<=b[1]<H
    t=spot(b/S,xx,yy,SIG) if inside else np.zeros((H//S,W//S),np.float32)
    return x,t[None],float(state[i]==1)
class Block(nn.Module):
    def __init__(s,a,b):
        super().__init__(); s.n=nn.Sequential(nn.Conv2d(a,b,3,padding=1,bias=False),nn.BatchNorm2d(b),nn.ReLU(True),nn.Conv2d(b,b,3,padding=1,bias=False),nn.BatchNorm2d(b),nn.ReLU(True))
    def forward(s,x): return s.n(x)
class Net(nn.Module):
    def __init__(s,c=16):
        super().__init__()
        s.e1=Block(4,c); s.e2=Block(c,c*2); s.e3=Block(c*2,c*4); s.e4=Block(c*4,c*8); s.m=Block(c*8,c*8)
        s.d3=Block(c*16,c*4); s.d2=Block(c*8,c*2); s.d1=Block(c*4,c*2); s.h=nn.Conv2d(c*2,1,1); s.w=nn.Linear(c*2,1)
    def forward(s,x):
        p=F.max_pool2d; u=lambda t:F.interpolate(t,scale_factor=2,mode='bilinear',align_corners=False)
        a=s.e1(x); b=s.e2(p(a,2)); c=s.e3(p(b,2)); d=s.e4(p(c,2)); m=s.m(p(d,2))
        y=s.d3(torch.cat([u(m),d],1)); y=s.d2(torch.cat([u(y),c],1)); y=s.d1(torch.cat([u(y),b],1))
        logit=s.h(y); att=torch.sigmoid(logit); pooled=(y*att).sum((2,3))/(att.sum((2,3))+1e-3)
        return logit,s.w(pooled)
def fit(idx,epochs):
    net=Net(); opt=torch.optim.AdamW(net.parameters(),2e-3,weight_decay=1e-3)
    sch=torch.optim.lr_scheduler.OneCycleLR(opt,3e-3,total_steps=epochs*math.ceil(len(idx)/16))
    for e in range(epochs):
        net.train(); o=rng.permutation(idx); tot=0
        for k in range(0,len(o),16):
            B=[sample(i,True) for i in o[k:k+16]]
            x=torch.tensor(np.stack([b[0] for b in B])); t=torch.tensor(np.stack([b[1] for b in B])); w=torch.tensor([b[2] for b in B])
            l,c=net(x); loss=F.binary_cross_entropy_with_logits(l,t,pos_weight=torch.tensor(20.))+.2*F.binary_cross_entropy_with_logits(c[:,0],w)
            opt.zero_grad(); loss.backward(); opt.step(); sch.step(); tot+=loss.item()*len(B)
        if (e+1)%10==0: print('  epoch',e+1,round(tot/len(o),3),flush=True)
    return net.eval()
@torch.no_grad()
def predict(net,i):
    x,_,_=sample(i,False); l,c=net(torch.tensor(x[None])); h=torch.sigmoid(l)[0,0].numpy()
    y,xp=np.unravel_index(h.argmax(),h.shape); return (xp*S+S/2,y*S+S/2),float(h.max()),float(torch.sigmoid(c)[0,0])
MODE=sys.argv[2] if len(sys.argv)>2 else 'cv'
if MODE!='cv':
    held=sys.argv[3].split(',') if len(sys.argv)>3 else []
    tr=np.array([i for i in range(len(clip)) if not any(h in str(clip[i]) for h in held)])
    print(MODE,'training on',len(tr),'held out',held,flush=True)
    net=fit(tr,EPOCHS); torch.save(net.state_dict(),f'/private/train/{MODE}.pth')
    class Out(nn.Module):
        def __init__(s,n): super().__init__(); s.n=n
        def forward(s,x):
            l,c=s.n(x); return torch.sigmoid(l),torch.sigmoid(c)
    torch.onnx.export(Out(net),torch.zeros(1,4,H,W),f'/private/train/{MODE}.onnx',input_names=['image'],output_names=['heat','water'],dynamic_axes={'image':{0:'n'},'heat':{0:'n'},'water':{0:'n'}},opset_version=17,dynamo=False)
    print('saved',flush=True); sys.exit()
clips=sorted(set(clip)); sizes={c:(clip==c).sum() for c in clips}
order=sorted(clips,key=lambda c:-sizes[c]); folds=[[] for _ in range(5)]
for c in order: min(folds,key=lambda f:sum(sizes[x] for x in f)).append(c)
res=[]
for n,f in enumerate(folds):
    test=np.where(np.isin(clip,f))[0]; tr=np.where(~np.isin(clip,f))[0]; t0=time.time()
    print('fold',n,[c[4:19] for c in f],len(tr),len(test),flush=True); net=fit(tr,EPOCHS)
    seen=tr[state[tr]<2]; base=np.median(blade[seen],axis=0)
    for i in test:
        p,conf,water=predict(net,i)
        res.append(dict(i=int(i),clip=str(clip[i]),state=int(state[i]),truth=blade[i].tolist(),pred=list(map(float,p)),conf=conf,water=water,base=base.tolist()))
    print(' took',round(time.time()-t0),flush=True)
json.dump(res,open('/private/train/cv.json','w'))
