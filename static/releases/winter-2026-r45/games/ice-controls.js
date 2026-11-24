export function stickInput(dx, dz) {
  const distance = Math.hypot(dx, dz);
  if (distance <= 5) return { x: 0, z: 0 };
  const amount = Math.min(1, (distance-5)/25);
  return { x: dx / distance * amount, z: dz / distance * amount };
}

// Predict only the local drawing position. The server decides collisions,
// pickups, cooldowns and falls. The horizon is bounded to a few ticks.
export function previewMotion(player, input, ahead) {
  let {x,z,vx,vz} = player;
  const moving = Boolean(input.x || input.z);
  const traction = player.grip > 0 ? .72
    : player.knock_time > 0 ? .16
    : player.grounded ? (moving ? .46 : .55)
    : (moving ? .27 : .14);
  for(let t=Math.min(.12,ahead);t>0;t-=.05){
    const step=Math.min(.05,t);
    if(player.dash_time<=ahead-t){
      const blend=1-Math.pow(1-traction,step/.05);
      vx+=(input.x*5.35-vx)*blend;
      vz+=(input.z*5.35-vz)*blend;
    }
    x+=vx*step;
    z+=vz*step;
  }
  return {x,z,vx,vz};
}

export function jumpPreview(player, requestedAt, now) {
  const seconds=(now-requestedAt)/1000;
  if(!Number.isFinite(seconds)||seconds<0||seconds>.38)return player.y;
  return Math.max(player.y,7.4*seconds-10*seconds*seconds);
}
