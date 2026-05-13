#!/usr/bin/env node
/**
 * Normalizes templates/<major>/sample.html → templates/<major>/normalized.html
 *
 * Two transforms applied in order:
 *   1. Image path renaming  (deterministic)
 *       • All .png/.jpg references in CSS url() and HTML src attributes have
 *         their path prefix stripped and are renumbered image1.png, image2.png …
 *       • Headshot images (detected by filename) become headshot.png/jpg.
 *   2. Color extraction  (programmatic — no AI)
 *       • Extracts the 5 perceptually distinct color roles via OKLCH clustering.
 *       • Injects a <style id="extracted-theme"> block with CSS custom properties
 *         and a <script id="color-palette"> block with palette metadata into <head>.
 *
 * Usage:
 *   node scripts/preprocessSamples.mjs [major1 major2 ...]
 *   node scripts/preprocessSamples.mjs --dry-run
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

import {
  extractRegex, dedup, autoFit, assignRoles, invertRoles, buildCss, buildJson,
} from "../src/extractHtmlColors/extractColors.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, "..");
const TEMPLATES = join(ROOT, "templates");
const MIN_SEP   = 1.5;

const dryRun    = process.argv.includes("--dry-run");
const requested = process.argv.slice(2).filter(a => !a.startsWith("--"));

const majors = requested.length > 0
  ? requested
  : readdirSync(TEMPLATES)
      .filter(f => statSync(join(TEMPLATES, f)).isDirectory())
      .filter(f => existsSync(join(TEMPLATES, f, "sample.html")))
      .sort();

// ─── Image path renaming ──────────────────────────────────────────────────────

function renameImagePaths(html) {
  const seen = new Set();
  const ordered = [];

  for (const pattern of [
    /url\(\s*["']?([^"')>\s]+\.(?:png|jpe?g))["']?\s*\)/gi,
    /\bsrc=["']([^"']+\.(?:png|jpe?g))["']/gi,
  ]) {
    let m;
    while ((m = pattern.exec(html)) !== null) {
      const path = m[1];
      if (!seen.has(path)) { seen.add(path); ordered.push(path); }
    }
  }

  const renameMap = new Map();
  let n = 1;
  for (const ref of ordered) {
    const filename = ref.split("/").pop().split("?")[0];
    const ext = (filename.match(/\.(jpe?g|png)$/i) || [".png"])[0]
      .toLowerCase().replace("jpeg", "jpg");
    const isHeadshot =
      /head[-_]?shot|profile[-_]?(?:photo|pic)?|portrait|avatar/i.test(filename);
    renameMap.set(ref, isHeadshot ? `headshot${ext}` : `image${n++}${ext}`);
  }

  let out = html;
  for (const [orig, renamed] of [...renameMap.entries()].sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(orig).join(renamed);
  }

  return { html: out, renameMap };
}

// ─── Masthead metadata ────────────────────────────────────────────────────────

const MASTHEAD_PLACEHOLDER_URL = "braid-masthead.png";

function stripCssComments(v = "") {
  return String(v || "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
}

function analyzeSampleMasthead(sampleHtml = "") {
  const headerMatch = sampleHtml.match(/<header\b[^>]*>([\s\S]{0,8000})<\/header>/i);
  const heroMatch   = sampleHtml.match(
    /<(?:section|header|div)[^>]*(?:id|class)=["'][^"']*hero[^"']*["'][^>]*>([\s\S]{0,5000})/i
  );
  const searchRegions = [headerMatch?.[1], heroMatch?.[1], sampleHtml.slice(0, 6000)]
    .filter(Boolean).join("\n");
  const styleBlock = (sampleHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/i) || [])[1] || "";

  const rasterImgMatch = searchRegions.match(
    /<img\b[^>]*src=["'](?!data:)[^"']+\.(?:png|jpe?g)(?:\?[^"']*)?["'][^>]*>/i
  );
  const cssBlocks = [...styleBlock.matchAll(/([^{}]+)\{([\s\S]*?)\}/g)];
  const rasterBgBlock = cssBlocks.find(([, selector, body]) =>
    /(header|\bhero\b)/i.test(selector) &&
    /url\(\s*["']?[^"')]+\.(?:png|jpe?g)(?:\?[^"')]*)?["']?\s*\)/i.test(body)
  );
  const sampleRasterCssSelector    = stripCssComments(rasterBgBlock?.[1] || "");
  const sampleRasterBackgroundDecl = rasterBgBlock?.[2]?.match(/background\s*:\s*[\s\S]*?;/i)?.[0]?.trim() || "";
  const rasterBgMatch = rasterBgBlock
    ? (rasterBgBlock[2].match(/url\(\s*["']?([^"')]+\.(?:png|jpe?g)(?:\?[^"')]*)?)["']?\s*\)/i) || [])[1] || true
    : null;
  const sampleRasterCssUrl       = typeof rasterBgMatch === "string" ? rasterBgMatch : "";
  const sampleHeaderContainsHero = /class=["'][^"']*\bhero\b[^"']*["']/i.test(headerMatch?.[1] || "");
  const sampleHasRasterHeroImage = !!(rasterImgMatch || rasterBgMatch);

  return {
    sampleHasRasterHeroImage,
    sampleRasterCssUrl,
    sampleRasterCssSelector,
    sampleRasterBackgroundDecl,
    sampleHeaderContainsHero,
    mastheadPlaceholderUrl: MASTHEAD_PLACEHOLDER_URL,
    domainContext: ""
  };
}

function embedMastheadMetaComment(html = "", mastheadMeta = null) {
  if (!mastheadMeta || !html) return html;
  const comment = `<!-- IW_MASTHEAD_META: ${JSON.stringify(mastheadMeta)} -->\n`;
  if (/<!--\s*IW_MASTHEAD_META:/i.test(html)) {
    return html.replace(/<!--\s*IW_MASTHEAD_META:\s*[\s\S]*?-->\s*/i, comment);
  }
  if (/<!DOCTYPE[^>]*>\s*/i.test(html)) {
    return html.replace(/(<!DOCTYPE[^>]*>\s*)/i, `$1${comment}`);
  }
  return comment + html;
}

