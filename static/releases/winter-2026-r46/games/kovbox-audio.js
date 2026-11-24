import { getAudioCtx, getSettings } from "../pages/settings.js";
import { readAudioBytes } from "../startup-assets.js";

export const KOVBOX_OPENING_MS = { quick: 640, legendary: 4200 };

const THEMES = { magic: 1030, ice: 1635, festive: 875 };
const cueFiles = ["grand-reveal.m4a", ...Object.keys(THEMES).flatMap(
  (theme) => [`${theme}-tap.wav`, `${theme}-reveal.wav`]
)];
const buffers = new Map();
const loading = new Map();

export function kovboxSoundTheme(poolCode) {
  if (poolCode === "winter-ice") return "ice";
  if (poolCode === "winter-seasonal") return "festive";
  return "magic";
}

export function prepareKovboxSounds() {
  const settings = getSettings();
  if (!settings.uiSounds || !settings.uiSoundsVolume) return;
  for (const file of cueFiles) {
    if (buffers.has(file) || loading.has(file)) continue;
    const path = new URL("../media/kovbox-audio/" + file, import.meta.url);
    const pending = readAudioBytes(path)
      .then((bytes) => getAudioCtx().decodeAudioData(bytes))
      .then((buffer) => buffers.set(file, buffer))
      .catch(() => {})
      .finally(() => loading.delete(file));
    loading.set(file, pending);
  }
  return Promise.allSettled(loading.values());
}

function oscillatorCue(ctx, output, onset, pitch, duration, volume) {
  const envelope = ctx.createGain();
  const source = ctx.createOscillator();
  source.type = "sine";
  source.frequency.setValueAtTime(pitch, onset);
  source.frequency.exponentialRampToValueAtTime(pitch * 1.20, onset + duration);
  envelope.gain.setValueAtTime(.001, onset);
  envelope.gain.linearRampToValueAtTime(volume, onset + .012);
  envelope.gain.exponentialRampToValueAtTime(.001, onset + duration);
  source.connect(envelope).connect(output);
  source.start(onset);
  source.stop(onset + duration);
  return { source, envelope };
}

function fallbackCues(ctx, output, cue, onset, offset, pitch) {
  const playNote = (delay, pitch, length, volume) =>
    oscillatorCue(ctx, output, onset + delay, pitch, length, volume);
  const duration = KOVBOX_OPENING_MS[cue] / 1000;
  if (!duration) return [playNote(0, pitch, .14, .49), playNote(.012, pitch * 1.51, .11, .20)];

  // Keep a timed flourish even when the recording hasn't finished decoding.
  const nodes = [];
  if (!offset) {
    nodes.push(playNote(0, pitch, .16, .36));
    if (cue === "legendary") {
      for (const [time, pitch] of [[.4, 165], [1.1, 245], [1.7, 331], [2.25, 442], [2.75, 498], [3.2, 660], [3.63, 880]]) {
        nodes.push(playNote(time, pitch, .33, .23 + time * .035));
      }
    }
  }
  const impact = Math.max(0, duration - offset);
  nodes.push(playNote(impact, 660, .34, .35), playNote(impact + .04, 994, .46, .30));
  if (cue === "legendary") {
    nodes.push(playNote(impact, 147, .74, .42), playNote(impact + .20, 1320, .69, .26));
  }
  return nodes;
}

function playBuffer(ctx, level, buffer, onset, offset = 0, rate = 1) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  source.connect(level);
  source.start(onset, offset);
  return { source };
}

export function createKovboxSound() {
  let active;

  function play(cue, offset = 0, tapStep = 0, theme = "magic") {
    const settings = getSettings();
    if (!settings.uiSounds || !settings.uiSoundsVolume || document.hidden) return;
    try {
      const ctx = getAudioCtx();
      const onset = ctx.currentTime;
      if (ctx.state !== "running") void ctx.resume().catch(() => {});
      if (active) {
        active.level.gain.setTargetAtTime(0, onset, .008);
        for (const { source } of active.nodes) {
          try { source.stop(onset + .04); } catch (_) {}
        }
      }

      const level = ctx.createGain();
      const opening = cue === "quick" || cue === "legendary";
      const step = typeof cue === "number" ? cue : tapStep || 1;
      const rate = 1 + .14 * (step - 1);
      const cueLevel = opening ? 1.02 : 1.60;
      level.gain.value = Math.min(1, settings.uiSoundsVolume * cueLevel);
      level.connect(ctx.destination);
      const tap = `${theme}-tap.wav`;
      const file = cue === "legendary" ? "grand-reveal.m4a" : opening ? `${theme}-reveal.wav` : tap;
      const buffer = buffers.get(file);
      const pitch = THEMES[theme] * rate;
      const nodes = buffer
        ? [playBuffer(ctx, level, buffer, onset, offset, opening ? 1 : rate)]
        : fallbackCues(ctx, level, cue, onset, offset, pitch);
      if (opening && tapStep > 0 && !offset) {
        const tapBuffer = buffers.get(tap);
        const tapGain = ctx.createGain();
        tapGain.gain.value = .46;
        tapGain.connect(level);
        const hit = tapBuffer
          ? playBuffer(ctx, tapGain, tapBuffer, onset, 0, rate)
          : oscillatorCue(ctx, tapGain, onset, pitch, .14, .55);
        nodes.push({ ...hit, tapGain });
      }
      const playing = { level, nodes };
      active = playing;
      let remaining = nodes.length;
      for (const { source, envelope, tapGain } of nodes) {
        source.onended = () => {
          source.disconnect();
          envelope?.disconnect();
          tapGain?.disconnect();
          if (--remaining) return;
          level.disconnect();
          if (active === playing) active = undefined;
        };
      }
    } catch (_) {}
  }

  return { play };
}
