import { createClient } from "@supabase/supabase-js";
import { explainBlobStoreError, getNamedBlobStore } from "./blobStore.mjs";

const PUBLISHED_SITES_STORE = "published-sites";

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  };
}

function sanitizeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function defaultSlugForUser(user) {
  const emailPrefix = sanitizeSlug(String(user?.email || "").split("@")[0]) || "portfolio";
  const suffix = String(user?.id || "").replace(/-/g, "").slice(0, 8).toLowerCase() || "site";
  return `${emailPrefix}-${suffix}`;
}

function getSupabaseAdmin() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function buildPublishUrl(event, slug) {
  const host = event.headers["x-forwarded-host"] || event.headers.host || "localhost";
  const isLocal = /^localhost(:\d+)?$/.test(host);
  const proto = isLocal
    ? "http"
    : (event.headers["x-forwarded-proto"] || event.headers["X-Forwarded-Proto"] || "https");
  return `${proto}://${host}/u/${encodeURIComponent(slug)}`;
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

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

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const html = String(payload.html || "").trim();
  if (!html || !/<html[\s>]/i.test(html)) {
    return json(400, { error: "Missing complete HTML document." });
  }

  const slug = sanitizeSlug(payload.slug) || defaultSlugForUser(user);
  if (!slug) {
    return json(400, { error: "Could not derive a valid publish slug." });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("memberships")
    .select("deploys_used, deploys_limit, status")
    .eq("user_id", user.id)
    .single();

  if (membershipError || !membership) {
    return json(403, { error: "No active membership record found for this account." });
  }
  if (membership.status !== "active") {
    return json(403, { error: `Membership is ${membership.status}. Publishing is disabled.` });
  }

  const deploysUsed  = membership.deploys_used  ?? 0;
  const deploysLimit = membership.deploys_limit ?? 0;
  if (deploysLimit !== -1 && deploysUsed >= deploysLimit) {
    return json(403, { error: "Please UPGRADE to publish or download with this account." });
  }

  const { store, configError } = getNamedBlobStore(PUBLISHED_SITES_STORE);
  if (!store) {
    return json(500, { error: configError });
  }

  const metaKey = `meta/${slug}.json`;
  const htmlKey = `html/${slug}.html`;

  try {
    const existingMetaRaw = await store.get(metaKey);
    const existingMeta = existingMetaRaw ? JSON.parse(existingMetaRaw) : null;

    if (existingMeta?.user_id && existingMeta.user_id !== user.id) {
      return json(409, { error: "That publish URL is already taken." });
    }

    // Each publish gets a versioned slug: {slug}-{N} where N = deploys_used + 1
    const deployNumber   = deploysUsed + 1;
    const versionedSlug  = `${slug}-${deployNumber}`;
    const versionedHtmlKey = `html/${versionedSlug}.html`;
    const versionedMetaKey = `meta/${versionedSlug}.json`;

    const now = new Date().toISOString();
    const metaPayload = {
      slug,
      user_id: user.id,
      email: user.email || "",
      created_at: existingMeta?.created_at || now,
      updated_at: now,
      latest_deploy: deployNumber
    };

    // Write bare slug (always the latest) AND versioned slug (permanent snapshot)
    await store.set(htmlKey, html);
    await store.set(versionedHtmlKey, html);
    await store.set(metaKey, JSON.stringify(metaPayload));
    await store.set(versionedMetaKey, JSON.stringify({ ...metaPayload, slug: versionedSlug }));

    const { error: updateError } = await supabase
      .from("memberships")
      .update({ deploys_used: deployNumber })
      .eq("user_id", user.id);
    if (updateError) {
      return json(500, { error: "Published, but failed to update deploy quota." });
    }

    return json(200, {
      ok: true,
      slug,
      versionedSlug,
      url: buildPublishUrl(event, slug),
      versionedUrl: buildPublishUrl(event, versionedSlug),
      deployNumber,
      republished: !!existingMeta
    });
  } catch (err) {
    return json(500, { error: explainBlobStoreError(err) });
  }
}
