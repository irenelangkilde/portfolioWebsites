/**
 * managePortfolio — authenticated portfolio management endpoint
 *
 * POST { action: "list",   slug }                    → list all versioned deploys
 * POST { action: "delete", slug, versionedSlug }     → delete one versioned deploy
 * POST { action: "domain", slug, domain }            → register a custom domain (delegates to addCustomDomain logic)
 */

import { createClient } from "@supabase/supabase-js";
import { getNamedBlobStore, explainBlobStoreError } from "./blobStore.mjs";

const PUBLISHED_SITES_STORE = "published-sites";

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  };
}

function getSupabaseAdmin() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function sanitizeSlug(value) {
  return String(value || "").toLowerCase().trim()
    .replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function sanitizeDomain(value) {
  return String(value || "").toLowerCase().trim()
    .replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
}

function buildPublishUrl(event, slug) {
  const host = event.headers["x-forwarded-host"] || event.headers.host || "localhost";
  const isLocal = /^localhost(:\d+)?$/.test(host);
  const proto = isLocal ? "http"
    : (event.headers["x-forwarded-proto"] || event.headers["X-Forwarded-Proto"] || "https");
  return `${proto}://${host}/u/${encodeURIComponent(slug)}`;
}

async function addNetlifyDomainAlias(domain) {
  const siteId = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_AUTH_TOKEN;
  if (!siteId || !token) return { ok: false, error: "NETLIFY_SITE_ID or NETLIFY_AUTH_TOKEN not configured." };

  const listRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!listRes.ok) return { ok: false, error: `Netlify API error: ${listRes.status}` };
  const site = await listRes.json();
  const existing = site.domain_aliases || [];
  if (existing.includes(domain)) return { ok: true, alreadyRegistered: true };

  const patchRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ domain_aliases: [...existing, domain] })
  });
  if (!patchRes.ok) {
    const text = await patchRes.text();
    return { ok: false, error: `Netlify API error: ${patchRes.status} — ${text.slice(0, 200)}` };
  }
  return { ok: true, alreadyRegistered: false };
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  // Auth
  const supabase = getSupabaseAdmin();
  if (!supabase) return json(500, { error: "Supabase admin not configured." });

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch?.[1]) return json(401, { error: "Missing bearer token." });

  const { data: authData, error: authError } = await supabase.auth.getUser(tokenMatch[1]);
  const user = authData?.user;
  if (authError || !user) return json(401, { error: "Invalid or expired session." });

  // Check deploy access (same paywall as Publish)
  const { data: membership } = await supabase
    .from("memberships")
    .select("deploys_used, deploys_limit, status")
    .eq("user_id", user.id)
    .single();
  if (!membership) return json(403, { error: "No membership record found." });
  if (membership.status !== "active") return json(403, { error: `Membership is ${membership.status}.` });

  let payload;
  try { payload = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON." }); }

  const action = payload.action;
  const slug   = sanitizeSlug(payload.slug);
  if (!slug) return json(400, { error: "Missing slug." });

  const { store, configError } = getNamedBlobStore(PUBLISHED_SITES_STORE);
  if (!store) return json(500, { error: configError });

  // Verify slug belongs to this user
  let bareMeta;
  try {
    const raw = await store.get(`meta/${slug}.json`);
    if (!raw) return json(404, { error: `No published portfolio found for slug "${slug}".` });
    bareMeta = JSON.parse(raw);
  } catch (err) { return json(500, { error: explainBlobStoreError(err) }); }

  if (bareMeta.user_id !== user.id) return json(403, { error: "That portfolio does not belong to your account." });

  // ── LIST ─────────────────────────────────────────────────────────────────────
  if (action === "list") {
    const latestDeploy = bareMeta.latest_deploy || 0;
    const deploys = [];
    for (let n = 1; n <= latestDeploy; n++) {
      const vSlug = `${slug}-${n}`;
      try {
        const raw = await store.get(`meta/${vSlug}.json`);
        if (raw) {
          const m = JSON.parse(raw);
          deploys.push({
            versionedSlug: vSlug,
            deployNumber:  n,
            url:           buildPublishUrl(event, vSlug),
            updated_at:    m.updated_at || null,
            isLatest:      n === latestDeploy
          });
        }
        // If raw is null the deploy was deleted — skip it
      } catch { /* skip */ }
    }
    return json(200, { ok: true, slug, latestDeploy, deploys });
  }

  // ── DELETE ───────────────────────────────────────────────────────────────────
  if (action === "delete") {
    const versionedSlug = sanitizeSlug(payload.versionedSlug);
    if (!versionedSlug) return json(400, { error: "Missing versionedSlug." });
    if (versionedSlug === slug) return json(400, { error: "Cannot delete the bare (latest) slug." });

    // Confirm versioned slug is a child of this slug
    if (!versionedSlug.startsWith(slug + "-")) {
      return json(400, { error: "versionedSlug does not belong to this portfolio." });
    }

    // Confirm it exists and belongs to user
    try {
      const raw = await store.get(`meta/${versionedSlug}.json`);
      if (!raw) return json(404, { error: `Deploy "${versionedSlug}" not found.` });
      const m = JSON.parse(raw);
      if (m.user_id !== user.id) return json(403, { error: "That deploy does not belong to your account." });
    } catch (err) { return json(500, { error: explainBlobStoreError(err) }); }

    try {
      await store.delete(`html/${versionedSlug}.html`);
      await store.delete(`meta/${versionedSlug}.json`);
    } catch (err) { return json(500, { error: `Delete failed: ${explainBlobStoreError(err)}` }); }

    return json(200, { ok: true, deleted: versionedSlug });
  }

  // ── DOMAIN ───────────────────────────────────────────────────────────────────
  if (action === "domain") {
    const domain = sanitizeDomain(payload.domain);
    if (!domain || !domain.includes(".")) {
      return json(400, { error: "Invalid domain. Provide a bare domain like janesmith.com." });
    }

    // targetSlug: which deploy to serve — defaults to bare slug (always latest).
    // If a versioned slug is provided, verify it belongs to this portfolio.
    let targetSlug = slug;
    if (payload.targetSlug) {
      const ts = sanitizeSlug(payload.targetSlug);
      if (ts !== slug && !ts.startsWith(slug + "-")) {
        return json(400, { error: "targetSlug does not belong to this portfolio." });
      }
      // Confirm it exists and belongs to user
      try {
        const raw = await store.get(`meta/${ts}.json`);
        if (!raw) return json(404, { error: `Deploy "${ts}" not found.` });
        const m = JSON.parse(raw);
        if (m.user_id !== user.id) return json(403, { error: "That deploy does not belong to your account." });
      } catch (err) { return json(500, { error: explainBlobStoreError(err) }); }
      targetSlug = ts;
    }

    const netlifyResult = await addNetlifyDomainAlias(domain);
    if (!netlifyResult.ok) return json(502, { error: netlifyResult.error });

    try {
      await store.set(`domain/${domain}`, JSON.stringify({
        slug: targetSlug,
        user_id: user.id,
        registered_at: new Date().toISOString()
      }));
    } catch (err) {
      return json(500, { error: `Domain registered with Netlify but mapping save failed: ${explainBlobStoreError(err)}` });
    }

    const siteUrl = process.env.NETLIFY_SITE_URL || "your-site.netlify.app";
    return json(200, {
      ok: true,
      domain,
      slug: targetSlug,
      alreadyRegistered: netlifyResult.alreadyRegistered,
      dnsInstructions: `CNAME  www  →  ${siteUrl}\nA      @    →  75.2.60.5`
    });
  }

  // ── LIST DOMAINS ─────────────────────────────────────────────────────────────
  if (action === "listDomains") {
    let keys;
    try {
      const result = await store.list({ prefix: "domain/" });
      keys = result.blobs.map(b => b.key);
    } catch (err) { return json(500, { error: explainBlobStoreError(err) }); }

    const domains = [];
    await Promise.all(keys.map(async key => {
      try {
        const raw = await store.get(key);
        if (!raw) return;
        const m = JSON.parse(raw);
        if (m.user_id !== user.id) return;
        // Only return domains mapped to this portfolio's slug family
        const mappedSlug = m.slug || "";
        const rootSlug = mappedSlug.replace(/-\d+$/, "");
        if (rootSlug !== slug) return;
        domains.push({
          domain: key.replace(/^domain\//, ""),
          slug:   mappedSlug,
          registered_at: m.registered_at || null
        });
      } catch { /* skip malformed entries */ }
    }));

    domains.sort((a, b) => a.domain.localeCompare(b.domain));
    return json(200, { ok: true, domains });
  }

  // ── DELETE DOMAIN ─────────────────────────────────────────────────────────────
  if (action === "deleteDomain") {
    const domain = sanitizeDomain(payload.domain);
    if (!domain || !domain.includes(".")) {
      return json(400, { error: "Invalid domain." });
    }

    // Verify the domain mapping belongs to this user before deleting
    try {
      const raw = await store.get(`domain/${domain}`);
      if (!raw) return json(404, { error: `Domain "${domain}" not found.` });
      const m = JSON.parse(raw);
      if (m.user_id !== user.id) return json(403, { error: "That domain does not belong to your account." });
    } catch (err) { return json(500, { error: explainBlobStoreError(err) }); }

    try {
      await store.delete(`domain/${domain}`);
    } catch (err) { return json(500, { error: `Delete failed: ${explainBlobStoreError(err)}` }); }

    return json(200, { ok: true, deleted: domain });
  }

  return json(400, { error: `Unknown action "${action}".` });
}
