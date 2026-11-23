// Fixed-point simulation shared with app/courier_engine.py. No DOM, clock or RNG globals.
export const ENGINE_VERSION = 2;
export const STEP_MS = 50;
export const TICKS = 2400;
export const MAX_BAG = 12;
export function rng(seed) {
  let state = seed >>> 0;
  return (n) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n; };
}
export function zoneAt(distance) {
  const part = distance % 24000;
  return part >= 16500 ? 2 : part >= 9000 ? 1 : 0;
}
export function encodeControl(aim, brake) {
  const q = Math.max(0, Math.min(2000, Math.round(aim) + 1000));
  return q + (brake ? 2048 : 0);
}
export function decodeControl(code) {
  return { aim: (code & 2047) - 1000, brake: code >= 2048 };
}
// A moving snowball always leaves the adjacent safe corridor passable.
export function entityX(e, tick) {
  if (!e.motion) return e.x;
  const half = e.period / 2;
  const phase = (tick + e.phase) % e.period;
  const triangle = phase <= half ? phase : e.period - phase;
  return e.x + Math.trunc((triangle * 2 - half) * e.motion / half);
}
export function makeTrack(seed) {
  const r = rng(seed), track = [];
  let y = 500, safe = 2;
  for (let i = 0; i < 420; i++) {
    y += 240 + r(61);
    if (i % 18 === 16) {
      track.push({ y, x: r(2) ? 650 : -650, kind: "dock", style: r(3), id: track.length });
      continue;
    }
    const tier = Math.min(3, Math.floor(y / 15000));
    safe = Math.max(0, Math.min(4, safe + r(3) - 1));
    const hasGift = i < 6 || r(100) < 62;
    let giftLane = safe;
    if (hasGift) {
      if (r(100) < 28) giftLane = Math.max(0, Math.min(4, safe + (r(2) ? 1 : -1)));
      track.push({ y, x: (giftLane - 2) * 360 + r(161) - 80, kind: "gift", style: r(4), id: track.length });
    }
    // Clear approaches and exits give the player time to brake and deliver.
    if (i > 4 && i % 18 !== 15 && i % 18 !== 17) {
      const lanes = [0, 1, 2, 3, 4].filter(lane => lane !== safe && (!hasGift || lane !== giftLane));
      const count = Math.min(lanes.length, tier === 0 ? 1 : tier === 1 ? 2 : tier === 2 ? 2 + r(2) : 3);
      for (let n = 0; n < count; n++) {
        const chosen = r(lanes.length), lane = lanes.splice(chosen, 1)[0], style = r(3);
        const motion = style === 2 && tier > 0 ? (Math.abs(lane - safe) < 2 ? 70 : 160) : 0;
        const period = motion ? 120 + r(3) * 40 : 160;
        const phase = motion ? r(period) : 0;
        track.push({ y: y + r(121) - 60, x: (lane - 2) * 360 + r(51) - 25,
          kind: "obstacle", style, motion, period, phase, id: track.length });
      }
    }
  }
  track.sort((a, b) => a.y - b.y || a.id - b.id);
  return track;
}
export function createState() {
  return { tick: 0, x: 0, vx: 0, distance: 0, speed: 0, bag: 0, score: 0,
    delivered: 0, deliveries: 0, picked: 0, lost: 0, hits: 0, combo: 0, bestCombo: 0,
    cooldown: 0, cursor: 0, finished: false, events: [] };
}
function approach(value, target) {
  const d = target - value;
  return value + Math.sign(d) * Math.max(1, Math.trunc(Math.abs(d) / 4));
}
export function step(state, track, code) {
  if (state.finished) return state;
  state.events = [];
  const control = decodeControl(code);
  const target = Math.trunc(control.aim * 9 / 10);
  const icy = zoneAt(state.distance) === 1 && state.x >= 0;
  const grip = icy ? (state.bag >= 8 ? 10 : 13) : (state.bag >= 8 ? 20 : 26);
  const desired = Math.max(-75, Math.min(75, Math.trunc((target - state.x) / 6)));
  state.vx = Math.trunc((state.vx * (100 - grip) + desired * grip) / 100);
  state.x = Math.max(-1080, Math.min(1080, state.x + state.vx));
  let base = icy ? 37 : zoneAt(state.distance) === 2 ? 28 : zoneAt(state.distance) === 1 ? 27 : 30;
  base -= Math.trunc(state.bag / 3);
  if (control.brake) base = Math.trunc(base * 55 / 100);
  if (state.cooldown > 0) { base = Math.trunc(base * 65 / 100); state.cooldown--; }
  if (Math.abs(state.x) > 900) base = Math.trunc(base * 65 / 100);
  state.speed = approach(state.speed, Math.max(8, base));
  state.distance += state.speed;
  while (state.cursor < track.length && track[state.cursor].y <= state.distance) {
    const e = track[state.cursor++];
    const contactX = entityX(e, state.tick);
    const dx = Math.abs(state.x - contactX);
    if (e.kind === "gift" && dx <= 105 && state.bag < MAX_BAG) {
      state.bag++; state.picked++; state.score += 5;
      state.events.push({ kind: "gift", x: e.x, value: 1 });
    } else if (e.kind === "obstacle" && dx <= 195 && !state.cooldown) {
      const lost = Math.min(2, state.bag);
      state.bag -= lost; state.lost += lost; state.hits++; state.cooldown = 14; state.combo = 0;
      state.events.push({ kind: "hit", x: contactX, value: lost });
    } else if (e.kind === "dock") {
      if (state.bag > 0 && dx <= 320 && state.speed <= 21) {
        const delivered = state.bag;
        state.combo = Math.min(5, state.combo + 1);
        state.bestCombo = Math.max(state.bestCombo, state.combo);
        const points = delivered * (80 + state.combo * 15) + 50;
        state.score += points; state.delivered += delivered; state.deliveries++; state.bag = 0;
        state.events.push({ kind: "delivery", x: e.x, value: delivered, points });
      } else if (state.bag > 0) {
        state.combo = 0;
        state.events.push({ kind: dx <= 320 ? "brake" : "miss", x: e.x, value: 0 });
      }
    }
  }
  state.tick++;
  state.finished = state.tick >= TICKS;
  return state;
}
export function result(state) {
  return { score: state.score, delivered: state.delivered, deliveries: state.deliveries,
    picked: state.picked, lost: state.lost, hits: state.hits, best_combo: state.bestCombo,
    distance: state.distance, duration_ms: state.tick * STEP_MS };
}
