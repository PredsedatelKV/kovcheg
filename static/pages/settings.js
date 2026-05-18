const SETTINGS_KEY = "kovcheg.settings";

const DEFAULT_SETTINGS = {
  darkMode: false,
  musicTrack: null,
  musicVolume: 0.3,
};

let audio = null;

function getSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

const TRACKS = [
  { id: "track1", name: "🎵 Таверна Ковчега", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" },
  { id: "track2", name: "🎵 Поля тыкв", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3" },
  { id: "track3", name: "🎵 Вечер у стены", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3" },
];

function playMusic(trackId, volume) {
  stopMusic();
  const track = TRACKS.find((t) => t.id === trackId);
  if (!track) return;
  audio = new Audio(track.url);
  audio.loop = true;
  audio.volume = volume;
  audio.play().catch(() => {});
}

function stopMusic() {
  if (audio) {
    audio.pause();
    audio = null;
  }
}

function applyTheme(dark) {
  document.documentElement.classList.toggle("dark", dark);
}

export function initSettings() {
  const s = getSettings();
  applyTheme(s.darkMode);
  if (s.musicTrack) playMusic(s.musicTrack, s.musicVolume);
}

export function openSettings() {
  const s = getSettings();
  
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>⚙️ Настройки</h2>
    
    <div class="settings-section">
      <h3>🌙 Тема</h3>
      <div class="settings-toggle">
        <span>Светлая</span>
        <button class="toggle-switch ${s.darkMode ? "active" : ""}" id="theme-toggle">
          <span class="toggle-knob"></span>
        </button>
        <span>Тёмная</span>
      </div>
    </div>
    
    <div class="settings-section">
      <h3>🎵 Музыка</h3>
      <div class="settings-track-list">
        ${TRACKS.map((t) => `
          <button class="settings-track ${s.musicTrack === t.id ? "active" : ""}" data-track="${t.id}">
            ${t.name}
            ${s.musicTrack === t.id ? "▶️" : ""}
          </button>
        `).join("")}
        <button class="settings-track ${!s.musicTrack ? "active" : ""}" data-track="">
          🔇 Без музыки
        </button>
      </div>
      <div class="settings-volume">
        <span>Громкость</span>
        <input type="range" id="volume-slider" min="0" max="100" value="${Math.round(s.musicVolume * 100)}"/>
        <span id="volume-value">${Math.round(s.musicVolume * 100)}%</span>
      </div>
    </div>
  `);

  // Theme toggle
  const themeToggle = modal.querySelector("#theme-toggle");
  themeToggle.addEventListener("click", () => {
    s.darkMode = !s.darkMode;
    themeToggle.classList.toggle("active", s.darkMode);
    saveSettings(s);
    applyTheme(s.darkMode);
  });

  // Track selection
  modal.querySelectorAll(".settings-track").forEach((btn) => {
    btn.addEventListener("click", () => {
      const trackId = btn.dataset.track;
      s.musicTrack = trackId || null;
      saveSettings(s);
      modal.querySelectorAll(".settings-track").forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.textContent = b.textContent.replace(" ▶️", "");
      });
      if (trackId) {
        btn.textContent += " ▶️";
        playMusic(trackId, s.musicVolume);
      } else {
        stopMusic();
      }
    });
  });

  // Volume
  const volSlider = modal.querySelector("#volume-slider");
  const volValue = modal.querySelector("#volume-value");
  volSlider.addEventListener("input", () => {
    const vol = Number(volSlider.value) / 100;
    s.musicVolume = vol;
    volValue.textContent = volSlider.value + "%";
    saveSettings(s);
    if (audio) audio.volume = vol;
  });
}
