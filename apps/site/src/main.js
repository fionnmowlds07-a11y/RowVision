import { createScene } from './scene3d.js';
const COL={hl:'#35d07f',link:'#7fe3ad',knee:'#ffb547',hip:'#5cc8ff',back:'#c49bff',elbow:'#ff7ab6'};
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const CLIPS={scull:{v:document.getElementById('src'),url:'/data/pose-scull.json',label:'YOU',slow:2,rate:1}};
Object.values(CLIPS).forEach(c=>{const r=()=>{c.v.defaultPlaybackRate=c.rate;c.v.playbackRate=c.rate;if(c.scrub)c.v.pause()};r();c.v.addEventListener('loadedmetadata',r);c.v.addEventListener('play',r);});
const ease=x=>x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;
const deg=(a,b,c)=>{const v1=[a[0]-b[0],a[1]-b[1]],v2=[c[0]-b[0],c[1]-b[1]];return Math.acos(Math.max(-1,Math.min(1,(v1[0]*v2[0]+v1[1]*v2[1])/(Math.hypot(...v1)*Math.hypot(...v2)||1))))*180/Math.PI};
const L=[5,7,9,11,13,15],R=[6,8,10,12,14,16];
// matches the engine: arms, shoulders, hips averaged; knee from the near leg
function body(f,side){const ids=side=='L'?L:R,far=side=='L'?R:L,mid=(a,b)=>[(f[a][0]+f[b][0])/2,(f[a][1]+f[b][1])/2];
  return {sh:mid(5,6),el:mid(7,8),wr:mid(9,10),hp:mid(11,12),kn:f[ids[4]].slice(0,2),an:f[ids[5]].slice(0,2),near:ids.map(i=>f[i]),far:far.map(i=>f[i])};}
function build(c){const P=c.pose;let tL=0,tR=0;P.frames.forEach(f=>{if(!f)return;L.forEach(i=>tL+=f[i][2]);R.forEach(i=>tR+=f[i][2])});const side=tL>=tR?'L':'R';
  const ar=P.w/P.h;let B=P.frames.map(f=>f&&body(f,side));for(let i=0;i<B.length;i++)if(!B[i])B[i]=B[i-1]||B.find(Boolean);
  const keys=['sh','el','wr','hp','kn','an'];
  const SB=B.map((b,i)=>{const o={near:b.near,far:b.far};keys.forEach(k=>{let x=0,y=0,n=0;for(let d=-3;d<=3;d++){const q=B[i+d];if(q){const w=4-Math.abs(d);x+=q[k][0]*w;y+=q[k][1]*w;n+=w}}o[k]=[x/n,y/n]});return o});
  const sc=p=>[p[0]*ar,p[1]];
  const knee=SB.map(b=>deg(sc(b.hp),sc(b.kn),sc(b.an))),hip=SB.map(b=>deg(sc(b.sh),sc(b.hp),sc(b.kn))),elbow=SB.map(b=>deg(sc(b.sh),sc(b.el),sc(b.wr)));
  const facing=Math.sign(SB.reduce((s,b)=>s+b.an[0]-b.hp[0],0))||1;
  const back=SB.map(b=>Math.atan2((b.sh[0]-b.hp[0])*facing*ar,b.hp[1]-b.sh[1])*180/Math.PI);
  const phase=knee.map((v,i)=>{const d=v-(knee[i-3]??v);if(v<80)return'Catch';if(v>150)return'Finish';return d>0?'Drive':'Recovery'});
  c.S={B:SB,knee,hip,elbow,back,phase};}
