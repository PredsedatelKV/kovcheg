import {ArenaScene,look,multiply} from "./arena-scene.js";

const CARS=[
  {from:-9.6,to:-1.05,trim:"#386883",name:"engine"},
  {from:-.06,to:7.47,trim:"#447b83",name:"cargo"},
  {from:8.48,to:15.6,trim:"#615f84",name:"service"},
];
const jackets=["#398fcc","#cc6578","#3d947b","#8878b3"];
const pine=["#2c626b","#3d7880","#386b77"];
const items={coal:"#384d60",parts:"#88a6b4",parcel:"#c66372",sealed:"#c66372"};
const lit=["#ffd895","#d0f7fa","#f5abae","#badbff"];
const speedOf=p=>Math.hypot(p.vx,p.vz);
function noise(index) {
  const f=Math.sin(index*127.1+311.7)*43758.5453123;
  return f-Math.floor(f);
}

export class TrainScene extends ArenaScene {
  constructor(canvas,map,preferences) {
    super(canvas,map,preferences);
    this.fog=[17,67];
    this.trackPaint=0;
    this.motionPhase=0;
  }

  resize() {
    const rect=this.canvas.getBoundingClientRect();
    this.resizePerspective(rect,rect.width<rect.height?1.38:1.12,.045,105,1.65,1380000);
  }

  makeWorld() {
    const b=this.static;
    for(const car of CARS)this.car(car,b);
    for(const z of [-.55,7.97]){
      b.box(0,-.12,z,1.63,.24,1.22,"#416577");
      b.box(0,2.51,z,1.73,.2,1.24,"#394f69");
      for(const side of [-1,1]){
        b.box(side*.77,1.23,z,.11,2.44,1.17,"#45687d");
        for(let i=0;i<5;i++)b.box(side*.71,1.22,z-.47+i*.235,.045,2.44,.035,"#6b8c9b");
        b.box(side*.48,.07,z,.10,.06,1.17,"#92aebb");
      }
    }
    this.gift(b,-1.11,.77,6.41,.45,"#b45267");
    this.gift(b,1.12,.78,6.29,.48,"#6599b3");
    this.gift(b,-1.04,1.01,13.63,.43,"#a96387");
    this.gift(b,-1.04,1.02,14.45,.37,"#608f87");
    this.gift(b,1.07,.78,5.28,.38,"#bc7a5e");
    this.engine(b);
    this.tree(b,-1.10,.19,14.87,1.40,"#437a71");
    for(let i=0;i<10;i++){
      const a=i*2.4,y=.47+(i%4)*.21,rr=.43-(i%4)*.075;
      b.box(-1.10+Math.cos(a)*rr,y,14.87+Math.sin(a)*rr,.055,.060,.055,lit[i%4],0,.9);
    }
    b.box(-1.10,1.70,14.87,.13,.12,.13,"#ffe2aa",.78,1,1,0,.78);
    this.table(b,-1.14,1.23,"#526a7f");
    b.box(-1.10,.98,1.16,.51,.08,.72,"#d5a185");
    b.box(-1.06,1.06,1.34,.40,.08,.29,"#ead1a8",-.13);
    b.box(-1.22,1.09,.89,.18,.20,.20,"#b27082");
    for(const [x,z] of [[-1.05,5.56],[1.05,5.73],[-1.05,10.25],[1.05,10.25],[-1.05,13.81],[1.05,13.81]]){
      this.crate(b,x,z,.66);
    }
    for(const [x,z] of [[-1.05,9.12],[1.10,9.20],[-1.06,11.53],[1.09,11.51],[1.09,14.70]]){
      b.box(x,.24,z,.56,.51,.58,"#4a6883");
      b.box(x,.57,z,.61,.17,.64,"#847e9b");
      b.box(x+Math.sign(x)*.22,.91,z,.18,.68,.65,"#64718f");
    }
    b.box(-1.36,.97,3.18,.21,.33,.52,"#37566d");
    b.box(-1.23,1.02,3.18,.065,.09,.20,"#b0e2ec",0,.8);
    for(const z of [-2.70,6.97,15.15]){
      for(const x of [-1.19,1.19])this.lantern(b,x,1.92,z,lit[0]);
    }
  }

