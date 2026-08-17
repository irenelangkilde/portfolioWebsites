/**
 * One-shot operational alerts.
 *
 * For things that have never happened and would matter the first time they do. A limit
 * that has been advertised but never reached is a guess; the moment it refuses somebody is
 * the moment it becomes a product decision, and that should not be discovered weeks later
 * in a support email.
 *
 * SENT ONCE, EVER, per alert key. A repeated alert about an ongoing condition becomes
 * noise within days, and noise is indistinguishable from no alert. The marker is a blob
 * rather than a database row so an alert can fire from any function without a migration;
 * deleting it re-arms the alert.
 *
 * Never throws. An alert that fails must not fail the operation it was reporting on.
 */

import { getEnv } from "./localEnv.mjs";
import { getNamedBlobStore } from "./blobStore.mjs";

const ALERT_STORE = "published-sites";   // reuse rather than provision a store for markers

async function sendOnce(alertKey, subject, html) {
  try {
    const { store, configError } = getNamedBlobStore(ALERT_STORE);
    if (configError || !store) {
      console.warn("[ops] alert store unavailable:", configError);
      return;
    }

    const markerKey = `ops/alert-${alertKey}.json`;
    const seen = await store.get(markerKey).catch(() => null);
    if (seen) return;

    const key = getEnv("RESEND_API_KEY");
    const to  = getEnv("OPS_ALERT_EMAIL") || "irene@irenes-ventures.com";

    if (key) {
      const { Resend } = await import("resend");
      const { error } = await new Resend(key).emails.send({
        from: "Irene's Webworks <gifts@email.irenes-ventures.com>",
        to, subject, html,
      });
      if (error) { console.error("[ops] alert send failed:", error.message); return; }
      console.log(`[ops] alert "${alertKey}" sent to ${to}`);
    } else {
      console.warn(`[ops] alert "${alertKey}" fired but RESEND_API_KEY is not set`);
    }

    // Written only after a successful send, so a mail failure retries next time rather
    // than consuming the single alert.
    await store.set(markerKey, JSON.stringify({ sent_at: new Date().toISOString(), subject }));
  } catch (err) {
    console.error("[ops] alert failed:", err?.message);
  }
}

/** The first time any user is refused an upload for exceeding their storage allowance. */
export async function alertStorageLimitReached({ userId, tier, used, limit, incoming }) {
  const gb = n => `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  await sendOnce(
    "storage-limit-reached",
    "Someone has hit their storage allowance for the first time",
    `<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:34rem;line-height:1.65;color:#1a2233">
  <h2 style="margin:0 0 .5rem">A storage limit refused an upload</h2>
  <p style="margin:0 0 1rem;color:#55627a">
    This is the first time it has happened. Until now the 10 GB / 100 GB figures on the
    plan cards were advertised but never reached, so nobody had tested whether they are the
    right numbers.
  </p>
  <table style="border-collapse:collapse;font-size:14px;color:#55627a;margin:0 0 1rem">
    <tr><td style="padding:2px 12px 2px 0">Account</td><td><code>${userId}</code></td></tr>
    <tr><td style="padding:2px 12px 2px 0">Plan</td><td>${tier}</td></tr>
    <tr><td style="padding:2px 12px 2px 0">Used</td><td>${gb(used)} of ${gb(limit)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0">Refused upload</td><td>${(incoming / 1024 / 1024).toFixed(1)} MB</td></tr>
  </table>
  <p style="margin:0 0 1rem;color:#55627a">
    Worth deciding deliberately rather than by default: raise the allowance, sell more
    storage, or leave it and let the message stand. Note there is still no way for a
    customer to delete an asset, so the only route below the line is upgrading.
  </p>
  <p style="margin:0;color:#8792a8;font-size:13px">
    Sent once. Delete <code>ops/alert-storage-limit-reached.json</code> from the
    published-sites blob store to re-arm it.
  </p>
</div>`
  );
}
