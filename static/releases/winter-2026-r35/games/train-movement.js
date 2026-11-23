const between=(value,min,max)=>Math.max(min,Math.min(max,value));
const includes=(x,z,rect)=>x>=rect[0]&&x<=rect[1]&&z>=rect[2]&&z<=rect[3];

export function canWalk(map,x,z,travel){
  const inside=rect=>includes(x,z,rect);
  return (map.train.some(inside)||(!travel&&map.platform.some(inside)))&&!map.obstacles.some(inside);
}

export function workScore(map,game,player,yaw,id){
  const work=map.work[id];
  if(!work)return null;
  const platform=player.x>1.48, outside=id.startsWith("station_");
  if(outside!==platform||(outside&&game.travel))return null;
  const dx=work[0]-player.x,dz=work[1]-player.z,distance=Math.hypot(dx,dz);
  if(distance>map.reach)return null;
  const dot=(dx*Math.sin(yaw)-dz*Math.cos(yaw))/Math.max(.001,distance);
  if(distance>.34&&dot<.45)return null;
  return dot*.68-distance*.49;
}

export function focusAt(map,game,player,yaw){
  let chosen="",best=-Infinity;
  for(const id in map.work){
    const score=workScore(map,game,player,yaw,id);
    if(score==null)continue;
    const priority=score+(player.actions.includes(id)?.21:0);
    if(priority>best){best=priority;chosen=id;}
  }
  return chosen;
}

function slide(map,p,dx,dz,travel,halt=false){
  if(canWalk(map,p.x+dx,p.z,travel))p.x+=dx;
  else if(halt)p.vx=0;
  if(canWalk(map,p.x,p.z+dz,travel))p.z+=dz;
  else if(halt)p.vz=0;
}

export function advanceMotion(map,p,input,travel,seconds){
  const velocityRetained=.33;
  for(let left=seconds;left>1e-5;){
    const step=Math.min(map.step,left);
    left-=step;
    const acceleration=1-velocityRetained**(step/map.step);
    p.vx+=(input.x*map.speed-p.vx)*acceleration;
    p.vz+=(input.z*map.speed-p.vz)*acceleration;
    slide(map,p,p.vx*step,p.vz*step,travel,true);
  }
}

export class TrainPrediction{
  constructor(map){this.map=map;this.reset();}

  reset(){
    this.pose=null;this.snapshot=null;this.dx=0;this.dz=0;this.cx=0;this.cz=0;
  }

  update(player,game,input,snapshot,now,dt){
    if(!player){this.reset();return null;}
    const p=this.pose,map=this.map;
    if(!p||p.warp!==player.warp||!canWalk(map,p.x,p.z,game.travel)){
      this.pose={...player};this.snapshot=snapshot;this.dx=this.dz=this.cx=this.cz=0;
      return this.pose;
    }
    advanceMotion(map,p,input,game.travel,dt);
    if(snapshot&&snapshot!==this.snapshot){
      this.snapshot=snapshot;
      const expected={...player};
      const moving=Math.hypot(input.x,input.z)>.06;
      const lead=between((now-snapshot.at)/1000+.035,0,.095);
      advanceMotion(map,expected,moving?{x:player.vx/map.speed,z:player.vz/map.speed}:input,game.travel,lead);
      const dx=expected.x-p.x,dz=expected.z-p.z;
      if(Math.hypot(dx,dz)>1.8){
        this.pose=expected;this.dx=this.dz=this.cx=this.cz=0;return this.pose;
      }
      this.dx=dx;this.dz=dz;
    }
    // Ease correction velocity as well as position so arrival of a packet
    // cannot make a visible step change to the speed of the camera.
    const moving=Math.hypot(input.x,input.z)>.06;
    const settle=moving?4.8:8.2, limit=moving?.64:1.05;
    const ease=1-Math.exp(-dt*8);
    this.cx+=(between(this.dx*settle,-limit,limit)-this.cx)*ease;
    this.cz+=(between(this.dz*settle,-limit,limit)-this.cz)*ease;
    const x=p.x,z=p.z;
    slide(map,p,this.cx*dt,this.cz*dt,game.travel);
    this.dx-=p.x-x;this.dz-=p.z-z;
    Object.assign(p,player,{x:p.x,z:p.z,vx:p.vx,vz:p.vz});
    return p;
  }
}
