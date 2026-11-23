// Dimensions are relative to the prop's center. Rotation keeps the smaller
// faces and trim attached when the prop moves from a crate to a player's hand.
function model(b,x,y,z,scale,turn) {
  const c=Math.cos(turn),s=Math.sin(turn);
  return (dx,dy,dz,w,h,d,color,ry=0,glow=0,rz=0)=>b.box(
    x+(dx*c+dz*s)*scale,y+dy*scale,z+(-dx*s+dz*c)*scale,
    w*scale,h*scale,d*scale,color,turn+ry,glow,1,0,rz
  );
}

export function gift(b,x,y,z,w,color="#ae384e",turn=0) {
  const box=model(b,x,y,z,w,turn);
  box(0,-.03,0,.95,.68,.95,color);
  box(0,.30,0,1,.15,1,color);
  box(0,.369,0,1.004,.023,1.004,color,0,.13);
  for(const side of [-1,1]){
    box(0,.006,.511*side,.15,.72,.024,"#ffd486");
    box(.511*side,.006,0,.024,.72,.15,"#edb865");
  }
  box(0,.39,0,1.028,.038,.15,"#ffda8b",0,.23);
  box(0,.391,0,.15,.04,1.028,"#ffda8b",0,.23);
  for(const side of [-1,1]){
    box(side*.155,.44,0,.25,.095,.13,"#ffe3a1",side*.20,.29,side*.24);
    box(side*.25,.47,0,.073,.084,.14,"#ffcd76",side*.20,.14,side*.24);
    box(side*.123,.421,side*.15,.13,.028,.21,"#e7aa59",side*.44,.16);
  }
  box(0,.46,0,.105,.105,.12,"#ffefbd",0,.4);
}

export function parcel(b,x,y,z,w,turn=0,priority=false) {
  const box=model(b,x,y,z,w,turn);
  box(0,0,0,.96,.62,.86,priority?"#c89132":"#aa6e48");
  box(0,.30,0,.94,.061,.84,priority?"#ffce72":"#dca779");
  box(.12,.335,.055,.65,.018,.51,priority?"#e29c36":"#bd8d5d",-.045);
  box(-.03,.347,0,.034,.023,.88,"#664c3f");
  box(0,.348,.03,.97,.024,.032,"#664c3f");
  for(const side of [-1,1]){
    box(-.03,0,.438*side,.034,.62,.026,"#745548");
    box(.49*side,0,.03,.028,.62,.035,"#745548");
  }
  box(.18,.356,.15,.22,.021,.25,"#f2ddac",.18,.26);
  box(.18,.368,.105,.105,.011,.035,"#ae3950",.18);
  if(priority){
    const gold="#ffeaa9";
    box(.16,0,.439,.094,.27,.025,gold,0,.45);
    box(.16,0,.445,.26,.088,.025,gold,0,.45);
    box(.16,0,.456,.15,.15,.024,gold,0,.55,Math.PI/4);
  }
}

export function coal(b,x,y,z,w,turn=0) {
  const box=model(b,x,y,z,w,turn);
  box(0,-.078,0,.96,.41,.82,"#202534",.12);
  box(-.13,.15,.04,.62,.32,.68,"#303949",-.28);
  box(.23,.10,-.14,.43,.29,.50,"#414c59",.41);
  box(-.26,.25,.04,.30,.13,.27,"#526270",-.42,0,.28);
  box(.05,.22,.31,.19,.07,.21,"#485765",.44,0,-.32);
  box(-.32,-.14,.30,.26,.11,.15,"#151d2c",-.3);
}

export function gear(b,x,y,z,w,turn=0) {
  const box=model(b,x,y,z,w,turn);
  const tau=2*Math.PI;
  for(let tooth=0;tooth<8;tooth++){
    const a=tooth*tau/8,dx=Math.sin(a),dz=Math.cos(a);
    box(dx*.37,0,dz*.37,.25,.18,.30,"#78a8bf",a);
    box(dx*.37,.104,dz*.37,.22,.035,.21,"#c1d9e0",a, .13);
  }
  box(0,0,0,.69,.19,.69,"#51768c",Math.PI/4);
  box(0,.155,0,.45,.147,.45,"#b88152",Math.PI/4);
  box(0,.235,0,.33,.049,.33,"#e9b36d",Math.PI/4,.14);
  box(0,.266,0,.15,.032,.15,"#324657",Math.PI/4);
}

