#!/usr/bin/env node
/**
 * One-off migration: extract inlined data URIs from published portfolio HTML,
 * upload each as a per-user asset, rewrite the HTML to reference the stable
 * URL, and write the updated HTML back to the published-sites store.
 *
 * Usage:
 *   NETLIFY_SITE_ID=xxx NETLIFY_AUTH_TOKEN=xxx node scripts/migrateInlineAssets.mjs [--dry-run] [--slug=<slug>]
 *
 * Safety:
 *   - Idempotent: running twice is safe (nothing to migrate on the second pass).
 *   - Non-destructive: only adds assets and rewrites HTML in place — never
 *     deletes anything.
 *   - Add --dry-run to log what would happen without writing.
 *   - --slug=<slug> to migrate a single portfolio (both bare + versioned).
 *
 * Requires @netlify/blobs (already in package.json).
 */

import { getStore } from "@netlify/blobs";
import { createHash } from "crypto";

const DRY_RUN = process.argv.includes("--dry-run");
const SLUG_ARG = (process.argv.find(a => a.startsWith("--slug=")) || "").split("=")[1] || "";

const SITE_ID = process.env.NETLIFY_SITE_ID;
const TOKEN   = process.env.NETLIFY_AUTH_TOKEN;
if (!SITE_ID || !TOKEN) {
  console.error("Missing NETLIFY_SITE_ID or NETLIFY_AUTH_TOKEN env vars.");
  process.exit(1);
}

const publishedSites = getStore({ name: "published-sites", siteID: SITE_ID, token: TOKEN });
const portfolioAssets = getStore({ name: "portfolio-assets", siteID: SITE_ID, token: TOKEN });

// MIME → extension. Must match the whitelist in uploadPortfolioAsset.mjs.
const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png":  "png",
  "image/webp": "webp",
  "image/gif":  "gif",
  "image/svg+xml": "svg",
  "video/mp4":  "mp4",
  "video/webm": "webm",
  "video/ogg":  "ogv",
  "video/quicktime": "mov",
  "application/pdf": "pdf",
};

// Match `data:<mime>;base64,<payload>`. Captures inside HTML — src, href, url(),
// srcset. Non-greedy on the payload so we don't accidentally swallow trailing
// HTML. The character class excludes what could plausibly terminate the URI in
// each context.
const DATA_URI_RE = /data:([a-zA-Z0-9./+-]+);base64,([A-Za-z0-9+/=]+)/g;

async function uploadAsset(userId, mimeType, base64) {
  const ext = MIME_EXT[mimeType];
  if (!ext) return null; // skip unsupported types — leave them inlined

  let buffer;
  try { buffer = Buffer.from(base64, "base64"); }
  catch { return null; }
  if (!buffer.length) return null;

  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 20);
  const assetName = `${hash}.${ext}`;
  const key = `${userId}/${assetName}`;

  if (!DRY_RUN) {
    // Only write if not already there — idempotency + content-addressed keying
    // means the same file uploaded twice has the same key; skip work.
    const existing = await portfolioAssets.get(key);
    if (!existing) {
      await portfolioAssets.set(key, buffer.toString("base64"), {
        metadata: {
          content_type: mimeType,
          original_filename: "",
          size_bytes:  buffer.length,
          uploaded_at: new Date().toISOString(),
          user_id:     userId,
          source:      "migrateInlineAssets",
        }
      });
    }
  }
  const url = `/.netlify/functions/getPortfolioAsset?owner=${encodeURIComponent(userId)}&asset=${encodeURIComponent(assetName)}`;
  return { url, hash, bytes: buffer.length, ext };
}

async function migrateOnePortfolio(htmlKey, metaKey) {
  const htmlRaw = await publishedSites.get(htmlKey);
  if (!htmlRaw) { console.warn(`  ${htmlKey}: HTML missing, skipping`); return null; }
  const metaRaw = await publishedSites.get(metaKey);
  if (!metaRaw) { console.warn(`  ${htmlKey}: meta missing, skipping`); return null; }
  const meta = JSON.parse(metaRaw);
  const userId = meta.user_id;
  if (!userId) { console.warn(`  ${htmlKey}: no user_id in meta, skipping`); return null; }

  const html = String(htmlRaw);
  const matches = [...html.matchAll(DATA_URI_RE)];
  if (!matches.length) return { htmlKey, migrated: 0, bytesReclaimed: 0 };

  let migrated = 0;
  let bytesReclaimed = 0;
  const replacements = new Map(); // original data URI → new URL

  for (const m of matches) {
    const [full, mimeType, base64] = m;
    if (replacements.has(full)) continue;
    const result = await uploadAsset(userId, mimeType, base64);
    if (!result) {
      console.warn(`  ${htmlKey}: skipped a ${mimeType} data URI (unsupported or empty)`);
      continue;
    }
    replacements.set(full, result.url);
    migrated += 1;
    bytesReclaimed += full.length - result.url.length;
  }

  if (!replacements.size) return { htmlKey, migrated: 0, bytesReclaimed: 0 };

  let newHtml = html;
  for (const [orig, url] of replacements) {
    // Simple global replace — data URIs are long and unique enough that a
    // plain string replace is unambiguous and much cheaper than another regex.
    newHtml = newHtml.split(orig).join(url);
  }

  if (!DRY_RUN) {
    await publishedSites.set(htmlKey, newHtml);
  }
  return { htmlKey, migrated, bytesReclaimed, before: html.length, after: newHtml.length };
}

async function main() {
  console.log(`migrateInlineAssets — ${DRY_RUN ? "DRY RUN" : "LIVE"}${SLUG_ARG ? ` — slug=${SLUG_ARG}` : ""}`);

  // Find every HTML key under html/. Format is `html/<slug>.html` or
  // `html/<slug>-<N>.html` for versioned deploys — both need migration.
  const { blobs } = await publishedSites.list({ prefix: "html/" });
  const htmlKeys = blobs
    .map(b => b.key)
    .filter(k => k.endsWith(".html"))
    .filter(k => !SLUG_ARG || k === `html/${SLUG_ARG}.html` || k.startsWith(`html/${SLUG_ARG}-`));

  console.log(`Found ${htmlKeys.length} HTML blob(s) to inspect.`);
  let totalMigrated = 0;
  let totalPortfoliosTouched = 0;
  let totalBytes = 0;

  for (const htmlKey of htmlKeys) {
    // Corresponding meta key: html/foo.html → meta/foo.json
    const slug = htmlKey.replace(/^html\//, "").replace(/\.html$/, "");
    const metaKey = `meta/${slug}.json`;
    console.log(`\n${htmlKey}`);
    try {
      const result = await migrateOnePortfolio(htmlKey, metaKey);
      if (result && result.migrated > 0) {
        totalMigrated += result.migrated;
        totalPortfoliosTouched += 1;
        totalBytes += result.bytesReclaimed;
        console.log(`  migrated ${result.migrated} inlined asset(s), HTML ${result.before} → ${result.after} bytes`);
      } else if (result) {
        console.log(`  no inlined assets found`);
      }
    } catch (err) {
      console.error(`  ERROR: ${err?.message || err}`);
    }
  }

  console.log(`\nDone. Migrated ${totalMigrated} asset(s) across ${totalPortfoliosTouched} portfolio(s). Reclaimed ~${Math.round(totalBytes / 1024)} KB of HTML.`);
  if (DRY_RUN) console.log("(dry run — no writes were performed)");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
