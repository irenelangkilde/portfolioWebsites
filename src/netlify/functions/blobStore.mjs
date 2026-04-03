import { getStore } from "@netlify/blobs";

const STORE_NAME = "preview-results";

export function explainBlobStoreError(err) {
  const message = err?.message || "Unknown error";
  const missing = [];
  if (!process.env.NETLIFY_SITE_ID) missing.push("NETLIFY_SITE_ID");
  if (!process.env.NETLIFY_AUTH_TOKEN) missing.push("NETLIFY_AUTH_TOKEN");

  if (/invalid url/i.test(message)) {
    const missingText = missing.length ? ` Missing: ${missing.join(", ")}.` : "";
    return `Netlify Blobs could not resolve a valid site/runtime URL.${missingText} Run this project with \`netlify dev\` from a linked site, or set valid Netlify credentials for local access. Underlying error: ${message}`;
  }

  return message;
}

export function getPreviewResultsStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN;

  try {
    if (siteID && token) {
      return {
        store: getStore({ name: STORE_NAME, siteID, token }),
        configError: null
      };
    }

    return {
      store: getStore({ name: STORE_NAME }),
      configError: null
    };
  } catch (err) {
    const missing = [];
    if (!siteID) missing.push("NETLIFY_SITE_ID");
    if (!token) missing.push("NETLIFY_AUTH_TOKEN");

    const missingText = missing.length
      ? ` Missing: ${missing.join(", ")}.`
      : "";

    return {
      store: null,
      configError: `Netlify Blobs is not configured for local/background function access.${missingText} Run via Netlify Dev with a linked site, or set valid Netlify credentials.${err?.message ? ` Underlying error: ${err.message}` : ""}`
    };
  }
}
