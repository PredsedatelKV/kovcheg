// Native WebGL voxel renderer. Shared cube mesh, instanced static/dynamic batches.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const VERT=`
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 iOffset;
attribute vec3 iSize;
attribute vec4 iColor;
attribute vec2 iStyle;
uniform mat4 uViewProjection;
uniform vec3 uEye;
varying vec4 vColor;
varying float vFog;
void main(){
 float c=cos(iStyle.x),s=sin(iStyle.x);
 mat3 rot=mat3(c,0.,-s,0.,1.,0.,s,0.,c);
 vec3 world=rot*(aPosition*iSize)+iOffset;
 vec3 normal=rot*aNormal;
 float light=.76+.24*max(0.,dot(normal,normalize(vec3(-.45,.85,.4))));
 light=mix(light,1.12,iStyle.y);
 vColor=vec4(iColor.rgb*light,iColor.a);
 vFog=smoothstep(20.,65.,distance(uEye,world));
 gl_Position=uViewProjection*vec4(world,1.);
}`;
const FRAG=`
precision mediump float;
varying vec4 vColor;
varying float vFog;
void main(){gl_FragColor=vec4(mix(vColor.rgb,vec3(.76,.88,.98),vFog*.55),vColor.a);}`;
function shader(gl,type,src){
 const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
 if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));
 return s;
}
function perspective(fov,aspect,near,far){
 const f=1/Math.tan(fov/2),nf=1/(near-far);
 return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,2*far*near*nf,0]);
}
function look(eye,yaw,pitch){
 const f=[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch)];
 const r=[Math.cos(yaw),0,Math.sin(yaw)];
 const u=[-Math.sin(yaw)*Math.sin(pitch),Math.cos(pitch),Math.cos(yaw)*Math.sin(pitch)];
 return new Float32Array([r[0],u[0],-f[0],0,r[1],u[1],-f[1],0,r[2],u[2],-f[2],0,
  -(r[0]*eye[0]+r[2]*eye[2]),-(u[0]*eye[0]+u[1]*eye[1]+u[2]*eye[2]),f[0]*eye[0]+f[1]*eye[1]+f[2]*eye[2],1]);
}
function multiply(a,b){
 const out=new Float32Array(16);
 for(let c=0;c<4;c++)for(let r=0;r<4;r++)out[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];
 return out;
}
function cubeGeometry(){
 const a=[];const faces=[
 [[1,0,0],[[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5],[.5,-.5,.5]]],
 [[-1,0,0],[[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5],[-.5,-.5,-.5]]],
 [[0,1,0],[[-.5,.5,-.5],[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5]]],
 [[0,-1,0],[[-.5,-.5,.5],[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5]]],
 [[0,0,1],[[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5],[-.5,-.5,.5]]],
 [[0,0,-1],[[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5],[.5,-.5,-.5]]]
 ];
 for(const [n,points]of faces)for(const i of [0,1,2,0,2,3])a.push(...points[i],...n);
 return new Float32Array(a);
}
const COLORS=new Map();
function color(hex){
 let c=COLORS.get(hex);if(c)return c;
 const n=parseInt(hex.replace("#",""),16);c=[(n>>16&255)/255,(n>>8&255)/255,(n&255)/255];COLORS.set(hex,c);return c;
}
class Batch{
 constructor(gl){this.gl=gl;this.buffer=gl.createBuffer();this.array=new Float32Array(12*2400);this.count=0;this.uploaded=0;}
 reset(){this.count=0;}
 box(x,y,z,sx,sy,sz,hex,rotation=0,glow=0,alpha=1){
  const offset=this.count*12;
  if(offset+12>this.array.length){const larger=new Float32Array(this.array.length*2);larger.set(this.array);this.array=larger;}
  const rgb=color(hex),a=this.array;
  a[offset]=x;a[offset+1]=y;a[offset+2]=z;a[offset+3]=sx;a[offset+4]=sy;a[offset+5]=sz;
  a[offset+6]=rgb[0];a[offset+7]=rgb[1];a[offset+8]=rgb[2];a[offset+9]=alpha;a[offset+10]=rotation;a[offset+11]=glow;
  this.count++;
 }
 upload(usage){
  const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
  if(this.uploaded<this.array.byteLength){gl.bufferData(gl.ARRAY_BUFFER,this.array.byteLength,usage);this.uploaded=this.array.byteLength;}
  gl.bufferSubData(gl.ARRAY_BUFFER,0,this.array.subarray(0,this.count*12));
 }
 dispose(){this.gl.deleteBuffer(this.buffer);}
}
function seeded(seed){
 let s=seed>>>0;return ()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};
}
export class ArenaScene{
 constructor(canvas,map,{reduceMotion=false}={}){
  this.canvas=canvas;this.map=map;this.reduceMotion=reduceMotion;
  this.gl=canvas.getContext("webgl",{alpha:false,antialias:true,powerPreference:"high-performance"});
  if(!this.gl)throw Error("Для 3D-арены нужен WebGL. Открой игру в актуальном браузере или Telegram.");
  const gl=this.gl;this.ext=gl.getExtension("ANGLE_instanced_arrays");
  if(!this.ext)throw Error("Этот браузер не поддерживает отрисовку 3D-арены.");
  this.program=gl.createProgram();this.vs=shader(gl,gl.VERTEX_SHADER,VERT);this.fs=shader(gl,gl.FRAGMENT_SHADER,FRAG);
  gl.attachShader(this.program,this.vs);gl.attachShader(this.program,this.fs);gl.linkProgram(this.program);
  if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error("Не удалось подготовить 3D-графику");
  gl.useProgram(this.program);this.attrs={};
  for(const name of ["aPosition","aNormal","iOffset","iSize","iColor","iStyle"])this.attrs[name]=gl.getAttribLocation(this.program,name);
  this.matrixLoc=gl.getUniformLocation(this.program,"uViewProjection");this.eyeLoc=gl.getUniformLocation(this.program,"uEye");
  this.geometry=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.geometry);gl.bufferData(gl.ARRAY_BUFFER,cubeGeometry(),gl.STATIC_DRAW);
  this.static=new Batch(gl);this.dynamic=new Batch(gl);this.weapon=new Batch(gl);this.particles=[];this.recoil=0;this.hit=0;this.time=0;
  this.camera={x:-10,z:-9,yaw:2.2,pitch:-.04};this.eye=[-10,1.55,-9];
  this.makeWorld();this.static.upload(gl.STATIC_DRAW);this.resize();
  gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);
  this.onLost=e=>{e.preventDefault();this.lost=true;canvas.dispatchEvent(new CustomEvent("arena-graphics-lost"));};
  canvas.addEventListener("webglcontextlost",this.onLost);
 }
 resize(){
  const rect=this.canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,1.8);
  this.width=Math.max(280,rect.width);this.height=Math.max(320,rect.height);
  this.canvas.width=Math.round(this.width*dpr);this.canvas.height=Math.round(this.height*dpr);
  this.projection=perspective(Math.PI*(this.width<this.height?.51:.40),this.width/this.height,.055,90);
  this.gl.viewport(0,0,this.canvas.width,this.canvas.height);
 }
 makeWorld(){
  const b=this.static,r=seeded(907),snow=["#eef8ff","#e5f3ff","#f0faff","#e9f7ff"];
  b.box(0,-.17,0,160,.20,160,"#dceefa");
  b.box(0,-.5,0,28,.9,28,"#91bcd8");
  for(let x=-13;x<=13;x++)for(let z=-13;z<=13;z++){
   b.box(x,-.035,z,1.01,.1,1.01,snow[Math.floor(r()*snow.length)]);
   if(r()<.14)b.box(x+(r()-.5)*.6,.024,z+(r()-.5)*.6,.14,.012,.2,"#cee6f5");
  }
  for(let z=-12;z<=12;z++)for(let x=-1;x<=1;x++)b.box(x,.021,z,.97,.012,.97,"#d2effb");
  for(const c of this.map.covers){
   const [x,z,w,d,h,material]=c;
   if(material==="ice"){
    b.box(x,h/2,z,w,h,d,"#74b9e0");b.box(x,h+.05,z,w+.13,.12,d+.13,"#f5fcff");
    for(let i=0;i<3;i++)b.box(x-w*.35+i*w*.35,h*.48,z+d/2+.012,.08,h*.7,.025,"#bcecff",0,.12);
    b.box(x,h*.5,z-d/2-.012,w*.8,.09,.03,"#b2e8fa");
    for(const side of [-1,1]){
     for(const edge of [-1,1])b.box(x+edge*w/2,h/2,z+side*d/2,.035,h,.035,"#c9f0ff",0,.2);
     for(let k=0;k<8;k++){
      const xx=x-w*.38+k*w*.095,yy=h*(.72-(k%4)*.07);
      b.box(xx,yy,z+side*(d/2+.018),w*.10,.035,.025,k%3?"#a6ddf4":"#e0f7ff");
     }
    }
   }else if(material==="wood"){
    for(let y=.19;y<h;y+=.34)b.box(x,y,z,w,.31,d,y>.8?"#9c796a":"#836653");
    b.box(x,h+.06,z,w+.16,.18,d+.16,"#f4fbff");
    for(const side of [-1,1])b.box(x+side*w*.34,h*.45,z,w*.06,h,.04,"#d0a38a");
   }else{
    b.box(x,h/2,z,w,h,d,"#c8e5f5");b.box(x,h+.01,z,w+.08,.14,d+.08,"#f7fdff");
    b.box(x-w*.18,h*.53,z+d/2+.02,w*.55,.06,.035,"#e5f8ff");
   }
  }
  for(let i=-13;i<=13;i+=2){
   for(const side of [-1,1]){
    b.box(i,.55,side*13.6,.22,1.1,.22,"#7497ad");b.box(i,1.14,side*13.6,.3,.12,.3,"#f6fcff");
    b.box(side*13.6,.55,i,.22,1.1,.22,"#7497ad");b.box(side*13.6,1.14,i,.3,.12,.3,"#f6fcff");
   }
  }
  for(const side of [-1,1]){
   b.box(0,.65,side*13.6,27,.11,.13,"#a8c9dc");b.box(side*13.6,.65,0,.13,.11,27,"#a8c9dc");
   for(let i=-12;i<=12;i+=1.5){
    const bulb=["#ffd77e","#f291a4","#8ae2cf","#9fc2ff"][Math.floor((i+12)/1.5)%4];
    b.box(i,1.3,side*13.6,.12,.16,.12,bulb,0,1);
    b.box(side*13.6,1.3,i,.12,.16,.12,bulb,0,1);
   }
  }
  for(const x of [-17,-13,-9,-4,2,7,12,17]){
   this.tree(x,-17,2.6+r()*1.8);this.tree(x,17,2.8+r()*1.3);
  }
  for(const z of [-10,-4,3,9]){this.tree(-17,z,3.5+r());this.tree(17,z,3.4+r());}
  this.hut(-19,-10,0);this.hut(19,10,Math.PI);
  for(const x of [-11,11])for(const z of [-11,11]){
   b.box(x,1.4,z,.17,2.8,.17,"#375b7c");b.box(x,2.8,z,.55,.15,.55,"#e4f5ff");
   b.box(x,2.55,z,.35,.45,.35,"#ffdda0",0,1);
   b.box(x,2.26,z,.5,.12,.5,"#426d8d");b.box(x,2.95,z,.4,.15,.4,"#fbffff");
   b.box(x,.03,z,2.2,.025,2.2,"#e5f2f3");
  }
  // Stepped, snow-capped voxel ridges around the forest.
  for(let i=0;i<26;i++){
   const side=i%2?-1:1,x=(r()-.5)*95,z=side*(38+r()*18),rotation=Math.PI/4;
   let y=-.1;
   const height=6+r()*6,base=10+r()*8;
   for(let layer=0;layer<4;layer++){
    const width=base*(1-layer*.23),hh=height*(.35-layer*.055);
    b.box(x,y+hh/2,z,width,hh,width*.8,layer<2?"#bdd8eb":"#d4eafb",rotation);
    b.box(x,y+hh+.05,z,width+.07,.18,width*.8+.07,"#effaff",rotation);
    y+=hh;
   }
  }
  for(let i=0;i<9;i++){
   const x=(r()-.5)*70,z=(r()-.5)*70,y=15+r()*6;
   b.box(x,y,z,5+r()*4,.7,2+r()*3,"#e9f6ff");
   b.box(x-1,y+.55,z+1,3,.5,2,"#f6fcff");
  }
  for(const [x,z] of this.map.pads||[]){
   b.box(x,.035,z,1.2,.04,1.2,"#adccdf",Math.PI/4);
   b.box(x,.06,z,1.0,.035,1.0,"#edfaff",Math.PI/4);
  }
 }
 tree(x,z,h){
  const b=this.static;b.box(x,h*.2,z,.32,h*.4,.32,"#846d60");
  for(let i=0;i<5;i++){
   const size=h*(.65-i*.105),y=h*.28+i*h*.14;
   b.box(x,y,z,size,h*.20,size,i%2?"#387d83":"#286875");
   b.box(x,y+h*.1+.03,z,size+.05,.12,size+.05,"#e9f8ff");
   b.box(x-size*.27,y+h*.13,z,size*.38,.12,size*.5,"#ffffff");
  }
 }
 hut(x,z,rot){
  const b=this.static;
  b.box(x,1.4,z,4,2.8,4,"#8c6b60",rot);b.box(x,2.9,z,4.7,.35,4.7,"#eaf8ff",rot);
  b.box(x,3.3,z,3.5,.5,3.5,"#c1e0f2",rot);b.box(x,3.65,z,2.1,.25,2.1,"#f7fcff",rot);
  for(const off of [-1.1,1.1]){
   b.box(x+off,1.5,z+2.03,.75,.9,.05,"#ffd489",0,1);
   b.box(x+off,1.5,z+2.07,.06,.95,.07,"#805f56");b.box(x+off,1.5,z+2.07,.8,.06,.07,"#805f56");
  }
  b.box(x,1,z+2.04,.65,2,.08,"#465e71");
  b.box(x+1,3.6,z-.7,.55,1.0,.55,"#7b7a81");b.box(x+1,4.17,z-.7,.7,.15,.7,"#ecf9ff");
 }
 part(b,p,x,y,z,sx,sy,sz,hex,rot=0,glow=0){
  const theta=Math.atan2(p.ax,p.az),s=Math.sin(theta),c=Math.cos(theta),scale=p.boss?1.55:1;
  b.box(p.x+(x*c+z*s)*scale,y*scale,p.z+(-x*s+z*c)*scale,sx*scale,sy*scale,sz*scale,hex,theta+rot,glow);
 }
 actor(p,me,dt){
  if(p.hp<=0)return;
  const b=this.dynamic;
  const local=p.id===me,theta=Math.atan2(p.ax,p.az),speed=Math.hypot(p.vx,p.vz);
  b.box(p.x,.035,p.z,p.boss?1.4:.72,.025,p.boss?1.4:.65,"#91b0c7",theta);
  if(local)return;
  const phase=Math.sin(this.time*11+(p.id.charCodeAt(0)||1))*Math.min(1,speed/3)*.16;
  if(p.enemy){
   this.part(b,p,0,.36,0,.94,.68,.88,"#e6f6ff");
   this.part(b,p,0,.93,0,.72,.58,.70,"#f3fbff");
   this.part(b,p,0,1.40,0,.54,.48,.52,"#f7fdff");
   this.part(b,p,0,1.70,0,.75,.10,.70,"#45617b");this.part(b,p,0,1.85,0,.45,.26,.45,p.boss?"#b04a6a":"#304861");
   this.part(b,p,0,1.08,.02,.78,.12,.76,p.boss?"#d65b76":"#5596d3");
   for(const side of [-1,1]){
    this.part(b,p,side*.14,1.46,.268,.07,.07,.025,"#21465d");
    this.part(b,p,side*.53,.94,.14,.4,.10,.11,"#8d7160",side*.25);
   }
   this.part(b,p,0,1.36,.34,.10,.09,.24,"#f6a265");
   for(let j=0;j<3;j++)this.part(b,p,0,.44+j*.19,.45-j*.04,.055,.055,.025,"#42738b");
  }else{
   const jacket=p.team===0?"#4998d1":"#d86780",hat=p.team===0?"#315a8b":"#8e435f";
   this.part(b,p,0,.92,0,.49,.64,.34,jacket);
   this.part(b,p,0,1.48,0,.40,.40,.37,"#f0d0ba");
   this.part(b,p,0,1.73,0,.46,.14,.43,hat);this.part(b,p,0,1.84,0,.32,.14,.32,hat);
   this.part(b,p,0,1.95,0,.13,.13,.13,"#eefaff");
   this.part(b,p,0,1.24,.02,.56,.10,.40,"#e4f5ff");
   this.part(b,p,-.16,1.05,.22,.11,.31,.08,"#e4f5ff");
   for(const side of [-1,1]){
    this.part(b,p,side*.14,.42,side*phase,.21,.47,.26,"#3a597b");
    this.part(b,p,side*.14,.15,side*phase+.06,.23,.16,.36,"#294665");
    this.part(b,p,side*.34,1.0,.19,.20,.28,.34,jacket);
    this.part(b,p,side*.34,1.02,.40,.18,.18,.20,"#d3eaf8");
    this.part(b,p,side*.10,1.51,.192,.06,.06,.022,"#21425e");
   }
   this.part(b,p,.25,1.10,.57,.17,.15,.43,p.weapon==="pistol"?"#d0eaff":"#75c8ec");
   this.part(b,p,.25,1.11,.80,.13,.10,.12,"#3d7296");
  }
  if(p.shield>0){
   for(let i=0;i<16;i++){
    const angle=i*Math.PI/8+this.time*.5,r=p.boss?1.1:.68;
    b.box(p.x+Math.sin(angle)*r,.18+(i%3)*.54,p.z+Math.cos(angle)*r,.07,.27,.07,"#8ce3ff",angle,1);
   }
  }
  const y=p.boss?3.3:2.13,ratio=p.hp/p.max_hp;
  b.box(p.x,y,p.z,.75,.065,.06,"#678da6",this.camera.yaw);
  const shift=(ratio-1)*.375;
  b.box(p.x+Math.cos(this.camera.yaw)*shift,y+.002,p.z+Math.sin(this.camera.yaw)*shift,.75*ratio,.07,.07,p.team===0?"#87d8ed":"#ee92a2",this.camera.yaw,1);
 }
 addEvent(e,localId){
  if(e.kind==="shot"&&e.actor===localId)this.recoil=.12;
  if(e.kind==="hit"&&e.actor===localId)this.hit=.3;
  if(["impact","hit","down","pickup"].includes(e.kind)){
   const x=e.x,z=e.z;if(!Number.isFinite(x)||!Number.isFinite(z))return;
   const count=e.kind==="down"?16:7;
   for(let i=0;i<count;i++){
    const t=i*2.399+e.id;
    this.particles.push({x,y:e.y||.8,z,vx:Math.sin(t)*2,vy:1.8+(i%4)*.4,vz:Math.cos(t)*2,life:.4+i%3*.12,max:.7,color:e.kind==="hit"?"#c1eaff":"#ffffff"});
   }
   if(this.particles.length>160)this.particles.splice(0,this.particles.length-160);
  }
 }
 pickup(d){
  const b=this.dynamic,spin=this.time*1.1,y=.58+Math.sin(this.time*2+d.id)*.09;
  const shades={heal:"#f692a5",shield:"#8edfff",rapid:"#88cdee",spread:"#a8a3e2",cannon:"#f4ca83"};
  const col=shades[d.kind];
  b.box(d.x,.09,d.z,.65,.04,.65,col,Math.PI/4,.45);
  if(d.kind==="heal"){
   b.box(d.x,y,d.z,.42,.40,.26,"#f4fbff",spin);
   b.box(d.x,y,d.z+.146,.25,.08,.04,col,spin,1);
   b.box(d.x,y,d.z+.146,.08,.25,.04,col,spin,1);
  }else if(d.kind==="shield"){
   b.box(d.x,y,d.z,.43,.44,.14,col,spin,.3);
   b.box(d.x,y+.1,d.z,.28,.10,.16,"#efffff",spin,.8);
   b.box(d.x,y-.25,d.z,.24,.12,.14,col,spin,.6);
  }else{
   b.box(d.x,y,d.z,.58,.25,.28,col,spin,.3);
   b.box(d.x,y+.12,d.z,.40,.06,.31,"#eefaff",spin,.5);
   b.box(d.x,y-.12,d.z,.15,.20,.14,"#477a9c",spin);
  }
  b.box(d.x,y+.55,d.z,.07,.07,.07,"#f7ffff",spin,1);
 }
 viewmodel(me,dt,moving){
  const b=this.weapon;b.reset();
  const rapid=me?.weapon==="rapid",spread=me?.weapon==="spread",cannon=me?.weapon==="cannon";
  const bob=this.reduceMotion?0:Math.sin(this.time*10)*.012*moving;
  const recoil=this.recoil*(cannon?1.0:.6);
  const x=.27+Math.sin(this.time*1.5)*.006,y=-.27+bob,z=-.56+recoil;
  b.box(x,y-.12,z+.12,.18,.23,.28,"#5798c6",-.12);
  b.box(x,y-.04,z+.05,.15,.14,.20,"#def2ff");
  b.box(x,y,z-.14,.16,cannon?.23:.16,cannon?.48:rapid?.52:.36,cannon?"#a5d6ed":"#91c9ec");
  b.box(x,y+.10,z-.14,.13,.06,cannon?.43:.34,"#eafaff");
  b.box(x,y-.12,z-.02,.10,.20,.12,"#3e7297",-.1);
  b.box(x+.086,y+.005,z-.12,.018,.09,.19,"#3d91bf");
  b.box(x+.098,y+.005,z-.12,.012,.045,.10,"#b6f3ff",0,.8);
  b.box(x-.087,y+.005,z-.12,.018,.09,.19,"#3d91bf");
  b.box(x,y+.02,z-(rapid?.43:cannon?.43:.35),spread?.22:.13,spread?.13:.11,.13,"#365e81");
  if(spread)for(const side of [-1,1])b.box(x+side*.07,y+.02,z-.43,.065,.065,.10,"#c6eeff");
  else b.box(x,y+.02,z-(rapid?.51:cannon?.51:.43),.07,.065,.04,"#bcecff",0,.7);
  b.box(x,y+.145,z-.19,.035,.05,.04,"#426c89");
  b.box(x,y+.08,z+.02,.035,.05,.035,"#426c89");
  for(let i=0;i<(rapid?3:cannon?2:1);i++)b.box(x+.085,y,z-.1-i*.09,.015,.055,.035,"#6eecff",0,1);
  if(this.recoil>.07)b.box(x,y+.02,z-(rapid?.56:cannon?.58:.48),.12,.10,.12,"#eeffff",0,1);
 }
 drawBatch(batch,matrix,eye,upload=true){
  const gl=this.gl,ext=this.ext;gl.useProgram(this.program);
  gl.uniformMatrix4fv(this.matrixLoc,false,matrix);gl.uniform3fv(this.eyeLoc,eye);
  gl.bindBuffer(gl.ARRAY_BUFFER,this.geometry);
  for(const [name,size,offset] of [["aPosition",3,0],["aNormal",3,12]]){
   const at=this.attrs[name];gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,size,gl.FLOAT,false,24,offset);ext.vertexAttribDivisorANGLE(at,0);
  }
  if(upload)batch.upload(gl.DYNAMIC_DRAW);else gl.bindBuffer(gl.ARRAY_BUFFER,batch.buffer);
  for(const [name,size,offset] of [["iOffset",3,0],["iSize",3,12],["iColor",4,24],["iStyle",2,40]]){
   const at=this.attrs[name];gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,size,gl.FLOAT,false,48,offset);ext.vertexAttribDivisorANGLE(at,1);
  }
  ext.drawArraysInstancedANGLE(gl.TRIANGLES,0,36,batch.count);
 }
 draw(state,view,dt){
  if(this.lost)return;
  const gl=this.gl;this.time+=dt;this.recoil=Math.max(0,this.recoil-dt*.7);this.hit=Math.max(0,this.hit-dt);
  const me=state?.actors.find(a=>a.id===view.me);
  const desiredX=me?.x??-10,desiredZ=me?.z??-9;
  const f=1-Math.exp(-dt*18);
  if(view.snap||Math.hypot(this.camera.x-desiredX,this.camera.z-desiredZ)>4){this.camera.x=desiredX;this.camera.z=desiredZ;}
  else{this.camera.x+=(desiredX-this.camera.x)*f;this.camera.z+=(desiredZ-this.camera.z)*f;}
  this.camera.yaw=view.yaw;this.camera.pitch=view.pitch;
  const moving=me&&me.hp>0?Math.min(1,Math.hypot(me.vx,me.vz)/3):0;
  const bob=this.reduceMotion?0:Math.sin(this.time*11)*.018*moving;
  const eye=[this.camera.x,view.attract?1.65:me?.hp===0?.65:1.55+bob,this.camera.z];this.eye=eye;
  const matrix=multiply(this.projection,look(eye,view.yaw,view.pitch));this.viewProjection=matrix;
  gl.clearColor(.76,.88,.98,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  this.drawBatch(this.static,matrix,eye,false);
  const b=this.dynamic;b.reset();
  if(state){
   for(const p of state.actors)this.actor(p,view.me,dt);
   for(const d of state.pickups)this.pickup(d);
   for(const ball of state.balls){
    const size=ball.big?.25:.14;
    b.box(ball.x,ball.y||1.35,ball.z,size,size,size,"#f7ffff",this.time*3,1);
    b.box(ball.x,ball.y||1.35,ball.z,size*1.35,size*.35,size*.35,"#a1e7ff",this.time*3,.5);
   }
  }
  let write=0;
  for(const p of this.particles){
   p.life-=dt;if(p.life<=0)continue;
   p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;p.vy-=5*dt;
   const size=.06*p.life/p.max;
   b.box(p.x,Math.max(.05,p.y),p.z,size,size,size,p.color,this.time*3,.4);this.particles[write++]=p;
  }this.particles.length=write;
  for(let i=0;i<65;i++){
   const x=((i*7.613+this.time*.10)%30)-15,z=((i*3.731+this.time*.07)%30)-15;
   const y=8-((i*.817+this.time*(.5+(i%3)*.12))%8);
   b.box(x,y,z,.032+(i%2)*.016,.032,.032,"#ffffff",this.time*.2,.6);
  }
  this.drawBatch(b,matrix,eye);
  if(view.playing&&me&&me.hp>0){
   gl.clear(gl.DEPTH_BUFFER_BIT);this.viewmodel(me,dt,moving);this.drawBatch(this.weapon,this.projection,[0,0,0]);
  }
  this.canvas.dataset.instances=String(this.static.count+b.count+this.weapon.count);
 }
 project(x,y,z){
  const m=this.viewProjection;if(!m)return null;
  const w=m[3]*x+m[7]*y+m[11]*z+m[15];if(w<=0)return null;
  return {x:((m[0]*x+m[4]*y+m[8]*z+m[12])/w*.5+.5)*this.width,
          y:(.5-(m[1]*x+m[5]*y+m[9]*z+m[13])/w*.5)*this.height};
 }
 dispose(){
  const gl=this.gl;this.canvas.removeEventListener("webglcontextlost",this.onLost);
  this.static.dispose();this.dynamic.dispose();this.weapon.dispose();
  gl.deleteBuffer(this.geometry);gl.deleteProgram(this.program);gl.deleteShader(this.vs);gl.deleteShader(this.fs);
  this.particles=[];this.ext=null;
  gl.getExtension("WEBGL_lose_context")?.loseContext();
 }
}
