import { rng, zoneAt, MAX_BAG } from "./courier-engine.js";
const BASE = new URL("../media/courier/", import.meta.url);
let assetPromise;
function image(name) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    const timer = setTimeout(() => reject(new Error("Долго загружается зимняя трасса. Попробуйте ещё раз.")), 15000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error("Не удалось загрузить графику трассы")); };
    img.src = new URL(name + ".webp", BASE).href;
  });
}
export function loadAssets() {
  if (!assetPromise) assetPromise = Promise.all(["sled","horizon","tree","cabin"].map(image))
    .then(([sled,horizon,tree,cabin]) => ({sled,horizon,tree,cabin}))
    .catch(error => { assetPromise = null; throw error; });
  return assetPromise;
}
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
function canvas(w,h) { const c=document.createElement("canvas");c.width=w;c.height=h;return c; }
function polygon(ctx,points,fill,stroke) {
  ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();
  if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}
}
function round(ctx,x,y,w,h,r) {
  r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
}
function giftSprite(color) {
  const c=canvas(84,100),g=c.getContext("2d");
  g.fillStyle="#3877a020";g.beginPath();g.ellipse(42,87,32,8,0,0,Math.PI*2);g.fill();
  polygon(g,[[12,35],[42,48],[42,83],[12,69]],color[1]);
  polygon(g,[[42,48],[72,35],[72,69],[42,83]],color[2]);
  polygon(g,[[12,35],[42,20],[72,35],[42,49]],color[0],"#ffffffa0");
  polygon(g,[[35,24],[42,21],[49,24],[21,39],[14,36]],"#fff1cd");
  polygon(g,[[35,46],[42,49],[49,46],[49,79],[42,83],[35,80]],"#fff4da");
  polygon(g,[[35,24],[42,21],[70,34],[63,38]],"#fff5d4");
  g.strokeStyle="#fff0c9";g.lineWidth=4;
  g.beginPath();g.moveTo(42,23);g.bezierCurveTo(14,8,34,2,42,23);g.bezierCurveTo(54,-1,76,10,42,23);g.stroke();
  g.strokeStyle="#ffffffb0";g.lineWidth=1.5;g.beginPath();g.moveTo(14,42);g.lineTo(14,67);g.stroke();
  return c;
}
function obstacleSprite(style) {
  const c=canvas(140,90),g=c.getContext("2d");
  g.fillStyle="#3d679a22";g.beginPath();g.ellipse(70,74,62,10,0,0,7);g.fill();
  if(style===0) {
    const grad=g.createLinearGradient(0,28,0,73);grad.addColorStop(0,"#bad2e8");grad.addColorStop(1,"#6e96b9");
    polygon(g,[[15,64],[29,35],[59,23],[94,29],[123,57],[116,74],[35,78]],grad);
    polygon(g,[[18,55],[32,34],[60,23],[94,28],[117,48],[94,53],[73,46],[52,58],[37,51]],"#f7fcff");
    g.strokeStyle="#d4e8f6";g.lineWidth=3;g.beginPath();g.moveTo(29,67);g.lineTo(54,61);g.lineTo(74,66);g.stroke();
  } else {
    const grad=g.createLinearGradient(0,35,0,72);grad.addColorStop(0,"#b99479");grad.addColorStop(1,"#755a4f");
    round(g,12,39,115,33,13);g.fillStyle=grad;g.fill();
    g.fillStyle="#dbc6ac";g.beginPath();g.ellipse(119,56,9,15,0,0,7);g.fill();
    g.strokeStyle="#a5846d";g.lineWidth=2;g.beginPath();g.ellipse(120,56,5,9,0,0,7);g.stroke();
    g.fillStyle="#f6fcff";g.beginPath();g.moveTo(13,42);g.bezierCurveTo(24,25,39,38,48,31);g.bezierCurveTo(65,21,72,35,88,29);g.bezierCurveTo(108,22,121,35,123,41);g.lineTo(122,49);g.bezierCurveTo(103,43,89,54,74,47);g.bezierCurveTo(53,44,34,54,14,47);g.closePath();g.fill();
  }
  return c;
}
export class CourierScene {
  constructor(target, assets, options={}) {
    this.canvas=target;this.ctx=target.getContext("2d",{alpha:false});
    this.assets=assets;this.options=options;this.w=420;this.h=840;this.dpr=1.5;
    this.time=0;this.particles=[];this.trail=[];this.shake=0;this.quality=1;
    this.gifts=[["#b3dafa","#65aee0","#438bc4"],["#f4bebc","#de8c90","#c36e7e"],
      ["#d2e8dc","#92c7b2","#6ca88f"],["#e5d9fa","#b3a2d4","#9182be"]].map(giftSprite);
    this.obstacles=[obstacleSprite(0),obstacleSprite(1)];
    const r=rng(71203);this.flakes=Array.from({length:60},()=>({x:r(10000)/10000,y:r(10000)/10000,r:1+r(20)/10,s:15+r(38),phase:r(628)/100}));
    this.resize();
  }
  resize() {
    const rect=this.canvas.getBoundingClientRect();
    this.w=Math.max(280,rect.width);this.h=Math.max(420,rect.height);
    this.dpr=Math.min(window.devicePixelRatio||1,this.quality<1?1.25:1.8);
    this.canvas.width=Math.round(this.w*this.dpr);this.canvas.height=Math.round(this.h*this.dpr);
    this.bg=canvas(Math.ceil(this.w+100),Math.ceil(this.h));
    const g=this.bg.getContext("2d"),im=this.assets.horizon;
    g.fillStyle="#dceeff";g.fillRect(0,0,this.bg.width,this.bg.height);
    const hh=this.h*.59,scale=Math.max(this.bg.width/im.width,hh/im.height);
    const iw=im.width*scale,ih=im.height*scale;
    g.drawImage(im,(this.bg.width-iw)/2,0,iw,ih);
    const fade=g.createLinearGradient(0,this.h*.39,0,this.h*.61);
    fade.addColorStop(0,"#e8f4ff00");fade.addColorStop(1,"#e4f1fb");
    g.fillStyle=fade;g.fillRect(0,this.h*.39,this.bg.width,this.h*.61);
    const ground=g.createLinearGradient(0,this.h*.6,0,this.h);
    ground.addColorStop(0,"#e4f1fb");ground.addColorStop(1,"#c7e0f5");
    g.fillStyle=ground;g.fillRect(0,this.h*.6,this.bg.width,this.h*.4);
  }
  setTrack(track,seed) {
    this.track=track;this.decor=[];const r=rng(seed^0x504f4c45);
    for(let y=300;y<90000;y+=280) {
      for(const side of [-1,1]) this.decor.push({y:y+r(100),x:side*(1300+r(650)),
        kind:zoneAt(y)===2&&r(4)===0?"cabin":"tree",scale:75+r(40),phase:r(10)});
    }
    this.decor.sort((a,b)=>a.y-b.y);this.decorCursor=0;this.trail=[];this.particles=[];this.shake=0;
  }
  point(x,z,camera=0) {
    const p=1/(1+z/580),hy=this.h*.365,py=this.h*.805;
    const curve=(Math.sin((this.distance+z)/6500)*.12+Math.sin((this.distance+z)/2300)*.028)*this.w*(1-p);
    return {x:this.w/2+(x-camera)*this.w/2100*p+curve,y:hy+(py-hy)*p,p};
  }
  notifyStep(s) {
    if(s.tick%2===0){this.trail.push({x:s.x,z:s.distance});if(this.trail.length>26)this.trail.shift();}
    for(const e of s.events) {
      if(e.kind==="hit")this.shake=this.options.reduceMotion?0:5;
      const total=e.kind==="hit"?15:e.kind==="delivery"?22:e.kind==="gift"?6:0;
      for(let i=0;i<total;i++) {
        const angle=(i*2.399+s.tick)*1.2;
        this.particles.push({x:this.w/2+s.x*this.w/2100*.8,y:this.h*.7,
          vx:Math.cos(angle)*(e.kind==="delivery"?65:35),vy:-45-Math.sin(angle)*30,
          life:.7+i%4*.08,max:.9,r:e.kind==="delivery"?3:2,color:e.kind==="hit"?"#f6fdff":i%3?"#c5ecff":"#ffedb4"});
      }
    }
    if(this.particles.length>90)this.particles.splice(0,this.particles.length-90);
  }
  draw(state,dt=0,interpolation=1,previous=null,ambient=false) {
    this.time+=dt;this.shake=Math.max(0,this.shake-dt*12);
    const x=previous?previous.x+(state.x-previous.x)*interpolation:state.x;
    this.distance=previous?previous.distance+(state.distance-previous.distance)*interpolation:state.distance;
    if(ambient)this.distance=1200+this.time*80;
    const g=this.ctx,w=this.w,h=this.h,camera=x*.2;
    g.setTransform(this.dpr,0,0,this.dpr,0,0);g.clearRect(0,0,w,h);
    const drift=Math.sin(this.distance/6500)*14;
    g.drawImage(this.bg,-50+drift,0);
    g.save();
    if(this.shake)g.translate(Math.sin(this.time*47)*this.shake*.45,Math.cos(this.time*33)*this.shake*.3);
    // The road is tessellated in world coordinates, keeping turns and edge strips smooth.
    const far=8000,step=120;
    for(let z=far;z>=-240;z-=step) {
      const p0=this.point(-1020,z,camera),p1=this.point(1020,z,camera);
      const p2=this.point(1020,z+step,camera),p3=this.point(-1020,z+step,camera);
      polygon(g,[[p0.x,p0.y],[p1.x,p1.y],[p2.x,p2.y],[p3.x,p3.y]],"#bdd6ea");
      const a=this.point(-960,z,camera),b=this.point(960,z,camera),c=this.point(960,z+step,camera),d=this.point(-960,z+step,camera);
      polygon(g,[[a.x,a.y],[b.x,b.y],[c.x,c.y],[d.x,d.y]],"#f0f8ff");
      if(zoneAt(this.distance+z)===1) {
        const aa=this.point(0,z,camera),dd=this.point(0,z+step,camera);
        polygon(g,[[aa.x,aa.y],[b.x,b.y],[c.x,c.y],[dd.x,dd.y]],"#b7e0f3");
      }
      for(const side of [-1,1]) {
        const a=this.point(side*945,z,camera),b=this.point(side*980,z,camera),
          c=this.point(side*980,z+step,camera),d=this.point(side*945,z+step,camera);
        polygon(g,[[a.x,a.y],[b.x,b.y],[c.x,c.y],[d.x,d.y]],"#fcfeff");
      }
    }
    // Soft wind-swept snow and cracks are sparse, world-anchored details.
    for(let i=Math.floor(this.distance/200);i<Math.floor(this.distance/200)+24;i++) {
      const z=i*200-this.distance,p=this.point(0,z,camera);
      if(p.p<.1||z<0)continue;
      g.globalAlpha=.18*p.p;g.strokeStyle=zoneAt(i*200)===1?"#5e9fc2":"#b2d4e9";g.lineWidth=1.2;
      g.beginPath();const a=this.point(zoneAt(i*200)===1?80:-600,z,camera),b=this.point(700,z+50,camera);
      g.moveTo(a.x,a.y);g.quadraticCurveTo(p.x+40*p.p,p.y-4*p.p,b.x,b.y);g.stroke();g.globalAlpha=1;
    }
    // Parallel sled tracks recede naturally behind the vehicle.
    for(let side of [-1,1]) {
      g.beginPath();let first=true;
      for(const t of this.trail) {
        const z=t.z-this.distance;if(z< -180)continue;
        const p=this.point(t.x+side*104,z,camera);
        if(first){g.moveTo(p.x,p.y);first=false;}else g.lineTo(p.x,p.y);
      }
      g.strokeStyle="#87b8d54a";g.lineWidth=1.7;g.stroke();
    }
    while(this.decorCursor<this.decor.length&&this.decor[this.decorCursor].y<this.distance-260)this.decorCursor++;
    const visible=[];
    for(let i=this.decorCursor;i<this.decor.length&&this.decor[i].y<this.distance+3900;i++)visible.push(this.decor[i]);
    const cursor=ambient?0:state.cursor;
    for(let i=cursor;i<this.track.length&&this.track[i].y<this.distance+3400;i++) {
      const e=this.track[i];if(e.y>=this.distance-90)visible.push(e);
    }
    visible.sort((a,b)=>b.y-a.y);
    for(const e of visible) {
      const z=e.y-this.distance;if(z< -200)continue;
      const p=this.point(e.x,z,camera),fade=clamp((3900-z)/700,0,1);
      if(p.x< -300||p.x>w+300)continue;
      g.globalAlpha=fade;
      if(e.kind==="tree"||e.kind==="cabin") {
        const im=this.assets[e.kind],ww=(e.kind==="tree"?w*.44:w*.76)*p.p*(e.scale||100)/100;
        const hh=ww*im.height/im.width;
        if(ww<3)continue;
        g.fillStyle="#3d71991b";g.beginPath();g.ellipse(p.x,p.y,ww*.35,ww*.08,0,0,7);g.fill();
        g.drawImage(im,p.x-ww/2,p.y-hh,ww,hh);
      } else if(e.kind==="gift") {
        const sz=w*.14*p.p,bob=Math.sin(this.time*2.5+e.id)*2.5*p.p;
        g.drawImage(this.gifts[e.style],p.x-sz/2,p.y-sz*1.12+bob,sz,sz*1.19);
        if(p.p>.45) {
          g.fillStyle="#ffffffcc";g.beginPath();g.arc(p.x+sz*.32,p.y-sz*.98,1.4,0,7);g.fill();
        }
      } else if(e.kind==="obstacle") {
        const ww=w*.22*p.p,hh=ww*90/140;
        g.drawImage(this.obstacles[e.style],p.x-ww/2,p.y-hh*.82,ww,hh);
      } else if(e.kind==="dock")this.drawDock(g,e,p,z,camera);
    }
    g.globalAlpha=1;
    this.drawPlayer(g,state,x,camera);
    for(const p of this.particles) {
      if(dt){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=70*dt;p.life-=dt;}
      if(p.life<=0)continue;
      g.globalAlpha=clamp(p.life/p.max,0,1);g.fillStyle=p.color;
      g.beginPath();g.arc(p.x,p.y,p.r,0,7);g.fill();
    }
    this.particles=this.particles.filter(p=>p.life>0);g.globalAlpha=1;g.restore();
    if(!this.options.reduceMotion&&this.options.holidayDecor!==false) {
      const count=this.quality<1?26:this.flakes.length;
      for(let i=0;i<count;i++) {
        const f=this.flakes[i],xx=(f.x*w+Math.sin(this.time*.5+f.phase)*15+this.time*3)%w;
        const yy=(f.y*h+this.time*f.s)%h;
        g.globalAlpha=.3+f.r*.14;g.fillStyle="#fff";g.beginPath();g.arc(xx,yy,f.r,0,7);g.fill();
      }
      g.globalAlpha=1;
    }
  }
  drawDock(g,e,p,z,camera) {
    const side=Math.sign(e.x),house=this.point(side*1450,z+15,camera),im=this.assets.cabin;
    const ww=this.w*.8*p.p,hh=ww*im.height/im.width;
    g.drawImage(im,house.x-ww/2,house.y-hh,ww,hh);
    const r=65*p.p,near=z<1000;
    g.fillStyle=near?"#6ba5ec40":"#73b9ee24";g.strokeStyle=near?"#6f9ee9":"#90bfe5";g.lineWidth=Math.max(1,2*p.p);
    g.beginPath();g.ellipse(p.x,p.y,r,r*.3,0,0,7);g.fill();g.stroke();
    if(near) {
      const grad=g.createLinearGradient(0,p.y-110*p.p,0,p.y);
      grad.addColorStop(0,"#8ec9ff00");grad.addColorStop(1,"#8ec9ff44");
      g.fillStyle=grad;g.fillRect(p.x-r,p.y-110*p.p,r*2,110*p.p);
    }
    if(p.p>.2) {
      const sz=42*p.p;
      g.drawImage(this.gifts[0],p.x-sz/2,p.y-sz*1.6,sz,sz*1.2);
      if(p.p>.42) {
        const text="ДОСТАВКА",fw=Math.max(8,11*p.p);
        g.font="700 "+fw+"px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif";g.textAlign="center";
        const tw=g.measureText(text).width+14*p.p;
        round(g,p.x-tw/2,p.y-84*p.p,tw,21*p.p,8*p.p);g.fillStyle="#f5fbfff0";g.fill();
        g.fillStyle="#326096";g.fillText(text,p.x,p.y-69*p.p);
      }
    }
  }
  drawPlayer(g,s,x,camera) {
    const p=this.point(x,0,camera),ww=this.w*.195,im=this.assets.sled,hh=ww*im.height/im.width;
    const bob=this.options.reduceMotion?0:Math.sin(this.time*9)*Math.min(1.3,s.speed/25);
    g.save();g.translate(p.x,p.y+bob);
    g.fillStyle="#37638e25";g.beginPath();g.ellipse(0,0,ww*.46,ww*.14,0,0,7);g.fill();
    g.rotate(clamp(-s.vx/75,-1,1)*.085);
    if(s.cooldown>0&&s.tick%4<2)g.globalAlpha=.72;
    g.drawImage(im,-ww/2,-hh+ww*.13,ww,hh);g.globalAlpha=1;
    for(let i=0;i<Math.min(s.bag,6);i++) {
      const col=i%3,row=Math.floor(i/3),sz=ww*.22;
      g.drawImage(this.gifts[i%4],-ww*.28+col*ww*.16,-hh*.28-row*ww*.14,sz,sz*1.19);
    }
    g.restore();
  }
  dispose() { this.trail=[];this.particles=[];this.track=[];this.decor=[];this.canvas.width=1;this.canvas.height=1; }
}
