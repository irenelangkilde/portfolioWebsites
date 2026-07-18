import { explainBlobStoreError, getPortfolioAssetsStore } from "./blobStore.mjs";

/**
 * GET /.netlify/functions/getPortfolioAsset?owner=<userId>&asset=<hash>.<ext>
 *
 * Public endpoint that serves user-uploaded portfolio assets. No auth: assets
 * are meant to be visible on published portfolios that anyone can view.
 *
 * Companion upload endpoint: uploadPortfolioAsset.mjs
 * See ALLOWED_TYPES there for the accepted extensions.
 */

// Extension → content-type. Must stay in sync with ALLOWED_TYPES in
// uploadPortfolioAsset.mjs (mirrored, not shared, so serve behavior is
// independent of upload validation — a caller could still request an
// extension that's technically no longer accepted for upload).
const EXT_CONTENT_TYPE = {
  jpg:  "image/jpeg",
  png:  "image/png",
  webp: "image/webp",
  gif:  "image/gif",
  svg:  "image/svg+xml",
  mp4:  "video/mp4",
  webm: "video/webm",
  ogv:  "video/ogg",
  mov:  "video/quicktime",
  pdf:  "application/pdf",
};

// Asset path shape enforced strictly to prevent traversal (../../etc.) and
// to reject stray characters that would break the blob lookup anyway.
const ASSET_RE = /^([0-9a-f]{8,64})\.([a-z0-9]{2,5})$/i;

// UUID or opaque-ish user ID. Supabase user IDs are UUIDs; we accept a
// slightly looser shape so future ID formats don't break the endpoint.
const OWNER_RE = /^[a-zA-Z0-9._-]{8,128}$/;

export async function handler(event) {
  const owner = event.queryStringParameters?.owner;
  const asset = event.queryStringParameters?.asset;
  if (!owner || !asset) {
    return { statusCode: 400, headers: { "content-type": "text/plain" }, body: "Missing owner or asset." };
  }
  if (!OWNER_RE.test(owner)) {
    return { statusCode: 400, headers: { "content-type": "text/plain" }, body: "Bad owner." };
  }
  const match = asset.match(ASSET_RE);
  if (!match) {
    return { statusCode: 400, headers: { "content-type": "text/plain" }, body: "Bad asset name." };
  }
  const ext = match[2].toLowerCase();
  const contentType = EXT_CONTENT_TYPE[ext];
  if (!contentType) {
    return { statusCode: 415, headers: { "content-type": "text/plain" }, body: `Unsupported extension: ${ext}` };
  }

  const { store, configError } = getPortfolioAssetsStore();
  if (!store) {
    return { statusCode: 500, headers: { "content-type": "text/plain" }, body: configError };
  }

  try {
    const b64 = await store.get(`${owner}/${asset}`);
    if (!b64) {
      return { statusCode: 404, headers: { "content-type": "text/plain" }, body: "Asset not found." };
    }
    return {
      statusCode: 200,
      headers: {
        "content-type": contentType,
        // Content-hashed URLs are immutable — cache indefinitely on the browser.
        "cache-control": "public, max-age=31536000, immutable"
      },
      body: b64,
      isBase64Encoded: true
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "content-type": "text/plain" },
      body: explainBlobStoreError(err)
    };
  }
}