const ready=c=>c.S&&c.v.videoWidth&&(!c.scrub||c.has);
const ft=c=>Math.min(c.pose.frames.length-1.001,(c.scrub?c.bufT:c.v.currentTime)/c.slow*c.pose.fps+(c.start||0));
const fi=c=>Math.floor(ft(c));
const lerp2=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
function at(S,t){t=Math.max(0,t);const i=Math.floor(t),j=Math.min(S.B.length-1,i+1),u=t-i,A=S.B[i],B=S.B[j],o={near:A.near.map((p,k)=>lerp2(p,B.near[k],u)),far:A.far.map((p,k)=>lerp2(p,B.far[k],u))};['sh','el','wr','hp','kn','an'].forEach(k=>o[k]=lerp2(A[k],B[k],u));o.v=k=>S[k][i]+(S[k][j]-S[k][i])*u;return o}
const CH=[
 {t:'See every <span class="hl">stroke.</span>',p:'RowVision reads your rowing technique from ordinary phone video. Knees, hips, back and arms, through every catch and finish.',big:1,angles:[],z:1,at:'mid'},
 {t:'The stroke, joint by joint.',p:'Every rower moves through the same four phases. RowVision measures each one.',angles:[],z:1.6,at:'body'},
 {t:'Legs.',p:'Knee angle through every stroke. How deep you come to the catch, and when the legs finish.',angles:['knee'],cls:'c-knee',z:2.2,at:'kn'},
 {t:'Hips and back.',p:'Hip angle and back lean. Did the body swing open too early, or hang on at the finish?',angles:['hip','back'],cls:'c-back',z:2,at:'hp'},
 {t:'Arms.',p:'Elbow angle shows when the arms break. They should come in last, after the legs and back.',angles:['elbow'],cls:'c-elbow',z:2.2,at:'el'},
 {t:'All of it, every frame.',p:'Four angles tracked together, scored at every catch and finish against targets your coach can set.',angles:['knee','hip','back','elbow'],z:1.6,at:'body'},
 {t:'Your turn.',p:'Film your next outing. Free on Windows and Linux.',cta:1,angles:['knee','back'],z:1,at:'body'}];
function target(ch,b){const c=CH[ch];let p=[.5,.45];if(b&&c.at!='mid'){p=c.at=='body'?[(b.sh[0]+b.hp[0]+b.kn[0])/3,(b.sh[1]+b.hp[1]+b.kn[1])/3]:b[c.at];}return {x:p[0],y:p[1],z:c.z}}
function mkStage(cv,clip){return {cv,clip:CLIPS[clip||cv.dataset.clip||'scull'],cam:{x:.5,y:.45,z:1}}}
function size(cv){const r=cv.getBoundingClientRect(),d=Math.min(2,devicePixelRatio||1);const w=Math.round(r.width*d),h=Math.round(r.height*d);if(cv.width!=w||cv.height!=h){cv.width=w;cv.height=h}return d}
function arc(g,c,p,q,r,label,col,a){const a1=Math.atan2(p[1]-c[1],p[0]-c[0]),a2=Math.atan2(q[1]-c[1],q[0]-c[0]);let d=a2-a1;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;
  g.save();g.globalAlpha=a;g.strokeStyle=col;g.lineWidth=Math.max(2,r*.06);g.fillStyle=col+'40';g.beginPath();g.moveTo(...c);g.arc(c[0],c[1],r,a1,a1+d,d<0);g.closePath();g.fill();g.stroke();
  const am=a1+d/2,fs=Math.max(14,r*.42),tx=c[0]+Math.cos(am)*r*1.55,ty=c[1]+Math.sin(am)*r*1.55;g.font=`800 ${fs}px "Bricolage Grotesque",sans-serif`;g.textAlign='center';g.textBaseline='middle';
  const w=g.measureText(label).width+fs*.6;g.fillStyle='#000c';g.beginPath();g.roundRect(tx-w/2,ty-fs*.65,w,fs*1.3,fs*.3);g.fill();g.fillStyle=col;g.fillText(label,tx,ty+fs*.04);g.restore();}
