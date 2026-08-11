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

// The domains we own, version-controlled rather than typed into an env var. Any host NOT
// recognised here is treated as a visitor's own custom portfolio domain and looked up in
// the blob store — so a marketing domain missing from this list does not fall through
// harmlessly, it renders "No portfolio is registered for <domain>" on every page.
// Deno-safe: the module is plain ESM with no imports and no Node built-ins.
import { KNOWN_DOMAINS } from "../../src/netlify/shared/knownDomains.mjs";

const PUBLISHED_SITES_STORE = "published-sites";

// The one origin the app is served from. Must match CANONICAL in src/siteConfig.js —
// the client builds auth redirects from that, and this redirects everything else here,
// so a mismatch would bounce users between two origins.
const CANONICAL_ORIGIN = "https://resumeto.website";

// The directory of ventures, not the app. This host is ours — so it must NOT fall through
// to the custom-portfolio blob lookup, which would 404 with "No portfolio is registered"
// the way an unlisted subdomain does — but it is also NOT redirected to the canonical
// origin like the other aliases, because its whole purpose is to serve different content.
//
// It is deliberately NOT in KNOWN_DOMAINS: that list now means "redirect these to the
// app", which is the opposite of what this host is for.
//
// irenes-ventures.com itself is not here. It stays in KNOWN_DOMAINS and 301s to the app,
// so the .com still lands people on the product — it just does not SERVE it, because two
// origins serving the same app is what made a password reset sign a user in somewhere
// they were not looking.
const ABOUT_HOSTS = new Set([
  "about.irenes-ventures.com",
]);
const ABOUT_PAGE = "/html/about.html";

// Hosts that should never be treated as custom portfolio domains
const SYSTEM_HOST_PATTERN = /\.(netlify\.app|netlify\.live)(:\d+)?$|^localhost(:\d+)?$/i;

/** True when the host is one of ours — apex or www — and therefore safe to redirect. */
function isKnownAliasHost(bareHost) {
  const bare = String(bareHost || "").toLowerCase().replace(/^www\./, "");
  return KNOWN_DOMAINS.some(d => d.toLowerCase() === bare);
}

function apexAndWww(hostname) {
  // Given any hostname, return its apex domain and www variant.
  const parts = hostname.split(".");
  if (parts.length < 2) return [];
  const apex = parts.slice(-2).join(".");
  return [apex, `www.${apex}`];
}

