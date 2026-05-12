import { explainBlobStoreError, getPublishedImagesStore } from "./blobStore.mjs";

/**
 * GET /.netlify/functions/getPublishedImage?slug=<slug>
 * Returns the raw PNG bytes for a published portfolio's hero image.
 * Images are stored with no TTL — they persist as long as the portfolio exists.
 */
export async function handler(event) {
  const slug = event.queryStringParameters?.slug;
  if (!slug) {
    return { statusCode: 400, headers: { "content-type": "text/plain" }, body: "Missing slug" };
  }

  const { store, configError } = getPublishedImagesStore();
  if (!store) {
    return { statusCode: 500, headers: { "content-type": "text/plain" }, body: configError };
  }

  try {
    const b64 = await store.get(slug);
    if (!b64) {
      return {
        statusCode: 404,
        headers: { "content-type": "text/plain" },
        body: "Image not found"
      };
    }
    return {
      statusCode: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=86400"
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
