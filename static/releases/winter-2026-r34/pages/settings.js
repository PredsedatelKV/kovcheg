import { MusicSceneManager } from "../music-scene.js";
import { musicSource, readAudioBytes } from "../startup-assets.js";
const MUSIC_GAIN = .22;
const UI_GAIN = .45;
const SETTINGS_KEY = "kovcheg.settings";

const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const DEFAULT_SETTINGS = {
  darkMode: true,
  reduceMotion: false,
  glassEnabled: true,
  musicTrack: "new-year",
  musicVolume: 0.5,
  musicPaused: false,
  uiSounds: true,
  uiSoundsVolume: 0.3,
  audioSettingsVersion: 4,
  holidayDecor: true,
};

let audio = window.__kovchegBackgroundAudio || null;
let audioCtx = window.__kovchegAudioContext || null;
let audioUnlockInstalled = false;
let settingsInitialized = false;
let cancelPendingMusicSeek = null;
const managedMedia = new WeakMap();

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = window.__kovchegAudioContext || new (window.AudioContext || window.webkitAudioContext)();
    window.__kovchegAudioContext = audioCtx;
  }
  return audioCtx;
}

// iOS Safari и Telegram WebView игнорируют HTMLMediaElement.volume.
// Пропускаем музыку и записанные эффекты через Web Audio GainNode.
export function setManagedMediaVolume(media, volume, fade = 0) {
  const value = Math.max(0, Math.min(1, Number(volume) || 0));
  media.dataset.volume = String(value);
  try {
    const ctx = getAudioCtx();
    let managed = managedMedia.get(media) || media.__kovchegManagedMedia;
    if (!managed) {
      const source = ctx.createMediaElementSource(media);
      const gain = ctx.createGain();
      source.connect(gain);
      gain.connect(ctx.destination);
      managed = { gain };
      managedMedia.set(media, managed);
      media.__kovchegManagedMedia = managed;
    }
    if (managed.volume !== value) {
      const parameter = managed.gain.gain;
      parameter.cancelScheduledValues(ctx.currentTime);
      if (fade && managed.volume !== undefined) parameter.setTargetAtTime(value, ctx.currentTime, fade / 4);
      else parameter.setValueAtTime(value, ctx.currentTime);
      managed.volume = value;
    }
    media.volume = 1;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  } catch (_) {
    try { media.volume = value; } catch (_) {}
  }
}

async function resumeManagedAudio() {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") await ctx.resume();
    return ctx.state === "running";
  } catch (_) {
    return false;
  }
}

function waitUntilMediaReady(media) {
  if (media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      media.removeEventListener("loadeddata", done);
      media.removeEventListener("canplay", done);
      media.removeEventListener("error", done);
      resolve();
    };
    media.addEventListener("loadeddata", done, { once: true });
    media.addEventListener("canplay", done, { once: true });
    media.addEventListener("error", done, { once: true });
    try { media.load(); } catch (_) {}
    setTimeout(done, 1500);
  });
}

export async function playManagedMedia(media, volume, restart = true) {
  setManagedMediaVolume(media, volume);
  await Promise.all([resumeManagedAudio(), waitUntilMediaReady(media)]);
  if (restart) {
    media.pause();
    try { media.currentTime = 0; } catch (_) {}
  }
  try {
    await media.play();
    return true;
  } catch (_) {
    return false;
  }
}

function getSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    const settings = { ...DEFAULT_SETTINGS, ...stored };
    delete settings.winterBackground;
    if (stored.audioSettingsVersion !== 4) {
      settings.audioSettingsVersion = 4;
      settings.musicTrack = "new-year";
      settings.musicPaused = stored.musicTrack ? Boolean(stored.musicPaused) : false;
      settings.uiSoundsVolume = stored.uiSoundsVolume !== undefined && stored.uiSoundsVolume !== 0.5
        ? stored.uiSoundsVolume : 0.3;
      settings.holidayDecor = stored.holidayDecor ?? !stored.reduceMotion;
      delete settings.customTrackUrl;
      delete settings.customTrackName;
      saveSettings(settings);
    }
    return settings;
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch (e) {
    // QuotaExceededError: кастомный трек (data-URL до ~10МБ) не влезает в localStorage.
    // Не падаем — пробуем сохранить настройки без тяжёлого трека, чтобы остальное не потерялось.
    try {
      const lite = { ...s, customTrackUrl: null };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(lite));
      if (window.kov && window.kov.toast) {
        window.kov.toast("Недостаточно места: мелодия не сохранена, остальные настройки сохранены");
      }
    } catch (_) {
      // Даже урезанные настройки не влезли — молча игнорируем, чтобы не ронять UI.
    }
  }
}

