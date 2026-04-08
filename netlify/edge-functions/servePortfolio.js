/**
 * Edge Function: servePortfolio
 *
 * Intercepts requests on custom domains (not *.netlify.app / localhost),
 * looks up a domain → slug mapping in the published-sites blob store,
 * and serves the corresponding portfolio HTML.
 *
 * /u/:slug requests on the main site pass straight through to the
 * publishedPortfolio function via the redirect rule in netlify.toml.
 */

import { getStore } from "@netlify/blobs";

const PUBLISHED_SITES_STORE = "published-sites";

// Hosts that should never be treated as custom portfolio domains
const SYSTEM_HOST_PATTERN = /\.(netlify\.app|netlify\.live)(:\d+)?$|^localhost(:\d+)?$/i;

function isSystemHost(host, primaryDomain) {
  if (SYSTEM_HOST_PATTERN.test(host)) return true;
  // Also pass through the site's own primary/alias domains
  if (primaryDomain) {
    const primaries = primaryDomain.split(",").map(d => d.trim().toLowerCase());
    const bare = host.replace(/:\d+$/, "").toLowerCase();
    if (primaries.includes(bare)) return true;
  }
  return false;
}

function html404(domain, message) {
  return new Response(
    `<!doctype html><html><body style="font-family:sans-serif;padding:40px">
      <h2>Portfolio not found</h2>
      <p>${message}</p>
    </body></html>`,
    { status: 404, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

function sanitizeSlug(value) {
  return String(value || "").toLowerCase().trim()
    .replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

export default async function handler(request, context) {
  const host = request.headers.get("host") || "";
  const url  = new URL(request.url);

  // Pass through requests on the main site domain(s) — let normal routing handle them,
  // EXCEPT for /u/:slug paths which we handle here to avoid redirect/edge-function chain issues.
  const primaryDomain = Netlify.env.get("NETLIFY_PRIMARY_DOMAIN") || "";
  if (isSystemHost(host, primaryDomain)) {
    // Handle /u/:slug on the primary domain directly
    const slugMatch = url.pathname.match(/^\/u\/([^/]+)$/);
    if (slugMatch) {
      const slug = sanitizeSlug(slugMatch[1]);
      if (!slug) return new Response("Missing slug", { status: 400 });

      const siteID = Netlify.env.get("NETLIFY_SITE_ID");
      const token  = Netlify.env.get("NETLIFY_AUTH_TOKEN");
      if (!siteID || !token) return new Response("Blob store credentials not configured.", { status: 503 });

      let store;
      try { store = getStore({ name: PUBLISHED_SITES_STORE, siteID, token }); }
      catch (err) { return new Response(`Blob store init failed: ${err?.message}`, { status: 503 }); }

      let html;
      try { html = await store.get(`html/${slug}.html`); }
      catch (err) { return new Response(`Error fetching portfolio: ${err?.message}`, { status: 500 }); }

      if (!html) return new Response("Published page not found", { status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" } });

      return new Response(html, { status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" } });
    }
    return context.next();
  }

  const domain = host.replace(/:\d+$/, "").toLowerCase();

  // Edge functions need explicit credentials to access Netlify Blobs
  const siteID = Netlify.env.get("NETLIFY_SITE_ID");
  const token  = Netlify.env.get("NETLIFY_AUTH_TOKEN");

  if (!siteID || !token) {
    return new Response(
      "Blob store credentials not configured (NETLIFY_SITE_ID / NETLIFY_AUTH_TOKEN).",
      { status: 503 }
    );
  }

  let store;
  try {
    store = getStore({ name: PUBLISHED_SITES_STORE, siteID, token });
  } catch (err) {
    return new Response(`Blob store init failed: ${err?.message}`, { status: 503 });
  }

  // Look up domain → slug mapping
  let mapping;
  try {
    const raw = await store.get(`domain/${domain}`);
    if (!raw) {
      return html404(domain, `No portfolio is registered for <strong>${domain}</strong>.`);
    }
    mapping = JSON.parse(raw);
  } catch (err) {
    return new Response(`Error looking up domain mapping: ${err?.message}`, { status: 500 });
  }

  const slug = mapping?.slug;
  if (!slug) {
    return new Response("Domain mapping exists but contains no slug.", { status: 500 });
  }

  // Fetch the portfolio HTML
  let html;
  try {
    html = await store.get(`html/${slug}.html`);
  } catch (err) {
    return new Response(`Error fetching portfolio HTML: ${err?.message}`, { status: 500 });
  }

  if (!html) {
    return html404(domain, `The portfolio for <strong>${domain}</strong> has not been published yet.`);
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
