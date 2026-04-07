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

function sanitizeDomain(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")  // strip protocol if pasted
    .replace(/\/.*$/, "")          // strip any path
    .trim();
}

function sanitizeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// Register a domain alias on the Netlify site via the Netlify API.
// If Netlify also manages the DNS zone for the domain, it will handle
// SSL provisioning automatically.
async function addNetlifyDomainAlias(domain) {
  const siteId = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_AUTH_TOKEN;
  if (!siteId || !token) {
    return { ok: false, error: "NETLIFY_SITE_ID or NETLIFY_AUTH_TOKEN not configured." };
  }

  // Fetch current aliases so we don't duplicate
  const listRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!listRes.ok) {
    return { ok: false, error: `Netlify API error fetching site: ${listRes.status}` };
  }
  const site = await listRes.json();
  const existing = site.domain_aliases || [];
  if (existing.includes(domain)) {
    return { ok: true, alreadyRegistered: true };
  }

  // PATCH site to add the new alias
  const patchRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ domain_aliases: [...existing, domain] })
  });
  if (!patchRes.ok) {
    const text = await patchRes.text();
    return { ok: false, error: `Netlify API error registering domain: ${patchRes.status} — ${text.slice(0, 200)}` };
  }

  return { ok: true, alreadyRegistered: false };
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  // Authenticate the user
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return json(500, { error: "Supabase admin environment is not configured." });
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const accessToken = tokenMatch?.[1];
  if (!accessToken) {
    return json(401, { error: "Missing bearer token." });
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
  const user = authData?.user;
  if (authError || !user) {
    return json(401, { error: "Invalid or expired session." });
  }

  // Parse body
  let payload;
  try { payload = JSON.parse(event.body || "{}"); } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const domain = sanitizeDomain(payload.domain);
  const slug   = sanitizeSlug(payload.slug);

  if (!domain || !domain.includes(".")) {
    return json(400, { error: "Invalid domain. Provide a bare domain like janesmith.com." });
  }
  if (!slug) {
    return json(400, { error: "Missing slug — the portfolio identifier to map this domain to." });
  }

  // Verify the slug actually belongs to this user
  const { store, configError } = getNamedBlobStore(PUBLISHED_SITES_STORE);
  if (!store) return json(500, { error: configError });

  let meta;
  try {
    const raw = await store.get(`meta/${slug}.json`);
    if (!raw) return json(404, { error: `No published portfolio found for slug "${slug}".` });
    meta = JSON.parse(raw);
  } catch (err) {
    return json(500, { error: explainBlobStoreError(err) });
  }

  if (meta.user_id !== user.id) {
    return json(403, { error: "That portfolio does not belong to your account." });
  }

  // Register domain alias on Netlify
  const netlifyResult = await addNetlifyDomainAlias(domain);
  if (!netlifyResult.ok) {
    return json(502, { error: netlifyResult.error });
  }

  // Store domain → slug mapping in blob store so the edge function can look it up
  try {
    await store.set(`domain/${domain}`, JSON.stringify({
      slug,
      user_id: user.id,
      registered_at: new Date().toISOString()
    }));
  } catch (err) {
    return json(500, { error: `Domain registered with Netlify but mapping save failed: ${explainBlobStoreError(err)}` });
  }

  return json(200, {
    ok: true,
    domain,
    slug,
    alreadyRegistered: netlifyResult.alreadyRegistered,
    instructions: [
      `Point your domain's DNS to Netlify:`,
      `  CNAME  www  →  ${process.env.NETLIFY_SITE_URL || "your-site.netlify.app"}`,
      `  A      @    →  75.2.60.5`,
      `SSL will be provisioned automatically once DNS propagates (usually under an hour).`
    ].join("\n")
  });
}
