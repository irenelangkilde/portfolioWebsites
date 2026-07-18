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

export function buildPublishUrl(event, slug) {
  const configuredHost = (process.env.PUBLISHED_SITES_HOST || "").trim().replace(/\/+$/, "");
  if (configuredHost) {
    const base = /^https?:\/\//i.test(configuredHost) ? configuredHost : `https://${configuredHost}`;
    return `${base}/u/${encodeURIComponent(slug)}`;
  }
  const host = event.headers["x-forwarded-host"] || event.headers.host || "localhost";
  const isLocal = /^localhost(:\d+)?$/.test(host);
  const proto = isLocal
    ? "http"
    : (event.headers["x-forwarded-proto"] || event.headers["X-Forwarded-Proto"] || "https");
  return `${proto}://${host}/u/${encodeURIComponent(slug)}`;
}