const TRACKS = [
  { id: "new-year", name: "Новогодняя музыка", url: new URL("../media/new-year.mp3", import.meta.url).href },
];

function stopMusic() {
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    try { audio.load(); } catch (_) {}
  }
  // Clean up old resume listeners to prevent multiple tracks
  document.removeEventListener("pointerdown", resumePlay);
  document.removeEventListener("touchstart", resumePlay);
}

function resumePlay() {
  if (musicScenes.sync()) return;
  const settings = getSettings();
  if (settings.musicPaused || !audio?.src) return;
  resumeManagedAudio();
  audio.play().catch(() => {});
}

function initAudio(src, loop, volume, fade = 0) {
  if (!audio) {
    audio = new Audio();
    window.__kovchegBackgroundAudio = audio;
  }
  if (!audio.isConnected) {
    audio.id = "kovcheg-background-audio"; audio.hidden = true;
    audio.setAttribute("aria-hidden", "true");
    document.body.appendChild(audio);
  }
  if (!audio.__kovMusicHooks) {
    audio.__kovMusicHooks = true;
    for (const event of ["playing","pause","ended","error","waiting"]) {
      audio.addEventListener(event, () => { audio.dataset.state = event; });
    }
  }
  const track = new URL(src, location.href).href;
  const prepared = musicSource(track);
  const changed = audio.src !== prepared;
  audio.dataset.musicTrack = track;
  if (changed) {
    if (cancelPendingMusicSeek) cancelPendingMusicSeek();
    audio.pause(); audio.src = prepared;
  }
  audio.loop = loop;
  audio.preload = "auto";
  setManagedMediaVolume(audio, volume * MUSIC_GAIN, changed ? 0 : fade);
  if (audio.paused) audio.play().catch(() => {});
}

function playMusic(trackId, volume) {
  if (musicScenes.sync()) return;
  const track = TRACKS.find((t) => t.id === trackId);
  if (!track) return;
  initAudio(track.url, true, volume);
}

function seekMusic(src, time) {
  if (!audio || audio.src !== musicSource(src)) return;
  const target = audio.src;
  const apply = () => {
    if (!audio || audio.src !== target) return;
    try { audio.currentTime = Math.max(0, Number(time) || 0); } catch (_) {}
    cleanup();
  };
  const cleanup = () => {
    audio?.removeEventListener("loadedmetadata", apply);
    audio?.removeEventListener("error", cleanup);
    if (cancelPendingMusicSeek === cleanup) cancelPendingMusicSeek = null;
  };
  if (cancelPendingMusicSeek) cancelPendingMusicSeek();
  if (audio.readyState >= 1) apply();
  else {
    cancelPendingMusicSeek = cleanup;
    audio.addEventListener("loadedmetadata", apply, { once:true });
    audio.addEventListener("error", cleanup, { once:true });
  }
}

const musicScenes = new MusicSceneManager({
  preferences: getSettings,
  hidden: () => document.hidden,
  capture: () => ({src:audio?.dataset.musicTrack || "",time:audio?.currentTime || 0}),
  play: (src,volume,fade) => initAudio(src,true,volume,fade),
  pause: () => audio?.pause(),
  seek: seekMusic,
  restore: (snapshot) => {
    const preferences=getSettings();
    if(preferences.musicPaused){stopMusic();return;}
    const track=TRACKS.find(track=>track.id==="new-year");
    if(!track)return;
    initAudio(track.url,true,preferences.musicVolume);
    if(snapshot?.src===new URL(track.url,location.href).href)seekMusic(track.url,snapshot.time);
  },
});

export function useGameMusic(src) { return musicScenes.acquire(new URL(src,location.href).href,true); }
export function setMusicEnabled(enabled) {
  const preferences=getSettings();
  preferences.musicPaused=!enabled;preferences.musicTrack="new-year";saveSettings(preferences);
  if(musicScenes.sync())return;
  if(preferences.musicPaused)stopMusic();
  else playMusic("new-year",preferences.musicVolume);
}

