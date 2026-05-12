import { explainBlobStoreError, getPreviewImagesStore } from "./blobStore.mjs";

/**
 * GET /.netlify/functions/getPreviewImage?key=<jobId>
 * Returns the raw PNG bytes for a preview image stored during generation.
 * Images expire after 1 hour (same TTL as the preview-results job record).
 */
export async function handler(event) {
  const key = event.queryStringParameters?.key;
  if (!key) {
    return { statusCode: 400, headers: { "content-type": "text/plain" }, body: "Missing key" };
  }

  const { store, configError } = getPreviewImagesStore();
  if (!store) {
    return { statusCode: 500, headers: { "content-type": "text/plain" }, body: configError };
  }

  try {
    const b64 = await store.get(key);
    if (!b64) {
      return {
        statusCode: 404,
        headers: { "content-type": "text/plain" },
        body: "Image not found or expired"
      };
    }
    return {
      statusCode: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=3600"
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
