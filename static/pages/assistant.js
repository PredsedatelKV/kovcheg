import { get, post } from "/static/api.js";

const STORAGE_KEY = "kovcheg.assistant.chat";

const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function saveHistory(messages) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
}

export function openAssistantChat() {
  const messages = loadHistory();

  const renderMessages = (container) => {
    if (!messages.length) {
      container.innerHTML = `
        <div class="chat-empty">
          <img src="/static/img/villager.svg" alt="Мошонка" class="chat-empty-avatar"/>
          <p>Привет, путник! Я Мошонка — житель Ковчега.<br>Живу в канаве у стены, охраняю тыквенную грядку.<br>Спроси что-нибудь про общину!</p>
        </div>
      `;
      return;
    }
    container.innerHTML = messages
      .map(
        (m) => `
      <div class="chat-message ${m.role}">
        <div class="chat-bubble">${escapeHtml(m.text)}</div>
      </div>
    `
      )
      .join("");
    container.scrollTop = container.scrollHeight;
  };

  const modal = window.kov.showModal(`
    <div class="chat-modal">
      <div class="chat-header">
        <div class="chat-avatar"><img src="/static/img/villager.svg" alt="Мошонка"/></div>
        <div>
          <div class="chat-name">Ассистент Мошонка</div>
          <div class="chat-status">Житель канавы у стены</div>
        </div>
        <div class="chat-actions">
          <button class="chat-clear" id="chat-clear" title="Очистить чат">🗑</button>
          <button class="close" onclick="closeModal()">×</button>
        </div>
      </div>
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input-row">
        <input type="text" class="input" id="chat-input" placeholder="Спроси про Ковчег..." autocomplete="off"/>
        <button class="btn btn-sm" id="chat-send">➤</button>
      </div>
    </div>
  `);

  const msgContainer = modal.querySelector("#chat-messages");
  const input = modal.querySelector("#chat-input");
  const sendBtn = modal.querySelector("#chat-send");
  const clearBtn = modal.querySelector("#chat-clear");

  renderMessages(msgContainer);

  // Очистка чата
  clearBtn.addEventListener("click", () => {
    if (confirm("Мошонка забудет всю нашу беседу. Точно очистить?")) {
      messages.length = 0;
      saveHistory(messages);
      renderMessages(msgContainer);
      input.focus();
    }
  });

  const sendMessage = async () => {
    const text = input.value.trim();
    if (!text) return;

    messages.push({ role: "user", text });
    saveHistory(messages);
    renderMessages(msgContainer);
    input.value = "";
    sendBtn.disabled = true;

    // Индикатор "печатает"
    const typingEl = document.createElement("div");
    typingEl.className = "chat-typing";
    typingEl.textContent = "Мошонка думает...";
    msgContainer.appendChild(typingEl);
    msgContainer.scrollTop = msgContainer.scrollHeight;

    try {
      const result = await post("/api/assistant/ask", {
        question: text,
        history: messages.slice(0, -1), // без текущего вопроса, он уже в messages
      });
      typingEl.remove();
      messages.push({ role: "bot", text: result.answer });
      saveHistory(messages);
      renderMessages(msgContainer);
    } catch (e) {
      typingEl.remove();
      messages.push({ role: "bot", text: "⚠️ " + e.message });
      saveHistory(messages);
      renderMessages(msgContainer);
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  };

  sendBtn.addEventListener("click", sendMessage);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });

  input.focus();
}
