import { getStore } from "@netlify/blobs";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const PREVIEW_RESULTS_STORE = "preview-results";

function canUseLocalBlobFallback() {
  return process.env.NETLIFY_DEV === "true" || !process.env.AWS_LAMBDA_FUNCTION_NAME;
}

function isNetlifyManagedRuntime() {
  return !!process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY === "true";
}

function isLocalBlobFailure(err) {
  const message = err?.message || "";
  const causeMessage = err?.cause?.message || "";
  return /invalid url|fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|401 status code|403 status code|unauthorized|forbidden|environment has not been configured|MissingBlobsEnvironmentError/i.test(`${message} ${causeMessage}`);
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

  if (blobContext && /401 status code|403 status code|unauthorized|forbidden/i.test(message)) {
    if (canUseLocalBlobFallback()) {
      return `Netlify Blobs authentication failed locally, so the local fallback store should be used. Underlying error: ${message}`;
    }
    return `Netlify Blobs authentication failed. In deployed Netlify functions, remove stale NETLIFY_AUTH_TOKEN/NETLIFY_SITE_ID overrides or rotate the token, then redeploy. Underlying error: ${message}`;
  }

  return message;
}

export function getNamedBlobStore(name) {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN;
  const hasExplicitCredentials = !!(siteID && token);
  const managed = isNetlifyManagedRuntime();

  // Ordered attempts rather than one branch.
  //
  // The previous logic used explicit credentials ONLY when not in a managed runtime
  // (`siteID && token && !isNetlifyManagedRuntime()`), which meant a deployed function
  // could never fall back to them. That is fine while Netlify injects its blobs context,
  // and fatal when it does not: the function fails with "The environment has not been
  // configured to use Netlify Blobs" while perfectly good credentials sit unread in the
  // environment, and the local fallback is (correctly) refused on Lambda.
  //
  // Order differs by runtime because the likely-correct source differs. In a managed
  // runtime the injected context is preferred and scoped to the deploy; locally there is
  // no injected context at all, so explicit credentials come first.
  const attempts = managed
    ? [
        { label: "injected context", make: () => getStore({ name }) },
        ...(hasExplicitCredentials
          ? [{ label: "explicit credentials", make: () => getStore({ name, siteID, token }) }]
          : []),
      ]
    : [
        ...(hasExplicitCredentials
          ? [{ label: "explicit credentials", make: () => getStore({ name, siteID, token }) }]
          : []),
        { label: "injected context", make: () => getStore({ name }) },
      ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      return { store: withLocalFallback(attempt.make(), name), configError: null };
    } catch (err) {
      lastError = err;
    }
  }

  // Local dev only. Never on Lambda: a tmpdir store there would appear to work and
  // silently lose every write between invocations.
  if (canUseLocalBlobFallback() && isLocalBlobFailure(lastError)) {
    return { store: createLocalBlobStore(name), configError: null };
  }

  const missing = [];
  if (!siteID) missing.push("NETLIFY_SITE_ID");
  if (!token) missing.push("NETLIFY_AUTH_TOKEN");

  const missingText = missing.length ? ` Missing: ${missing.join(", ")}.` : "";

  // Which runtime was detected, and what was actually tried. Without this the message is
  // the same whether credentials were absent, present-but-rejected, or never attempted.
  const diag = ` [runtime: ${managed ? "netlify-managed" : "local"}; tried: ${attempts.map(a => a.label).join(" → ")}]`;

  return {
    store: null,
    configError: `Netlify Blobs is not configured for local/background function access.${missingText} Run via Netlify Dev with a linked site, or set valid Netlify credentials.${diag}${lastError?.message ? ` Underlying error: ${lastError.message}` : ""}`
  };
}

export function getPreviewResultsStore() {
  return getNamedBlobStore(PREVIEW_RESULTS_STORE);
}

const PREVIEW_IMAGES_STORE   = "preview-images";
const PUBLISHED_IMAGES_STORE = "published-images";
const PORTFOLIO_ASSETS_STORE = "portfolio-assets";

export function getPreviewImagesStore() {
  return getNamedBlobStore(PREVIEW_IMAGES_STORE);
}

export function getPublishedImagesStore() {
  return getNamedBlobStore(PUBLISHED_IMAGES_STORE);
}

// Per-user assets uploaded via the editor: images, videos, PDFs. Keyed by
// `{userId}/{sha256Prefix}.{ext}` for per-user dedup and namespace isolation.
// Written by uploadPortfolioAsset, read by getPortfolioAsset.
export function getPortfolioAssetsStore() {
  return getNamedBlobStore(PORTFOLIO_ASSETS_STORE);
}
