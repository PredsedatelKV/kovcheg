const SETTINGS_KEY = "kovcheg.settings";

const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const DEFAULT_SETTINGS = {
  darkMode: false,
  musicTrack: null,
  musicVolume: 0.3,
  musicPaused: false,
  customTrackUrl: null,
  customTrackName: null,
  uiSounds: false,
  uiSoundsVolume: 0.5,
};

let audio = null;
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function getSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

const TRACKS = [
  { id: "track1", name: "⚔️ Ковчег идёт на войну", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3" },
  { id: "track2", name: "🌾 Мошонка косит сено", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3" },
  { id: "track3", name: "🍺 Пьяный крипер в таверне", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-12.mp3" },
];

function stopMusic() {
  if (audio) {
    audio.pause();
    audio.src = "";
    audio = null;
  }
}

function initAudio(src, loop, volume) {
  stopMusic();
  audio = new Audio();
  audio.src = src;
  audio.loop = loop;
  audio.volume = volume;
  const play = () => audio.play().catch(() => {});
  play();
  if (audio.paused) {
    const resume = () => {
      audio.play().catch(() => {});
      document.removeEventListener("pointerdown", resume);
      document.removeEventListener("touchstart", resume);
    };
    document.addEventListener("pointerdown", resume, { once: true });
    document.addEventListener("touchstart", resume, { once: true });
  }
}

function playMusic(trackId, volume) {
  const track = TRACKS.find((t) => t.id === trackId);
  if (!track) return;
  initAudio(track.url, true, volume);
}

function playCustomMusic(url, volume) {
  if (!url) return;
  initAudio(url, true, volume);
}

function togglePause() {
  if (!audio) return;
  if (audio.paused) {
    audio.play().catch(() => {});
  } else {
    audio.pause();
  }
}

function isCurrentlyPlaying() {
  return audio && !audio.paused;
}

function getActiveTrack(s) {
  if (!audio || !audio.src || audio.src === "") return null;
  if (s.customTrackUrl && audio.src === s.customTrackUrl) {
    return { type: "custom", id: "custom", name: s.customTrackName || "Моя мелодия" };
  }
  for (const t of TRACKS) {
    if (audio.src === t.url || audio.src.indexOf(t.url) !== -1) {
      return { type: "builtin", id: t.id, name: t.name };
    }
  }
  return null;
}

function playUISound(type) {
  const s = getSettings();
  if (!s.uiSounds) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = s.uiSoundsVolume * 0.3;
    const now = ctx.currentTime;
    switch (type) {
      case "click":
        osc.frequency.value = 800;
        osc.type = "sine";
        gain.gain.setValueAtTime(s.uiSoundsVolume * 0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
        break;
      case "win":
        osc.frequency.value = 523;
        osc.type = "sine";
        gain.gain.setValueAtTime(s.uiSoundsVolume * 0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.frequency.value = 659;
        osc2.type = "sine";
        gain2.gain.setValueAtTime(s.uiSoundsVolume * 0.3, now + 0.1);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc2.start(now + 0.1);
        osc2.stop(now + 0.3);
        const osc3 = ctx.createOscillator();
        const gain3 = ctx.createGain();
        osc3.connect(gain3);
        gain3.connect(ctx.destination);
        osc3.frequency.value = 784;
        osc3.type = "sine";
        gain3.gain.setValueAtTime(s.uiSoundsVolume * 0.3, now + 0.2);
        gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc3.start(now + 0.2);
        osc3.stop(now + 0.45);
        break;
      case "lose":
        osc.frequency.value = 300;
        osc.type = "sawtooth";
        gain.gain.setValueAtTime(s.uiSoundsVolume * 0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
        break;
      case "spin":
        osc.frequency.value = 400;
        osc.type = "triangle";
        gain.gain.setValueAtTime(s.uiSoundsVolume * 0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
        break;
      case "cashout":
        osc.frequency.value = 600;
        osc.type = "sine";
        gain.gain.setValueAtTime(s.uiSoundsVolume * 0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
        break;
      case "flag":
        osc.frequency.value = 1000;
        osc.type = "square";
        gain.gain.setValueAtTime(s.uiSoundsVolume * 0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc.start(now);
        osc.stop(now + 0.06);
        break;
      case "mine":
        osc.frequency.value = 100;
        osc.type = "sawtooth";
        gain.gain.setValueAtTime(s.uiSoundsVolume * 0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.start(now);
        osc.stop(now + 0.5);
        break;
      case "reveal":
        osc.frequency.value = 600;
        osc.type = "sine";
        gain.gain.setValueAtTime(s.uiSoundsVolume * 0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.05);
        break;
      case "bet":
        osc.frequency.value = 500;
        osc.type = "triangle";
        gain.gain.setValueAtTime(s.uiSoundsVolume * 0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
        break;
      case "toast":
        osc.frequency.value = 700;
        osc.type = "sine";
        gain.gain.setValueAtTime(s.uiSoundsVolume * 0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
        break;
      default:
        osc.frequency.value = 500;
        osc.type = "sine";
        gain.gain.setValueAtTime(s.uiSoundsVolume * 0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
    }
  } catch (_) {}
}

function applyTheme(dark) {
  document.documentElement.classList.toggle("dark", dark);
}

export function initSettings() {
  const s = getSettings();
  applyTheme(s.darkMode);
  if (s.musicPaused) return;
  if (s.customTrackUrl) {
    playCustomMusic(s.customTrackUrl, s.musicVolume);
  } else if (s.musicTrack) {
    playMusic(s.musicTrack, s.musicVolume);
  }
}

export function openSettings() {
  const s = getSettings();
  const active = getActiveTrack(s);
  const playing = isCurrentlyPlaying();

  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Настройки</h2>

    <div class="settings-section">
      <h3>Тема</h3>
      <div class="settings-toggle">
        <span>Светлая</span>
        <button class="toggle-switch ${s.darkMode ? "active" : ""}" id="theme-toggle">
          <span class="toggle-knob"></span>
        </button>
        <span>Тёмная</span>
      </div>
    </div>

    <div class="settings-section">
      <h3>Музыка</h3>
      <div class="settings-track-list" id="track-list"></div>
      ${s.customTrackUrl ? `
        <div class="settings-custom-track-info">
          <div class="settings-track-name">${escapeHtml(s.customTrackName || "Моя мелодия")}</div>
          <button class="btn btn-sm btn-danger" id="remove-audio-btn">Удалить мелодию</button>
        </div>
      ` : `
        <div class="settings-upload-row">
          <input type="file" accept="audio/*" id="custom-audio-input" style="display:none"/>
          <button class="btn btn-sm btn-secondary" id="upload-audio-btn">Загрузить свою мелодию</button>
        </div>
      `}
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
  `);

  function renderTracks() {
    const cur = getSettings();
    const curActive = getActiveTrack(cur);
    const curPlaying = isCurrentlyPlaying();
    const list = modal.querySelector("#track-list");
    if (!list) return;

    let html = "";
    for (const t of TRACKS) {
      const isActive = curActive && curActive.id === t.id;
      const icon = isActive ? (curPlaying ? "⏸" : "▶") : "";
      html += `<button class="settings-track ${isActive ? "active" : ""}" data-track="${t.id}">${t.name} ${icon}</button>`;
    }
    if (cur.customTrackUrl) {
      const isCustom = curActive && curActive.type === "custom";
      const icon = isCustom ? (curPlaying ? "⏸" : "▶") : "";
      html += `<button class="settings-track ${isCustom ? "active" : ""}" data-track="custom">${escapeHtml(cur.customTrackName || "Моя мелодия")} ${icon}</button>`;
    }
    html += `<button class="settings-track ${!curActive ? "active" : ""}" data-track="">Без музыки</button>`;
    list.innerHTML = html;

    list.querySelectorAll(".settings-track").forEach((btn) => {
      btn.addEventListener("click", () => {
        const st = getSettings();
        const stActive = getActiveTrack(st);
        const tid = btn.dataset.track;

        if (tid === "custom") {
          if (!st.customTrackUrl) {
            window.kov.toast("Сначала загрузите мелодию");
            return;
          }
          if (stActive && stActive.type === "custom") {
            togglePause();
            st.musicPaused = !isCurrentlyPlaying();
            saveSettings(st);
            renderTracks();
            return;
          }
          st.musicTrack = null;
          st.musicPaused = false;
          saveSettings(st);
          playCustomMusic(st.customTrackUrl, st.musicVolume);
          renderTracks();
          return;
        }

        if (tid) {
          if (stActive && stActive.id === tid) {
            togglePause();
            st.musicPaused = !isCurrentlyPlaying();
            saveSettings(st);
            renderTracks();
            return;
          }
          st.musicTrack = tid;
          st.musicPaused = false;
          saveSettings(st);
          playMusic(tid, st.musicVolume);
          renderTracks();
          return;
        }

        st.musicTrack = null;
        st.musicPaused = true;
        saveSettings(st);
        stopMusic();
        renderTracks();
      });
    });
  }

  modal.querySelector("#theme-toggle").addEventListener("click", () => {
    s.darkMode = !s.darkMode;
    modal.querySelector("#theme-toggle").classList.toggle("active", s.darkMode);
    saveSettings(s);
    applyTheme(s.darkMode);
  });

  const uploadBtn = modal.querySelector("#upload-audio-btn");
  if (uploadBtn) {
    uploadBtn.addEventListener("click", () => {
      modal.querySelector("#custom-audio-input").click();
    });
  }

  const customInput = modal.querySelector("#custom-audio-input");
  if (customInput) {
    customInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        return window.kov.toast("Файл слишком большой (макс. 10 МБ)");
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const url = ev.target.result;
        s.customTrackUrl = url;
        s.customTrackName = file.name.replace(/\.[^.]+$/, "");
        s.musicTrack = null;
        saveSettings(s);
        playCustomMusic(url, s.musicVolume);
        window.kov.toast("Мелодия загружена");
        closeModal();
        setTimeout(() => openSettings(), 100);
      };
      reader.readAsDataURL(file);
    });
  }

  const removeBtn = modal.querySelector("#remove-audio-btn");
  if (removeBtn) {
    removeBtn.addEventListener("click", () => {
      s.customTrackUrl = null;
      s.customTrackName = null;
      saveSettings(s);
      stopMusic();
      window.kov.toast("Мелодия удалена");
      closeModal();
      setTimeout(() => openSettings(), 100);
    });
  }

  const volSlider = modal.querySelector("#volume-slider");
  const volValue = modal.querySelector("#volume-value");
  volSlider.addEventListener("input", () => {
    const vol = Number(volSlider.value) / 100;
    s.musicVolume = vol;
    volValue.textContent = volSlider.value + "%";
    saveSettings(s);
    if (audio) audio.volume = vol;
  });

  modal.querySelector("#sounds-toggle").addEventListener("click", () => {
    s.uiSounds = !s.uiSounds;
    modal.querySelector("#sounds-toggle").classList.toggle("active", s.uiSounds);
    saveSettings(s);
    if (s.uiSounds) playUISound("click");
  });

  const soundsVolSlider = modal.querySelector("#sounds-volume-slider");
  const soundsVolValue = modal.querySelector("#sounds-volume-value");
  soundsVolSlider.addEventListener("input", () => {
    const vol = Number(soundsVolSlider.value) / 100;
    s.uiSoundsVolume = vol;
    soundsVolValue.textContent = soundsVolSlider.value + "%";
    saveSettings(s);
  });

  renderTracks();
}

export { playUISound, getSettings, saveSettings };