function render(st,mix,opts={}){
  const cv=st.cv,d=size(cv),g=cv.getContext('2d'),W=cv.width,H=cv.height,C=st.clip,V=C.v;g.fillStyle='#000';g.fillRect(0,0,W,H);
  if(!ready(C))return;const S=C.S,t=ft(C),i=Math.round(t),b=at(S,t);
  const ta=target(mix.a,b),tb=target(mix.b,b),f=mix.f;
  const T={x:ta.x+(tb.x-ta.x)*f,y:ta.y+(tb.y-ta.y)*f,z:opts.zoom||(ta.z+(tb.z-ta.z)*f)};
  const k=reduce?1:(opts.glide||.1);st.cam.x+=(T.x-st.cam.x)*k;st.cam.y+=(T.y-st.cam.y)*k;st.cam.z+=(T.z-st.cam.z)*k;
  const Vw=C.pose.w,Vh=C.pose.h,s=Math.max(W/Vw,H/Vh)*st.cam.z;const hw=W/(2*s*Vw),hh=H/(2*s*Vh);
  const cx=Math.min(1-hw,Math.max(hw,st.cam.x)),cy=Math.min(1-hh,Math.max(hh,st.cam.y));
  const P=p=>[W/2+(p[0]-cx)*Vw*s,H/2+(p[1]-cy)*Vh*s];
  g.imageSmoothingQuality='high';g.drawImage(C.scrub?C.buf:V,W/2-cx*Vw*s,H/2-cy*Vh*s,Vw*s,Vh*s);
  const zz=Math.min(1,(st.cam.z-1)/2);if(zz>0){const gr=g.createRadialGradient(W/2,H/2,Math.min(W,H)*.25,W/2,H/2,Math.max(W,H)*.7);gr.addColorStop(0,'#0000');gr.addColorStop(1,`rgba(0,0,0,${.65*zz})`);g.fillStyle=gr;g.fillRect(0,0,W,H);}
  if(C.spot){const q=P([(b.sh[0]+b.hp[0]+b.kn[0])/3,(b.sh[1]+b.hp[1]+b.kn[1])/3]);const rr=Math.hypot(P(b.sh)[0]-P(b.hp)[0],P(b.sh)[1]-P(b.hp)[1]);const gr=g.createRadialGradient(q[0],q[1],rr*.9,q[0],q[1],rr*2.6);gr.addColorStop(0,'rgba(0,0,0,0)');gr.addColorStop(1,'rgba(0,0,0,.93)');g.fillStyle=gr;g.fillRect(0,0,W,H);}
  const A=CH[mix.a],Bc=CH[mix.b];
  const J={sh:P(b.sh),el:P(b.el),wr:P(b.wr),hp:P(b.hp),kn:P(b.kn),an:P(b.an)};const bl=Math.hypot(J.sh[0]-J.hp[0],J.sh[1]-J.hp[1]);
  const skel=opts.skel??((A.skel??0)*(1-f)+(Bc.skel??0)*f);
  const box=opts.box===false?0:(A.box?1-f:0)+(Bc.box?f:0);
  if(box>.01){const xs=[J.sh,J.hp,J.kn,J.an,J.wr].map(p=>p[0]),ys=[J.sh,J.hp,J.kn,J.an].map(p=>p[1]);const x0=Math.min(...xs)-bl*.4,x1=Math.max(...xs)+bl*.4,y0=Math.min(...ys)-bl*.7,y1=Math.max(...ys)+bl*.3;
    g.save();g.globalAlpha=box;g.strokeStyle=COL.hl;g.lineWidth=2*d;g.setLineDash([8*d,6*d]);g.strokeRect(x0,y0,x1-x0,y1-y0);g.setLineDash([]);g.font=`700 ${13*d}px "DM Sans",sans-serif`;const tw=g.measureText(C.label).width+12*d;g.fillStyle=COL.hl;g.fillRect(x0,y0-26*d,tw,24*d);g.fillStyle='#04140b';g.textAlign='left';g.textBaseline='alphabetic';g.fillText(C.label,x0+6*d,y0-9*d);g.restore();}
  if(skel>.01&&!reduce){const lw0=Math.max(2*d,bl*.045);g.save();g.lineCap='round';g.globalCompositeOperation='lighter';for(let k=7;k>=1;k--){const gb=at(S,t-k*.6);const G={sh:P(gb.sh),el:P(gb.el),wr:P(gb.wr),hp:P(gb.hp),kn:P(gb.kn),an:P(gb.an)};g.globalAlpha=skel*.16*(1-k/8);g.strokeStyle=k<4?COL.link:COL.hl;g.lineWidth=lw0*(1.6-k*.1);[['wr','el'],['el','sh'],['sh','hp'],['hp','kn'],['kn','an']].forEach(([x,y])=>{g.beginPath();g.moveTo(...G[x]);g.lineTo(...G[y]);g.stroke()})}
    // hand + knee path trails
    [['wr',COL.elbow],['kn',COL.knee]].forEach(([jn,col])=>{g.globalAlpha=skel*.7;g.strokeStyle=col;g.lineWidth=2*d;g.beginPath();for(let k=0;k<=24;k++){const q=P(at(S,t-k*.5)[jn]);k?g.lineTo(...q):g.moveTo(...q)}g.stroke()});g.restore();
    // catch pulse
    const sinceCatch=(()=>{for(let k=0;k<40;k++){const j=Math.floor(t)-k;if(j<1)break;if(S.knee[j]<=S.knee[j-1]&&S.knee[j]<=S.knee[j+1]&&S.knee[j]<95)return k+(t%1)}return 99})();
    if(sinceCatch<14){const r=bl*(.2+sinceCatch*.12),a=1-sinceCatch/14;g.save();g.globalAlpha=a*skel;g.strokeStyle=COL.knee;g.lineWidth=3*d*a+1;g.beginPath();g.arc(...J.kn,r,0,7);g.stroke();g.globalAlpha=a*skel*.9;g.font=`800 ${Math.max(13,bl*.16)}px "Bricolage Grotesque"`;g.fillStyle=COL.knee;g.textAlign='center';g.fillText('CATCH',J.kn[0],J.kn[1]-r-6*d);g.restore();}}
  if(skel>.01){const lw=Math.max(2*d,bl*.045);const LIM=[[0,1],[1,2],[0,3],[3,4],[4,5]];
    const Q=b.far.map(P);g.save();g.globalAlpha=.3*skel;g.strokeStyle='#fff';g.lineWidth=lw*.6;g.lineCap='round';LIM.forEach(([x,y])=>{g.beginPath();g.moveTo(...Q[x]);g.lineTo(...Q[y]);g.stroke()});g.restore();
    g.save();g.globalAlpha=skel;g.lineCap='round';g.lineJoin='round';g.shadowColor=COL.hl;g.shadowBlur=10*d;g.strokeStyle=COL.hl;g.lineWidth=lw;
    [['wr','el'],['el','sh'],['sh','hp'],['hp','kn'],['kn','an']].forEach(([x,y])=>{g.beginPath();g.moveTo(...J[x]);g.lineTo(...J[y]);g.stroke()});
    g.shadowBlur=0;const jc={kn:COL.knee,hp:COL.hip,sh:COL.back,el:COL.elbow,wr:'#fff',an:'#fff'};const pulse=1+.25*Math.sin(performance.now()/180);Object.keys(J).forEach(k2=>{g.fillStyle=jc[k2];g.shadowColor=jc[k2];g.shadowBlur=14*d;g.beginPath();g.arc(...J[k2],lw*1.1*pulse,0,7);g.fill()});g.restore();}
  const angles=opts.angles??null;const aw=n=>angles?(angles.includes(n)?1:0):(A.angles.includes(n)?1-f:0)+(Bc.angles.includes(n)?f:0);
  const Rr=bl*.38;
  if(aw('knee')>.01)arc(g,J.kn,J.hp,J.an,Rr,Math.round(b.v('knee'))+'°',COL.knee,aw('knee'));
  if(aw('hip')>.01)arc(g,J.hp,J.sh,J.kn,Rr*.8,Math.round(b.v('hip'))+'°',COL.hip,aw('hip'));
  if(aw('back')>.01){const up=[J.hp[0],J.hp[1]-bl*1.1];g.save();g.globalAlpha=aw('back')*.8;g.strokeStyle=COL.back;g.setLineDash([6*d,6*d]);g.lineWidth=2*d;g.beginPath();g.moveTo(...J.hp);g.lineTo(...up);g.stroke();g.restore();
    arc(g,J.hp,up,J.sh,Rr*1.25,(b.v('back')>0?'+':'')+Math.round(b.v('back'))+'°',COL.back,aw('back'));}
  if(aw('elbow')>.01)arc(g,J.el,J.sh,J.wr,Rr*.7,Math.round(b.v('elbow'))+'°',COL.elbow,aw('elbow'));
  if(opts.trace){const x0=20*d,x1=W-20*d,y0=H-100*d,y1=H-24*d,N=S.knee.length;g.fillStyle='#000b';g.fillRect(x0-8*d,y0-12*d,x1-x0+16*d,y1-y0+24*d);
    g.strokeStyle=COL.knee;g.lineWidth=2*d;g.beginPath();S.knee.forEach((v,j)=>{const x=x0+j/N*(x1-x0),y=y1-(v-40)/150*(y1-y0);j?g.lineTo(x,y):g.moveTo(x,y)});g.stroke();g.fillStyle='#fff';g.fillRect(x0+i/N*(x1-x0)-d,y0,2*d,y1-y0);}
}
const simple=[...document.querySelectorAll('canvas[data-cam]')].filter(c=>c.id!='howCv').map(cv=>({...mkStage(cv),ch:+cv.dataset.cam,angles:cv.dataset.angles?cv.dataset.angles.split(','):[],trace:!!cv.dataset.trace}));
// No WebGL (old phone, blocked GPU): keep the still photo of the scene and the chapter text.
let S3;try{S3=createScene(document.getElementById('gl'),document.getElementById('ov'))}catch(e){document.getElementById('scene').classList.add('still');S3={frame(){},setShot(){},angles:{knee:0,hip:0,back:0,elbow:0,phase:''}}}let CUR=0,lock=0;
const how={...mkStage(document.getElementById('howCv')),ch:0,angles:[],skel:0};
const chaps=document.getElementById('chaps'),prog=document.getElementById('prog'),mch=document.getElementById('mchaps');
CH.forEach((c,n)=>{const el=document.createElement('div');el.className='chap';el.innerHTML=`<span class="num">${String(n+1).padStart(2,'0')} / ${String(CH.length).padStart(2,'0')}</span>${c.big?`<h1 class="h1">${c.t}</h1>`:`<h2 class="${c.cls||''}">${c.t}</h2>`}<p>${c.p}</p>${c.cta?'<div style="pointer-events:auto"><a class="btn" href="#get">Download free</a></div>':''}`;chaps.append(el);prog.append(document.createElement('i'));
});
const steps=[...document.querySelectorAll('.step')],howcap=document.getElementById('howcap'),capT=['Raw clip','Finding 3 seat','Pose, every frame','Angles, live'];
const SIO=new IntersectionObserver(es=>es.forEach(e=>{if(!e.isIntersecting)return;steps.forEach(x=>x.classList.remove('on'));e.target.classList.add('on');const n=steps.indexOf(e.target);how.ch=+e.target.dataset.cam;how.angles=e.target.dataset.angles?e.target.dataset.angles.split(','):[];how.skel=e.target.dataset.skel=='0'?0:1;how.box=!!e.target.dataset.box;howcap.textContent=capT[n]}),{rootMargin:'-45% 0px -45% 0px'});
steps.forEach(x=>SIO.observe(x));
const live=[...document.querySelectorAll('[data-live]')],live3=[...document.querySelectorAll('[data-live3]')];let autoNext=performance.now()+5000;
function tiles(){const C=CLIPS.scull;if(!ready(C))return;const i=fi(C),S=C.S;live.forEach(el=>{const k=el.dataset.live;el.textContent=k=='phase'?S.phase[i]:(k=='back'&&S.back[i]>0?'+':'')+Math.round(S[k][i])+'°'})}
function chart(){const cv=document.getElementById('seqChart'),C=CLIPS.scull;if(!ready(C)||!cv.closest('.page.on'))return;const S=C.S,d=size(cv),g=cv.getContext('2d'),W=cv.width,H=cv.height,N=S.knee.length,now=fi(C),pad=36*d;g.clearRect(0,0,W,H);
  g.strokeStyle='#1f2b24';g.lineWidth=1;g.fillStyle='#a9bdb0';g.font=`500 ${11*d}px "DM Sans"`;
  [-40,0,60,120,180].forEach(a=>{const y=H-pad-((a+40)/220)*(H-2*pad);g.beginPath();g.moveTo(pad,y);g.lineTo(W-8*d,y);g.stroke();g.fillText(a+'°',2*d,y+4*d)});
  [['knee',COL.knee],['hip',COL.hip],['back',COL.back],['elbow',COL.elbow]].forEach(([k,c])=>{g.strokeStyle=c;g.lineWidth=2.2*d;g.beginPath();S[k].forEach((v,j)=>{if(j>now)return;const x=pad+j/N*(W-pad-8*d),y=H-pad-((v+40)/220)*(H-2*pad);j?g.lineTo(x,y):g.moveTo(x,y)});g.stroke()});
  g.fillStyle='#a9bdb0';g.fillText('time →',W-56*d,H-8*d);}