  car(car,b) {
    const {from,to,trim,name}=car;
    const length=to-from,mid=(from+to)/2;
    b.box(0,-.18,mid,3.24,.38,length,"#52758b");
    b.box(0,-.48,mid,3.02,.30,length-.2,"#273f55");
    b.box(0,2.74,mid,3.43,.34,length+.04,"#3e536d");
    b.box(0,2.96,mid,3.12,.16,length,"#c3deed");
    b.box(0,2.62,mid,2.98,.13,length,"#c7d1d8");
    for(let z=from+.26,i=0;z<to;z+=.52,i++){
      b.box(0,2.542,z,2.91,.034,.48,i%3?"#d1d9de":"#dadde0");
      b.box(-.99,2.519,z,.022,.013,.49,"#adbac5");
      b.box(.99,2.519,z,.022,.013,.49,"#adbac5");
      if(i%4===0)b.box(0,2.515,z,2.98,.048,.105,"#8399a7");
    }
    for (const side of [-1,1]){
      b.box(side*1.17,2.451,mid,.054,.031,length-.58,"#bba387");
      for(let z=from+.82;z<to-.55;z+=2.4)b.box(side*1.17,2.445,z,.065,.034,1.62,"#ffdc9e",0,.9);
    }
    for(let z=from+.19,j=0;z<to;z+=.39,j++){
      b.box(0,.015,z,3.12,.043,.38,j%3?"#8a756c":"#9b8172");
    }
    b.box(0,.045,mid,1.33,.025,length-.55,name==="cargo"?"#527f85":"#536d8c");
    for(let z=from+.48;z<to-.36;z+=1.34){
      b.box(0,.063,z,.99,.012,.027,"#7690a5");
      b.box(-.48,.064,z+.07,.064,.015,.14,"#c1ac91",0,.14);
      b.box(.48,.064,z+.07,.064,.015,.14,"#c1ac91",0,.14);
    }
    for(const side of [-1,1]){
      b.box(side*.68,.06,mid,.032,.022,length-.57,"#cbac89");
      b.box(side*1.07,2.50,mid,.12,.11,length,"#657d94");
      const x=side*1.58;
      for(const z of [from+.20,to-.20]){
        b.box(x,1.22,z,.14,2.42,.4,trim);
        b.box(0,2.29,z,.1+3.02,.52,.16,"#b0bece");
        for(const s of [-1,1]){
          b.box(s*1.12,1.06,z,.90,2.17,.16,trim);
          b.box(s*.68,1.10,z,.08,2.24,.18,"#c3ad8f");
        }
      }
      for(let z=from+.59;z<to-.2;z+=.42){
        if(name==="cargo"&&side===1&&Math.abs(z-3.04)<.91)continue;
        b.box(x,.49,z,.14,.99,.42,trim);
        b.box(x,2.25,z,.16,.68,.42,"#c6dbe6");
        b.box(side*1.49,1.01,z,.18,.09,.41,"#abbdc8");
        b.box(x,.30,z,.17,.095,.41,"#a8c2c9");
      }
      for(let z=from+.64;z<to-.3;z+=1.50){
        if(name==="cargo"&&side===1&&Math.abs(z-3.04)<1.16)continue;
        b.box(x,1.57,z,.16,1.17,.12,"#80a0ad");
        b.box(side*1.55,2.14,z+.49,.15,.055,.80,"#e0edf3");
        b.box(side*1.552,1.39,z+.47,.04,.032,.79,"#aac9db");
        for(let i=0;i<5;i++){
          const pl=z+.16+i*.215;
          const py=2.28-Math.sin(i/4*Math.PI)*.12;
          b.box(side*1.485,py,pl,.048,.044,.22,"#647976");
          b.box(side*1.453,py-.053,pl,.064,.085,.058,lit[(i+Math.floor(z*3+120))%4],0,1);
        }
      }
      for(const z of [from+1.35,to-1.30]){
        b.box(side*1.12,-.63,z,.35,.68,.67,"#304a60");
        b.box(side*1.30,-.67,z,.14,.34,.35,"#778d9d");
      }
    }
    for(let z=from+1.7;z<to;z+=2.7){
      b.box(0,2.51,z,.78,.20,.43,"#526c83");
      b.box(0,2.397,z,.64,.043,.33,"#ffdfaa",0,1);
      b.box(0,2.37,z,.55,.025,.26,"#fff3cd",0,1);
      for(const sign of [-1,1])b.box(sign*.34,2.39,z,.045,.08,.34,"#cba77f");
    }
  }