const uiBuffers = new Map();
function loadUISounds() {
  for (const name of ["tap", "confirm", "soft"]) {
    if (uiBuffers.has(name)) continue;
    const pending = readAudioBytes(new URL("../media/" + name + ".wav", import.meta.url))
      .then((data) => getAudioCtx().decodeAudioData(data));
    uiBuffers.set(name, pending);
    pending.catch(() => uiBuffers.delete(name));
  }
}

export function prepareInterfaceSounds() {
  loadUISounds();
  return Promise.allSettled(uiBuffers.values());
}

function playUISound(type) {
  const settings = getSettings();
  if (!settings.uiSounds || !settings.uiSoundsVolume) return;
  const name = ["win", "cashout", "toast"].includes(type) ? "confirm"
    : ["lose", "mine", "spin"].includes(type) ? "soft" : "tap";
  loadUISounds();
  resumeManagedAudio();
  uiBuffers.get(name)?.then((buffer) => {
    const current = getSettings();
    if (!current.uiSounds) return;
    const ctx = getAudioCtx();
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = current.uiSoundsVolume * UI_GAIN;
    source.connect(gain).connect(ctx.destination);
    source.onended = () => { source.disconnect(); gain.disconnect(); };
    source.start();
  }).catch(() => {});
}

function applyAppearance({ darkMode: dark, glassEnabled }) {
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.classList.toggle("solid-surfaces", !glassEnabled);
  const backgroundColor = dark ? "#03041c" : "#fafafb";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", backgroundColor);
  const tg = window.Telegram?.WebApp;
  try {
    const headerColor = glassEnabled ? (dark ? "#101f40" : "#f2f9ff") : (dark ? "#1e2737" : "#ffffff");
    tg?.setHeaderColor?.(headerColor);
    tg?.setBackgroundColor?.(backgroundColor);
  } catch (_) { /* Older Telegram versions only accept named colors. */ }
}

export function startConfiguredMusic() {
  const settings = getSettings();
  if (!settings.musicPaused) playMusic("new-year", settings.musicVolume);
}

export function initSettings({startMusic = true} = {}) {
  const s = getSettings();
  applyAppearance(s);
  document.documentElement.classList.toggle("motion-lite", s.reduceMotion);
  document.documentElement.classList.toggle("holiday-off", !s.holidayDecor);
  if (settingsInitialized) {
    if (!musicScenes.sync() && audio) setManagedMediaVolume(audio, s.musicVolume * MUSIC_GAIN);
    return;
  }
  settingsInitialized = true;
  if (!audioUnlockInstalled) {
    audioUnlockInstalled = true;
    const unlock = () => { resumeManagedAudio(); resumePlay(); };
    document.addEventListener("pointerdown", unlock, { capture: true, passive: true });
    document.addEventListener("touchstart", unlock, { capture: true, passive: true });
    document.addEventListener("keydown", unlock, { capture: true });
  }
  document.addEventListener("visibilitychange", () => { musicScenes.sync(); });
  if (startMusic) startConfiguredMusic();
}

