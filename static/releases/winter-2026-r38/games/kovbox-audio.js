import { getAudioCtx, getSettings } from "../pages/settings.js";
import { readAudioBytes } from "../startup-assets.js";

const cueFiles = new Map([
  ["tap", [new URL("../media/tap.wav", import.meta.url), 0]],
  [1, [new URL("../media/kovbox-audio/bonus-1.mp3", import.meta.url), 0]],
  [2, [new URL("../media/kovbox-audio/bonus-2.mp3", import.meta.url), 0]],
  [3, [new URL("../media/kovbox-audio/bonus-3.mp3", import.meta.url), 0]],
  ["open", ["/static/audio/lootbox/open.mp3?v=286", .016]],
  ["special", ["/static/audio/lootbox/special.mp3?v=286", .096]],
  ["legendary", [new URL("../media/kovbox-audio/legendary.wav", import.meta.url), 0]],
  ["win", [new URL("../media/confirm.wav", import.meta.url), 0]],
]);
const buffers = new Map();
const loading = new Map();
const fallbackPitch = new Map([["tap", 480], [1, 520], [2, 639], [3, 785], ["open", 312],
  ["special", 880], ["legendary", 463], ["win", 698]]);

export function prepareKovboxSounds() {
  const settings = getSettings();
  if (!settings.uiSounds || !settings.uiSoundsVolume) return;
  for (const [cue, [path]] of cueFiles) {
    if (buffers.has(cue) || loading.has(cue)) continue;
    const pending = readAudioBytes(path)
      .then((bytes) => getAudioCtx().decodeAudioData(bytes))
      .then((buffer) => buffers.set(cue, buffer))
      .catch(() => {})
      .finally(() => loading.delete(cue));
    loading.set(cue, pending);
  }
}

function startFallback(ctx, gain, cue, onset) {
  const source = ctx.createOscillator();
  const pitch = fallbackPitch.get(cue);
  const duration = cue === "open" ? .28 : .13;
  source.type = "sine";
  source.frequency.setValueAtTime(pitch, onset);
  source.frequency.exponentialRampToValueAtTime(pitch * (cue === "open" ? 1.7 : 1.34), onset + duration);
  gain.gain.setValueAtTime(.001, onset);
  gain.gain.linearRampToValueAtTime(.36, onset + .006);
  gain.gain.exponentialRampToValueAtTime(.001, onset + duration);
  source.connect(gain);
  source.start(onset);
  source.stop(onset + duration);
  return source;
}

export function createKovboxSound() {
  const voices = new Set();

  function stop(fade = 0) {
    for (const voice of voices) {
      if (voice.stopping) continue;
      voice.stopping = true;
      const at = voice.ctx.currentTime;
      try {
        if (fade > 0) voice.level.gain.setTargetAtTime(0, at, fade / 4);
        voice.source.stop(at + fade);
        if (voice.finalSource) voice.finalSource.stop(at + fade);
      } catch (_) {}
    }
  }

  function play(cue, offset = cueFiles.get(cue)?.[1]) {
    const settings = getSettings();
    if (!settings.uiSounds || !settings.uiSoundsVolume || document.hidden || !cueFiles.has(cue)) return;
    try {
      const ctx = getAudioCtx();
      const onset = ctx.currentTime;
      if (ctx.state !== "running") void ctx.resume().catch(() => {});
      stop(.04);
      const level = ctx.createGain();
      level.gain.value = settings.uiSoundsVolume * (cue === "tap" || cue === "win" ? .55 : 1);
      level.connect(ctx.destination);

      const buffer = buffers.get(cue);
      let source;
      let finalSource;
      if (buffer) {
        source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(level);
        source.start(onset, offset);
      } else {
        // Play immediately if the recording is still downloading or decoding.
        // Starting a recording after that promise resolves would lag the tap.
        const envelope = ctx.createGain();
        envelope.connect(level);
        source = startFallback(ctx, envelope, cue, onset);
        if (cue === "legendary") {
          const chime = ctx.createGain();
          chime.connect(level);
          finalSource = startFallback(ctx, chime, "special", onset + Math.max(0, .64 - offset));
        }
      }

      const voice = { ctx, level, source, finalSource, stopping: false };
      voices.add(voice);
      (finalSource || source).onended = () => {
        voices.delete(voice);
        source.disconnect();
        finalSource?.disconnect();
        level.disconnect();
      };
    } catch (_) {}
  }

  return { play, stop };
}
