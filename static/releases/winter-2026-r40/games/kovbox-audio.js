import { getAudioCtx, getSettings } from "../pages/settings.js";
import { readAudioBytes } from "../startup-assets.js";

export const KOVBOX_OPENING_MS = { quick: 640, legendary: 4200 };

const cueFiles = new Map([
  ["tap", "box-tap.wav"],
  [1, "star-1.wav"],
  [2, "star-2.wav"],
  [3, "star-3.wav"],
  ["quick", "quick-reveal.wav"],
  ["legendary", "grand-reveal.m4a"],
]);
const fallbackPitch = new Map([["tap", 605], [1, 630], [2, 803], [3, 1009], ["quick", 510], ["legendary", 465]]);
const buffers = new Map();
const loading = new Map();

export function prepareKovboxSounds() {
  const settings = getSettings();
  if (!settings.uiSounds || !settings.uiSoundsVolume) return;
  for (const [cue, file] of cueFiles) {
    if (buffers.has(cue) || loading.has(cue)) continue;
    const path = new URL("../media/kovbox-audio/" + file, import.meta.url);
    const pending = readAudioBytes(path)
      .then((bytes) => getAudioCtx().decodeAudioData(bytes))
      .then((buffer) => buffers.set(cue, buffer))
      .catch(() => {})
      .finally(() => loading.delete(cue));
    loading.set(cue, pending);
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

function fallbackCues(ctx, output, cue, onset, offset) {
  const playNote = (delay, pitch, length, volume) =>
    oscillatorCue(ctx, output, onset + delay, pitch, length, volume);
  const duration = KOVBOX_OPENING_MS[cue] / 1000;
  if (!duration) return [playNote(0, fallbackPitch.get(cue), .14, .39)];

  // Keep a timed flourish even when the recording hasn't finished decoding.
  const nodes = [];
  if (!offset) {
    nodes.push(playNote(0, fallbackPitch.get(cue), .16, .36));
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

export function createKovboxSound() {
  let active;

  function play(cue, offset = 0, tapStep = 0) {
    const settings = getSettings();
    if (!settings.uiSounds || !settings.uiSoundsVolume || document.hidden || !cueFiles.has(cue)) return;
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
      const cueLevel = typeof cue === "number" ? 1.72 : cue === "tap" ? .92 : 1.02;
      level.gain.value = Math.min(1, settings.uiSoundsVolume * cueLevel);
      level.connect(ctx.destination);
      const buffer = buffers.get(cue);
      let nodes;
      if (buffer) {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(level);
        source.start(onset, offset);
        nodes = [{ source }];
      } else {
        nodes = fallbackCues(ctx, level, cue, onset, offset);
      }
      if (tapStep > 0) {
        const pitch = fallbackPitch.get(Math.min(tapStep, 3)) * (tapStep > 3 ? 1.23 : 1);
        nodes.push(oscillatorCue(ctx, level, onset, pitch, .10, .57));
      }
      const playing = { level, nodes };
      active = playing;
      let remaining = nodes.length;
      for (const { source, envelope } of nodes) {
        source.onended = () => {
          source.disconnect();
          envelope?.disconnect();
          if (--remaining) return;
          level.disconnect();
          if (active === playing) active = undefined;
        };
      }
    } catch (_) {}
  }

  return { play };
}