export function openSettings(options = {}) {
  let s = getSettings();
  const modal = window.kov.showModal(`
    <button type="button" class="close" aria-label="Назад" onclick="closeModal()">×</button>
    <h2>Настройки</h2>

    <div class="settings-section">
      <h3>Тема</h3>
      <div class="settings-toggle">
        <span>Светлая</span>
        <button class="toggle-switch ${s.darkMode ? "active" : ""}" id="theme-toggle" type="button" role="switch" aria-label="Тёмная тема" aria-checked="${s.darkMode}">
          <span class="toggle-knob"></span>
        </button>
        <span>Тёмная</span>
      </div>
      <label class="motion-preference appearance-glass-row">
        <span><strong>Ледяное стекло</strong><small>Прозрачность, блики и преломление</small></span>
        <input type="checkbox" role="switch" id="glass-toggle" ${s.glassEnabled ? "checked" : ""}>
      </label>
    </div>

    <div class="settings-section">
      <label class="motion-preference"><span><strong>Меньше движения</strong><small>Спокойные переходы</small></span>
        <input type="checkbox" id="motion-toggle" ${s.reduceMotion ? "checked" : ""}>
      </label>
    </div>

    <div class="settings-section">
      <label class="motion-preference"><span><strong>Новогоднее оформление</strong></span>
        <input type="checkbox" id="holiday-toggle" ${s.holidayDecor ? "checked" : ""}>
      </label>
    </div>

    <div class="settings-section">
      <h3>Фоновая музыка</h3>
      <div class="settings-track-list" id="track-list"></div>
      <div class="settings-volume">
        <span>Громкость музыки</span>
        <input type="range" id="volume-slider" min="0" max="100" value="${Math.round(s.musicVolume * 100)}"/>
        <span id="volume-value">${Math.round(s.musicVolume * 100)}%</span>
      </div>
    </div>

    <div class="settings-section">
      <h3>Звуки интерфейса</h3>
      <div class="settings-toggle">
        <span>Выкл</span>
        <button class="toggle-switch ${s.uiSounds ? "active" : ""}" id="sounds-toggle">
          <span class="toggle-knob"></span>
        </button>
        <span>Вкл</span>
      </div>
      <div class="settings-volume">
        <span>Громкость звуков</span>
        <input type="range" id="sounds-volume-slider" min="0" max="100" value="${Math.round(s.uiSoundsVolume * 100)}"/>
        <span id="sounds-volume-value">${Math.round(s.uiSoundsVolume * 100)}%</span>
      </div>
    </div>
  `, { ...options, sheet: true, label: "Настройки" });

  function renderTracks() {
    const current = getSettings();
    modal.querySelector("#track-list").innerHTML = `<label class="motion-preference">
      <span>Новогодняя музыка</span><input type="checkbox" id="music-enabled" ${!current.musicPaused ? "checked" : ""}>
    </label>`;
    modal.querySelector("#music-enabled").addEventListener("change", (event) => {
      setMusicEnabled(event.target.checked);
    });
  }

  const themeToggle = modal.querySelector("#theme-toggle");
  themeToggle.addEventListener("click", () => {
    s = getSettings();
    s.darkMode = !s.darkMode;
    themeToggle.classList.toggle("active", s.darkMode);
    themeToggle.setAttribute("aria-checked", String(s.darkMode));
    saveSettings(s);
    applyAppearance(s);
  });

  modal.querySelector("#motion-toggle").addEventListener("change", (event) => {
    const current = getSettings();
    current.reduceMotion = event.target.checked;
    saveSettings(current);
    document.documentElement.classList.toggle("motion-lite", current.reduceMotion);
  });

  modal.querySelector("#glass-toggle").addEventListener("change", (event) => {
    const current = getSettings();
    current.glassEnabled = event.target.checked;
    saveSettings(current);
    applyAppearance(current);
  });

  modal.querySelector("#holiday-toggle").addEventListener("change", (event) => {
    const current = getSettings();
    current.holidayDecor = event.target.checked;
    saveSettings(current);
    document.documentElement.classList.toggle("holiday-off", !current.holidayDecor);
  });

  var volSlider = modal.querySelector("#volume-slider");
  var volValue = modal.querySelector("#volume-value");
  function _setVolume(v) {
    s = getSettings();
    s.musicVolume = v;
    volValue.textContent = Math.round(v * 100) + "%";
    saveSettings(s);
    if (!musicScenes.sync() && audio) setManagedMediaVolume(audio, v * MUSIC_GAIN);
  }
  // Достаточно одного слушателя "input"; "change" дублировал бы _setVolume и лишние saveSettings.
  volSlider.addEventListener("input", function() {
    _setVolume(Number(this.value) / 100);
  });
  // Некоторые версии iOS WebView обновляют range только событием change.
  volSlider.addEventListener("change", function() {
    _setVolume(Number(this.value) / 100);
  });

  modal.querySelector("#sounds-toggle").addEventListener("click", () => {
    s = getSettings();
    s.uiSounds = !s.uiSounds;
    modal.querySelector("#sounds-toggle").classList.toggle("active", s.uiSounds);
    saveSettings(s);
    if (s.uiSounds) playUISound("click");
  });

  const soundsVolSlider = modal.querySelector("#sounds-volume-slider");
  const soundsVolValue = modal.querySelector("#sounds-volume-value");
  soundsVolSlider.addEventListener("input", () => {
    const vol = Number(soundsVolSlider.value) / 100;
    s = getSettings();
    s.uiSoundsVolume = vol;
    soundsVolValue.textContent = soundsVolSlider.value + "%";
    saveSettings(s);
  });

  renderTracks();
}

export { playUISound, getSettings, saveSettings, getAudioCtx, resumeManagedAudio, UI_GAIN };
