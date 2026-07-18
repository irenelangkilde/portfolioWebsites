import { explainBlobStoreError, getPublishedImagesStore } from "./blobStore.mjs";

/**
 * GET /.netlify/functions/getPublishedImage?slug=<slug>[&kind=scene]
 *
 * Serves permanent hero images for published portfolios. Images are written by
 * publishPortfolio at publish time and persist for the life of the portfolio.
 *
 *   kind (default) → PNG masthead image, keyed by slug
 *   kind=scene     → JPEG scene-hero image, keyed by `${slug}:scene`
 *
 * Keep the kind→(store-key, content-type) mapping in sync with the promotion
 * loop in publishPortfolio.mjs.
 */
const KIND_CONFIG = {
  default: { keySuffix: "",       contentType: "image/png"  },
  scene:   { keySuffix: ":scene", contentType: "image/jpeg" },
};

export async function handler(event) {
  const slug = event.queryStringParameters?.slug;
  const kind = event.queryStringParameters?.kind || "default";
  if (!slug) {
    return { statusCode: 400, headers: { "content-type": "text/plain" }, body: "Missing slug" };
  }
  const cfg = KIND_CONFIG[kind];
  if (!cfg) {
    return { statusCode: 400, headers: { "content-type": "text/plain" }, body: `Unknown image kind: ${kind}` };
  }

  const { store, configError } = getPublishedImagesStore();
  if (!store) {
    return { statusCode: 500, headers: { "content-type": "text/plain" }, body: configError };
  }

  try {
    const b64 = await store.get(`${slug}${cfg.keySuffix}`);
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
        "content-type": cfg.contentType,
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
