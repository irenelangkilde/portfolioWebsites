import { createClient } from "@supabase/supabase-js";
import { checkStorage, addStorage } from "./storageQuota.mjs";
import { alertStorageLimitReached } from "./opsAlert.mjs";
import { createHash } from "crypto";
import { explainBlobStoreError, getPortfolioAssetsStore } from "./blobStore.mjs";

/**
 * POST /.netlify/functions/uploadPortfolioAsset
 *
 * Auth-gated upload endpoint for editor-managed assets (images, videos, PDFs).
 * Assets go to the `portfolio-assets` blob store under a per-user, content-hashed
 * key: `{userId}/{sha256Prefix}.{ext}`. Same file uploaded twice → one blob.
 *
 * Request:
 *   Authorization: Bearer <supabase session token>
 *   { filename: string, mimeType: string, data: base64-encoded bytes }
 *
 * Response:
 *   { ok: true, url, hash, size, mimeType }
 *
 * Companion serve endpoint: getPortfolioAsset.mjs
 * Note: `filename` currently affects only the returned metadata (kept for logging
 * and future features like Content-Disposition); the URL uses hash+ext only.
 */

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  };
}

// MIME whitelist. Extensions are what we use in the served URL; keeps URLs
// readable and lets browsers pick correct handlers without a HEAD request.
const ALLOWED_TYPES = {
  // Images
  "image/jpeg": "jpg",
  "image/png":  "png",
  "image/webp": "webp",
  "image/gif":  "gif",
  "image/svg+xml": "svg",
  // Videos
  "video/mp4":  "mp4",
  "video/webm": "webm",
  "video/ogg":  "ogv",
  "video/quicktime": "mov",
  // Documents
  "application/pdf": "pdf",
};

// 5 MB across all types for MVP. Real "portfolio video" support needs a
// separate path (Netlify Edge Function or direct-to-blob signed upload) —
// see SKILL.md limits at ~6 MB request body + ~33% base64 overhead.
const MAX_BYTES = 5 * 1024 * 1024;

function getSupabaseAdmin() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return json(500, { error: "Supabase admin environment is not configured." });
  }

  // Auth: signed-in users only.
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const accessToken = tokenMatch?.[1];
  if (!accessToken) return json(401, { error: "Missing bearer token." });

  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
  const user = authData?.user;
  if (authError || !user) return json(401, { error: "Invalid or expired session." });

  // Parse body.
  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const { filename = "", mimeType = "", data = "" } = payload;
  if (!mimeType || !data) {
    return json(400, { error: "mimeType and data are both required." });
  }

  const ext = ALLOWED_TYPES[mimeType];
  if (!ext) {
    return json(415, { error: `Unsupported media type: ${mimeType}` });
  }

  // Decode + size check. We do the base64 decode first because the base64
  // string can be up to ~33% larger than the underlying bytes — a Buffer's
  // .length reflects the actual byte count, which is what we want to cap.
  let buffer;
  try {
    buffer = Buffer.from(data, "base64");
  } catch {
    return json(400, { error: "Failed to decode base64 data." });
  }
  if (!buffer.length) {
    return json(400, { error: "Decoded body was empty." });
  }
  if (buffer.length > MAX_BYTES) {
    return json(413, {
      error: `File too large (${Math.round(buffer.length / 1024)} KB). Max is ${MAX_BYTES / 1024 / 1024} MB.`
    });
  }

  // Content-hashed key inside the user's namespace. 20 hex chars from SHA-256
  // is 80 bits — comfortably collision-resistant for a single user's asset
  // count, and keeps URLs shorter than the full 64-char hash.
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 20);
  const assetName = `${hash}.${ext}`;
  const key = `${user.id}/${assetName}`;

  const { store, configError } = getPortfolioAssetsStore();
  if (!store) return json(500, { error: configError });

  // Content-hashed keys mean re-uploading an identical file overwrites rather than adds.
  // Checking for the key first is what keeps the running total honest: without it, saving
  // the same photo twice would consume the allowance twice.
  let alreadyStored = false;
  try { alreadyStored = !!(await store.get(key)); }
  catch { /* treat an unreadable probe as "new" — the counter errs high, never low */ }

  if (!alreadyStored) {
    const quota = await checkStorage(supabase, user.id, buffer.length);
    if (!quota.allowed) {
      // First refusal anywhere is worth knowing about: it means an advertised number has
      // started biting real behaviour, which until now it never had.
      await alertStorageLimitReached({ userId: user.id, ...quota, incoming: buffer.length });
      return json(413, { error: quota.reason, storage: { used: quota.used, limit: quota.limit } });
    }
  }

  try {
    // Store as base64 (matches how getPreviewImage/getPublishedImage do it —
    // Netlify Function response bodies with isBase64Encoded work off strings).
    await store.set(key, buffer.toString("base64"), {
      metadata: {
        content_type: mimeType,
        original_filename: filename || "",
        size_bytes:  buffer.length,
        uploaded_at: new Date().toISOString(),
        user_id:     user.id,
      }
    });
  } catch (err) {
    return json(500, { error: explainBlobStoreError(err) });
  }

  if (!alreadyStored) await addStorage(supabase, user.id, buffer.length);

  const url = `/.netlify/functions/getPortfolioAsset?owner=${encodeURIComponent(user.id)}&asset=${encodeURIComponent(assetName)}`;
  return json(200, { ok: true, url, hash, size: buffer.length, mimeType });
}
