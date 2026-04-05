import { explainBlobStoreError, getNamedBlobStore } from "./blobStore.mjs";

const PUBLISHED_SITES_STORE = "published-sites";

function sanitizeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function handler(event) {
  const slug = sanitizeSlug(event.queryStringParameters?.slug);
  if (!slug) {
    return {
      statusCode: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: "Missing slug"
    };
  }

  const { store, configError } = getNamedBlobStore(PUBLISHED_SITES_STORE);
  if (!store) {
    return {
      statusCode: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: configError
    };
  }

  try {
    const html = await store.get(`html/${slug}.html`);
    if (!html) {
      return {
        statusCode: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
        body: "Published page not found"
      };
    }

    return {
      statusCode: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=60"
      },
      body: html
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: explainBlobStoreError(err)
    };
  }
}
