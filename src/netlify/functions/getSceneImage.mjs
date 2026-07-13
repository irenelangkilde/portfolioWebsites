import { explainBlobStoreError, getPreviewImagesStore } from "./blobStore.mjs";

/**
 * GET /.netlify/functions/getSceneImage?key=<scene:jobId>
 * Returns the downscaled JPEG bytes for a scene-based hero image saved during
 * a Design-options generation. Images live in the preview-images blob store
 * with a "scene:" key prefix and share the 1-hour TTL of the generation job.
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
        body: "Scene image not found or expired"
      };
    }
    return {
      statusCode: 200,
      headers: {
        "content-type": "image/jpeg",
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
