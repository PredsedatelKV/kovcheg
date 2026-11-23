import { getSettings } from "../pages/settings.js";

// Length, noise texture and level, followed by (start Hz, end Hz, level, delay).
const effects = {
  click:[.08,"glass",.18,[[770,600,.4]]],
  countdown:[.16,"glass",.08,[[495,495,.65]]],
  start:[.45,"glass",.10,[[523,525,.6],[784,787,.45,.075],[1046,1050,.4,.14]]],
  finish:[.75,"glass",.07,[[523,523,.5],[659,659,.5,.105],[784,784,.5,.21]]],
  fail:[.45,"wind",.13,[[340,245,.5],[242,162,.45,.14]]],
  foot:[.13,"snow",.72,[[136,89,.13]]],
  skate:[.23,"snow",.58,[[219,119,.08]]],
  snowman:[.20,"snow",.58,[[124,67,.26]]],
  pistol:[.15,"shot",.67,[[294,93,.62]]],
  rapid:[.12,"shot",.68,[[425,140,.53],[1050,910,.18]]],
  spread:[.24,"shot",.70,[[276,62,.67],[131,38,.27,.02]]],
  cannon:[.38,"shot",.69,[[172,46,.77],[380,143,.27,.02]]],
  snow:[.23,"wind",.59,[[240,98,.26]]],
  boss:[.39,"wind",.63,[[182,37,.76]]],
  windup:[.35,"snow",.42,[[128,272,.32]]],
  impact:[.16,"snow",.70,[[182,74,.35]]],
  blast:[.37,"shot",.56,[[124,39,.78]]],
  hit:[.13,"glass",.18,[[870,650,.61],[1340,974,.21]]],
  hurt:[.26,"shot",.32,[[198,76,.76]]],
  block:[.29,"glass",.32,[[1180,575,.54],[1461,892,.32]]],
  weapon:[.27,"glass",.24,[[556,660,.48],[835,1047,.4,.075]]],
  heal:[.35,"glass",.09,[[674,790,.52],[1000,1185,.38,.062]]],
  shield:[.48,"wind",.26,[[268,535,.54],[400,796,.37,.08]]],
  shieldOff:[.28,"wind",.20,[[613,240,.51]]],
  spawn:[.35,"glass",.16,[[380,760,.48],[560,1120,.29]]],
  wave:[.56,"wind",.28,[[160,242,.55],[322,486,.38,.12]]],
  clear:[.65,"glass",.08,[[660,660,.48],[784,784,.4,.09],[1175,1175,.31,.20]]],
  down:[.45,"snow",.46,[[166,71,.43]]],
  gift:[.29,"glass",.09,[[1160,1160,.6],[1716,1700,.27,.045]]],
  delivery:[.65,"glass",.10,[[660,660,.53],[880,880,.47,.08],[1320,1320,.4,.17]]],
  brake:[.31,"snow",.76,[[220,78,.15]]],
  miss:[.26,"wind",.20,[[340,216,.45]]],
  jump:[.22,"wind",.36,[[233,474,.43]]],
  land:[.17,"snow",.64,[[144,87,.42]]],
  dash:[.30,"wind",.67,[[285,511,.32]]],
  pulse:[.39,"shot",.40,[[278,61,.7],[590,146,.30]]],
  crack:[.25,"glass",.66,[[1173,594,.39],[1837,996,.23,.043]]],
  fissure:[.14,"glass",.52,[[1604,999,.30]]],
  break:[.47,"glass",.58,[[683,145,.4],[1541,660,.31,.067],[356,60,.35,.14]]],
  splash:[.48,"snow",.69,[[254,62,.38]]],
  freeze:[.39,"glass",.25,[[1047,1047,.32],[1568,1568,.26,.08]]],
  storm:[.92,"wind",.73,[[146,123,.37],[216,158,.29]]],
  iceWind:[3,"wind",.58,[]],
  runners:[2,"snow",.6,[]],
  rail:[2.0,"rail",.75,[]],
  boiler:[2.75,"boiler",.58,[]],
  whistle:[.85,"wind",.15,[[462,395,.51],[680,587,.21],[925,782,.12]]],
  trainStep:[.14,"shot",.31,[[122,94,.33]]],
  furnace:[.44,"wind",.65,[[290,115,.39]]],
  wrench:[.31,"glass",.51,[[807,544,.43],[1222,350,.32,.081]]],
};
const buffers = new Map();
let npcClip;

