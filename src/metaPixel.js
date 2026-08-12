/**
 * metaPixel.js — Meta (Facebook) pixel, gated on the site's consent choice.
 *
 * WHY THIS IS NOT META'S SNIPPET
 *
 * The code Meta hands you calls `fbq('track', 'PageView')` on load, unconditionally.
 * Dropping that into these pages would fire an advertising tracker before the consent
 * banner has been answered, contradicting the Consent Mode v2 defaults every page sets
 * and making the banner decorative. So the loader is deferred instead: nothing is
 * requested from connect.facebook.net until consent is "granted".
 *
 * "denied" is a real answer, not a temporary one — the pixel simply never loads, and the
 * queued events are dropped rather than held. There is no later moment at which they
 * become permissible.
 *
 * EVENT IDS AND DEDUPLICATION
 *
 * Purchase carries an eventID of the Stripe checkout session id — the same value used as
 * GA4's transaction_id. When the Conversions API is added to stripeWebhook.mjs, the
 * server can send the same event with the same id and Meta will collapse the pair
 * instead of counting the sale twice. Adding this later without a shared id would
 * silently double every conversion, which is worse than having no server signal at all.
 *
 * Public API:
 *   window.iwMetaTrack(name, params, eventId)  — standard event (Purchase, …)
 *   window.iwMetaTrackCustom(name, params)     — trackCustom event
 */
(function () {
  "use strict";

  var PIXEL_ID = "1763670300947796";

  var loaded  = false;   // fbevents.js requested
  var pending = [];      // events raised before consent arrived

  function consentGranted() {
    try {
      return typeof window.getAnalyticsConsent === "function" &&
             window.getAnalyticsConsent() === "granted";
    } catch (e) { return false; }
  }

  /** Meta's loader stub, run only once consent is in hand. */
  function loadPixel() {
    if (loaded) return;
    loaded = true;
    try {
      !function(f,b,e,v,n,t,s){
        if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)
      }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

      window.fbq('init', PIXEL_ID);
      window.fbq('track', 'PageView');
    } catch (err) {
      console.warn("[metaPixel] load failed:", err && err.message);
    }
  }

  function emit(item) {
    try {
      if (typeof window.fbq !== "function") return;
      var opts = item.eventId ? { eventID: item.eventId } : undefined;
      if (item.custom) window.fbq('trackCustom', item.name, item.params || {}, opts);
      else             window.fbq('track',       item.name, item.params || {}, opts);
    } catch (err) {
      console.warn("[metaPixel] track failed:", err && err.message);
    }
  }

  function flush() {
    var queued = pending;
    pending = [];
    for (var i = 0; i < queued.length; i++) emit(queued[i]);
  }

  function track(item) {
    // Measurement is never allowed to break the page it is measuring.
    try {
      if (!consentGranted()) { pending.push(item); return; }
      loadPixel();
      emit(item);
    } catch (err) {
      console.warn("[metaPixel] track failed:", err && err.message);
    }
  }

  window.iwMetaTrack = function (name, params, eventId) {
    track({ name: name, params: params, eventId: eventId, custom: false });
  };
  window.iwMetaTrackCustom = function (name, params) {
    track({ name: name, params: params, custom: true });
  };

  // A visitor who accepts mid-visit gets the pixel from that point on, including any
  // event raised while the banner was still open (e.g. they hit Purchase first).
  window.addEventListener("iw-consent-change", function (ev) {
    if (ev && ev.detail && ev.detail.state === "granted") {
      loadPixel();
      flush();
    } else {
      pending = [];   // declined: drop, never hold
    }
  });

  // Returning visitors have already decided; analytics-consent.js re-applies the stored
  // choice on boot, but it may run after this file, so check directly too.
  if (consentGranted()) loadPixel();
})();