function sceneUI(){S3.setShot(CUR,CH[CUR].angles);[...chaps.children].forEach((c,n)=>c.classList.toggle('on',n==CUR));[...prog.children].forEach((c,n)=>c.classList.toggle('on',n==CUR));document.getElementById('readout').style.opacity=CUR>=2?1:0;document.getElementById('hint').style.opacity=CUR<CH.length-1?1:0}
function go(n){CUR=Math.max(0,Math.min(CH.length-1,n));lock=performance.now()+1100;sceneUI()}
[...prog.children].forEach((d,n)=>d.onclick=()=>go(n));
const sceneEl=document.getElementById('scene');
function sceneTop(){return sceneEl.getBoundingClientRect().top-64}
function snapScene(){scrollTo({top:scrollY+sceneTop(),behavior:reduce?'auto':'smooth'});lock=performance.now()+700}
function step(dir,e){if(innerWidth<=820||!sceneEl.closest('.page.on'))return;const t=sceneTop(),H=sceneEl.offsetHeight;
  if(Math.abs(t)<6){ // pinned in view
    if((dir>0&&CUR<CH.length-1)||(dir<0&&CUR>0)){e&&e.preventDefault();if(performance.now()>lock)go(CUR+dir);return}
    return;}
  if(dir>0&&t>0&&t<innerHeight*.7){e&&e.preventDefault();if(performance.now()>lock){CUR=0;sceneUI();snapScene()}return}
  if(dir<0&&t<0&&t>-H*.7){e&&e.preventDefault();if(performance.now()>lock){CUR=CH.length-1;sceneUI();snapScene()}return}}
