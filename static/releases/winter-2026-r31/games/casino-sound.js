import { readAudioBytes } from "../startup-assets.js";
import { getAudioCtx, getSettings, resumeManagedAudio, UI_GAIN } from "../pages/settings.js";

const buffers = new Map();
const marks = ["stake", "reel", "stop", "die", "launch", "crash", "win", "jackpot", "loss",
  "slot-stop", "slot-win", "slot-big-win", "slot-jackpot", "slot-lose"];

function load(name) {
  if (!buffers.has(name)) {
    const path = new URL("../media/casino/sfx/" + name + ".mp3", import.meta.url);
    const request = readAudioBytes(path).then((data) => getAudioCtx().decodeAudioData(data));
    buffers.set(name, request);
    request.catch(() => buffers.delete(name));
  }
  return buffers.get(name);
}

export function prepareCasinoSounds() {
  return Promise.allSettled(marks.map(load));
}

export function createCasinoSound() {
  const sources = new Set();
  let version = 0;
  let disposed = false;

  function stop() {
    version += 1;
    for (const source of sources) {
      try { source.stop(); } catch (_) {}
    }
  }

  function play(name, { delay = 0, level = 1, rate = 1, duration = 0 } = {}) {
    const settings = getSettings();
    if (disposed || document.hidden || !settings.uiSounds || !settings.uiSoundsVolume) return;
    const scheduledAt = performance.now();
    const generation = version;
    void resumeManagedAudio();
    load(name).then((buffer) => {
      const current = getSettings();
      if (disposed || generation !== version || document.hidden || !current.uiSounds) return;
      const elapsed = (performance.now() - scheduledAt) / 1000;
      if (elapsed > delay + .32) return;
      const ctx = getAudioCtx();
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      const start = ctx.currentTime + Math.max(0, delay - elapsed);
      const volume = Math.min(1, current.uiSoundsVolume * UI_GAIN * level);
      source.buffer = buffer;
      source.playbackRate.value = rate;
      gain.gain.value = volume;
      if (duration > 0) {
        source.loop = true;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(volume, start + .13);
        gain.gain.setValueAtTime(volume, start + duration - .22);
        gain.gain.linearRampToValueAtTime(0, start + duration);
      }
      source.connect(gain).connect(ctx.destination);
      sources.add(source);
      source.onended = () => {
        sources.delete(source);
        source.disconnect();
        gain.disconnect();
      };
      if (duration > 0) source.start(start, 0, duration);
      else source.start(start);
    }).catch(() => {});
  }

  return {
    preload() {
      if (getSettings().uiSounds) void prepareCasinoSounds();
    },
    play,
    stop,
    dispose() {
      disposed = true;
      stop();
    },
  };
}