export function lantern(b,x,y,z,w,tint="#ffbe5e",lit=true,turn=0) {
  const box=model(b,x,y,z,w,turn),metal="#584338",trim="#9d7047";
  box(0,-.40,0,.87,.13,.87,metal);
  box(0,-.32,0,.73,.085,.73,trim);
  box(0,-.046,0,.54,.48,.54,lit?tint:"#516879",0,lit?.94:0);
  if(lit)box(0,-.088,0,.57,.22,.57,"#ffe7a4",0,1);
  box(0,.27,0,.82,.13,.82,trim);
  box(0,.36,0,.64,.075,.64,metal);
  box(0,.42,0,.33,.069,.33,trim);
  for(const side of [-1,1]){
    box(.22*side,.53,0,.074,.23,.093,trim);
    for(const other of [-1,1])box(.31*side,-.035,.31*other,.08,.54,.08,metal);
  }
  box(0,.66,0,.49,.065,.095,trim);
}

export function toy(b,x,y,z,w,turn=0) {
  const box=model(b,x,y,z,w,turn);
  box(0,-.44,0,.71,.085,.47,"#ad834c");
  for(const side of [-1,1]){
    box(.145*side,-.32,0,.21,.22,.27,"#3a4057");
    box(.15*side,-.403,.045,.22,.09,.32,"#293348");
    box(.273*side,-.046,0,.14,.28,.22,"#9c3d4b");
    box(.274*side,.087,0,.16,.064,.23,"#f3cb7b",0,.18);
  }
  box(0,-.063,0,.41,.37,.30,"#ba444f");
  box(0,-.134,.155,.42,.07,.035,"#6b3c45");
  box(0,.092,.17,.035,.245,.024,"#f3cb7b",0,.15);
  box(0,.245,0,.32,.234,.283,"#edc296");
  for(const side of [-1,1])box(.076*side,.275,.147,.035,.038,.024,"#34415a");
  box(0,.198,.155,.16,.045,.037,"#fff0dc");
  box(0,.397,0,.39,.14,.322,"#414d6c");
  box(0,.338,.043,.43,.055,.32,"#283a56");
  box(0,.410,.169,.089,.089,.025,"#ffdb89",.0,.34,.7);
}

const carried={coal,parts:gear,parcel,sealed:gift};
export function loadItem(b,kind,x,y,z,w,turn) {
  if(kind==="priority")return parcel(b,x,y,z,w,turn,true);
  if(kind==="priority_sealed")return gift(b,x,y,z,w,"#a16a29",turn);
  const draw=carried[kind];
  if(!draw)return;
  if(kind==="sealed")draw(b,x,y,z,w,"#aa405d",turn);
  else draw(b,x,y,z,w,turn);
}

const signs={
  coal:["0011100","0111110","1111111","1111111","0111110","0011100"],
  tool:["0010110","0111100","0011000","0110000","1100000","1000000"],
  box:["0111110","0101010","0101010","0111110","0100010","0111110"],
  gift:["0101010","0011100","1111111","1011101","1011101","1111111"],
  heat:["0001000","0011000","0110100","0110010","0111110","0011100"],
  snow:["1001001","0101010","0011100","1111111","0011100","0101010","1001001"],
  lamp:["0011100","0010100","0111110","0101010","0101010","0111110"],
  mail:["1111111","1100011","1010101","1001001","1000001","1111111"],
  star:["0001000","0001000","1111111","0111110","0111110","0100010"],
  bell:["0001000","0011100","0111110","0111110","1111111","0001000"],
};

export function marker(b,name,x,y,z,side,ink) {
  const pixel=.032,grid=signs[name];
  b.box(x,y,z,.031,.32,.34,"#263950");
  b.box(x+.018*side,y,z,.015,.277,.294,"#3c526e");
  for(let row=0;row<grid.length;row++){
    for(let col=0;col<7;col++){
      if(grid[row][col]==="1")b.box(x+.027*side,y+(.5*(grid.length-1)-row)*pixel,z+(3-col)*pixel*side,
        .012,pixel+.001,pixel+.001,ink,0,.62);
    }
  }
}

export function openBin(b,x,z,w) {
  const box=model(b,x,0,z,w,0);
  box(0,.2,0,.98,.36,.98,"#74584e");
  box(0,.47,0,.97,.057,.97,"#523e39");
  const sign=-Math.sign(x);
  box(sign*.46,.46,0,.10,1.09,.98,"#a78363");
  box(-sign*.46,.52,0,.11,1.12,.98,"#a78363");
  for(const side of [-1,1]){
    box(0,.53,.45*side,.95,1.10,.11,"#a78363");
    box(0,.93,.45*side,1,.102,.143,"#cfac80");
    box(sign*.522,.345,.32*side,.06,.63,.073,"#6d4d43");
  }
  box(sign*.47,.95,0,.13,.105,1.02,"#c29a74");
}
