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
})();