// ─── Color extraction + injection ────────────────────────────────────────────

function hexToRgb(hex) {
  const h = hex.replace("#", "").toLowerCase();
  if (h.length === 3)
    return { r: parseInt(h[0]+h[0],16), g: parseInt(h[1]+h[1],16), b: parseInt(h[2]+h[2],16) };
  return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
}

function buildRgbVars(roles) {
  const lines = [":root {"];
  for (const [varName, entry] of Object.entries(roles)) {
    const { r, g, b } = hexToRgb(entry.hex);
    lines.push(`  ${varName}-rgb: ${r}, ${g}, ${b};`);
  }
  lines.push("}");
  return lines.join("\n");
}

// Collect every hex that belongs to each role's cluster so we can rewrite them all.
function buildHexToVarMap(roles, clusters) {
  const map = new Map(); // lowercase hex → CSS var name
  for (const [varName, roleEntry] of Object.entries(roles)) {
    const cluster = clusters.find(c => c.hex === roleEntry.hex);
    if (!cluster) { map.set(roleEntry.hex.toLowerCase(), varName); continue; }
    const addHex = h => map.set(h.toLowerCase(), varName);
    addHex(cluster.hex);
    cluster.merged.forEach(addHex);
    for (const member of cluster.members) {
      addHex(member.hex);
      member.merged.forEach(addHex);
    }
  }
  return map;
}

function rewriteCssVars(html, roles, clusters) {
  const hexToVar = buildHexToVarMap(roles, clusters);

  // Build rgba() lookup: "r,g,b" → var name
  const rgbToVar = new Map();
  for (const [hex, varName] of hexToVar) {
    const { r, g, b } = hexToRgb(hex.length === 4 ? hex : hex); // already lowercase 6-digit
    rgbToVar.set(`${r},${g},${b}`, varName);
  }

  function rewriteCss(css) {
    // 6-digit hex
    let out = css.replace(/#([0-9a-fA-F]{6})\b/g, (m) => {
      const v = hexToVar.get(m.toLowerCase()); return v ? `var(${v})` : m;
    });
    // 3-digit hex
    out = out.replace(/#([0-9a-fA-F]{3})\b/g, (m, d) => {
      const exp = "#" + d.split("").map(c => c+c).join("");
      const v = hexToVar.get(exp.toLowerCase()); return v ? `var(${v})` : m;
    });
    // rgba() / rgb()
    out = out.replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+%?)\s*)?\)/g,
      (m, r, g, b, a) => {
        const v = rgbToVar.get(`${+r},${+g},${+b}`);
        if (!v) return m;
        return a !== undefined ? `rgba(var(${v}-rgb),${a})` : `rgb(var(${v}-rgb))`;
      });
    return out;
  }

  // Rewrite <style> blocks (skip extracted-theme — it uses oklch() values, not hex)
  let result = html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (match, attrs, css) => {
    if (/id\s*=\s*["']extracted-theme["']/i.test(attrs)) return match;
    return `<style${attrs}>${rewriteCss(css)}</style>`;
  });

  // Rewrite inline style attributes
  result = result.replace(/(\bstyle\s*=\s*")([^"]*?)(")/gi, (m, open, css, close) =>
    `${open}${rewriteCss(css)}${close}`);
  result = result.replace(/(\bstyle\s*=\s*')([^']*?)(')/gi, (m, open, css, close) =>
    `${open}${rewriteCss(css)}${close}`);

  return result;
}