function isSystemHost(host) {
  if (SYSTEM_HOST_PATTERN.test(host)) return true;
  const bare = host.replace(/:\d+$/, "").toLowerCase();

  // Collect all known site hostnames from explicit config and Netlify's auto env vars.
  const candidates = new Set();

  const addDomainList = (raw) => {
    if (!raw) return;
    for (const d of raw.split(",")) {
      const h = d.trim().toLowerCase();
      if (!h) continue;
      candidates.add(h);
      for (const v of apexAndWww(h)) candidates.add(v);
    }
  };

  // NETLIFY_PRIMARY_DOMAIN used to be read here and passed in. It is not one of Netlify's
  // automatic environment variables, so the lookup always returned "" and contributed
  // nothing — the parameter is gone rather than left looking meaningful. The primary
  // domain still reaches this function via the URL variable below, which Netlify does set.

  // The checked-in list. Adding a domain here is a code change that ships with a deploy,
  // which is the intended path — it is reviewable and cannot be silently truncated the
  // way a long comma-separated env var can.
  for (const d of KNOWN_DOMAINS) {
    candidates.add(d);
    for (const v of apexAndWww(d)) candidates.add(v);
  }

  // Kept as an escape hatch: lets a domain be recognised immediately via the Netlify UI
  // without waiting for a deploy. Note this is the ALIAS_DOMAINS environment variable,
  // which is NOT the same thing as adding a domain alias under Netlify's Domain
  // management — only this variable and the list above are read here.
  addDomainList(Netlify.env.get("ALIAS_DOMAINS"));

  // Netlify always sets URL = primary site URL. Use it as a reliable fallback.
  const siteUrl = Netlify.env.get("URL") || "";
  if (siteUrl) {
    try {
      const siteHost = new URL(siteUrl).hostname.toLowerCase();
      candidates.add(siteHost);
      for (const v of apexAndWww(siteHost)) candidates.add(v);
    } catch {}
  }

  return candidates.has(bare);
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

function isStaticPassThroughPath(pathname) {
  return /^\/(?:users|html|assets)\//i.test(pathname)
    || /^\/(?:editor|overview|subscriptions|index)\.html$/i.test(pathname)
    || pathname === "/";
}

export default async function handler(request, context) {
  const host = request.headers.get("host") || "";
  const url  = new URL(request.url);

  // ── Send every alias to the canonical origin ────────────────────────────────
  // Netlify serves domain aliases directly rather than redirecting, so a visitor could
  // use the whole app on any of the 33 domains. That is not merely untidy: a Supabase
  // session lives in localStorage, which is PER-ORIGIN. Fill in the form on
  // resumeto.website, complete a password reset that lands on irenes-ventures.com, and
  // the session is written to an origin the user is not looking at — a hard refresh of
  // the original tab still shows signed out, and no code can bridge it, because
  // cross-origin localStorage is isolated by design and there is no window handle to
  // postMessage between an email-opened tab and the original one.
  //
  // Redirecting here rather than in netlify.toml keeps one list of domains (the
  // checked-in KNOWN_DOMAINS) instead of 32 hand-written redirect rules, and runs before
  // any of the routing below.
  //
  // Only hosts we recognise are redirected. A visitor's own custom portfolio domain is
  // not in KNOWN_DOMAINS and must keep serving their site, and netlify.app/localhost are
  // excluded so previews and local development still work on their own origin.
  const canonicalHost = (CANONICAL_ORIGIN.replace(/^https?:\/\//, "") || "").toLowerCase();
  const bareHost = host.replace(/:\d+$/, "").toLowerCase();

  // The ventures directory is checked BEFORE the alias redirect below, so it is never
  // swept up by it.
  if (ABOUT_HOSTS.has(bareHost)) {
    // Only the root is swapped. Everything else — /blog, /assets, /html/... — serves as
    // usual, so the apex page can link to shared assets and the blog without a special
    // case. A rewrite rather than a redirect: the address bar keeps saying
    // about.irenes-ventures.com, which is the point of having a separate page.
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return context.rewrite(new URL(ABOUT_PAGE, url.origin));
    }
    return context.next();
  }

  if (
    canonicalHost &&
    bareHost !== canonicalHost &&
    !SYSTEM_HOST_PATTERN.test(host) &&
    isKnownAliasHost(bareHost)
  ) {
    const target = new URL(url.pathname + url.search + url.hash, CANONICAL_ORIGIN);
    return Response.redirect(target.toString(), 301);
  }

  // Pass through requests on the main site domain(s) — let normal routing handle them,
  // EXCEPT for /u/:slug paths which we handle here to avoid redirect/edge-function chain issues.
  if (isSystemHost(host)) {
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

  // Allow selected real static files/pages on custom domains to fall through to
  // Netlify's normal static asset handling instead of forcing blob-backed portfolio routing.
  if (isStaticPassThroughPath(url.pathname)) {
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

  const baseSlug = mapping?.slug;
  if (!baseSlug) {
    return new Response("Domain mapping exists but contains no slug.", { status: 500 });
  }

  // Support /v{N} path to serve a specific version, e.g. theirdomain.com/v4
  // Strip any versioned suffix from baseSlug to get the root slug, then append -N.
  let slug = baseSlug;
  const versionMatch = url.pathname.match(/^\/v(\d+)\/?$/);
  if (versionMatch) {
    const rootSlug = baseSlug.replace(/-\d+$/, "");
    slug = `${rootSlug}-${versionMatch[1]}`;
  }

  // Fetch the portfolio HTML
  let html;
  try {
    html = await store.get(`html/${slug}.html`);
  } catch (err) {
    return new Response(`Error fetching portfolio HTML: ${err?.message}`, { status: 500 });
  }

  if (!html) {
    return html404(domain, versionMatch
      ? `Version <strong>${versionMatch[1]}</strong> of the portfolio for <strong>${domain}</strong> was not found.`
      : `The portfolio for <strong>${domain}</strong> has not been published yet.`
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