function sample(ctx, key) {
  if (buffers.has(key)) return buffers.get(key);
  const [length, texture, strength, tones] = effects[key];
  const rate = 24000;
  const buffer = ctx.createBuffer(1, Math.round(length * rate), rate);
  const samples = buffer.getChannelData(0);
  const loop = !tones.length;
  const [smooth, high] = {glass:[.09,-.38],snow:[.27,.22],wind:[.045,.05],shot:[.28,.25],
    rail:[.11,.09],boiler:[.028,.014]}[texture];
  let random = 4811 + key.length * 319;
  let low = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    random = (Math.imul(random,1664525)+1013904223) >>> 0;
    const white = random / 2147483648 - 1;
    low += (white - low) * smooth;
    const envelope = loop
      ? Math.min(1, t / .15, (length - t) / .15) * (.80 + .18 * Math.sin(t * Math.PI * 2 / length))
      : Math.min(1, t / .004) * Math.exp(-5 * t / length) * Math.min(1, (length - t) / .018);
    let value = (low + (white - low) * high) * strength * envelope * (loop ? 1.4 : 1);
    if(texture==="rail")value+=(Math.sin(t*201)*.085+low*.64)*Math.pow(.5+.5*Math.cos(t*Math.PI*5),12);
    if(texture==="boiler")value+=(Math.sin(t*161)*.035+low*.32)*envelope;
    for (const [from,to,level,delay=0] of tones) {
      const at = t - delay;
      if (at <= 0) continue;
      const phase = 2*Math.PI*(from*at+(to-from)*at*at/(2*length));
      value += Math.sin(phase)*level*Math.min(1,at/.007)*Math.exp(-5*at/(length-delay))*Math.min(1,(length-t)/.025);
    }
    samples[i] = Math.tanh(value);
  }
  buffers.set(key, buffer);
  return buffer;
}

export class GameAudio {
  constructor({ npc = false } = {}) {
    this.ctx = null;
    this.voices = new Set();
    this.loops = new Map();
    this.last = new Map();
    this.npc = npc;
    this.disposed = false;
  }

  unlock() {
    if (this.disposed) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = window.__kovchegAudioContext ||= new AudioContext();
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      if (this.npc && !npcClip) {
        npcClip = fetch(new URL("../media/arena/npc-down.wav", import.meta.url))
          .then(response => {
            if (!response.ok) throw Error("Audio unavailable");
            return response.arrayBuffer();
          })
          .then(bytes => this.ctx.decodeAudioData(bytes))
          .catch(() => null);
      }
    } catch (_) {}
  }

  volume() {
    if (this.disposed || this.ctx?.state !== "running" || document.hidden) return 0;
    const settings = getSettings();
    return settings.uiSounds ? settings.uiSoundsVolume : 0;
  }

  voice(buffer, volume, pan, rate, loop = false) {
    const ctx = this.ctx;
    const node = ctx.createBufferSource(), gain = ctx.createGain();
    const spatial = pan && ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const voice = {node,gain};
    node.buffer = buffer;
    node.loop = loop;
    node.playbackRate.value = rate;
    gain.gain.value = volume;
    node.connect(gain);
    gain.connect(spatial || ctx.destination);
    if (spatial) {
      spatial.pan.value = Math.max(-1, Math.min(1, pan));
      spatial.connect(ctx.destination);
    }
    this.voices.add(voice);
    node.onended = () => {
      this.voices.delete(voice);
      node.disconnect();
      gain.disconnect();
      spatial?.disconnect();
    };
    node.start();
    return voice;
  }

  play(key, { level=.8, pan=0, rate=1, gap=.045 } = {}) {
    const volume = this.volume() * level;
    if (!volume || !effects[key] || this.voices.size >= 24) return;
    const time = this.ctx.currentTime;
    if (time - (this.last.get(key) ?? -Infinity) < gap) return;
    this.last.set(key, time);
    this.voice(sample(this.ctx,key), volume, pan, rate * (.94 + Math.random()*.12));
  }

  async npcDown(options) {
    this.play("down", options);
    const buffer = await npcClip;
    const volume = this.volume() * (options?.level ?? .8);
    if (!buffer || !volume || this.voices.size >= 24) return;
    const time = this.ctx.currentTime;
    if (time - (this.last.get("npc") ?? -Infinity) < .24) return;
    this.last.set("npc", time);
    this.voice(buffer, volume * .95, options?.pan || 0, 1);
  }

  ambient(key, level, rate = 1) {
    const volume = this.volume() * level;
    let voice = this.loops.get(key);
    if (!voice && volume > 0) {
      voice = this.voice(sample(this.ctx,key),0,0,rate,true);
      this.loops.set(key,voice);
    }
    if (!voice) return;
    const time = this.ctx.currentTime;
    voice.gain.gain.setTargetAtTime(volume,time,.095);
    voice.node.playbackRate.setTargetAtTime(rate,time,.14);
  }

  silence() {
    for (const {node} of this.voices) {
      try { node.stop(); } catch (_) {}
    }
    this.voices.clear();
    this.loops.clear();
  }

  dispose() {
    this.disposed = true;
    this.silence();
  }
}

export function spatialAudio(listener, x, z, yaw = 0, range = 16) {
  if (!listener || !Number.isFinite(x) || !Number.isFinite(z)) return {level:.65,pan:0};
  const dx = x - listener.x, dz = z - listener.z, distance = Math.hypot(dx,dz);
  return {
    level: .92 * Math.max(0, 1 - distance / range) ** 1.4,
    pan: (dx*Math.cos(yaw)+dz*Math.sin(yaw)) / Math.max(2.8,distance),
  };
}