addEventListener('wheel',e=>{if(Math.abs(e.deltaY)<4)return;step(Math.sign(e.deltaY),e)},{passive:false});
addEventListener('keydown',e=>{const k={ArrowDown:1,PageDown:1,' ':1,ArrowUp:-1,PageUp:-1}[e.key];if(k&&!e.target.closest('input,textarea'))step(k,e)});
sceneUI();
const pages=[...document.querySelectorAll('.page')];
function splitText(){document.querySelectorAll('.split').forEach(h=>{const walk=n=>{[...n.childNodes].forEach(c=>{if(c.nodeType==3){const fr=document.createDocumentFragment();c.textContent.split(/(\s+)/).forEach(w=>{if(!w.trim()){fr.append(w);return}const o=document.createElement('span');o.className='w';const s=document.createElement('span');s.textContent=w;o.append(s);fr.append(o)});c.replaceWith(fr)}else walk(c)})};walk(h);h.querySelectorAll('.w>span').forEach((s,k)=>s.style.transitionDelay=k*70+'ms')})}
const RIO=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)e.target.classList.remove('pre-rv')}),{rootMargin:'0px 0px -10% 0px'});
function route(){const id=(location.hash||'#home').slice(1);const pg=document.getElementById('p-'+id)?id:'home';
  pages.forEach(p=>p.classList.toggle('on',p.id=='p-'+pg));document.querySelectorAll('.links a').forEach(a=>a.toggleAttribute('aria-current',a.getAttribute('href')=='#'+pg));
  document.getElementById('sheet').classList.remove('open');scrollTo(0,0);const cur=document.getElementById('p-'+pg);
  if(!reduce){cur.classList.add('pre');requestAnimationFrame(()=>requestAnimationFrame(()=>cur.classList.remove('pre')))}
  cur.querySelectorAll('.rv').forEach(el=>{if(!reduce&&el.getBoundingClientRect().top>innerHeight)el.classList.add('pre-rv');RIO.observe(el)});Object.values(CLIPS).forEach(c=>{if(!c.scrub)c.v.play().catch(()=>{})});}
