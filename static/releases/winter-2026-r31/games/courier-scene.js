import {RenderBudget} from "./render-budget.js";
import { rng, zoneAt, MAX_BAG, entityX } from "./courier-engine.js";
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
    .then(async (images) => {
      const names=["sled","horizon","tree","cabin"],prepared={};
      for(let i=0;i<images.length;i++){
        await new Promise(resolve=>setTimeout(resolve,0));
        prepared[names[i]]=gradeArtwork(images[i]);
      }
      return prepared;
    })
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
  const c=canvas(168,200),g=c.getContext("2d");g.scale(2,2);
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
  const c=canvas(280,180),g=c.getContext("2d");g.scale(2,2);
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
// Colour grading happens once when the assets load, never on a live frame.
// A pixel LUT also works in WebViews without CanvasRenderingContext2D.filter.
const lightLUT=Uint8ClampedArray.from({length:256},(_,v)=>clamp(Math.round((v-112)*1.07+118),0,255));
function gradeArtwork(im){
  const c=canvas(im.width,im.height),g=c.getContext("2d",{willReadFrequently:true});
  g.drawImage(im,0,0);
  const data=g.getImageData(0,0,c.width,c.height),p=data.data;
  for(let i=0;i<p.length;i+=4){
    if(!p[i+3])continue;
    const l=(54*p[i]+183*p[i+1]+19*p[i+2])/256;
    for(let channel=0;channel<3;channel++){
      const v=clamp(Math.round(l+(p[i+channel]-l)*1.18),0,255);
      p[i+channel]=lightLUT[v];
    }
  }
  g.putImageData(data,0,0);return c;
}
const bankCache=new WeakMap();
class SpriteBank{
  constructor(source){
    this.levels=[source];let current=source;
    while(current.width>48&&current.height>48){
      const next=canvas(Math.max(1,Math.round(current.width/2)),Math.max(1,Math.round(current.height/2)));
      const g=next.getContext("2d");g.imageSmoothingQuality="high";g.drawImage(current,0,0,next.width,next.height);
      this.levels.push(next);current=next;
    }
  }
  pick(width){
    let chosen=this.levels[0];
    for(let i=1;i<this.levels.length;i++){if(this.levels[i].width<width)break;chosen=this.levels[i];}
    return chosen;
  }
}
function bank(source){let b=bankCache.get(source);if(!b){b=new SpriteBank(source);bankCache.set(source,b);}return b;}
function snowballSprite(){
  const c=canvas(280,180),g=c.getContext("2d");g.scale(2,2);
  const shadow=g.createRadialGradient(70,76,1,70,76,48);shadow.addColorStop(0,"#336f9d48");shadow.addColorStop(1,"#336f9d00");
  g.fillStyle=shadow;g.save();g.translate(0,56);g.scale(1,.28);g.beginPath();g.arc(70,70,48,0,7);g.fill();g.restore();
  const ice=g.createRadialGradient(58,28,3,77,49,36);ice.addColorStop(0,"#fff");ice.addColorStop(.58,"#eafaff");ice.addColorStop(1,"#77acd4");
  g.fillStyle=ice;g.beginPath();g.arc(70,44,32,0,7);g.fill();
  g.strokeStyle="#c3ddec";g.lineWidth=1.6;g.beginPath();g.ellipse(70,44,12,30,-.42,0,7);g.stroke();
  g.fillStyle="#ffffffc0";g.beginPath();g.ellipse(58,28,9,4,-.5,0,7);g.fill();
  return c;
}
let sharedSprites;
function sprites(){
  if(!sharedSprites)sharedSprites={
    gifts:[["#9cdbff","#3b9bd9","#236da9"],["#ffb8a5","#ef7f84","#c45270"],
      ["#b7f0d6","#63c9a5","#3a9d86"],["#d8c6ff","#a081df","#7259b2"]].map(giftSprite).map(bank),
    obstacles:[obstacleSprite(0),obstacleSprite(1),snowballSprite()].map(bank)
  };
  return sharedSprites;
}
export class CourierScene {
  constructor(target,assets,options={}){
    this.canvas=target;this.ctx=target.getContext("2d",{alpha:false});
    this.assets=assets;this.options=options;this.w=420;this.h=840;this.dpr=1;this.renderBudget=new RenderBudget();
    this.time=0;this.particles=[];this.trail=[];this.shake=0;
    this.banks={sled:bank(assets.sled),tree:bank(assets.tree),cabin:bank(assets.cabin)};
    const shared=sprites();this.gifts=shared.gifts;this.obstacles=shared.obstacles;
    const r=rng(71203);
    this.flakes=Array.from({length:60},()=>({x:r(10000)/10000,y:r(10000)/10000,r:1+r(20)/10,s:15+r(38),phase:r(628)/100}));
    this.resize();
  }
  resize(){
    const rect=this.canvas.getBoundingClientRect();
    const w=Math.max(1,rect.width),h=Math.max(1,rect.height);
    const dpr=this.renderBudget.ratio(w,h,window.devicePixelRatio,1.8,1380000);
    if(this.bg&&this.w===w&&this.h===h&&this.dpr===dpr)return;
    this.w=w;this.h=h;this.dpr=dpr;
    this.canvas.width=Math.round(this.w*this.dpr);this.canvas.height=Math.round(this.h*this.dpr);
    this.ctx.imageSmoothingEnabled=true;this.ctx.imageSmoothingQuality="high";
    this.hy=this.h*.365;this.py=this.h*.805;this.span=this.py-this.hy;this.worldScale=this.w/2100;
    this.road=[];
    for(let z=8120;z>=-280;z-=120){
      const p=1/(1+z/580);
      this.road.push({z,p,y:this.hy+this.span*p,scale:this.worldScale*p,center:0,
        c1:Math.cos(z/6500),s1:Math.sin(z/6500),c2:Math.cos(z/2300),s2:Math.sin(z/2300)});
    }
    const bw=this.w+100;
    this.bg=canvas(Math.ceil(bw*this.dpr),Math.ceil(this.h*this.dpr));
    const g=this.bg.getContext("2d"),im=this.assets.horizon;
    g.scale(this.dpr,this.dpr);g.imageSmoothingQuality="high";
    g.fillStyle="#d3ebff";g.fillRect(0,0,bw,this.h);
    const hh=this.h*.59,scale=Math.max(bw/im.width,hh/im.height);
    g.drawImage(im,(bw-im.width*scale)/2,0,im.width*scale,im.height*scale);
    const fade=g.createLinearGradient(0,this.h*.39,0,this.h*.61);
    fade.addColorStop(0,"#e0f2ff00");fade.addColorStop(1,"#dcefff");
    g.fillStyle=fade;g.fillRect(0,this.h*.39,bw,this.h*.61);
    const ground=g.createLinearGradient(0,this.h*.6,0,this.h);
    ground.addColorStop(0,"#dcefff");ground.addColorStop(1,"#b0d6ee");
    g.fillStyle=ground;g.fillRect(0,this.h*.6,bw,this.h*.4);
  }
  wave(y){return Math.sin(y/6500)*.12+Math.sin(y/2300)*.028;}
  setTrack(track,seed){
    this.track=track;this.objects=[];const r=rng(seed^0x504f4c45);
    for(let y=300;y<115000;y+=280){
      for(const side of [-1,1]){
        const worldY=y+r(100),x=side*(1300+r(650)),kind=zoneAt(y)===2&&r(4)===0?"cabin":"tree";
        this.objects.push({y:worldY,x,kind,scale:75+r(40),phase:r(10),wave:this.wave(worldY),eventIndex:-1,layer:1});
      }
    }
    for(let i=0;i<track.length;i++){
      const e=track[i];
      this.objects.push({...e,wave:this.wave(e.y),eventIndex:i,layer:0});
    }
    this.objects.sort((a,b)=>a.y-b.y||a.layer-b.layer);
    this.objectStart=0;this.objectEnd=0;this.trail=[];this.particles=[];this.shake=0;
    this.stripes=Array.from({length:580},(_,i)=>({y:i*200,wave:this.wave(i*200),waveEnd:this.wave(i*200+50)}));
  }
  point(x,z,camera=0,wave=null){
    const p=1/(1+z/580),curve=wave===null?this.wave(this.distance+z):wave;
    return{x:this.w/2+(x-camera)*this.worldScale*p+curve*this.w*(1-p),y:this.hy+this.span*p,p};
  }
  notifyStep(s){
    if(s.tick%2===0){this.trail.push({x:s.x,z:s.distance,wave:this.wave(s.distance)});if(this.trail.length>26)this.trail.shift();}
    for(const e of s.events){
      if(e.kind==="hit")this.shake=this.options.reduceMotion?0:5;
      const total=e.kind==="hit"?15:e.kind==="delivery"?22:e.kind==="gift"?6:0;
      for(let i=0;i<total;i++){
        const angle=(i*2.399+s.tick)*1.2;
        this.particles.push({x:this.w/2+s.x*this.worldScale*.8,y:this.h*.7,
          vx:Math.cos(angle)*(e.kind==="delivery"?65:35),vy:-45-Math.sin(angle)*30,
          life:.7+i%4*.08,max:.9,r:e.kind==="delivery"?3:2,color:e.kind==="hit"?"#fff":i%3?"#b2e7ff":"#ffe59c"});
      }
    }
    if(this.particles.length>90)this.particles.splice(0,this.particles.length-90);
  }
  roadFill(g,half,fill){
    const rows=this.road;g.beginPath();
    for(let i=0;i<rows.length;i++){const r=rows[i],x=r.center-half*r.scale;i?g.lineTo(x,r.y):g.moveTo(x,r.y);}
    for(let i=rows.length-1;i>=0;i--){const r=rows[i];g.lineTo(r.center+half*r.scale,r.y);}
    g.closePath();g.fillStyle=fill;g.fill();
  }
  iceFill(g,from,to){
    const rows=this.road;g.beginPath();
    for(let i=from;i<=to;i++){const r=rows[i];i===from?g.moveTo(r.center,r.y):g.lineTo(r.center,r.y);}
    for(let i=to;i>=from;i--){const r=rows[i];g.lineTo(r.center+945*r.scale,r.y);}
    g.closePath();g.fillStyle="#8fd7ef";g.fill();
  }
  draw(state,dt=0,interpolation=1,previous=null,ambient=false){
    if(this.renderBudget.observe(dt,!ambient&&dt>0))this.resize();
    this.time+=dt;this.shake=Math.max(0,this.shake-dt*12);
    const x=previous?previous.x+(state.x-previous.x)*interpolation:state.x;
    this.distance=previous?previous.distance+(state.distance-previous.distance)*interpolation:state.distance;
    if(ambient)this.distance=1200+this.time*80;
    const g=this.ctx,w=this.w,h=this.h,camera=x*.2;
    g.setTransform(this.dpr,0,0,this.dpr,0,0);g.globalAlpha=1;
    const drift=Math.sin(this.distance/6500)*14;
    // The opaque cached background covers the entire frame: no redundant clearRect.
    g.drawImage(this.bg,-50+drift,0,this.bg.width/this.dpr,this.bg.height/this.dpr);
    g.save();
    if(this.shake)g.translate(Math.sin(this.time*47)*this.shake*.45,Math.cos(this.time*33)*this.shake*.3);
    const sin1=Math.sin(this.distance/6500),cos1=Math.cos(this.distance/6500),
      sin2=Math.sin(this.distance/2300),cos2=Math.cos(this.distance/2300);
    for(const r of this.road){
      const wave=(sin1*r.c1+cos1*r.s1)*.12+(sin2*r.c2+cos2*r.s2)*.028;
      r.center=w/2-camera*r.scale+wave*w*(1-r.p);
    }
    // Same tessellation and contours, batched into three continuous surfaces.
    this.roadFill(g,1020,"#8ebedb");this.roadFill(g,980,"#fff");this.roadFill(g,945,"#effaff");
    let iceStart=-1;
    for(let i=0;i<this.road.length-1;i++){
      const icy=zoneAt(this.distance+this.road[i].z)===1;
      if(icy&&iceStart<0)iceStart=i;
      if(iceStart>=0&&(!icy||i===this.road.length-2)){
        this.iceFill(g,iceStart,icy?i+1:i);iceStart=-1;
      }
    }
    const stripeStart=Math.floor(this.distance/200);
    for(let i=stripeStart;i<Math.min(this.stripes.length,stripeStart+24);i++){
      const e=this.stripes[i],z=e.y-this.distance;if(z<0)continue;
      const p=1/(1+z/580),endP=1/(1+(z+50)/580);
      const cx=w/2-camera*this.worldScale*p+e.wave*w*(1-p),y=this.hy+this.span*p;
      const ex=w/2+(700-camera)*this.worldScale*endP+e.waveEnd*w*(1-endP),ey=this.hy+this.span*endP;
      const icy=zoneAt(e.y)===1;
      g.globalAlpha=.22*p;g.strokeStyle=icy?"#428bb2":"#94c8e5";g.lineWidth=1.2;g.beginPath();
      g.moveTo(cx+(icy?80:-600)*this.worldScale*p,y);g.quadraticCurveTo(cx+40*p,y-4*p,ex,ey);g.stroke();
    }
    g.globalAlpha=1;
    for(const side of [-1,1]){
      g.beginPath();let first=true;
      for(const t of this.trail){
        const z=t.z-this.distance;if(z< -180)continue;
        const p=1/(1+z/580),px=w/2+(t.x+side*104-camera)*this.worldScale*p+t.wave*w*(1-p),py=this.hy+this.span*p;
        if(first){g.moveTo(px,py);first=false;}else g.lineTo(px,py);
      }
      g.strokeStyle="#699fc15c";g.lineWidth=1.7;g.stroke();
    }
    const objects=this.objects;
    while(this.objectStart<objects.length&&objects[this.objectStart].y<this.distance-300)this.objectStart++;
    if(this.objectEnd<this.objectStart)this.objectEnd=this.objectStart;
    while(this.objectEnd<objects.length&&objects[this.objectEnd].y<this.distance+3900)this.objectEnd++;
    for(let i=this.objectEnd-1;i>=this.objectStart;i--){
      const e=objects[i],z=e.y-this.distance;
      if(e.eventIndex>=0&&(!ambient&&e.eventIndex<state.cursor||z< -90||z>3400))continue;
      if(z< -200)continue;
      const p=1/(1+z/580),fade=clamp((3900-z)/700,0,1);
      const t0=Math.max(0,state.tick-1);
      const mx=e.motion?entityX(e,t0)+(entityX(e,state.tick)-entityX(e,t0))*interpolation:e.x;
      const px=w/2+(mx-camera)*this.worldScale*p+e.wave*w*(1-p),py=this.hy+this.span*p;
      if(px< -300||px>w+300)continue;
      g.globalAlpha=fade;
      if(e.kind==="tree"||e.kind==="cabin"){
        const ww=(e.kind==="tree"?w*.44:w*.76)*p*e.scale/100,b=this.banks[e.kind],im=b.pick(ww*this.dpr);
        const hh=ww*this.assets[e.kind].height/this.assets[e.kind].width;if(ww<3)continue;
        g.fillStyle="#2e658d24";g.beginPath();g.ellipse(px,py,ww*.35,ww*.08,0,0,7);g.fill();g.drawImage(im,px-ww/2,py-hh,ww,hh);
      }else if(e.kind==="gift"){
        const sz=w*.14*p,bob=Math.sin(this.time*2.5+e.id)*2.5*p,im=this.gifts[e.style].pick(sz*this.dpr);
        g.drawImage(im,px-sz/2,py-sz*1.12+bob,sz,sz*1.19);
        if(p>.45){g.fillStyle="#fff";g.beginPath();g.arc(px+sz*.32,py-sz*.98,1.4,0,7);g.fill();}
      }else if(e.kind==="obstacle"){
        const ww=w*.22*p,hh=ww*90/140,im=this.obstacles[e.style].pick(ww*this.dpr);
        g.drawImage(im,px-ww/2,py-hh*.82,ww,hh);
      }else if(e.kind==="dock")this.drawDock(g,e,px,py,p,z,camera);
    }
    g.globalAlpha=1;this.drawPlayer(g,state,x,camera);
    let alive=0;
    for(let i=0;i<this.particles.length;i++){
      const p=this.particles[i];
      if(dt){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=70*dt;p.life-=dt;}
      if(p.life<=0)continue;this.particles[alive++]=p;
      g.globalAlpha=clamp(p.life/p.max,0,1);g.fillStyle=p.color;g.beginPath();g.arc(p.x,p.y,p.r,0,7);g.fill();
    }
    this.particles.length=alive;g.globalAlpha=1;g.restore();
    if(!this.options.reduceMotion&&this.options.holidayDecor!==false){
      for(const f of this.flakes){
        const xx=(f.x*w+Math.sin(this.time*.5+f.phase)*15+this.time*3)%w,yy=(f.y*h+this.time*f.s)%h;
        g.globalAlpha=.3+f.r*.14;g.fillStyle="#fff";g.beginPath();g.arc(xx,yy,f.r,0,7);g.fill();
      }
      g.globalAlpha=1;
    }
  }
  drawDock(g,e,px,py,p,z,camera){
    const side=Math.sign(e.x),house=this.point(side*1450,z+15,camera,this.wave(e.y+15));
    const ww=this.w*.8*p,hh=ww*this.assets.cabin.height/this.assets.cabin.width,im=this.banks.cabin.pick(ww*this.dpr);
    g.drawImage(im,house.x-ww/2,house.y-hh,ww,hh);
    const r=65*p,near=z<1000;
    g.fillStyle=near?"#479ef759":"#50b1ed33";g.strokeStyle=near?"#3e80d4":"#6bb2e7";g.lineWidth=Math.max(1,2*p);
    g.beginPath();g.ellipse(px,py,r,r*.3,0,0,7);g.fill();g.stroke();
    if(near){
      const grad=g.createLinearGradient(0,py-110*p,0,py);grad.addColorStop(0,"#82d0ff00");grad.addColorStop(1,"#6dc2ff50");
      g.fillStyle=grad;g.fillRect(px-r,py-110*p,r*2,110*p);
    }
    if(p>.2){
      const sz=42*p;g.drawImage(this.gifts[0].pick(sz*this.dpr),px-sz/2,py-sz*1.6,sz,sz*1.2);
      if(p>.42){
        const text="ДОСТАВКА",fw=Math.max(8,11*p);g.font="700 "+fw+"px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif";g.textAlign="center";
        const tw=g.measureText(text).width+14*p;round(g,px-tw/2,py-84*p,tw,21*p,8*p);g.fillStyle="#f5fbfff0";g.fill();
        g.fillStyle="#285b96";g.fillText(text,px,py-69*p);
      }
    }
  }
  drawPlayer(g,s,x,camera){
    const px=this.w/2+(x-camera)*this.worldScale,py=this.py,ww=this.w*.195,im=this.banks.sled.pick(ww*this.dpr);
    const hh=ww*this.assets.sled.height/this.assets.sled.width;
    const bob=this.options.reduceMotion?0:Math.sin(this.time*9)*Math.min(1.3,s.speed/25);
    g.save();g.translate(px,py+bob);g.fillStyle="#285d8d30";g.beginPath();g.ellipse(0,0,ww*.46,ww*.14,0,0,7);g.fill();
    g.rotate(clamp(-s.vx/75,-1,1)*.085);if(s.cooldown>0&&s.tick%4<2)g.globalAlpha=.72;
    g.drawImage(im,-ww/2,-hh+ww*.13,ww,hh);g.globalAlpha=1;
    for(let i=0;i<Math.min(s.bag,6);i++){
      const col=i%3,row=Math.floor(i/3),sz=ww*.22;
      g.drawImage(this.gifts[i%4].pick(sz*this.dpr),-ww*.28+col*ww*.16,-hh*.28-row*ww*.14,sz,sz*1.19);
    }
    g.restore();
  }
  dispose(){
    this.trail=[];this.particles=[];this.track=[];this.objects=[];this.stripes=[];this.road=[];
    if(this.bg)this.bg.width=1;this.canvas.width=1;this.canvas.height=1;
  }
}
