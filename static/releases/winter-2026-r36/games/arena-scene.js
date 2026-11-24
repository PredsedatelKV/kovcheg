import {RenderBudget} from "./render-budget.js";
import {ArenaAnimator} from "./arena-motion.js";
// Native WebGL voxel renderer. Shared cube mesh, instanced static/dynamic batches.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const VERT=`
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 iOffset;
attribute vec3 iSize;
attribute vec4 iColor;
attribute vec4 iStyle;
uniform mat4 uViewProjection;
uniform vec3 uEye;
uniform vec2 uFog;
varying vec4 vColor;
varying float vFog;
#ifdef VOXEL_DETAIL
varying vec4 vFace;
varying vec3 vMaterial;
#endif
void main(){
 float c=cos(iStyle.x),s=sin(iStyle.x);
 mat3 yaw=mat3(c,0.,-s,0.,1.,0.,s,0.,c);
 float cx=cos(iStyle.z),sx=sin(iStyle.z),cz=cos(iStyle.w),sz=sin(iStyle.w);
 mat3 pitch=mat3(1.,0.,0.,0.,cx,sx,0.,-sx,cx);
 mat3 roll=mat3(cz,sz,0.,-sz,cz,0.,0.,0.,1.);
 mat3 rot=yaw*roll*pitch;
 vec3 world=rot*(aPosition*iSize)+iOffset;
 vec3 normal=rot*aNormal;
 float light=.76+.24*max(0.,dot(normal,normalize(vec3(-.45,.85,.4))));
 light=mix(light,1.12,iStyle.y);
#ifdef VOXEL_DETAIL
 vec3 face=abs(aNormal);
 vec2 uv=face.x>.5 ? aPosition.zy : face.y>.5 ? aPosition.xz : aPosition.xy;
 vec2 size=face.x>.5 ? iSize.zy : face.y>.5 ? iSize.xz : iSize.xy;
 vFace=vec4(uv,size);
 float inTrain=(1.-smoothstep(1.48,1.75,abs(world.x)))*
               smoothstep(-9.9,-9.4,world.z)*(1.-smoothstep(15.6,15.9,world.z));
 float lamp=1.-smoothstep(.2,1.35,abs(mod(world.z+1.0,2.7)-1.35));
 float warm=inTrain*(.28+lamp*.46)*(.72+max(normal.y,0.)*.28);
 float range=1.-smoothstep(2.,13.,distance(uEye,world));
 vMaterial=vec3(warm,range,1.-clamp(iStyle.y,0.,1.));
 vec3 tint=mix(vec3(.94,1.,1.08),vec3(1.15,1.025,.90),warm);
 light=mix(light,light*(.88+.12*abs(normal.y)),vMaterial.z);
 vColor=vec4(iColor.rgb*light*mix(vec3(1.),tint,vMaterial.z),iColor.a);
#else
 vColor=vec4(iColor.rgb*light,iColor.a);
#endif
 vFog=smoothstep(uFog.x,uFog.y,distance(uEye,world));
 gl_Position=uViewProjection*vec4(world,1.);
}`;
const FRAG=`
precision mediump float;
varying vec4 vColor;
varying float vFog;
#ifdef VOXEL_DETAIL
varying vec4 vFace;
varying vec3 vMaterial;
#endif
void main(){
 vec3 color=vColor.rgb;
 #ifdef VOXEL_DETAIL
 vec2 size=vFace.zw;
 vec2 tile=floor((vFace.xy+.5)*size*42.);
 float fleck=fract(dot(mod(tile,vec2(17.,23.)),vec2(.7548777,.5698403)));
 vec2 fromEdge=(.5-abs(vFace.xy))*size;
 float bevel=(1.-smoothstep(.001,.018,min(fromEdge.x,fromEdge.y)))*
             smoothstep(.03,.10,min(size.x,size.y));
 float sheen=bevel*(.055+vMaterial.x*.12);
 color=color*(1.+(fleck-.51)*.105*vMaterial.y*vMaterial.z)+sheen*vec3(1.,.83,.61)*vMaterial.y*vMaterial.z;
 #endif
 gl_FragColor=vec4(mix(color,vec3(.76,.88,.98),vFog*.55),vColor.a);
}`;
function shader(gl,type,src){
 const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
 if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));
 return s;
}
export function perspective(fov,aspect,near,far){
 const f=1/Math.tan(fov/2),nf=1/(near-far);
 return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,2*far*near*nf,0]);
}
export function look(eye,yaw,pitch){
 const f=[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch)];
 const r=[Math.cos(yaw),0,Math.sin(yaw)];
 const u=[-Math.sin(yaw)*Math.sin(pitch),Math.cos(pitch),Math.cos(yaw)*Math.sin(pitch)];
 return new Float32Array([r[0],u[0],-f[0],0,r[1],u[1],-f[1],0,r[2],u[2],-f[2],0,
  -(r[0]*eye[0]+r[2]*eye[2]),-(u[0]*eye[0]+u[1]*eye[1]+u[2]*eye[2]),f[0]*eye[0]+f[1]*eye[1]+f[2]*eye[2],1]);
}
export function multiply(a,b){
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
 constructor(gl){this.gl=gl;this.buffer=gl.createBuffer();this.array=new Float32Array(14*2400);this.count=0;this.uploaded=0;}
 reset(){this.count=0;}
 box(x,y,z,sx,sy,sz,hex,rotation=0,glow=0,alpha=1,rotX=0,rotZ=0){
  const offset=this.count*14;
  if(offset+14>this.array.length){const larger=new Float32Array(this.array.length*2);larger.set(this.array);this.array=larger;}
  const rgb=color(hex),a=this.array;
  a[offset]=x;a[offset+1]=y;a[offset+2]=z;a[offset+3]=sx;a[offset+4]=sy;a[offset+5]=sz;
  a[offset+6]=rgb[0];a[offset+7]=rgb[1];a[offset+8]=rgb[2];a[offset+9]=alpha;a[offset+10]=rotation;a[offset+11]=glow;a[offset+12]=rotX;a[offset+13]=rotZ;
  this.count++;
 }
 upload(usage){
  const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
  if(this.uploaded<this.array.byteLength){gl.bufferData(gl.ARRAY_BUFFER,this.array.byteLength,usage);this.uploaded=this.array.byteLength;}
  gl.bufferSubData(gl.ARRAY_BUFFER,0,this.array.subarray(0,this.count*14));
 }
 dispose(){this.gl.deleteBuffer(this.buffer);}
}
function seeded(seed){
 let s=seed>>>0;return ()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};
}
export class ArenaScene{
 constructor(canvas,map,{reduceMotion=false}={},voxelDetail=false){
  this.canvas=canvas;this.map=map;this.reduceMotion=reduceMotion;this.renderBudget=new RenderBudget();
  this.gl=canvas.getContext("webgl",{alpha:false,antialias:true,powerPreference:"high-performance"});
  if(!this.gl)throw Error("Для 3D-арены нужен WebGL. Открой игру в актуальном браузере или Telegram.");
  const gl=this.gl;this.ext=gl.getExtension("ANGLE_instanced_arrays");
  if(!this.ext)throw Error("Этот браузер не поддерживает отрисовку 3D-арены.");
  const voxelSource=voxelDetail?"#define VOXEL_DETAIL\n":"";
  this.program=gl.createProgram();
  this.vs=shader(gl,gl.VERTEX_SHADER,voxelSource+VERT);
  this.fs=shader(gl,gl.FRAGMENT_SHADER,voxelSource+FRAG);
  gl.attachShader(this.program,this.vs);gl.attachShader(this.program,this.fs);gl.linkProgram(this.program);
  if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error("Не удалось подготовить 3D-графику");
  gl.useProgram(this.program);this.attrs={};
  for(const name of ["aPosition","aNormal","iOffset","iSize","iColor","iStyle"])this.attrs[name]=gl.getAttribLocation(this.program,name);
  this.matrixLoc=gl.getUniformLocation(this.program,"uViewProjection");this.eyeLoc=gl.getUniformLocation(this.program,"uEye");this.fogLoc=gl.getUniformLocation(this.program,"uFog");
  this.geometry=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.geometry);gl.bufferData(gl.ARRAY_BUFFER,cubeGeometry(),gl.STATIC_DRAW);
  this.static=new Batch(gl);this.dynamic=new Batch(gl);this.weapon=new Batch(gl);this.particles=[];this.animator=new ArenaAnimator();this.recoil=0;this.hit=0;this.time=0;
  this.camera={x:-10,z:-9,yaw:2.2,pitch:-.04};this.eye=[-10,1.55,-9];
  this.makeWorld();this.static.upload(gl.STATIC_DRAW);this.resize();
  gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);
  this.onLost=e=>{e.preventDefault();this.lost=true;canvas.dispatchEvent(new CustomEvent("arena-graphics-lost"));};
  canvas.addEventListener("webglcontextlost",this.onLost);
 }
 resize(){
  const rect=this.canvas.getBoundingClientRect();
  this.resizePerspective(rect,Math.PI*(rect.width<rect.height?.51:.40),.055,90,1.8);
 }
 resizePerspective(rect,fov,near,far,maxDpr,maxPixels){
  const width=Math.max(1,rect.width),height=Math.max(1,rect.height);
  const ratio=this.renderBudget.ratio(width,height,window.devicePixelRatio,maxDpr,maxPixels);
  const px=Math.max(1,Math.round(width*ratio)),py=Math.max(1,Math.round(height*ratio));
  if(width!==this.width||height!==this.height||!this.projection){
   this.width=width;this.height=height;
   this.projection=perspective(fov,width/height,near,far);
  }
  if(this.canvas.width!==px||this.canvas.height!==py||!this.bufferReady){
   this.canvas.width=px;this.canvas.height=py;
   this.gl.viewport(0,0,px,py);this.bufferReady=true;
  }
  this.canvas.dataset.pixelRatio=ratio.toFixed(2);
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
 part(b,p,x,y,z,sx,sy,sz,hex,rot=0,glow=0,rotX=0,rotZ=0){
  const theta=Math.atan2(p.ax,p.az),ss=Math.sin(theta),cc=Math.cos(theta),scale=p.boss?1.55:1;
  b.box(p.x+(x*cc+z*ss)*scale,y*scale,p.z+(-x*ss+z*cc)*scale,sx*scale,sy*scale,sz*scale,hex,theta+rot,glow,1,rotX,rotZ);
 }
 actor(p,me,dt){
  const basePose=this.animator.pose(p);
  const pose=p.skater&&p.airborne?{
   ...basePose,bob:0,leftLeg:-.37,rightLeg:.61,leftArm:-.98,rightArm:-.72,lean:.15,
  }:basePose;
  if(p.hp<=0)return;
  const b=this.dynamic,theta=Math.atan2(p.ax,p.az);
  if(!p.skater)b.box(p.x,.035,p.z,p.boss?1.4:.72,.025,p.boss?1.4:.65,"#91b0c7",theta);
  const local=p.id===me;
  const bob=pose.bob;
  const part=(x,y,z,sx,sy,sz,col,rx=0,rz=0)=>this.part(b,p,x,y+bob+(p.altitude||0),z,sx,sy,sz,col,0,0,rx,rz);
  const head=(x,y,z,sx,sy,sz,col)=>{
   const py=1.28,angle=pose.headPitch,dy=y-py;
   const yy=py+dy*Math.cos(angle)-z*Math.sin(angle),zz=dy*Math.sin(angle)+z*Math.cos(angle);
   part(x,yy,zz,sx,sy,sz,col,angle);
  };
  const legPart=(side,leg)=>{
   const hip=.68,l=.50;
   part(side*.12,hip-l*.5*Math.cos(leg),-l*.5*Math.sin(leg),.22,l,.25,"#3a597b",leg);
   part(side*.12,hip-.58*Math.cos(leg)-.05*Math.sin(leg),-.58*Math.sin(leg)+.05*Math.cos(leg),.23,.16,.34,"#294665",leg);
  };
  if(local){
   legPart(-1,pose.leftLeg);legPart(1,pose.rightLeg);
   return;
  }
  if(p.enemy){
   part(0,.58,0,.94,.60,.88,"#e6f6ff",0,pose.lean);
   part(0,.95,0,.72,.58,.70,"#f3fbff",0,pose.lean*.6);
   head(0,1.40,0,.54,.48,.52,"#f7fdff");
   head(0,1.70,0,.75,.10,.70,"#45617b");head(0,1.85,0,.45,.26,.45,p.boss?"#b04a6a":"#304861");
   part(0,1.08,.02,.78,.12,.76,p.boss?"#d65b76":"#5596d3");
   for(const side of [-1,1]){
    head(side*.14,1.46,.268,.07,.07,.025,"#21465d");
    const leg=side<0?pose.leftLeg:pose.rightLeg;
    part(side*.28,.36-.12*Math.cos(leg*.6),.16-.12*Math.sin(leg*.6),.23,.24,.27,"#c7e4f3",leg*.6);
    part(side*.28,.14+Math.abs(Math.sin(leg))*.07,.28-Math.sin(leg)*.26,.33,.19,.50,"#b2d8ee",leg*.6);
    const arm=side>0?pose.throwAngle:-leg*.55,roll=side*.95;
    const shoulder=1.24,sx=side*.42;
    const elbowX=sx+.30*Math.cos(arm)*Math.sin(roll),elbowY=shoulder-.30*Math.cos(arm)*Math.cos(roll),elbowZ=-.30*Math.sin(arm);
    part(sx+.15*Math.cos(arm)*Math.sin(roll),shoulder-.15*Math.cos(arm)*Math.cos(roll),-.15*Math.sin(arm),.10,.30,.11,"#8d7160",arm,roll);
    const fore=arm-.13,rz=roll+side*.10;
    part(elbowX+.12*Math.cos(fore)*Math.sin(rz),elbowY-.12*Math.cos(fore)*Math.cos(rz),elbowZ-.12*Math.sin(fore),.09,.24,.10,"#9a7d69",fore,rz);
    const handX=elbowX+.27*Math.cos(fore)*Math.sin(rz),handY=elbowY-.27*Math.cos(fore)*Math.cos(rz),handZ=elbowZ-.27*Math.sin(fore);
    part(handX,handY,handZ,.13,.13,.13,"#f4fbff",fore,rz);
    if(side>0&&p.windup>.1)part(handX,handY+.10,handZ,.18,.18,.18,"#fcffff",arm);
   }
   head(0,1.36,.34,.10,.09,.24,"#f6a265");
   for(let j=0;j<3;j++)part(0,.45+j*.19,.45-j*.04,.055,.055,.025,"#42738b");
  }else{
   const jacket=p.jacket||(p.team===0?"#4998d1":"#d86780"),hat=p.hat||(p.team===0?"#315a8b":"#8e435f");
   part(0,.92,0,.49,.64,.34,jacket,0,pose.lean);
   head(0,1.48,0,.40,.40,.37,"#f0d0ba");
   head(0,1.73,0,.46,.14,.43,hat);head(0,1.84,0,.32,.14,.32,hat);
   head(0,1.95,0,.13,.13,.13,"#eefaff");
   part(0,1.24,.02,.56,.10,.40,"#e4f5ff");
   part(-.16,1.05,.22,.11,.31,.08,"#e4f5ff",pose.leftLeg*.12);
   for(const side of [-1,1]){
    const leg=side<0?pose.leftLeg:pose.rightLeg;
    legPart(side,leg);
    const arm=side<0?pose.leftArm:pose.rightArm,fore=arm-.18*pose.aim;
    const elbowY=1.19-.27*Math.cos(arm),elbowZ=-.27*Math.sin(arm);
    part(side*.34,1.19-.135*Math.cos(arm),-.135*Math.sin(arm),.20,.27,.23,jacket,arm);
    part(side*.34,elbowY-.125*Math.cos(fore),elbowZ-.125*Math.sin(fore),.19,.25,.20,jacket,fore);
    const handY=elbowY-.29*Math.cos(fore),handZ=elbowZ-.29*Math.sin(fore);
    part(side*.34,handY,handZ,.18,.18,.20,"#d3eaf8",fore);
    if(side>0&&!p.skater){
     const gunAngle=fore+1.5;
     part(side*.34,handY+.04-Math.sin(gunAngle)*.13,handZ+Math.cos(gunAngle)*.13,.16,.14,.37,p.weapon==="pistol"?"#d0eaff":"#75c8ec",gunAngle);
     part(side*.34,handY+.04-Math.sin(gunAngle)*.35,handZ+Math.cos(gunAngle)*.35,.12,.10,.12,"#3d7296",gunAngle);
    }
    head(side*.10,1.51,.192,.06,.06,.022,"#21425e");
   }
  }
  if(p.shield>0)for(let i=0;i<16;i++){
   const angle=i*Math.PI/8+this.time*.5,r=p.boss?1.1:.68;
   b.box(p.x+Math.sin(angle)*r,.18+(i%3)*.54,p.z+Math.cos(angle)*r,.07,.27,.07,"#8ce3ff",angle,1);
  }
  const y=p.boss?3.3:2.13,ratio=p.hp/p.max_hp;
  b.box(p.x,y,p.z,.75,.065,.06,"#678da6",this.camera.yaw);
  const shift=(ratio-1)*.375;
  b.box(p.x+Math.cos(this.camera.yaw)*shift,y+.002,p.z+Math.sin(this.camera.yaw)*shift,.75*ratio,.07,.07,p.team===0?"#87d8ed":"#ee92a2",this.camera.yaw,1);
 }
 addEvent(e,localId){
  if(e.kind==="shot")this.animator.shot(e.actor);
  if(e.kind==="shot"&&e.actor===localId)this.recoil=.12;
  if(e.kind==="hit"&&e.actor===localId)this.hit=.3;
  if(["impact","hit","down","pickup"].includes(e.kind)){
   const x=e.x,z=e.z;if(!Number.isFinite(x)||!Number.isFinite(z))return;
   const count=e.kind==="down"||e.big?16:7;
   for(let i=0;i<count;i++){
    const t=i*2.399+e.id;
    this.particles.push({x,y:e.y||.8,z,vx:Math.sin(t)*2,vy:1.8+(i%4)*.4,vz:Math.cos(t)*2,life:.4+i%3*.12,max:.7,color:e.kind==="hit"?"#c1eaff":"#ffffff"});
   }
   if(this.particles.length>160)this.particles.splice(0,this.particles.length-160);
  }
 }
 pickup(d){
  const b=this.dynamic,spin=this.time*1.1,y=.58+Math.sin(this.time*2+d.id)*.09;
  const shades={heal:"#f692a5",shield:"#8edfff",rapid:"#88cdee",spread:"#a8a3e2",cannon:"#f4ca83"},col=shades[d.kind];
  const part=(x,yy,z,sx,sy,sz,color,glow=0)=>b.box(d.x+x*Math.cos(spin)+z*Math.sin(spin),y+yy,d.z-x*Math.sin(spin)+z*Math.cos(spin),sx,sy,sz,color,spin,glow);
  b.box(d.x,.09,d.z,.80,.04,.80,col,Math.PI/4,.45);
  for(let i=0;i<12;i++){
   const a=i*Math.PI/6;
   b.box(d.x+Math.cos(a)*.72,.07,d.z+Math.sin(a)*.72,.10,.025,.10,col,a,.65);
  }
  if(d.kind==="heal"){
   part(0,0,0,.42,.40,.26,"#f4fbff");
   for(const side of [-1,1]){part(0,0,side*.146,.25,.08,.04,col,1);part(0,0,side*.146,.08,.25,.04,col,1);}
  }else if(d.kind==="shield"){
   part(0,0,0,.43,.44,.14,col,.3);part(0,.1,0,.28,.10,.16,"#efffff",.8);part(0,-.25,0,.24,.12,.14,col,.6);
  }else{
   part(0,0,0,.58,.25,.28,col,.3);part(0,.12,0,.40,.06,.31,"#eefaff",.5);part(0,-.12,0,.15,.20,.14,"#477a9c");
  }
  part(0,.55,0,.07,.07,.07,"#f7ffff",1);
 }
 viewmodel(me,dt,moving){
  const b=this.weapon;b.reset();
  const rapid=me?.weapon==="rapid",spread=me?.weapon==="spread",cannon=me?.weapon==="cannon";
  const gait=this.animator.states.get(me?.id)?.phase||0;
  const bob=this.reduceMotion?0:Math.sin(gait*2)*.010*moving;
  const recoil=this.recoil*(cannon?1.0:.6);
  const x=.27+Math.sin(this.time*1.5)*.003+(this.reduceMotion?0:Math.cos(gait)*.007*moving),y=-.34+bob,z=-.72+recoil;
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
 staticBatch(build){
  const batch=new Batch(this.gl);
  build(batch);
  batch.upload(this.gl.STATIC_DRAW);
  return batch;
 }
 drawBatch(batch,matrix,eye,upload=true){
  const gl=this.gl,ext=this.ext;gl.useProgram(this.program);
  gl.uniformMatrix4fv(this.matrixLoc,false,matrix);gl.uniform3fv(this.eyeLoc,eye);gl.uniform2f(this.fogLoc,this.fog?.[0]??20,this.fog?.[1]??65);
  gl.bindBuffer(gl.ARRAY_BUFFER,this.geometry);
  for(const [name,size,offset] of [["aPosition",3,0],["aNormal",3,12]]){
   const at=this.attrs[name];gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,size,gl.FLOAT,false,24,offset);ext.vertexAttribDivisorANGLE(at,0);
  }
  if(upload)batch.upload(gl.DYNAMIC_DRAW);else gl.bindBuffer(gl.ARRAY_BUFFER,batch.buffer);
  for(const [name,size,offset] of [["iOffset",3,0],["iSize",3,12],["iColor",4,24],["iStyle",4,40]]){
   const at=this.attrs[name];gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,size,gl.FLOAT,false,56,offset);ext.vertexAttribDivisorANGLE(at,1);
  }
  ext.drawArraysInstancedANGLE(gl.TRIANGLES,0,36,batch.count);
 }
 draw(state,view,dt){
  if(this.lost)return;
  if(this.renderBudget.observe(dt,view.playing))this.resize();
  this.animator.beginFrame(dt,state?.actors||[]);
  const gl=this.gl;this.time+=dt;this.recoil=Math.max(0,this.recoil-dt*.7);this.hit=Math.max(0,this.hit-dt);
  const me=state?.actors.find(a=>a.id===view.me);
  const desiredX=me?.x??-10,desiredZ=me?.z??-9;
  const f=1-Math.exp(-dt*18);
  if(view.snap||Math.hypot(this.camera.x-desiredX,this.camera.z-desiredZ)>4){this.camera.x=desiredX;this.camera.z=desiredZ;}
  else{this.camera.x+=(desiredX-this.camera.x)*f;this.camera.z+=(desiredZ-this.camera.z)*f;}
  this.camera.yaw=view.yaw;this.camera.pitch=view.pitch;
  const moving=me&&me.hp>0?Math.min(1,Math.hypot(me.vx,me.vz)/3):0;
  const bob=this.reduceMotion?0:Math.sin(this.time*11)*.018*moving;
  const headOffset=(me&&!view.attract)?0.14:0;
  const eye=[this.camera.x+Math.sin(view.yaw)*headOffset,view.attract?1.65:me?.hp===0?.65:1.55+bob,this.camera.z-Math.cos(view.yaw)*headOffset];this.eye=eye;
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
  this.particles=[];this.animator.clear();this.ext=null;
  gl.getExtension("WEBGL_lose_context")?.loseContext();
 }
}