addEventListener('hashchange',route);
const sheet=document.getElementById('sheet');document.getElementById('menuBtn').onclick=()=>sheet.classList.add('open');document.getElementById('closeBtn').onclick=()=>sheet.classList.remove('open');
const cur=document.getElementById('cur');let mx=0,my=0,cx=0,cy=0;
addEventListener('pointermove',e=>{mx=e.clientX;my=e.clientY;cur.classList.toggle('big',!!e.target.closest('.stage,.btn,.card,.scene'))});
document.querySelectorAll('.btn').forEach(b=>{b.addEventListener('pointermove',e=>{if(reduce)return;const r=b.getBoundingClientRect();b.style.transform=`translate(${(e.clientX-r.left-r.width/2)*.25}px,${(e.clientY-r.top-r.height/2)*.35}px)`});b.addEventListener('pointerleave',()=>b.style.transform='')});
const vis=el=>{if(!el.closest('.page.on'))return false;const r=el.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.width>0};

function loop(){cx+=(mx-cx)*.2;cy+=(my-cy)*.2;cur.style.left=cx+'px';cur.style.top=cy+'px';
  simple.forEach(s=>{if(vis(s.cv))render(s,{a:s.ch,b:s.ch,f:0},{angles:s.angles,trace:s.trace,skel:s.skel??1,box:s.box?undefined:false})});
  if(sceneEl.closest('.page.on')&&sceneEl.getBoundingClientRect().bottom>0){S3.frame(performance.now(),reduce);live3.forEach(el=>{const k=el.dataset.live3,v=S3.angles[k];el.textContent=k=='phase'?v:(k=='back'&&v>0?'+':'')+Math.round(v)+'°'})}
  if(innerWidth<=820&&performance.now()>autoNext){autoNext=performance.now()+5000;go((CUR+1)%CH.length)}
  if(vis(how.cv))render(how,{a:1,b:1,f:0},{zoom:3,angles:how.angles,skel:how.skel,box:how.box?undefined:false});
  tiles();chart();requestAnimationFrame(loop)}
Object.values(CLIPS).forEach(c=>fetch(c.url).then(r=>r.json()).then(j=>{c.pose=j;build(c)}).catch(()=>{}));
splitText();route();requestAnimationFrame(loop);
