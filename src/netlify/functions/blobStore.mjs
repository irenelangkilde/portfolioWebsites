import { getStore } from "@netlify/blobs";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const PREVIEW_RESULTS_STORE = "preview-results";

function canUseLocalBlobFallback() {
  return process.env.NETLIFY_DEV === "true" || !process.env.AWS_LAMBDA_FUNCTION_NAME;
}

function isLocalBlobFailure(err) {
  const message = err?.message || "";
  const causeMessage = err?.cause?.message || "";
  return /invalid url|fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(`${message} ${causeMessage}`);
}

function localBlobPath(name, key) {
  return join(tmpdir(), "portfolio-webworks-blobs", encodeURIComponent(name), encodeURIComponent(key));
}

function createLocalBlobStore(name) {
  return {
    async get(key) {
      const file = localBlobPath(name, key);
      try {
        const raw = await readFile(file, "utf8");
        const wrapped = JSON.parse(raw);
        if (wrapped.expiresAt && Date.now() > wrapped.expiresAt) {
          await rm(file, { force: true });
          return null;
        }
        return wrapped.value;
      } catch {
        return null;
      }
    },
    async set(key, value, options = {}) {
      const file = localBlobPath(name, key);
      await mkdir(join(tmpdir(), "portfolio-webworks-blobs", encodeURIComponent(name)), { recursive: true });
      const ttlMs = Number(options.ttl || 0) > 0 ? Number(options.ttl) * 1000 : 0;
      await writeFile(file, JSON.stringify({
        value,
        expiresAt: ttlMs ? Date.now() + ttlMs : 0
      }), "utf8");
    }
  };
}

function withLocalFallback(store, name) {
  if (!store || !canUseLocalBlobFallback()) return store;
  const localStore = createLocalBlobStore(name);
  return {
    async get(key, ...args) {
      try {
        return await store.get(key, ...args);
      } catch (err) {
        if (!isLocalBlobFailure(err)) throw err;
        console.warn(`[blobStore] Falling back to local tmp store for get(${name}/${key}): ${err?.message || err}`);
        return localStore.get(key);
      }
    },
    async set(key, value, options) {
      try {
        return await store.set(key, value, options);
      } catch (err) {
        if (!isLocalBlobFailure(err)) throw err;
        console.warn(`[blobStore] Falling back to local tmp store for set(${name}/${key}): ${err?.message || err}`);
        return localStore.set(key, value, options);
      }
    }
  };
}

export function explainBlobStoreError(err) {
  const message = err?.message || "Unknown error";
  const stack = err?.stack || "";
  const missing = [];
  if (!process.env.NETLIFY_SITE_ID) missing.push("NETLIFY_SITE_ID");
  if (!process.env.NETLIFY_AUTH_TOKEN) missing.push("NETLIFY_AUTH_TOKEN");

  const blobContext = /@netlify\/blobs|blobStore\.mjs|getPreviewResult\.mjs|analyzeResume-background\.mjs|buildWebsite-background\.mjs/.test(stack);

  if (blobContext && /invalid url/i.test(message)) {
    const missingText = missing.length ? ` Missing: ${missing.join(", ")}.` : "";
    return `Netlify Blobs could not resolve a valid site/runtime URL.${missingText} Run this project with \`netlify dev\` from a linked site, or set valid Netlify credentials for local access. Underlying error: ${message}`;
  }

  return message;
}

export function getNamedBlobStore(name) {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN;

  try {
    if (siteID && token) {
      return {
        store: withLocalFallback(getStore({ name, siteID, token }), name),
        configError: null
      };
    }

    return {
      store: withLocalFallback(getStore({ name }), name),
      configError: null
    };
  } catch (err) {
    if (canUseLocalBlobFallback() && isLocalBlobFailure(err)) {
      return {
        store: createLocalBlobStore(name),
        configError: null
      };
    }

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

export function getPreviewResultsStore() {
  return getNamedBlobStore(PREVIEW_RESULTS_STORE);
}

const PREVIEW_IMAGES_STORE   = "preview-images";
const PUBLISHED_IMAGES_STORE = "published-images";

export function getPreviewImagesStore() {
  return getNamedBlobStore(PREVIEW_IMAGES_STORE);
}

export function getPublishedImagesStore() {
  return getNamedBlobStore(PUBLISHED_IMAGES_STORE);
}
