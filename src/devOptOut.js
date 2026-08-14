/**
 * Developer opt-out — keeps your own visits out of GA4, GTM and the Meta pixel.
 *
 *   ?iw-optout=1   turn it on for this browser (persists)
 *   ?iw-optout=0   turn it off
 *
 * WHY THIS EXISTS
 *
 * GA4's internal-traffic filter is IP-based, so it misses you on mobile data, on other
 * networks, and whenever a residential IP rotates. Meta offers no IP exclusion at all.
 * And the obvious workaround — declining your own consent banner — makes it impossible to
 * check that tracking works, because the trackers never load.
 *
 * This is independent of consent: you can accept the banner, watch the tags fire in the
 * console, and still not appear in anyone's reports.
 *
 * WHY IT LOADS SYNCHRONOUSLY, BEFORE THE gtag BLOCK
 *
 * `ga-disable-<MEASUREMENT_ID>` is Google's supported kill switch, and it is only honoured
 * if set before gtag('config', ...) runs. That call is inline in each page's head, so this
 * file has to execute ahead of it. It is deliberately tiny and cached after first load.
 *
 * WHAT IT DOES NOT DO
 *
 * It cannot retract anything already collected, and it is per-browser and per-origin —
 * a new browser, a new device, or cleared site data starts fresh.
 */
(function () {
  "use strict";

  var KEY   = "iw-dev-optout";
  var GA_ID = "G-QHDQP5JY0X";

  function read() {
    try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; }
  }

  function write(on) {
    try {
      if (on) localStorage.setItem(KEY, "1");
      else    localStorage.removeItem(KEY);
    } catch (e) {}
  }

  try {
    var params = new URLSearchParams(window.location.search);
    if (params.has("iw-optout")) {
      var on = params.get("iw-optout") !== "0";
      write(on);
      console.log("[iw] developer opt-out " + (on ? "ENABLED" : "CLEARED") +
                  " for this browser. GA4, GTM tags and the Meta pixel " +
                  (on ? "will not record you." : "will record you again."));
    }
  } catch (e) {}

  var optedOut = read();

  // Read by metaPixel.js, and available to anything else that reports.
  window.IW_OPTED_OUT = optedOut;

  if (optedOut) {
    // Stops GA4 measurement for this property, including hits sent by tags GTM fires,
    // since they share the same property id.
    window["ga-disable-" + GA_ID] = true;
    console.log("[iw] developer opt-out active — analytics suppressed. ?iw-optout=0 to clear.");
  }
})();
