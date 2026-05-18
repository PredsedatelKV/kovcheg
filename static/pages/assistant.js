import { get, post, iconHtml } from "/static/api.js";

const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function openAssistantChat() {
  const messages = [];

  const renderMessages = (container) => {
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
          <div class="chat-status">Всегда на связи</div>
        </div>
        <button class="close" onclick="closeModal()">×</button>
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

  const sendMessage = async () => {
    const text = input.value.trim();
    if (!text) return;

    messages.push({ role: "user", text });
    renderMessages(msgContainer);
    input.value = "";
    sendBtn.disabled = true;

    // Индикатор "печатает"
    const typingEl = document.createElement("div");
    typingEl.className = "chat-typing";
    typingEl.textContent = "Мошонка печатает...";
    msgContainer.appendChild(typingEl);
    msgContainer.scrollTop = msgContainer.scrollHeight;

    try {
      const result = await post("/api/assistant/ask", { question: text });
      typingEl.remove();
      messages.push({ role: "bot", text: result.answer });
      renderMessages(msgContainer);
    } catch (e) {
      typingEl.remove();
      messages.push({ role: "bot", text: "⚠️ " + e.message });
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