function injectColorTheme(html, minSep = MIN_SEP) {
  const counts     = extractRegex(html);
  const candidates = dedup(counts);
  const fit        = autoFit(candidates, minSep);
  const { clusters, confidence } = fit;
  const roles      = assignRoles(clusters);
  const inverted   = invertRoles(roles);
  const meta       = { k: fit.k, confidence, threshold: minSep };

  const injection = [
    `<style id="extracted-theme">`,
    buildCss(roles, inverted),
    `/* RGB channel variables — enables rgba(var(--color-primary-rgb), alpha) */`,
    buildRgbVars(roles),
    `</style>`,
    `<script type="application/json" id="color-palette">`,
    buildJson(clusters, roles, inverted, meta),
    `</script>`,
  ].join("\n");

  let injected;
  if (html.includes("</head>")) {
    injected = html.replace("</head>", `${injection}\n</head>`);
  } else if (/<body/i.test(html)) {
    injected = html.replace(/<body[^>]*>/i, m => `${injection}\n${m}`);
  } else {
    injected = injection + "\n" + html;
  }

  return { html: injected, confidence, k: fit.k, roles, clusters };
}

// ─── Main loop ────────────────────────────────────────────────────────────────

console.log(`Normalizing ${majors.length} template(s): ${majors.join(", ")}${dryRun ? " [dry-run]" : ""}\n`);

for (const major of majors) {
  const srcPath = join(TEMPLATES, major, "sample.html");
  const outPath = join(TEMPLATES, major, "normalized.html");

  if (!existsSync(srcPath)) {
    console.warn(`⚠ Skipping ${major}: no sample.html`);
    continue;
  }

  if (dryRun) {
    console.log(`[dry-run] ${major}/sample.html → normalized.html`);
    continue;
  }

  process.stdout.write(`Processing: ${major} … `);

  const html = readFileSync(srcPath, "utf-8");

  // Step 1: rename image paths
  const { html: imgRenamed, renameMap } = renameImagePaths(html);

  // Update masthead metadata to reflect renamed paths
  const mastheadMeta = analyzeSampleMasthead(html);
  const oldCssUrl = mastheadMeta.sampleRasterCssUrl;
  if (oldCssUrl && renameMap.has(oldCssUrl)) {
    const newName = renameMap.get(oldCssUrl);
    mastheadMeta.sampleRasterCssUrl = newName;
    if (mastheadMeta.sampleRasterBackgroundDecl) {
      mastheadMeta.sampleRasterBackgroundDecl =
        mastheadMeta.sampleRasterBackgroundDecl.split(oldCssUrl).join(newName);
    }
  }

  // Step 2: inject color theme
  const { html: colorized, confidence, k, roles, clusters } = injectColorTheme(imgRenamed);
  const warn = confidence < MIN_SEP ? " ⚠ low-confidence" : "";

  // Step 3: rewrite CSS hex/rgba() values to CSS variable references
  const varified = rewriteCssVars(colorized, roles, clusters);

  // Step 4: embed masthead metadata
  const normalized = embedMastheadMetaComment(varified, mastheadMeta);

  writeFileSync(outPath, normalized, "utf-8");

  const kb = (normalized.length / 1024).toFixed(1);
  const renames = renameMap.size > 0
    ? `  [${[...renameMap.values()].join(", ")}]`
    : "";
  console.log(`✓ ${major}/normalized.html (${kb} KB, k=${k} conf=${confidence.toFixed(2)}${warn})${renames}`);
}

console.log("\nDone.");
