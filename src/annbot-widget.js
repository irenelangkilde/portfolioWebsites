(function () {
  const AVATAR   = "/assets/images/RaggedyAnn_robot_clearbelly_noMedusahair.png";
  const LABEL    = "I’d love feedback! Tell me what you think, or ask me for help.";
  const API_URL  = "/.netlify/functions/annbot";
  const GREETING = "Hi! 👋 I’m Annbot. What do you think so far? Any feedback or questions about Irene’s Webworks?";

  const CSS = `
    #annbot-wrap {
      position: fixed; bottom: 24px; left: 24px; z-index: 9999;
      display: flex; flex-direction: column; align-items: flex-start; gap: 10px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    #annbot-bubble {
      background: #fff; color: #1a1a2e;
      border-radius: 16px 16px 16px 4px;
      padding: 11px 15px; max-width: 220px;
      font-size: 13px; line-height: 1.5;
      box-shadow: 0 4px 20px rgba(0,0,0,.13);
      border: 1px solid rgba(232,49,90,.2);
      cursor: pointer;
      transition: opacity .3s, transform .3s;
    }
    #annbot-bubble.ab-hidden { opacity: 0; pointer-events: none; transform: translateY(6px); }
    #annbot-fab {
      width: 64px; height: 64px; border-radius: 50%;
      border: 3px solid #1a8cff; padding: 0; cursor: pointer;
      background: #fff; overflow: hidden;
      box-shadow: 0 4px 22px rgba(26,140,255,.35);
      transition: transform .2s, box-shadow .2s;
      flex-shrink: 0;
    }
    #annbot-fab:hover { transform: scale(1.08); box-shadow: 0 6px 30px rgba(26,140,255,.45); }
    #annbot-fab img { width: 100%; height: 100%; object-fit: cover; object-position: top center; display: block; }
    #annbot-panel {
      position: fixed; bottom: 104px; left: 24px;
      width: 360px; max-height: 520px;
      background: #fff; border-radius: 20px;
      box-shadow: 0 8px 40px rgba(0,0,0,.17);
      display: flex; flex-direction: column; overflow: hidden;
      z-index: 9999; border: 1px solid rgba(232,49,90,.13);
      transition: opacity .25s, transform .25s;
    }
    #annbot-panel.ab-hidden { opacity: 0; pointer-events: none; transform: translateY(12px) scale(.97); }
    #annbot-header {
      background: linear-gradient(135deg, #e8315a 0%, #c41f45 100%);
      padding: 14px 16px; display: flex; align-items: center; gap: 10px; flex-shrink: 0;
    }
    #annbot-header img {
      width: 40px; height: 40px; border-radius: 50%;
      border: 2px solid rgba(255,255,255,.45);
      object-fit: cover; object-position: top center; background: #fff;
    }
    #annbot-htext { flex: 1; }
    #annbot-hname { color: #fff; font-weight: 700; font-size: 15px; line-height: 1.2; }
    #annbot-hstatus { color: rgba(255,255,255,.75); font-size: 11.5px; }
    #annbot-close {
      background: none; border: none; color: rgba(255,255,255,.75);
      font-size: 22px; line-height: 1; cursor: pointer; padding: 2px 4px;
    }
    #annbot-close:hover { color: #fff; }
    #annbot-messages {
      flex: 1; overflow-y: auto; padding: 16px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .ab-msg {
      max-width: 86%; padding: 10px 14px; font-size: 13.5px;
      line-height: 1.5; word-break: break-word;
    }
    .ab-msg.ab-bot {
      background: #f5f5f7; color: #1a1a2e;
      border-radius: 4px 16px 16px 16px; align-self: flex-start;
    }
    .ab-msg.ab-user {
      background: #e8315a; color: #fff;
      border-radius: 16px 16px 4px 16px; align-self: flex-end;
    }
    .ab-msg.ab-thinking {
      background: #f5f5f7; color: #aaa; font-style: italic;
      border-radius: 4px 16px 16px 16px; align-self: flex-start;
    }
    #annbot-input-area {
      padding: 12px; border-top: 1px solid #f0f0f0;
      display: flex; gap: 8px; align-items: flex-end; flex-shrink: 0;
    }
    #annbot-input {
      flex: 1; border: 1px solid #e0e0e0; border-radius: 12px;
      padding: 10px 12px; font-size: 13.5px; resize: none;
      outline: none; font-family: inherit; line-height: 1.4;
      max-height: 100px; min-height: 40px; box-sizing: border-box;
      color: #1a1a2e; background: #ffffff;
    }
    #annbot-input:focus { border-color: #e8315a; }
    #annbot-send {
      background: #e8315a; color: #fff; border: none; border-radius: 12px;
      width: 40px; height: 40px; cursor: pointer; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      transition: background .15s;
    }
    #annbot-send:hover { background: #c41f45; }
    #annbot-send:disabled { background: #ccc; cursor: default; }
    #annbot-send svg { width: 17px; height: 17px; }
    @media (max-width: 400px) {
      #annbot-panel { width: calc(100vw - 32px); left: 16px; bottom: 96px; }
      #annbot-wrap  { left: 16px; bottom: 16px; }
    }
  `;

  const HTML = `
    <div id="annbot-wrap">
      <div id="annbot-bubble">${LABEL}</div>
      <button id="annbot-fab" aria-label="Chat with Annbot">
        <img src="${AVATAR}" alt="Annbot">
      </button>
    </div>
    <div id="annbot-panel" class="ab-hidden" role="dialog" aria-label="Annbot chat">
      <div id="annbot-header">
        <img src="${AVATAR}" alt="">
        <div id="annbot-htext">
          <div id="annbot-hname">Annbot</div>
          <div id="annbot-hstatus">Here to help ✨</div>
        </div>
        <button id="annbot-close" aria-label="Close chat">×</button>
      </div>
      <div id="annbot-messages"></div>
      <div id="annbot-input-area">
        <textarea id="annbot-input" placeholder="Type a message…" rows="1" aria-label="Message"></textarea>
        <button id="annbot-send" aria-label="Send">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>
  `;

  const SESSION_ID = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

  function init() {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    document.body.insertAdjacentHTML("beforeend", HTML);

    const fab      = document.getElementById("annbot-fab");
    const bubble   = document.getElementById("annbot-bubble");
    const panel    = document.getElementById("annbot-panel");
    const closeBtn = document.getElementById("annbot-close");
    const input    = document.getElementById("annbot-input");
    const sendBtn  = document.getElementById("annbot-send");
    const msgArea  = document.getElementById("annbot-messages");

    let history   = [];
    let isOpen    = false;
    let bubbleTimer;

    function hideBubble() { bubble.classList.add("ab-hidden"); }
    function showBubble() { bubble.classList.remove("ab-hidden"); }

    bubbleTimer = setTimeout(hideBubble, 6000);

    fab.addEventListener("mouseenter", () => { clearTimeout(bubbleTimer); showBubble(); });
    fab.addEventListener("mouseleave", () => { bubbleTimer = setTimeout(hideBubble, 2000); });

    function addMsg(text, type) {
      const el = document.createElement("div");
      el.className = "ab-msg " + type;
      el.textContent = text;
      msgArea.appendChild(el);
      msgArea.scrollTop = msgArea.scrollHeight;
      return el;
    }

    function openPanel() {
      isOpen = true;
      panel.classList.remove("ab-hidden");
      hideBubble();
      clearTimeout(bubbleTimer);
      if (history.length === 0) addMsg(GREETING, "ab-bot");
      setTimeout(() => input.focus(), 120);
    }

    function closePanel() {
      isOpen = false;
      panel.classList.add("ab-hidden");
    }

    fab.addEventListener("click", () => isOpen ? closePanel() : openPanel());
    bubble.addEventListener("click", openPanel);
    closeBtn.addEventListener("click", closePanel);

    async function send() {
      const text = input.value.trim();
      if (!text || sendBtn.disabled) return;

      input.value = "";
      input.style.height = "auto";
      sendBtn.disabled = true;

      addMsg(text, "ab-user");
      history.push({ role: "user", content: text });
      window.umami?.track("annbot-message");

      const thinking = addMsg("Annbot is typing…", "ab-thinking");

      try {
        const res  = await fetch(API_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: history, sessionId: SESSION_ID, pageUrl: location.href })
        });
        const data = await res.json();
        const reply = data.reply || data.error || "Sorry, something went wrong.";
        thinking.remove();
        history.push({ role: "assistant", content: reply });
        addMsg(reply, "ab-bot");
      } catch {
        thinking.remove();
        addMsg("Sorry, I couldn’t connect. Please try again in a moment.", "ab-bot");
      }

      sendBtn.disabled = false;
      input.focus();
    }

    sendBtn.addEventListener("click", send);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 100) + "px";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
