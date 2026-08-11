/**
 * Canonical origin for auth redirects.
 *
 * Every Supabase email — password reset, signup confirmation, magic link — carries a
 * redirectTo, and Supabase only honours one that matches the Redirect URLs allowlist in
 * its dashboard. Anything else is silently replaced by the dashboard's Site URL, which
 * is how a reset link ended up on the marketing home page with no reset dialog.
 *
 * These pages used `window.location.origin`, which is whatever domain the visitor
 * happens to be on. With 33 alias domains serving the same site, that means 33 possible
 * redirectTo values, all of which would have to be allowlisted — and each entry widens
 * the surface for an attacker crafting a link that sends an auth token to a host they
 * control. Cheap TLDs that lapse make that worse: an expired domain left in the
 * allowlist can be re-registered by someone else and then receive recovery tokens.
 *
 * So auth redirects are pinned here instead. The allowlist then needs exactly two
 * entries: this origin, and localhost for development.
 *
 * TO MOVE THE APP TO A DIFFERENT DOMAIN, change IW_AUTH_ORIGIN and add the new origin
 * to Supabase → Authentication → URL Configuration → Redirect URLs. Nothing else in the
 * client needs touching.
 */
(function () {
  // The single origin the app is served from. This is not only a branding choice: a
  // Supabase session lives in localStorage, which is PER-ORIGIN, so a user who fills in
  // the form on one origin and completes a password reset on another ends up signed in
  // somewhere they are not looking, with no way for code to bridge the two. The edge
  // function redirects every other alias here so that cannot happen.
  var CANONICAL = "https://resumeto.website";

  // Local development keeps its own origin, otherwise every reset during `netlify dev`
  // would bounce to production.
  function isLocal(host) {
    return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host || "");
  }

  window.IW_AUTH_ORIGIN = isLocal(window.location.hostname)
    ? window.location.origin
    : CANONICAL;

  /**
   * Build an absolute auth-redirect URL.
   *   iwAuthUrl("/src/overview.html?reset=1")
   * Paths are absolute from the site root — a relative one would resolve against
   * whichever page called it, which is how /overview.html (404) got used instead of
   * /src/overview.html.
   */
  window.iwAuthUrl = function (path) {
    var p = String(path || "/");
    if (p.charAt(0) !== "/") p = "/" + p;
    return window.IW_AUTH_ORIGIN + p;
  };

  // ── Purchase-source attribution ────────────────────────────────────────────
  // Where a visitor came from is an EVENT, not a state: it exists only during the visit
  // that carried it. Stripe records the payment, not the referrer; a cross-origin HTTPS
  // referrer header is stripped to the origin and absent entirely from mail clients and
  // apps; and analytics gives aggregate traffic that cannot be joined to a purchase. So
  // it is captured here, at the moment it is knowable, or not at all.
  //
  // FIRST-TOUCH with a 90-day window: an existing unexpired record is never overwritten.
  // If someone arrives via a referral link, leaves, and returns a month later from a
  // search, the referral keeps the credit — the usual convention, and the fairer one for
  // an affiliate who did the introducing.
  var ATTRIBUTION_KEY = "iw-attribution";
  var ATTRIBUTION_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

  function readAttribution() {
    try {
      var raw = localStorage.getItem(ATTRIBUTION_KEY);
      if (!raw) return null;
      var rec = JSON.parse(raw);
      if (!rec || !rec.t) return null;
      if (Date.now() - rec.t > ATTRIBUTION_WINDOW_MS) return null;   // expired
      return rec;
    } catch (e) { return null; }
  }

  function captureAttribution() {
    var params = new URLSearchParams(window.location.search);
    var ref = (params.get("ref") || params.get("via") || "").trim();

    var rec = {
      t:            Date.now(),
      ref_code:     ref.slice(0, 64),
      utm_source:   (params.get("utm_source")   || "").slice(0, 120),
      utm_medium:   (params.get("utm_medium")   || "").slice(0, 120),
      utm_campaign: (params.get("utm_campaign") || "").slice(0, 120),
      landing_path: String(window.location.pathname || "").slice(0, 200),
      referrer_host: ""
    };
    try {
      if (document.referrer) {
        var rh = new URL(document.referrer).hostname;
        // Our own pages are not a traffic source.
        if (rh && rh !== window.location.hostname) rec.referrer_host = rh.slice(0, 120);
      }
    } catch (e) {}

    // Nothing identifying about this visit — do not overwrite a real earlier record with
    // an empty one, and do not store a row that says nothing.
    var hasSignal = rec.ref_code || rec.utm_source || rec.utm_campaign || rec.referrer_host;
    if (!hasSignal) return;
    if (readAttribution()) return;   // first touch wins

    try { localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(rec)); } catch (e) {}
  }

  captureAttribution();

  /** The stored record, or null. Shape matches what createCheckoutSession expects. */
  window.iwAttribution = readAttribution;

  /** Just the referral code from that record, for prefilling an input. */
  window.iwStoredReferralCode = function () {
    var rec = readAttribution();
    return rec && rec.ref_code ? rec.ref_code : "";
  };
})();
