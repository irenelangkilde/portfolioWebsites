/**
 * Shared helper for constructing published-portfolio URLs.
 *
 * If PUBLISHED_SITES_HOST is set on the function's environment (e.g. webresu.me),
 * URLs are emitted at that host regardless of which host the request came in on.
 * Otherwise the request's host is used, so local dev still works without extra
 * configuration.
 *
 * Any function that returns a /u/{slug} URL to the client should import from
 * here — keeping this in one place avoids the "we forgot to update one of them"
 * bug that surfaced when PUBLISHED_SITES_HOST was first added.
 */

import { CANONICAL_HOST, isKnownDomain, isLocalHost, normalizeHost } from "../shared/knownDomains.mjs";

export function buildPublishUrl(event, slug) {
  const configuredHost = (process.env.PUBLISHED_SITES_HOST || "").trim().replace(/\/+$/, "");
  if (configuredHost) {
    const base = /^https?:\/\//i.test(configuredHost) ? configuredHost : `https://${configuredHost}`;
    return `${base}/u/${encodeURIComponent(slug)}`;
  }

  const rawHost = event.headers["x-forwarded-host"] || event.headers.host || "localhost";

  // A published URL outlives the visit that created it: it goes into the user's resume, is
  // emailed, and gets handed to employers. The marketing domains are cheap TLDs that may
  // not be renewed, so stamping one onto a permanent link would break every portfolio
  // published through it the day it lapses. Arrivals on a domain we recognise are pinned
  // to the canonical host instead. Anything unrecognised — a Netlify preview deploy, a
  // branch deploy — keeps its own host, so previews still self-link correctly.
  const host = isKnownDomain(rawHost) ? CANONICAL_HOST : normalizeHost(rawHost);

  const local = isLocalHost(rawHost);
  const proto = local
    ? "http"
    : (event.headers["x-forwarded-proto"] || event.headers["X-Forwarded-Proto"] || "https");

  // normalizeHost drops the port, which local dev needs back.
  const hostWithPort = local ? String(rawHost).trim().toLowerCase() : host;

  return `${proto}://${hostWithPort}/u/${encodeURIComponent(slug)}`;
}
