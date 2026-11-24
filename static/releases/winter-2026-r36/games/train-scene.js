import {ArenaScene,look,multiply} from "./arena-scene.js";
import {gift,parcel,coal,gear,lantern,toy,marker,openBin,loadItem} from "./train-props.js";

const CARS=[
  {from:-9.6,to:-1.05,trim:"#386883",name:"engine"},
  {from:-.06,to:7.47,trim:"#447b83",name:"cargo"},
  {from:8.48,to:15.6,trim:"#615f84",name:"service"},
];
const jackets=["#398fcc","#cc6578","#3d947b","#8878b3"];
const pine=["#2c626b","#3d7880","#386b77"];
const lit=["#ffd895","#d0f7fa","#f5abae","#badbff"];
const speedOf=p=>Math.hypot(p.vx,p.vz);
function noise(index) {
  const f=Math.sin(index*127.1+311.7)*43758.5453123;
  return f-Math.floor(f);
}

export class TrainScene extends ArenaScene {
  constructor(canvas,map,preferences) {
    super(canvas,map,preferences,true);
    this.fog=[17,67];
    this.trackPaint=0;
    this.motionPhase=0;
    this.stations=new Map();
  }

  resize() {
    const rect=this.canvas.getBoundingClientRect();
    const aspect=rect.width/Math.max(rect.height,1);
    const fov=aspect<1?Math.min(1.51,2*Math.atan(.46/Math.max(.01,aspect))):1.12;
    this.resizePerspective(rect,Math.max(1.12,fov),.045,105,1.65,1380000);
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
        b.box(side*.52,.07,z,.08,.033,1.17,"#bfa481");
        for(let i=0;i<5;i++){
          b.box(side*.65,.012,z-.44+i*.22,.20,.055,.064,"#91aaba");
          b.box(side*.65,2.34,z-.44+i*.22,.18,.055,.040,"#4d6b81");
        }
      }
      b.box(0,.032,z,1.05,.07,1.20,z>0?"#756782":"#416376");
      b.box(0,2.365,z,.50,.055,.28,"#ffe3a9",0,.90);
    }
    gift(b,-1.11,.82,6.41,.45,"#a53651",.34);
    gift(b,1.13,.85,6.70,.44,"#357b80",-.21);
    gift(b,1.07,.78,5.28,.38,"#b8675a",-.34);
    this.engine(b);
    this.tree(b,-1.10,.19,14.87,1.40,"#437a71");
    for(let i=0;i<10;i++){
      const a=i*2.4,y=.47+(i%4)*.21,rr=.43-(i%4)*.075;
      b.box(-1.10+Math.cos(a)*rr,y,14.87+Math.sin(a)*rr,.055,.060,.055,lit[i%4],0,.9);
    }
    b.box(-1.10,1.70,14.87,.13,.12,.13,"#ffe2aa",.78,1,1,0,.78);
    toy(b,-.92,.49,14.34,.52,-.45);
    gift(b,-1.02,.27,15.35,.29,"#b2465b",.32);
    gift(b,-1.26,.30,14.56,.31,"#337d83",-.31);
    this.table(b,-1.14,1.23,"#526a7f");
    b.box(-1.10,.98,1.16,.51,.08,.72,"#d5a185");
    parcel(b,-1.21,1.11,1.51,.40,.16);
    gift(b,-1.22,1.15,.97,.45,"#ad3f58",-.18);
    toy(b,-.92,1.09,.94,.19,1.45);
    for(const [x,z,angle] of [[-1.02,1.48,-.28],[-.93,1.46,.43]]){
      b.box(x,1.032,z,.034,.024,.22,"#afc4d4",angle,.24);
      b.box(x,1.034,z+.12,.076,.029,.080,"#975c70",angle);
    }
    b.box(-.88,1.048,1.20,.068,.087,.098,"#bf5769",.19);
    b.box(-.88,1.096,1.20,.039,.014,.049,"#f1d8aa",.19);
    marker(b,"gift",-.811,.76,1.23,1,"#ffd68e");
    openBin(b,-1.10,2.35,.66);
    b.box(-1.08,.68,2.35,.55,.092,.60,"#746151");
    marker(b,"box",-.741,.57,2.35,1,"#ffd68e");
    for(const [x,z] of [[-.70,1.27],[-.70,2.35],[.69,5.73]]){
      const side=Math.sign(x);
      b.box(x,.078,z,.073,.027,.58,"#efb765",0,.45);
      b.box(x-side*.09,.078,z,.11,.027,.18,"#efb765",0,.48);
    }
    for(const [x,z] of [[-1.05,5.56],[1.05,5.73],[-1.05,13.81],[1.05,13.81]])this.crate(b,x,z,.66);
    for(const [x,z] of [[-1.05,10.25],[1.05,10.25]])openBin(b,x,z,.69);
    for(const [dx,dz,w,turn] of [[0,-.17,.37,.25],[.09,.10,.35,-.40],[-.14,.08,.33,.09]]){
      coal(b,-1.05+dx,.72,10.25+dz,w,turn);
    }
    gear(b,1.04,.72,10.17,.42,.13);
    gear(b,1.14,.77,10.38,.29,.55);
    toy(b,-1.07,1.03,13.78,.59,1.23);
    gift(b,-1.05,.84,14.14,.30,"#587390",.42);
    for(const [id,x,y,z,side,color] of [
      ["coal",-.663,.49,10.25,1,"#b7c5df"],["tool",.663,.49,10.25,-1,"#b4e9f7"],
      ["lamp",.687,.46,13.81,-1,"#ffd68e"],
      ["box",-.687,.44,5.56,1,"#e2d6b8"],["gift",.687,.44,5.73,-1,"#ffd68e"]
    ])marker(b,id,x,y,z,side,color);
    for(const [x,z] of [[-1.05,9.12],[1.10,9.20],[-1.06,11.53],[1.09,11.51],[1.09,14.70]]){
      b.box(x,.24,z,.56,.51,.58,"#4a6883");
      b.box(x,.57,z,.61,.17,.64,"#847e9b");
      b.box(x+Math.sign(x)*.22,.91,z,.18,.68,.65,"#64718f");
    }
    b.box(-1.36,.97,3.18,.21,.33,.52,"#37566d");
    b.box(-1.23,1.02,3.18,.065,.09,.20,"#b0e2ec",0,.8);
    b.box(-1.24,1.35,3.18,.26,.094,.29,"#93734d");
    b.box(-1.24,1.27,3.18,.21,.09,.23,"#d9ac5b",0,.25);
    b.box(-1.24,1.204,3.18,.27,.055,.28,"#d4a154");
    b.box(-1.24,1.16,3.18,.07,.04,.07,"#85614c");
    marker(b,"bell",-1.24,.89,3.18,1,"#ffd786");
    for(const z of [-2.70,6.97,15.15]){
      for(const x of [-1.19,1.19])this.lantern(b,x,1.92,z,lit[0]);
    }
  }

  car(car,b) {
    const {from,to,trim,name}=car;
    const aisle={engine:"#526477",cargo:"#3e736f",service:"#565276"}[name];
    const wallWood={engine:"#53677a",cargo:"#6b574f",service:"#745d59"}[name];
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
    b.box(0,.045,mid,1.33,.025,length-.55,aisle);
    for(let z=from+.48;z<to-.36;z+=1.34){
      b.box(0,.063,z,.99,.012,.027,"#7690a5");
      b.box(-.48,.064,z+.07,.064,.015,.14,"#c1ac91",0,.14);
      b.box(.48,.064,z+.07,.064,.015,.14,"#c1ac91",0,.14);
    }
    for(const side of [-1,1]){
      b.box(side*.68,.06,mid,.032,.022,length-.57,"#cbac89");
      b.box(side*.63,.060,mid,.018,.004,length-.60,"#c1b4aa");
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
        if(z>from+.46&&z<to-.44){
          b.box(side*1.502,.59,z,.030,.66,.383,wallWood);
          b.box(side*1.483,.30,z,.019,.028,.376,"#b59c83");
          b.box(side*1.483,.884,z,.019,.025,.376,"#b8a58f");
        }
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
      for(const sign of [-1,1]){
        b.box(sign*.34,2.39,z,.045,.08,.34,"#cba77f");
        b.box(0,2.397,z+sign*.176,.71,.052,.023,"#a28163");
      }
    }
  }

  engine(b) {
    b.box(-1.04,.64,-7.81,.75,1.28,1.90,"#334e65");
    b.box(-1.03,1.27,-7.81,.75,.17,1.82,"#58768a");
    b.box(-.633,.62,-7.36,.054,.44,.56,"#402f37");
    for(const side of [-1,1]){
      b.box(-.563,.63,-7.36+side*.28,.09,.56,.082,"#a17253");
      b.box(-.553,.63+side*.255,-7.36,.105,.068,.64,"#b18560");
      b.box(-.55,.46,-7.36+side*.14,.12,.049,.19,"#5a4644");
    }
    for(const z of [-7.54,-7.36,-7.18])b.box(-.499,.64,z,.034,.37,.028,"#645451");
    marker(b,"heat",-.617,1.07,-7.36,1,"#ffc177");
    for(const z of [-8.39,-7.36,-7.03])b.box(-.618,1.20,z,.055,.055,.055,"#c6ad81");
    b.box(-1.19,1.72,-8.34,.20,1.11,.25,"#688797");
    b.box(-1.09,2.13,-7.63,.41,.15,1.59,"#688797");
    b.box(-1.04,2.26,-7.61,.18,.38,.16,"#688797");
    b.box(1.07,.55,-7.80,.72,1.10,1.63,"#495f77");
    b.box(1.04,1.11,-7.67,.71,.18,1.29,"#68899e");
    for(const z of [-8.23,-7.94,-7.68,-7.42]){
      b.box(.665,.79,z,.062,.24,.15,"#97b2be");
      b.box(.625,.85,z,.020,.07,.11,"#d2e5e9",0,.6);
    }
    for(const [z,size] of [[-7.42,.44],[-7.80,.37],[-8.15,.26]]){
      gear(b,.89,1.31,z,size,.30);
    }
    marker(b,"tool",.623,.96,-7.41,-1,"#b2e4f0");
    for(const x of [-.80,.80]){
      b.box(x,.91,-3.66,.50,.27,.47,"#466477");
      b.box(x,1.12,-3.66,.08,.32,.08,"#b4c6cc",0,0,1,0,x*.30);
      for(let i=0;i<4;i++)b.box(x-.15+i*.1,1.038,-3.85,.065,.015,.045,i<2?"#c7e9ef":"#8fadae",0,.40);
      b.box(x+.035,1.26,-3.66,.15,.10,.13,x<0?"#a6e4ff":"#c8e8a1",0,.7);
      const sign=Math.sign(x);
      b.box(x-sign*.233,.914,-3.66,.035,.158,.30,"#2f455b");
      for(let i=-1;i<=1;i++){
        b.box(x-sign*.259,.87+i*.041,-3.66,.023,.015,.25- Math.abs(i)*.06,
          x<0?"#8ec8e7":"#a1c894",0,.24);
      }
    }
    b.box(-1.38,.81,-5.48,.26,.49,.56,"#44667d");
    b.box(-1.19,.94,-5.48,.12,.12,.36,"#dfb98e");
    b.box(-1.13,1.19,-5.48,.12,.36,.09,"#a3bac9",0,0,1,0,-.22);
    b.box(-1.08,1.36,-5.48,.13,.12,.17,"#c86461");
    marker(b,"snow",-1.163,.84,-5.48,1,"#bae8fa");
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


  lantern(b,x,y,z,tint) {
    lantern(b,x,y,z,.28,tint);
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
    for(let i=0;i<11;i++){
      const z=2.89-i*.83,x=3.25+i*.48;
      b.box(x,.089,z,.20,.028,.13,"#efc77f",.53,.48);
      if(i%3===0)b.box(x,.1,z,.11,.029,.11,"#fff0b2",.53,.67);
    }
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
    const canopy=leg===0?"#527a6d":leg===1?"#496f8a":"#875662";
    for(const z of [-6.25,-2.1,2.15,6.35,10.55]){
      b.box(10.14,1.29,z,.17,2.54,.18,canopy);
      b.box(10.13,.11,z,.27,.24,.28,"#7a97ad");
      b.box(10.12,2.505,z,.29,.12,.29,"#e4f0f5");
      b.box(10.96,2.60,z,1.84,.13,.15,canopy,0,0,1,0,-.11);
      if(leg===0)this.lantern(b,10.07,2.19,z,"#ffdca4");
      if(leg===1)b.box(10.84,2.525,z,1.05,.04,.091,"#a8ecf5",0,.88);
      if(leg===2)for(let i=0;i<4;i++)b.box(10.19+i*.29,2.52-Math.sin(i)*.09,z,.07,.08,.09,lit[i],0,.95);
    }
    for(let z=-7.52;z<12;z+=.63){
      b.box(10.90,2.71,z,2.06,.16,.57,canopy,0,0,1,0,-.11);
      b.box(10.90,2.817,z,2.11,.058,.57,"#e2f2f7",0,.23,1,0,-.11);
    }
    if(leg===0){
      for(const z of [-7.8,9.45]){
        this.tree(b,10.93,.08,z,2.56,"#47766b");
        gift(b,10.58,.24,z+.48,.44,"#ae5362",.27);
        gift(b,10.65,.20,z-.46,.34,"#4e8f92",-.16);
      }
    }
    if(leg===1){
      for(const z of [-3,-2.2,-1.4]){
        b.box(11.10,.40,z,.70,.74,.67,"#7994a3");
        b.box(10.746,.44,z,.035,.20,.40,"#405d77");
        b.box(11.10,.78,z,.74,.064,.71,"#d3e9f0");
        gear(b,11.08,.91,z,.54,.19);
      }
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
    openBin(b,6.42,-2.6,.68);
    coal(b,6.45,.68,-2.65,.38,.25);
    coal(b,6.32,.68,-2.45,.31,-.33);
    marker(b,"coal",6.043,.43,-2.6,-1,"#b7c5df");
    openBin(b,8.44,6.13,.68);
    gear(b,8.41,.70,6.13,.48,-.26);
    marker(b,"tool",8.063,.43,6.13,-1,"#b4e9f7");
    parcel(b,9.37,.25,10.36,.67,.21);
    parcel(b,9.72,.60,10.19,.38,-.36);
    b.box(9.40,.49,-6.03,.52,.98,.66,"#5e7b93");
    b.box(9.36,1.01,-6.05,.57,.11,.74,"#accaDA");
    this.lantern(b,9.4,1.23,-6.31,"#ffe0a0");
    marker(b,"star",9.12,.76,-6.03,-1,"#ffdc8e");
    for(const side of [-1,1]){
      b.box(9.16,1.30,-6.03+side*.49,.14,2.6,.14,"#365a70");
      b.box(9.16,2.61,-6.03+side*.49,.21,.11,.21,"#e4f2f8");
    }
    b.box(9.16,2.21,-6.03,.19,.43,1.16,"#476d83");
    marker(b,"star",9.04,2.21,-6.03,-1,"#ffda8d");
  }

  hand(b,kind,t,action) {
    const y=(kind?-.60:-.72)+Math.sin(t)*.014+action*.105;
    for(const side of [-1,1]){
      const x=side*(kind?.23:.32);
      b.box(x,y-.086,-.57,.149,.169,.32,"#385875",side*.12,0,1,.21,side*.07);
      b.box(x-side*.013,y+.003,-.70,.133,.123,.095,"#b2bfc1",side*.12,0,1,.12);
      b.box(x-side*.024,y+.034,-.77,.131,.108,.126,"#526e82",side*.12,0,1,.10);
      b.box(x-side*.080,y+.057,-.775,.043,.059,.073,"#6d8b9a",side*.16,0,1,0,side*.20);
      b.box(x-side*.024,y+.084,-.795,.106,.014,.067,"#82a0af",side*.12);
    }
    loadItem(b,kind,.035,y+.148,-.88,.29,.20);
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
    const bob=!this.reduceMotion&&me?Math.sin(this.motionPhase)*.019*Math.min(1,speed):0;
    const eye=me?[me.x,1.56+bob,me.z]:[.23,1.54,5.95];
    const yaw=me?view.yaw:-.09+Math.sin(this.time*.25)*.17;
    const pitch=me?view.pitch:-.025;
    const matrix=multiply(this.projection,look(eye,yaw,pitch));
    this.viewProjection=matrix;

    const weather=game?.leg===2?.62:game?.leg===1?.35:0;
    const mist=game?.hazard==="frost"?1:0;
    this.sky??=weather;
    this.sky+=(weather+mist*.28-this.sky)*(1-Math.exp(-dt*1.6));
    gl.clearColor(.66-this.sky*.18,.79-this.sky*.12,.88-this.sky*.08,1);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    this.drawBatch(this.static,matrix,eye,false);
    if(game?.travel===false){
      const leg=game.leg;
      if(!this.stations.has(leg))this.stations.set(leg,this.staticBatch(batch=>this.station(batch,leg)));
      this.drawBatch(this.stations.get(leg),matrix,eye,false);
    }
    const b=this.dynamic;
    b.reset();
    this.landscape(b,game,this.trackPaint);
    if(game?.travel===false&&game.leg<2&&game.signals<=game.leg){
      parcel(b,9.38,1.19,-5.91,.49,.31,true);
    }
    for(let i=0;i<Math.min(game?.stock.parcel??4,3);i++){
      parcel(b,-1.11+(i===2?.08:0),.81+(i===2?.17:0),2.35+(i===0?-.14:.14),i===2?.28:.37,i*.29-.21);
    }
    if(game?.travel===false&&game.leg<2){
      for(let i=0;i<3;i++){
        const blink=game.stop_timer<7&&!this.reduceMotion?.50+Math.sin(this.time*8+i)*.33:.83;
        b.box(1.50,.076,2.46+i*.58,.082,.031,.23,"#ffd68e",0,blink);
      }
    }
    if(game?.travel!==false){
      b.box(1.58,1.17,3.055,.15,2.32,1.75,"#527a8a");
      b.box(1.483,1.66,3.05,.06,.62,1.04,"#95b3bf");
      b.box(1.445,1.18,3.42,.07,.09,.27,"#d1bb9b");
    }
    // Vary several real surfaces in response to the authoritative train state.
    const heat=game?.heat??74,work=this.map.work;
    for(let i=0;i<7;i++){
      const z=-7.36+(i-3)*.077;
      const flicker=this.reduceMotion?0:Math.sin(this.time*(7+i)+i*2.7)*.048;
      const h=.028+heat*.0021+flicker*(heat/90);
      b.box(-.544,.467+h/2,z,.057,h,.065,heat<12?"#78525e":i%2?"#ffe2a0":"#e68a56",0,Math.min(1,heat*.012));
      if(heat>26)b.box(-.506,.485+h*.33,z,.018,h*.45,.047,"#fff0b8",0,.90);
    }
    b.box(.620,.86,-7.68,.022,.08,.11,game?.fault?"#f6aca0":"#aee2b7",0,.94);
    lantern(b,1.05,.93,13.81,.49,"#ffc466",Boolean(game?.lamp),.23);
    for(const id of ["bridge","valley"]){
      const [x,z]=work[id];
      if(game?.signal_open)b.box(x,1.32,z,.094,.09,.10,game.route===id?"#bbfac0":"#ffe6a0",0,1);
    }
    for(let i=0;i<(game?.loaded??2);i++){
      const row=Math.floor(i/3),z=6.15-(i%3)*.36;
      gift(b,1.105,.79+row*.31,z,.30,i<(game?.manifest?.aboard||0)?"#ab752c":
        ["#b64961","#278182","#536eb3"][game?.leg??0],(i%3-1)*.19);
    }

    const actors=view.actors||[];
    const models=actors.filter(p=>p.id!==view.me).map((p,i)=>({...p,hp:100,skater:true,team:0,jacket:jackets[i%4]}));
    this.animator.beginFrame(dt,models);
    for(const p of models){
      this.actor(p,null,dt);
      if(p.hand){
        const x=p.x+p.ax*.40,z=p.z+p.az*.40;
        loadItem(b,p.hand,x,1,z,.32,Math.atan2(p.ax,p.az));
      }
    }
    if(view.target&&me){
      const [x,z]=work[view.target];
      // A physical floor marker stays in the scene while the action is in reach.
      const px=x>1.48?x-.44:x-Math.sign(x)*.43;
      const glow=this.reduceMotion?.42:.44+Math.sin(this.time*4)*.20;
      for(const sign of [-1,1]){
        b.box(px+sign*.115,.087,z,.022,.015,.21,"#ffe1a7",0,glow);
        b.box(px,.087,z+sign*.104,.21,.015,.022,"#ffe1a7",0,glow);
      }
    }
    if(!this.reduceMotion){
      for(let i=0;i<(mist?104:65);i++){
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

  dispose(){
    this.stations.forEach(batch=>batch.dispose());
    this.stations.clear();
    super.dispose();
  }

}
