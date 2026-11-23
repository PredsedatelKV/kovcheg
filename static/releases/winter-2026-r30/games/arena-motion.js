// Frame-rate independent, shared voxel rig for humans, bot teammates and snowmen.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export class ArenaAnimator {
 constructor(){this.time=0;this.states=new Map();this.dt=0;}
 state(id){
  let a=this.states.get(id);
  if(!a){a={phase:0,walk:0,aim:0,shot:0,alive:true,seen:this.time};this.states.set(id,a);}
  return a;
 }
 beginFrame(dt,actors){
  this.dt=clamp(dt,0,.1);this.time+=this.dt;
  if(this.states.size>actors.length+8){
   const present=new Set(actors.map(p=>p.id));
   for(const [id,a]of this.states)if(!present.has(id)&&this.time-a.seen>2)this.states.delete(id);
  }
 }
 shot(id){this.state(id).shot=.34;}
 pose(p){
  const a=this.state(p.id),dt=this.dt,speed=p.hp>0?Math.hypot(p.vx||0,p.vz||0):0;
  a.seen=this.time;
  if(p.hp>0&&!a.alive){a.phase=0;a.walk=0;a.aim=0;a.shot=0;}
  a.alive=p.hp>0;
  const blend=1-Math.exp(-dt*12);
  a.walk+=(clamp(speed/2.7,0,1)-a.walk)*blend;
  a.phase=(a.phase+speed*dt*2.9)%(Math.PI*2);
  a.shot=Math.max(0,a.shot-dt);
  a.aim+=((p.firing||a.shot>0?1:.12)-a.aim)*(1-Math.exp(-dt*10));
  const forward=(p.vx||0)*(p.ax||0)+(p.vz||0)*(p.az||-1);
  const direction=forward<-.1?-1:1;
  const swing=Math.sin(a.phase)*a.walk*.64*direction;
  const throwAngle=a.shot>0?-1.65*Math.sin((1-a.shot/.34)*Math.PI):(p.windup||0)*.85;
  return {
   phase:a.phase,walk:a.walk,aim:a.aim,
   leftLeg:swing,rightLeg:-swing,
   leftArm:-swing*.72*(1-a.aim)-a.aim*(1.24+(p.pitch||0)*.55),
   rightArm:swing*.72*(1-a.aim)-a.aim*(1.24+(p.pitch||0)*.55),
   bob:Math.abs(Math.sin(a.phase))*a.walk*.025+Math.sin(this.time*2.1)*.006,
   headPitch:-clamp(p.pitch||0,-.9,.9)*.65,
   lean:clamp(((p.vx||0)*(p.az||0)-(p.vz||0)*(p.ax||0))*.014,-.065,.065),
   throwAngle,
  };
 }
 clear(){this.states.clear();}
}
