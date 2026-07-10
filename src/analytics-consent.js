/**
 * analytics-consent.js
 *
 * Two responsibilities:
 *   1. Event mirror — forwards every `data-umami-event` click to Google Analytics
 *      (gtag) alongside its existing Umami dispatch. GA event names must be
 *      alphanumeric + underscores, so hyphens are normalized to underscores.
 *   2. Consent banner + Consent Mode v2 update — first-time visitors see a small
 *      banner ("Accept all" / "Reject non-essential"). The choice persists in
 *      localStorage; subsequent visits skip the banner and reapply the choice.
 *
 * Requirements on the host page (already in place):
 *   - Google tag (gtag.js) loaded via <script async src="…gtag/js?id=G-…">.
 *   - `gtag('consent', 'default', { … })` called BEFORE `gtag('config', …)`
 *     so no data is collected until this script updates the state.
 *
 * Public API:
 *   window.openConsentBanner()   — re-open the banner (wire to a footer link
 *                                   like "Cookie preferences").
 *   window.getAnalyticsConsent() — read the stored consent state.
 */
(function () {
  "use strict";

  const CONSENT_KEY = "portfolio_analytics_consent_v1";

  // ─────────────────────────────────────────────────────────────
  // Event mirror: data-umami-event → gtag('event', …)
  // ─────────────────────────────────────────────────────────────
  function toGaName(raw) {
    return String(raw || "").trim().replace(/-/g, "_").replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40);
  }

  document.addEventListener("click", (e) => {
    const target = e.target;
    const el = (target && typeof target.closest === "function")
      ? target.closest("[data-umami-event]")
      : null;
    if (!el || typeof window.gtag !== "function") return;
    const name = toGaName(el.getAttribute("data-umami-event"));
    if (!name) return;

    // Collect any data-umami-event-* attributes as event params.
    const params = {};
    for (const attr of el.attributes) {
      if (attr.name.startsWith("data-umami-event-") && attr.name !== "data-umami-event") {
        params[toGaName(attr.name.slice("data-umami-event-".length))] = attr.value;
      }
    }

    try { window.gtag("event", name, params); }
    catch (err) { console.warn("[analytics-consent] gtag event failed:", err); }
  }, true);

  // ─────────────────────────────────────────────────────────────
  // Consent state persistence
  // ─────────────────────────────────────────────────────────────
  function readConsent() {
    try {
      const raw = localStorage.getItem(CONSENT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && (parsed.state === "granted" || parsed.state === "denied")) return parsed;
      return null;
    } catch { return null; }
  }

  function writeConsent(state) {
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify({ state, at: Date.now() }));
    } catch (err) {
      console.warn("[analytics-consent] Could not persist consent:", err);
    }
  }

  function applyConsent(granted) {
    if (typeof window.gtag !== "function") return;
    try {
      window.gtag("consent", "update", {
        ad_storage:          granted ? "granted" : "denied",
        ad_user_data:        granted ? "granted" : "denied",
        ad_personalization:  granted ? "granted" : "denied",
        analytics_storage:   granted ? "granted" : "denied",
      });
    } catch (err) {
      console.warn("[analytics-consent] gtag consent update failed:", err);
    }
  }

  window.getAnalyticsConsent = function () {
    const s = readConsent();
    return s ? s.state : null;
  };

  // ─────────────────────────────────────────────────────────────
  // Banner UI
  // ─────────────────────────────────────────────────────────────
  const BANNER_ID = "consentBanner";
  const STYLE_ID  = "consentBannerStyle";

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${BANNER_ID} {
        position: fixed; left: 16px; right: 16px; bottom: 16px; z-index: 2147483000;
        max-width: 640px; margin: 0 auto;
        background: #16213e; color: #eaf0ff;
        border: 1px solid rgba(255,255,255,0.16);
        border-radius: 12px;
        box-shadow: 0 24px 60px rgba(0,0,0,0.42);
        padding: 16px 18px;
        font: 13px/1.55 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        display: flex; flex-direction: column; gap: 12px;
      }
      #${BANNER_ID} p { margin: 0; }
      #${BANNER_ID} strong { color: #ffffff; }
      #${BANNER_ID} a { color: #8de0ff; text-decoration: underline; }
      #${BANNER_ID} .cb-actions {
        display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end;
      }
      #${BANNER_ID} button {
        padding: 8px 14px; border-radius: 8px;
        font: inherit; font-weight: 700; cursor: pointer;
        border: 1px solid rgba(255,255,255,0.18);
        background: rgba(255,255,255,0.06); color: inherit;
        transition: background .15s ease, border-color .15s ease;
      }
      #${BANNER_ID} button:hover { background: rgba(255,255,255,0.12); }
      #${BANNER_ID} button.cb-primary {
        background: rgba(78,112,241,0.55);
        border-color: rgba(78,112,241,0.75);
      }
      #${BANNER_ID} button.cb-primary:hover { background: rgba(78,112,241,0.75); }
      @media (max-width: 480px) {
        #${BANNER_ID} { font-size: 12px; padding: 14px; }
        #${BANNER_ID} .cb-actions { justify-content: stretch; }
        #${BANNER_ID} .cb-actions button { flex: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  function removeBanner() {
    document.getElementById(BANNER_ID)?.remove();
  }

  function showBanner() {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", showBanner, { once: true });
      return;
    }
    if (document.getElementById(BANNER_ID)) return;
    ensureStyle();

    const banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-live", "polite");
    banner.setAttribute("aria-label", "Cookie and analytics consent");
    banner.innerHTML = `
      <p>
        <strong>Cookies &amp; analytics.</strong>
        We use Google Analytics (cookies) and Umami (cookieless) to understand
        how visitors use the site. You can accept everything or limit us to
        essential and cookieless tracking.
      </p>
      <div class="cb-actions">
        <button type="button" data-cb-choice="denied">Reject non-essential</button>
        <button type="button" data-cb-choice="granted" class="cb-primary">Accept all</button>
      </div>
    `;
    banner.addEventListener("click", (ev) => {
      const btn = ev.target?.closest?.("button[data-cb-choice]");
      if (!btn) return;
      const choice = btn.getAttribute("data-cb-choice");
      const granted = choice === "granted";
      writeConsent(granted ? "granted" : "denied");
      applyConsent(granted);
      removeBanner();
    });
    document.body.appendChild(banner);
  }

  window.openConsentBanner = showBanner;

  // ─────────────────────────────────────────────────────────────
  // Boot: apply stored choice or show banner
  // ─────────────────────────────────────────────────────────────
  function boot() {
    const stored = readConsent();
    if (stored) {
      applyConsent(stored.state === "granted");
    } else {
      showBanner();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
