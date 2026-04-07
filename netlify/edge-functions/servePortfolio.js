/**
 * Edge Function: servePortfolio
 *
 * Handles two cases:
 *
 * 1. Custom domain (e.g. janesmith.com)
 *    - Reads Host header
 *    - Looks up domain → slug mapping in the published-sites blob store
 *    - Fetches and returns the portfolio HTML
 *
 * 2. Clean-URL rewrites via netlify.toml redirect (/u/:slug)
 *    - The slug is already in the URL; passes through to publishedPortfolio function
 *    - This edge function only intercepts custom-domain requests (those not
 *      matching *.netlify.app or localhost)
 */

import { getStore } from "@netlify/blobs";

const PUBLISHED_SITES_STORE = "published-sites";

// Hosts that should never be treated as custom portfolio domains
const SYSTEM_HOST_PATTERN = /\.(netlify\.app|netlify\.live|localhost)(:\d+)?$|^localhost(:\d+)?$/i;

export default async function handler(request, context) {
  const url  = new URL(request.url);
  const host = request.headers.get("host") || "";

  // Only intercept custom domains — let /u/* rewrites and all other paths
  // fall through to the normal routing
  if (SYSTEM_HOST_PATTERN.test(host)) {
    return context.next();
  }

  // Strip port if present (e.g. localhost:8888 in dev — already excluded above,
  // but defensive for edge cases)
  const domain = host.replace(/:\d+$/, "").toLowerCase();

  let store;
  try {
    store = getStore(PUBLISHED_SITES_STORE);
  } catch {
    return new Response("Service temporarily unavailable.", { status: 503 });
  }

  // Look up domain → slug mapping
  let mapping;
  try {
    const raw = await store.get(`domain/${domain}`);
    if (!raw) {
      return new Response(
        `<html><body style="font-family:sans-serif;padding:40px">
          <h2>Portfolio not found</h2>
          <p>No portfolio is registered for <strong>${domain}</strong>.</p>
        </body></html>`,
        { status: 404, headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }
    mapping = JSON.parse(raw);
  } catch {
    return new Response("Error looking up domain mapping.", { status: 500 });
  }

  const slug = mapping?.slug;
  if (!slug) {
    return new Response("Invalid domain mapping.", { status: 500 });
  }

  // Fetch the portfolio HTML from the blob store
  let html;
  try {
    html = await store.get(`html/${slug}.html`);
  } catch {
    return new Response("Error fetching portfolio.", { status: 500 });
  }

  if (!html) {
    return new Response(
      `<html><body style="font-family:sans-serif;padding:40px">
        <h2>Portfolio not found</h2>
        <p>The portfolio for <strong>${domain}</strong> has not been published yet.</p>
      </body></html>`,
      { status: 404, headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60"
    }
  });
}

// Run on every request so custom domains are always intercepted
export const config = { path: "/*" };