  engine(b) {
    b.box(-1.04,.64,-7.81,.75,1.28,1.90,"#334e65");
    b.box(-1.03,1.27,-7.81,.75,.17,1.82,"#58768a");
    b.box(-.633,.62,-7.36,.054,.44,.56,"#402f37");
    b.box(-.591,.61,-7.36,.038,.19,.42,"#fcb577",0,.95);
    for(const z of [-7.59,-7.36,-7.12])b.box(-.564,.64,z,.06,.46,.055,"#67535b");
    b.box(-1.19,1.72,-8.34,.20,1.11,.25,"#688797");
    b.box(-1.09,2.13,-7.63,.41,.15,1.59,"#688797");
    b.box(-1.04,2.26,-7.61,.18,.38,.16,"#688797");
    b.box(1.07,.55,-7.80,.72,1.10,1.63,"#495f77");
    b.box(1.04,1.11,-7.67,.71,.18,1.29,"#68899e");
    for(const z of [-8.23,-7.94,-7.68,-7.42]){
      b.box(.665,.79,z,.062,.24,.15,"#97b2be");
      b.box(.625,.85,z,.020,.07,.11,"#d2e5e9",0,.6);
    }
    for(const x of [-.80,.80]){
      b.box(x,.91,-3.66,.50,.27,.47,"#466477");
      b.box(x,1.12,-3.66,.08,.32,.08,"#b4c6cc",0,0,1,0,x*.30);
      for(let i=0;i<4;i++)b.box(x-.15+i*.1,1.038,-3.85,.065,.015,.045,i<2?"#c7e9ef":"#8fadae",0,.40);
      b.box(x+.035,1.26,-3.66,.15,.10,.13,x<0?"#a6e4ff":"#c8e8a1",0,.7);
    }
    b.box(-1.38,.81,-5.48,.26,.49,.56,"#44667d");
    b.box(-1.19,.94,-5.48,.12,.12,.36,"#dfb98e");
    b.box(-1.13,1.19,-5.48,.12,.36,.09,"#a3bac9",0,0,1,0,-.22);
    b.box(-1.08,1.36,-5.48,.13,.12,.17,"#bb7994");
    b.box(0,.64,-9.50,1.53,1.26,.16,"#506b81");
    for(const side of [-1,1]){
      b.box(side*.48,1.45,-9.52,.65,.36,.08,"#9cc5dc");
      b.box(side*.31,1.50,-9.46,.08,.31,.043,"#e2f3f9");
    }
    b.box(0,2.16,-9.50,1.81,.14,.14,"#8399ae");
  }

  table(b,x,z,tint) {
    for(const off of [-.32,.32])b.box(x,.39,z+off,.55,.77,.08,tint);
    b.box(x,.80,z,.63,.11,.98,"#b58a74");
  }

  crate(b,x,z,w) {
    b.box(x,.31,z,w,.61,w,"#ab8d7e");
    b.box(x,.624,z,w+.045,.08,w+.045,"#bea38a");
    b.box(x,.29,z-w*.5,.095,.59,.045,"#796a69");
    b.box(x,.29,z+w*.5,.095,.59,.045,"#796a69");
    b.box(x-Math.sign(x)*w*.5,.32,z,.042,.12,w,"#e1c6a0");
    for(const side of [-1,1])b.box(x+side*w*.35,.67,z,.032,.016,w,"#7e706b");
  }

  gift(b,x,y,z,w,tint) {
    b.box(x,y,z,w,w*.72,w,tint);
    b.box(x,y+w*.37,z,w+.044,.09,w+.044,tint);
    b.box(x,y+w*.406,z,w+.05,.021,.073,"#ffe3a6");
    b.box(x,y+w*.406,z,.073,.021,w+.05,"#ffe3a6");
    b.box(x,y,z+w*.521,.073,w*.73,.023,"#f4cb99");
    for(const side of [-1,1])b.box(x+side*.076,y+w*.48,z,.122,.071,.066,"#ffe5b2",side*.56);
  }

  lantern(b,x,y,z,tint) {
    b.box(x,y,z,.20,.34,.20,"#324c60");
    b.box(x,y,z,.157,.216,.22,tint,0,.9);
    b.box(x,y+.19,z,.24,.07,.24,"#8fa8b4");
    b.box(x,y-.19,z,.24,.07,.24,"#728a9a");
  }

