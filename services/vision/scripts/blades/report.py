import json,numpy as np,sys
R=json.load(open(sys.argv[1] if len(sys.argv)>1 else '/home/fionn/CompVisionRowing/private/train/cv.json')); P=256/14; CM=55/P
seen=[r for r in R if r['state']<2]
d=np.array([np.subtract(r['pred'],r['truth']) for r in seen]); e=np.hypot(*d.T); b=np.array([np.subtract(r['base'],r['truth']) for r in seen]); eb=np.hypot(*b.T)
print('n',len(R),'seen',len(seen))
print('dist trunks: median',round(np.median(e)/P,2),'baseline',round(np.median(eb)/P,2))
print('within 1 trunk',round((e<P).mean()*100),'% within 0.5',round((e<P/2).mean()*100),'%  baseline within 1',round((eb<P).mean()*100),'%')
print('vertical cm (trunk=55): median',round(np.median(abs(d[:,1]))*CM,1),'p90',round(np.percentile(abs(d[:,1]),90)*CM,1),'| correct-blade only (<1 trunk):',round(np.median(abs(d[e<P,1]))*CM,1) if (e<P).any() else None)
conf=np.array([r['conf'] for r in R]); hid=np.array([r['state']==2 for r in R]); 
print('conf median seen',round(np.median(conf[~hid]),2),'hidden',round(np.median(conf[hid]),2))
for th in (.2,.3,.5,.7):
    k=np.array([r['conf']>=th for r in seen]); print(' conf>=',th,'keep',round(k.mean()*100),'% within1',round((e[k]<P).mean()*100) if k.any() else None,'% ; hidden accepted',round((conf[hid]>=th).mean()*100),'%')
w=np.array([r['water']>.5 for r in seen]); t=np.array([r['state']==1 for r in seen]); print('water acc',round((w==t).mean()*100),'% water recall',round(w[t].mean()*100),'% air acc',round((~w[~t]).mean()*100),'%')
for c in sorted({r['clip'] for r in R}):
    m=np.array([r['clip']==c for r in seen])
    if m.any(): print(c[4:19],'n',m.sum(),'median',round(np.median(e[m])/P,2),'within1',round((e[m]<P).mean()*100),'%')
