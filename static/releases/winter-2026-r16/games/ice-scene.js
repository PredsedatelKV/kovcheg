import {ArenaScene, look, multiply, perspective} from "./arena-scene.js";

export const GRID = 11;
export const TILE = 1.65;
export const jackets = ["#46a9e3","#e67188","#56bd9d","#9b86e6"];
const hats = ["#285087","#98445f","#246658","#654b99"];
const ice = ["#b8e9fa","#a6def4","#c3edfd","#b0e5f7"];
const colors = {bridge:"#a3f5ff",anchor:"#afebd4",charge:"#ffe196"};
const tau = Math.PI * 2;
export function tileCoords(index) {
  return [(index % GRID - 5) * TILE, (Math.floor(index / GRID) - 5) * TILE];
}

function randomGenerator(seed) {
  return () => {
    seed = (Math.imul(seed,1664525)+1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export class IceScene extends ArenaScene {
  constructor(canvas, preferences) {
    super(canvas, {}, {reduceMotion:preferences.reduceMotion});
    this.fog=[44,105];
    this.track = {x:0,z:0};
    this.effects = [];
    this.previousTiles = "";
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(1.6, window.devicePixelRatio || 1);
    this.width = rect.width || 1;
    this.height = rect.height || 1;
    this.canvas.width = Math.max(1, Math.round(this.width*dpr));
    this.canvas.height = Math.max(1, Math.round(this.height*dpr));
    this.projection = perspective(.74, this.width/this.height, .1, 120);
    this.gl.viewport(0,0,this.canvas.width,this.canvas.height);
  }

  makeWorld() {
    const b = this.static;
    const rng = randomGenerator(712);
    b.box(0,-3,0,110,.8,110,"#567f9e");
    b.box(0,-.84,0,36,.15,33,"#336a97",0,.3);
    b.box(0,-.74,0,22,.06,22,"#387ba6",0,.35);
    for (let i=0;i<230;i++) {
      const x=(rng()-.5)*33,z=(rng()-.5)*30;
      b.box(x,-.695,z,.30+rng()*2.7,.012,.04+rng()*.05,i%3?"#659ec2":"#79accb",rng()*.24,0,.62);
    }
    // Deep snow shelves and evergreens set the lake into a small valley.
    for (const sign of [-1,1]) {
      for (let i=-6;i<=6;i++) {
        let x=i*3.1,z=sign*(12.6+rng()*2);
        b.box(x,-1.08,z,4.6,1.6,5.2,"#90b8d0",rng()*.4);
        b.box(x,-.20,z,4.3,.26,4.7,"#dfedf6",rng()*.4,.3);
        b.box(z,-1.04,x,4.8,1.65,4.2,"#a4c9df",rng()*.4);
        b.box(z,-.18,x,4.6,.24,4.1,"#e8f6ff",rng()*.4,.3);
        if (i%2 || rng()>.4) {
          this.fir(x,z,2.1+rng()*2.1);
          this.fir(z,x,2.2+rng()*2.0);
        }
      }
    }
    // Warm windows and a snow-capped roof anchor the far shore.
    const lx=-3.7,lz=-13.8;
    b.box(lx,.64,lz,3.3,1.55,2.2,"#54748a");
    b.box(lx,.06,lz+1.09,3.7,.28,.48,"#b5d6e8");
    for(const side of [-1,1]){
      b.box(lx+side*.91,1.52,lz,1.98,.17,2.7,"#607e9b",0,0,1,0,-side*.40);
      b.box(lx+side*.91,1.65,lz,2.00,.12,2.75,"#eaf7ff",0,.25,1,0,-side*.40);
      b.box(lx+side*1.03,.83,lz+1.12,.68,.57,.09,"#ffe0a3",0,.98);
      b.box(lx+side*1.03,.83,lz+1.18,.05,.58,.055,"#795e5e");
      b.box(lx+side*1.03,.83,lz+1.18,.68,.05,.055,"#795e5e");
    }
    b.box(lx,.53,lz+1.12,.52,.93,.10,"#2e506d");
    b.box(lx+1.02,1.97,lz-.50,.31,.89,.32,"#768eab");
    b.box(lx+1.02,2.45,lz-.50,.42,.13,.42,"#eaf8fe",0,.3);
    for (const x of [-9.9,9.9]) for (const z of [-9.9,9.9]) {
      b.box(x,-.26,z,.8,.6,.8,"#c7d8e7");
      b.box(x,.17,z,.18,.7,.18,"#3b6382");
      b.box(x,.62,z,.40,.33,.40,"#ffda96",0,.95);
      b.box(x,.84,z,.51,.12,.51,"#235475");
      b.box(x,.94,z,.42,.10,.42,"#f8fdff");
      for(let i=0;i<6;i++){
        b.box(x-Math.sign(x)*i*.22,.33-Math.sin(i/6*Math.PI)*.14,z,.08,.08,.08,
              ["#ffd283","#f4a7ac","#92d6fc"][i%3],0,1);
      }
    }
  }

  fir(x,z,height) {
    const b=this.static;
    b.box(x,height*.15,z,.18,height*.34,.17,"#786d68");
    for(let i=0;i<4;i++){
      const width=height*(.53-i*.11),y=height*(.25+i*.16);
      b.box(x,y,z,width,height*.19,width,"#3b7584",i*.16);
      b.box(x,y+height*.101,z,width*.90,height*.035,width*.90,"#cadfea",i*.16,.2);
    }
  }

  event(event) {
    if (event.kind==="pulse" || event.kind==="fall" || event.kind==="pickup"){
      this.effects.push({kind:event.kind,x:event.x,z:event.z,time:this.time});
    }
  }

  drawFloes(tiles, t) {
    const b=this.dynamic;
    for(let i=0;i<tiles.length;i++){
      const code=tiles[i],before=this.previousTiles[i];
      const [x,z]=tileCoords(i);
      if(code==="0"){
        if(before && before!=="0")this.effects.push({kind:"shard",x,z,time:t,seed:i});
        continue;
      }
      const hot=code==="3"||code==="4",reinforced=code==="5";
      const tint=reinforced?"#a8faea":code==="4"?"#dcbed7":hot?"#edc6d5":ice[(i*7+Math.floor(i/11))%4];
      const tremble=hot&&!this.reduceMotion?Math.sin(t*48+i)*.026:0;
      b.box(x,-.14+tremble,z,TILE-.05,.28,TILE-.05,"#528fba");
      b.box(x,.014+tremble,z,TILE-.075,.085,TILE-.075,tint,0,hot?.55:.22);
      b.box(x,-.096+tremble,z+.785,TILE-.13,.058,.023,"#80bddb");
      b.box(x-.64,.063+tremble,z-.05,.035,.018,1.28,reinforced?"#d9fffa":"#e6f8ff",0,.70);
      b.box(x+.02,.064+tremble,z+.61,1.22,.018,.023,"#d8f5ff",0,.8);
      if(i%3===0)b.box(x+.28,.066+tremble,z-.22,.10,.018,.58,"#ceeefb",-.72,.35);
      if(code==="2"||hot){
        const r=(i%7-3)*.42,d=hot?"#7e496a":"#5a9cba";
        b.box(x,.073+tremble,z,.045,.024,.94,d,r,.25);
        b.box(x+.22,.077+tremble,z-.24,.044,.029,.56,d,r-1.13,.35);
        if(hot)b.box(x-.26,.078+tremble,z+.25,.078,.03,.62,d,r+1.38,.4);
      }
    }
    this.previousTiles=tiles;
  }

  drawEffects() {
    const b=this.dynamic;
    this.effects=this.effects.filter(effect=>{
      const t=this.time-effect.time;
      if(t>.76)return false;
      const {kind,x,z}=effect;
      const pieces=kind==="shard"?7:16;
      for(let i=0;i<pieces;i++){
        const a=i*tau/pieces+(effect.seed||0)*.45;
        const r=kind==="pulse"?t*5:.10+t*(kind==="shard"?1.2:2);
        const y=kind==="pulse"?.15:kind==="fall"?-.63+1.5*t-2.55*t*t:.075+(1.9+i*.12)*t-4*t*t;
        const size=.12*(1-t*.98);
        b.box(x+Math.cos(a)*r,y,z+Math.sin(a)*r,size,size*(kind==="shard"?.56:1),size,kind==="pulse"?"#a5ffff":"#e0f9ff",a+t*3,1,1,t*2);
      }
      return true;
    });
  }

  drawMatch(game, playerId, actors, dt) {
    if(this.lost)return;
    this.time+=dt;
    const b=this.dynamic,gl=this.gl;
    const me=actors.find(a=>a.id===playerId&&a.alive);
    const target=me||null;
    const factor=1-Math.exp(-dt*4);
    this.track.x+=((target?.x||0)*.09-this.track.x)*factor;
    this.track.z+=((target?.z||0)*.12-this.track.z)*factor;
    const aspect=this.width/this.height;
    // Keep the whole shore visible in portrait and shift closer in landscape.
    const radius=aspect<1?Math.max(27,28.5/aspect):27;
    const pitch=-1.03;
    const eye=[this.track.x,radius*Math.sin(-pitch),this.track.z+radius*Math.cos(pitch)];
    const matrix=multiply(this.projection,look(eye,0,pitch));
    this.viewProjection=matrix;
    gl.clearColor(.76,.88,.98,1);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    this.drawBatch(this.static,matrix,eye,false);
    b.reset();
    this.drawFloes(game?.tiles||"1".repeat(121),this.time);
    for(const item of game?.pickups||[]){
      const [x,z]=tileCoords(item.tile);
      const y=.52+Math.sin(this.time*3+item.tile)*.09;
      const color=colors[item.kind],angle=this.time*1.8;
      b.box(x,.09,z,.68,.038,.68,color,Math.PI/4,.85);
      b.box(x,y,z,.34,.34,.34,color,angle,.8,1,.55,.55);
      b.box(x,y+.01,z,.37,.09,.37,"#eaffff",angle,1,1,.55,.55);
      b.box(x,y+.26,z,.07,.07,.07,"#ffffff",angle,1);
    }
    const rig=actors.filter(p=>p.alive||p.fallTime<.55).map(p=>({
      ...p,hp:100,skater:true,altitude:p.y-(p.alive?0:p.fallTime*4),
      jacket:jackets[p.colorIndex%4]||jackets[0],
      hat:hats[p.colorIndex%4]||hats[0],shield:p.grip>0?1:0,
    }));
    this.animator.beginFrame(dt,rig);
    for(const p of rig){
      if(p.alive&&p.y<.9)b.box(p.x,.071,p.z,.76,.02,.61,p.id===playerId?"#fef6b7":"#83b9d4",0,.38);
      this.actor(p,null,dt);
    }
    this.drawEffects();
    if(!this.reduceMotion){
      for(let i=0;i<7;i++){
        const age=(this.time*.55+i*.143)%1;
        const size=.085+age*.18;
        b.box(-2.68+age*.9,2.58+age*1.6,-14.30+Math.sin(age*7)*.13,size,size,size,"#e0f5ff",i,0,.3);
      }
    }
    if(!this.reduceMotion){
      const storm=game?.storm||0;
      for(let i=0;i<42+storm*12;i++){
        const x=(i*4.817+this.time*(.51+storm*.27))%24-12;
        const z=(i*7.917+this.time*.23)%24-12;
        const y=6-(i*.794+this.time*(.68+(i%4)*.11))%6;
        b.box(x,y,z,.035,.039,.030,"#ffffff",this.time*.38,1);
      }
    }
    this.drawBatch(b,matrix,eye);
  }
}