  tree(b,x,y,z,height,tint) {
    b.box(x,y+.27,z,.26,.54,.26,"#7b7168");
    for(let i=0;i<4;i++){
      const w=height*(.61-i*.13),tier=y+height*(.27+i*.17);
      const turn=(i+1)*.32;
      b.box(x,tier,z,w,height*.17,w,tint,turn);
      b.box(x,tier+height*.09,z,w*.92,height*.047,w*.92,"#d3e8f5",turn,.24);
    }
  }

  landscape(b,game,track) {
    const bridge=game?.route==="bridge"&&game.leg===1;
    const moving=game?.travel!==false;
    b.box(0,-1.56,0,120,.28,188,bridge?"#82aec3":"#c3d9e9",0,.2);
    b.box(0,-1.27,0,3.3,.33,178,"#778d9e");
    for(const x of [-.75,.75]){
      b.box(x,-1.10,0,.11,.13,178,"#758994",0,.15);
      b.box(x,-1.028,0,.091,.04,178,"#a8bdc6",0,.8);
    }
    const step=1.26;
    for(let z=-51+(track%step);z<44;z+=step)b.box(0,-1.17,z,2.28,.11,.31,"#655e64");
    const chunk=12;
    const offset=track%chunk;
    const start=Math.floor(track/chunk);
    for(let k=-5;k<=5;k++){
      const z=k*chunk+offset,index=k-start;
      for(const side of [-1,1]){
        const jitter=noise(index*3+side);
        const x=side*(7+jitter*5);
        if(!moving&&side===1&&z>-17&&z<20)continue;
        if(bridge){
          b.box(side*2.30,-.56,z, .19,1.70,.28,"#6c98ae");
          b.box(side*2.26,.23,z+5,.12,.15,11.6,"#a5c8d9",0,.45);
          b.box(side*2.30,-.21,z+3,.14,7.6,.16,"#88aec0",0,.24,1,side*.94);
          b.box(side*10,-1.33,z,4.8,.1,3.3,"#b1d3e3",jitter,0);
        }else{
          b.box(x,-1.26,z,5.7,.51,4.9,"#d5e5ed",jitter*.54);
          this.tree(b,x,-1.03,z,3.1+jitter*3.65,pine[(Math.abs(index)+1)%3]);
          this.tree(b,x+side*(3.2+jitter),-1.27,z-2.4,2.65+jitter*2.2,pine[(Math.abs(index)+2)%3]);
          if(game?.leg===2)this.tree(b,x-side*2,-1.27,z+2.7,2.01+jitter*2.1,pine[Math.abs(index)%3]);
        }
        b.box(side*(22+jitter*5),.30,z-4,12,4.0+jitter*5,13,"#a7c4d9",jitter,0,1,.12,-side*.24);
        b.box(side*(27+jitter*6),3.6,z-3,18,5.4+jitter*6,20,"#d8e8f3",jitter,0,1,.12,-side*.27);
      }
    }
    if(!moving)this.station(b,game.leg);
  }

