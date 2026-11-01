// Optional authored performance for v6. All secondary animation is resolved into
// numeric parameters before relay, so studio and broadcast share one performance.
import { springStep } from './spring.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
const follow=(x,target,dt,tau)=>x+(target-x)*(1-Math.exp(-dt/tau));

export class PerformanceMotion {
  constructor(profile={},motionProfile=null) {this.profile=profile;this.motionProfile=motionProfile;this.reset();}
  reset() {
    this.time=0;this.seed=this.profile.seed??61018;this.nextPose=0;this.poseAt=0;
    this.from={x:0,y:0,z:0,gx:0,gy:0};this.to={...this.from};this.axes={};
    this.nextBlink=2.3;this.blinkAt=-10;this.doubleBlink=false;
    this.mouth=0;this.voice=0;this.onset=0;this.lastAccent=-10;this.nod=0;this.nodV=0;
  }
  random() {this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
  axis(key,target,dt,f=1.5,z=.85) {
    const a=this.axes[key]??(this.axes[key]={x:0,v:0});
    if(this.motionProfile){springStep(a,target,dt,f,z,a.target??target);if(dt>0)a.target=target;return a.x;}
    let left=dt;
    while(left>1e-9){const h=Math.min(left,1/240),w=2*Math.PI*f;left-=h;a.v+=(w*w*(target-a.x)-2*z*w*a.v)*h;a.x+=a.v*h;}
    return a.x;
  }
  apply(P,dt,{idleWeight=0,autoBlink=false,strength=1,speech=true}={}) {
    if(P._performance===1)return P;
    const h=clamp(Number.isFinite(dt)?dt:0,0,.1);
    const s=clamp(strength,0,1.5);
    if(h<=0||s===0){P._performance=1;return P;}
    this.time+=h;
    const t=this.time;
    while(t>=this.nextPose){
      this.from={...this.to};this.poseAt=this.nextPose;
      this.to={x:(this.random()-.5)*15,y:(this.random()-.5)*6.4,z:(this.random()-.5)*8,
        gx:(this.random()-.5)*.58,gy:(this.random()-.5)*.22};
      this.poseDuration=1.1+this.random()*.7;this.nextPose+=3.4+this.random()*2.8;
    }
    const ease=value=>{const u=clamp(value,0,1);return this.motionProfile?u*u*u*(u*(u*6-15)+10):smooth(u);};
    const u=ease((t-this.poseAt)/this.poseDuration),ug=ease((t-this.poseAt)/.2);
    const target=k=>this.from[k]+(this.to[k]-this.from[k])*(['gx','gy'].includes(k)?ug:u);
    const idle=idleWeight*s;
    const hx=this.axis('hx',target('x'),h,1.6),hy=this.axis('hy',target('y'),h,1.5),hz=this.axis('hz',target('z'),h,1.25);
    const add=(key,value,lo,hi)=>{P[key]=clamp((P[key]??0)+value,lo,hi);};
    add('angleX',hx*idle,-32,32);add('angleY',hy*idle,-30,30);add('angleZ',hz*idle,-26,26);
    add('eyeBallX',this.axis('gx',target('gx'),h,7,1)*idle,-1,1);
    add('eyeBallY',this.axis('gy',target('gy'),h,6,1)*idle,-1,1);

    // Counterbalance is slower than gaze/head motion, with limited independent
    // body contribution. A tracker-provided torso pose remains the main motion.
    const soft=(v,max)=>max*Math.tanh(v/max);
    add('bodyYaw',this.axis('by',soft(P.angleX*.16,3.8),h,1.15,.82)*s,-16,16);
    const stance=(Math.sin(t*.61)+Math.sin(t*.27+.8)*.4)*.9*idleWeight;
    add('bodyZ',this.axis('bz',soft(P.angleZ*.14+stance,2.4),h,1.05,.85)*s,-16,16);
    add('bodyX',this.axis('bx',soft(P.angleX*.045+stance*.12,1.4),h,.85,.9)*s,-12,12);

    // Speech accents are event-driven and settle in silence. The app's existing
    // speech acting is respected; only a small accent is added when it is active.
    const mouth=clamp(P.mouthOpen??0,0,1);
    const previous=this.mouth;
    this.mouth=follow(this.mouth,mouth,h,.045);
    this.voice=follow(this.voice,speech ? mouth : 0,h,mouth>this.voice ? .09 : .32);
    const opening=(this.mouth-previous)/h;
    if(speech&&opening>1.6&&mouth>.2&&t-this.lastAccent>.22){
      this.lastAccent=t;this.nodV-=Math.min(1,opening/8)*10;
      this.onset=Math.min(1,this.onset+.55);
    }
    this.onset*=Math.exp(-h*5.5);
    if(this.motionProfile){const nod={x:this.nod,v:this.nodV};springStep(nod,0,h,Math.sqrt(190)/(2*Math.PI),17/(2*Math.sqrt(190)));this.nod=nod.x;this.nodV=nod.v;}
    let left=this.motionProfile?0:h;
    while(left>1e-9){const step=Math.min(left,1/240);left-=step;this.nodV+=(-190*this.nod-17*this.nodV)*step;this.nod+=this.nodV*step;}
    const existing=(P.talk??0)>.01;
    add('angleY',this.nod*s*(existing ? .25 : 1),-30,30);
    add('bodyLean',this.axis('lean',-this.voice*.85,h,1.7,.85)*s,-12,12);
    P.chestPulse=(this.voice*.45+this.onset*.65)*s;
    add('brow',this.onset*.045*s,-1,1);

    if(autoBlink){
      if(t>=this.nextBlink){
        this.blinkAt=this.nextBlink;
        this.doubleBlink=this.random()<.16;
        this.nextBlink+=this.doubleBlink ? .34 : 2.7+this.random()*3.0;
      }
      const blink=delay=>{
        const b=t-this.blinkAt-delay;
        if(b<0||b>.235)return 1;
        return b<.075?1-smooth(b/.075):smooth((b-.075)/.16);
      };
      P.eyeOpenL=(P.eyeOpenL??1)*blink(0);P.eyeOpenR=(P.eyeOpenR??1)*blink(.006);
    }else{
      // A tracked/manual blink owns the lids. Resume auto mode with a fresh wait.
      this.nextBlink=t+2.3;this.blinkAt=-10;
    }
    P._performance=1;
    return P;
  }
}
