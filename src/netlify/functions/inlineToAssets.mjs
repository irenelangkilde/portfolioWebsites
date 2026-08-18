/**
 * Turn data URIs embedded in a document into stored assets.
 *
 * Signed-out editing falls back to inlining images as base64, capped client-side at 12 MB
 * per document. That keeps a published page tolerable but not good: base64 is a third
 * larger than the bytes it carries, it cannot be cached separately from the HTML, and every
 * visitor downloads every image again on every page load. Publishing is the first moment an
 * account certainly exists, so it is the right place to convert.
 *
 * NEVER FAILS THE PUBLISH. Every failure — an unsupported type, a full allowance, a blob
 * write that errors — leaves that image inline and moves on. A portfolio that publishes
 * with a fat HTML file is enormously better than one that does not publish, and the person
 * pressing the button is not thinking about storage formats.
 *
 * Keys match uploadPortfolioAsset exactly — `${user.id}/${sha256(bytes).slice(0,20)}.${ext}`
 * — so an image inlined in the editor and the same image uploaded properly collapse onto
 * one stored file rather than two.
 */

import { createHash } from "crypto";
import { getPortfolioAssetsStore } from "./blobStore.mjs";
import { checkStorage, addStorage } from "./storageQuota.mjs";

const ALLOWED_TYPES = {
  "image/jpeg": "jpg",
  "image/png":  "png",
  "image/webp": "webp",
  "image/gif":  "gif",
  "image/svg+xml": "svg",
};

// Matches the base64 data URIs the editor produces. Deliberately not global-stateful: a
// fresh regex per call, because a lastIndex left over from a previous document is the
// classic way this kind of loop silently skips matches.
function dataUriPattern() {
  return /data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/gi;
}

/**
 * @returns {Promise<{ html: string, converted: number, skipped: number, bytesStored: number }>}
 */
export async function convertInlineImages(html, userId, supabase) {
  const result = { html, converted: 0, skipped: 0, bytesStored: 0 };
  if (!html || !userId) return result;

  const { store, configError } = getPortfolioAssetsStore();
  if (!store) {
    console.warn("[inline2asset] asset store unavailable:", configError);
    return result;
  }

  // Collected first, then processed. Rewriting the string while iterating over matches of
  // that same string is how offsets drift and a document ends up half-converted.
  const matches = [...html.matchAll(dataUriPattern())];
  if (!matches.length) return result;

  // Identical images appear more than once — a logo in a header and a footer. Deduplicated
  // by payload so the same bytes are hashed, quota-checked and written once.
  const byPayload = new Map();
  for (const m of matches) {
    if (!byPayload.has(m[0])) byPayload.set(m[0], { mime: m[1].toLowerCase(), b64: m[2] });
  }

  const replacements = new Map();

  for (const [full, { mime, b64 }] of byPayload) {
    const ext = ALLOWED_TYPES[mime];
    if (!ext) { result.skipped++; continue; }

    let buffer;
    try { buffer = Buffer.from(b64, "base64"); }
    catch { result.skipped++; continue; }
    if (!buffer.length) { result.skipped++; continue; }

    const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 20);
    const key  = `${userId}/${hash}.${ext}`;

    try {
      // Already stored — from an earlier publish, or uploaded properly at some point. No
      // new bytes, so no quota check and no counter change.
      const existing = await store.get(key);

      if (!existing) {
        const quota = await checkStorage(supabase, userId, buffer.length);
        if (!quota.allowed) {
          // Left inline rather than refused. Publishing is not the moment to enforce
          // storage: the alternative is failing a publish over a formatting improvement
          // the customer never asked for.
          console.warn(`[inline2asset] leaving an image inline — ${quota.reason}`);
          result.skipped++;
          continue;
        }
        await store.set(key, buffer.toString("base64"), {
          metadata: {
            content_type: mime,
            original_filename: "",
            size_bytes:  buffer.length,
            uploaded_at: new Date().toISOString(),
            user_id:     userId,
            source:      "publish-conversion",
          },
        });
        await addStorage(supabase, userId, buffer.length);
        result.bytesStored += buffer.length;
      }

      replacements.set(full,
        `/.netlify/functions/getPortfolioAsset?owner=${encodeURIComponent(userId)}&asset=${encodeURIComponent(`${hash}.${ext}`)}`);
      result.converted++;
    } catch (err) {
      console.warn("[inline2asset] could not store an image:", err?.message);
      result.skipped++;
    }
  }

  // Longest first, so a shorter payload that happens to be a prefix of a longer one cannot
  // corrupt it mid-replacement.
  const ordered = [...replacements.keys()].sort((a, b) => b.length - a.length);
  let out = html;
  for (const full of ordered) out = out.split(full).join(replacements.get(full));
  result.html = out;

  if (result.converted || result.skipped) {
    console.log(`[inline2asset] converted ${result.converted}, skipped ${result.skipped}, stored ${result.bytesStored} bytes`);
  }
  return result;
}