  station(b,leg) {
    b.box(7.68,-.59,2.4,9.05,1.22,24,"#7897ab");
    b.box(7.65,.009,2.4,9.14,.09,24.1,"#d7e7ef");
    for(let z=-9.2,i=0;z<14.26;z+=.47,i++){
      b.box(7.68,.062,z,8.65,.023,.44,i%4?"#c0d4df":"#c9dce6");
      if(i%4===0)b.box(10.36,.078,z-.13,1.05,.018,.14,"#e6f4fa");
    }
    b.box(3.19,.067,2.46,.18,.038,23.8,"#e9c07e",0,.25);
    b.box(2.24,-.02,3.05,1.85,.14,1.73,"#a2bac9");
    for(let i=0;i<7;i++)b.box(1.47+i*.25,.064,3.05,.06,.028,1.56,"#e6f1f5");
    const tint=leg===0?"#5e7d8c":leg===1?"#557786":"#5e6c87";
    if(leg===1){
      b.box(10.8,2.0,5.6,.27,4,.36,"#7894a8");
      b.box(12.1,3.92,5.6,2.8,.24,.44,"#9dabad");
      this.lantern(b,10.65,3.4,5.62,"#d0f0f3");
    }else if(leg===2){
      for(const z of [-6,10])this.tree(b,10.3,.08,z,4.2,"#527e81");
      b.box(11.96,2.10,2.95,.15,.29,2.96,"#4d617b");
      for(let i=0;i<10;i++)b.box(11.85,2.01,1.73+i*.26,.045,.10,.060,lit[i%4],0,1);
    }
    b.box(14.20,1.11,2.35,4.3,2.2,12.5,tint);
    for(let y=.28,i=0;y<2.17;y+=.24,i++){
      b.box(12.01,y,2.35,.045,.19,12.4,i%2?"#75909d":"#698796");
      b.box(11.98,y+.10,2.35,.039,.025,12.39,"#8da7b3");
    }
    for(const z of [-3.8,-.70,2.9,5.8,8.5]){
      b.box(11.89,1.06,z,.15,2.10,.17,"#536f84");
      b.box(11.86,2.20,z,.17,.13,.26,"#9fb0b7");
    }
    b.box(11.63,2.29,2.35,1.15,.12,12.94,"#7994a6",0,0,1,0,-.13);
    b.box(11.61,2.40,2.35,1.19,.093,13.01,"#e0f1fa",0,.26,1,0,-.13);
    b.box(13.94,2.39,2.35,5.1,.35,13.5,"#869bad");
    b.box(13.77,2.65,2.35,4.94,.25,13.11,"#e4f2fb");
    b.box(12.13,.94,2.94,.08,1.70,1.13,"#3b5670");
    for(const z of [-2.3,1.16,6.12,7.7]){
      b.box(12.03,1.30,z,.09,.66,.97,"#ffdc99",0,1);
      b.box(11.96,1.30,z,.05,.68,.045,"#6a7884");
      b.box(11.96,1.30,z,.05,.046,.98,"#6a7884");
    }
    for(const z of [-7.65,-.6,7.8,12.94]){
      b.box(11.2,1.05,z,.16,2.09,.17,"#5b768b");
      this.lantern(b,11.2,2.01,z,"#ffd997");
      b.box(11.2,.11,z,.42,.24,.41,"#a2bbce");
    }
    for(const z of [-4.7,4.73,11.42]){
      b.box(10.84,.40,z,.47,.11,1.56,"#8d7873");
      b.box(11.08,.67,z,.10,.44,1.56,"#9f8880");
      for(const dz of [-.58,.58])b.box(10.84,.23,z+dz,.36,.36,.09,"#607b8a");
    }
    this.crate(b,6.42,-2.6,.68);
    this.crate(b,8.44,6.13,.68);
    this.gift(b,9.55,.29,10.36,.6,"#b16f88");
    b.box(9.40,.49,-6.03,.52,.98,.66,"#5e7b93");
    b.box(9.36,1.01,-6.05,.57,.11,.74,"#accaDA");
    this.lantern(b,9.4,1.20,-6.03,"#d9f7fb");
  }

  hand(b,kind,t,action) {
    const y=-.64+Math.sin(t)*.016+action*.12;
    for(const s of [-1,1]){
      b.box(s*.28,y-.08,-.58,.19,.22,.34,s>0?"#456d94":"#3a628a",0,0,1,.25,s*.07);
      b.box(s*.24,y+.03,-.71,.15,.14,.22,"#a5c3d6",0,.18,1,.1);
    }
    if(kind==="sealed"||kind==="parcel")this.gift(b,.08,y+.151,-.93,.27,items[kind]);
    else if(kind){
      b.box(.08,y+.158,-.93,.224,.182,.234,items[kind],.32);
      b.box(.074,y+.238,-.94,.156,.052,.169,kind==="coal"?"#64798b":"#c0d6df",-.21);
    }
  }

