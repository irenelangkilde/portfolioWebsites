/**
 * The domains a visitor may arrive on.
 *
 * All of these are configured as aliases in Netlify and serve the same site. This module
 * is the single place they are written down; nothing should hardcode one of these hosts
 * inline. Adding or dropping a domain is a one-line data edit here.
 *
 * CANONICAL_HOST is the durable one. The rest are marketing/parking domains on cheap TLDs
 * that may not be renewed, so nothing long-lived — a published portfolio URL, an emailed
 * link — should ever be pinned to one of them. isKnownDomain() exists so callers can tell
 * "arrived on a domain we own" from "arrived on something unexpected" without matching a
 * literal.
 *
 * Note this list is NOT a security boundary. It says which hosts we recognise, not which
 * hosts are trusted: any of these may lapse and be re-registered by someone else. Do not
 * use it for CORS origins, cookie domains, or redirect allow-lists.
 */

export const CANONICAL_HOST = "irenes-ventures.com";

export const KNOWN_DOMAINS = [
  "irenes-ventures.com",
  "myonlineresume.info",
  "myonlineresume.store",
  "myonlineresume.xyz",
  "myportfolioresume.info",
  "myportfolioresume.net",
  "myportfolioresume.online",
  "myportfolioresume.store",
  "myportfolioresume.xyz",
  "mywebresume.site",
  "onlineresume.info",
  "onlineresume.shop",
  "onlineresume.site",
  "onlineresume.store",
  "resume2.website",
  "resume2website.info",
  "resume2website.net",
  "resume2website.online",
  "resume2website.store",
  "resume2website.xyz",
  "resumeportfolio.info",
  "resumeportfolio.net",
  "resumeportfolio.online",
  "resumeportfolio.shop",
  "resumeportfolio.store",
  "resumeto.website",
  "resumetowebsite.info",
  "resumetowebsite.store",
  "resumetowebsite.xyz",
  "resumeweb.site",
  "webresume.shop",
  "webresume.store",
  "webresume.xyz",
];

const KNOWN = new Set(KNOWN_DOMAINS);

/**
 * Reduce a raw Host header to a bare comparable hostname: lowercased, port removed,
 * trailing dot removed, "www." stripped. Netlify serves www and apex on the same site,
 * so both count as the same domain here.
 */
export function normalizeHost(rawHost) {
  return String(rawHost || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

/** True when the host is one of ours. Local dev and Netlify preview hosts are not. */
export function isKnownDomain(rawHost) {
  return KNOWN.has(normalizeHost(rawHost));
}

/** True for localhost / 127.0.0.1, with or without a port. */
export function isLocalHost(rawHost) {
  const host = normalizeHost(rawHost);
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}
