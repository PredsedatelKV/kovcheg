import { get } from "./api.js";
import { initTelegramWindow, useTelegramLegacySheet } from "./telegram-window.js";

initTelegramWindow();
let selected = false;

async function activateVersion(edition) {
  if (selected) return;
  selected = true;
  document.querySelectorAll("[data-edition]").forEach((button) => { button.disabled = true; });
  const classic = edition === "classic";
  try {
    const path = classic ? "/static/releases/classic-2540455/index.html" : new URL("./current-shell-pig2.html", import.meta.url).pathname;
    const response = await fetch(path);
    if (!response.ok) throw Error("Shell unavailable");
    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    doc.querySelectorAll("script").forEach((script) => script.remove());
    document.getElementById("version-picker-style")?.remove();
    document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => link.remove());
    for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) document.head.appendChild(link);
    document.documentElement.className = doc.documentElement.className;
    document.body.innerHTML = doc.body.innerHTML;
    if (classic) {
      useTelegramLegacySheet();
      const script = document.createElement("script");
      script.type = "module";
      script.src = "/static/releases/classic-2540455/app.js";
      document.body.appendChild(script);
    } else await import("./app.js");
  } catch (error) {
    selected = false;
    document.body.innerHTML = '<main class="version-picker"><h1>Не удалось открыть версию</h1><button onclick="location.reload()">Повторить вход</button></main>';
    console.error(error);
  }
}

try {
  const profile = await get("/api/profile/me", { force: true });
  if (profile.user?.telegram_id === 849162365 && profile.user.is_admin) {
    const style = document.createElement("style");
    style.id = "version-picker-style";
    style.textContent = `
      .version-picker{box-sizing:border-box;min-height:var(--kov-height,100dvh);display:flex;flex-direction:column;justify-content:center;width:min(100%,480px);padding:max(14px,var(--kov-safe-top,0px)) max(20px,var(--kov-safe-right,0px)) max(14px,var(--kov-safe-bottom,0px)) max(20px,var(--kov-safe-left,0px));margin:auto;gap:14px;color:#18334f;}
      .version-picker h1{margin:0 0 8px;font-size:30px;letter-spacing:-.04em;}
      .version-picker p{margin:0 0 12px;color:#526a82;line-height:1.5;}
      .version-choice{display:grid;gap:6px;padding:22px;border:1px solid #bfd5e9;border-radius:20px;background:#ffffffa6;text-align:left;color:inherit;font:inherit;box-shadow:0 8px 25px #42628210;cursor:pointer;}
      .version-choice strong{font-size:19px;}.version-choice span{font-size:13px;color:#526a82;}.version-choice:focus-visible{outline:3px solid #417fca;outline-offset:4px;}
      .version-choice:disabled{opacity:.5;}.version-choice:last-child{border-color:#73a8d1;background:#e9f5ffb8;}
    `;
    document.head.appendChild(style);
    document.body.innerHTML = `
      <main class="version-picker">
        <h1>Выберите версию</h1><p>Личный вход администратора</p>
        <button type="button" class="version-choice" data-edition="classic"><strong>До обновления</strong><span>Интерфейс до зимнего редизайна</span></button>
        <button type="button" class="version-choice" data-edition="current"><strong>Актуальная версия</strong><span>Зимний интерфейс, ёлочка и новый пропуск</span></button>
      </main>`;
    document.querySelectorAll("[data-edition]").forEach((button) => {
      button.addEventListener("click", () => activateVersion(button.dataset.edition));
    });
  } else await activateVersion("current");
} catch (_) { await activateVersion("current"); }