  drawJourney(game,view,dt) {
    if(this.lost)return;
    if(this.renderBudget.observe(dt,game?.phase==="playing"))this.resize();
    const gl=this.gl;
    this.time+=dt;
    const me=view.local;
    const running=game?.phase==="playing";
    const targetTrack=view.track??game?.track??0;
    if(Math.abs(targetTrack-this.trackPaint)>3)this.trackPaint=targetTrack;
    else this.trackPaint+=(targetTrack-this.trackPaint)*(1-Math.exp(-dt*15));
    const speed=me?speedOf(me):0;
    this.motionPhase+=dt*(4+speed*3);
    const bob=!this.reduceMotion&&me?Math.sin(this.motionPhase)*.021*Math.min(1,speed):0;
    const eye=me?[me.x,1.56+bob,me.z]:[.23,1.54,5.95];
    const yaw=me?view.yaw:-.09+Math.sin(this.time*.25)*.17;
    const pitch=me?view.pitch:-.025;
    const matrix=multiply(this.projection,look(eye,yaw,pitch));
    this.viewProjection=matrix;

    if(game?.leg===2)gl.clearColor(.50,.67,.80,1);
    else gl.clearColor(.66,.79,.88,1);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    this.drawBatch(this.static,matrix,eye,false);
    const b=this.dynamic;
    b.reset();
    this.landscape(b,game,this.trackPaint);
    if(game?.travel!==false){
      b.box(1.58,1.17,3.055,.15,2.32,1.75,"#527a8a");
      b.box(1.483,1.66,3.05,.06,.62,1.04,"#95b3bf");
      b.box(1.445,1.18,3.42,.07,.09,.27,"#d1bb9b");
    }
    // Vary several real surfaces in response to the authoritative train state.
    const heat=game?.heat??74,work=this.map.work;
    b.box(-.548,.59,-7.36,.034,.16,.38,heat>39?"#ffc580":heat>15?"#c3847e":"#696d8b",0,.85);
    b.box(.620,.86,-7.68,.022,.08,.11,game?.fault?"#f6aca0":"#aee2b7",0,.94);
    b.box(1.05,1.01,13.81,.22,.29,.23,game?.lamp?"#ffdf9b":"#8594a4",0,game?.lamp?1:0);
    for(const id of ["bridge","valley"]){
      const [x,z]=work[id];
      if(game?.signal_open)b.box(x,1.32,z,.094,.09,.10,game.route===id?"#bbfac0":"#ffe6a0",0,1);
    }
    for(let i=0;i<(game?.loaded??2);i++){
      const row=Math.floor(i/3),z=6.26-(i%3)*.31;
      this.gift(b,1.105,.73+row*.26,z,.265,["#b35c7a","#628caa","#628d76"][i%3]);
    }

    const actors=view.actors||[];
    const models=actors.filter(p=>p.id!==view.me).map((p,i)=>({...p,hp:100,skater:true,team:0,jacket:jackets[i%4]}));
    this.animator.beginFrame(dt,models);
    for(const p of models){
      this.actor(p,null,dt);
      if(p.hand){
        const x=p.x+p.ax*.40,z=p.z+p.az*.40;
        b.box(x,1.00,z,.28,.247,.28,items[p.hand],Math.atan2(p.ax,p.az));
        if(p.hand==="sealed")b.box(x,1.13,z,.26,.018,.055,"#ffe2b3",0,1);
      }
    }
    if(view.target&&me){
      const [x,z]=work[view.target];
      const color=view.available?"#fff0b7":"#caddf0";
      const y=1.05+(!this.reduceMotion?Math.sin(this.time*4)*.057:0);
      b.box(x,y,z,.080,.080,.080,color,.78,1,1,0,.78);
    }
    if(!this.reduceMotion){
      for(let i=0;i<86;i++){
        const x=(i*5.133+this.time*.64)%35-17.5;
        if(Math.abs(x)<1.90)continue;
        const z=(i*7.819+this.time*.29+this.trackPaint)%55-29;
        const y=7-(i*.384+this.time*.61)%7;
        b.box(x,y,z,.033,.039,.032,"#ffffff",0,.65);
      }
      for(let i=0;i<13;i++){
        const age=(this.time*.60+i*.08)%1,scale=.12+age*.26;
        b.box(-1.08+age*1.3,3.0+age*2.5,-8.37+age*(game?.speed||2)*.53,scale,scale,scale,"#dee9ee",i*.52,.45);
      }
    }
    this.drawBatch(b,matrix,eye);
    if(running&&me&&view.firstPerson){
      this.weapon.reset();
      this.hand(this.weapon,me.hand,this.motionPhase,view.progress||0);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      this.drawBatch(this.weapon,this.projection,[0,0,0]);
    }
    this.canvas.dataset.instances=String(this.static.count+b.count);
  }
}
