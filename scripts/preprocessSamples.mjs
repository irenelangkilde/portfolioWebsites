#!/usr/bin/env node
/**
 * Preprocesses templates/<major>/sample.html in two stages:
 *
 * Stage 1 — Annotation (AI, requires ANTHROPIC_API_KEY):
 *   Adds data-* attributes to sample.html so renderPortfolio (Cheerio) can inject
 *   candidate data. Runs first so color re-runs never need an AI call.
 *   → Output: annotated.html  (data-* attrs, original colors)
 *
 * Stage 2 — Color normalization (deterministic, no AI):
 *   Extracts perceptually distinct color clusters from sample.html via OKLCH
 *   farthest-point selection (threshold-stopped, no fixed k) and rewrites CSS
 *   using CSS Relative Color Syntax so every member tracks its cluster rep.
 *   1. Image path renaming (headshots → headshot.png/jpg, others → image1.png …)
 *   2. Color theme injection (<style id="extracted-theme">, <script id="color-palette">)
 *   3. CSS rewrite: hex/rgba() → var() or oklch(from var(…) …) relative expressions
 *   4. Masthead metadata: embeds IW_MASTHEAD_META comment
 *   → Output: annotated.html  (Stage 1 annotations + color transforms)
 *
 * Usage:
 *   node scripts/preprocessSamples.mjs [major1 major2 ...]
 *   node scripts/preprocessSamples.mjs --dry-run
 *   node scripts/preprocessSamples.mjs --skip-annotate   # normalization only
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

import {
  extractRegex, selectReps, assignMembers, rankClusters, buildJson,
  oklchDist, toOk, fmtOklch, oklchToHex,
} from "../src/extractHtmlColors/extractColors.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, "..");

// ─── Annotation config ────────────────────────────────────────────────────────
const ANNOTATE_PROMPT_PATH = join(ROOT, "src/netlify/functions/AnnotateTemplate.md");
const ANNOTATE_MODEL       = "claude-sonnet-4-6";
const ANNOTATE_MAX_TOKENS  = 32000;

// OKLCH distance threshold for rep selection. Candidates closer than this to any
// existing rep (or its complement) are not selected as new reps; they become
// cluster members instead.
const THRESHOLD = 0.20;

const TEMPLATES = join(ROOT, "templates");

const dryRun       = process.argv.includes("--dry-run");
const skipAnnotate = process.argv.includes("--skip-annotate");
const requested    = process.argv.slice(2).filter(a => !a.startsWith("--"));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!skipAnnotate && !dryRun && !ANTHROPIC_API_KEY) {
  console.warn("⚠ ANTHROPIC_API_KEY not set — annotation step will be skipped. Pass --skip-annotate to suppress this warning.\n");
}

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

  const isProfileOrBrandImg = (tag = "", src = "") =>
    /\b(headshot|profile|avatar|portrait|logo|brand|selfie|photo)\b|stockphoto|youngman|youngwoman|person/i.test(`${tag} ${src}`);
  const isMastheadImg = (tag = "", src = "") => {
    if (isProfileOrBrandImg(tag, src)) return false;
    return /\b(masthead|banner|cover|splash|hero[-_\s]?(image|visual|media|art|bg|background)|featured[-_\s]?image)\b/i.test(`${tag} ${src}`);
  };
  const rasterImgMatch = [...searchRegions.matchAll(
    /<img\b[^>]*src=["']((?!data:)[^"']+\.(?:png|jpe?g)(?:\?[^"']*)?)["'][^>]*>/ig
  )].find(m => isMastheadImg(m[0], m[1])) || null;
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

// ─── Hex / RGB helpers ────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = hex.replace("#", "").toLowerCase();
  if (h.length === 3)
    return { r: parseInt(h[0]+h[0],16), g: parseInt(h[1]+h[1],16), b: parseInt(h[2]+h[2],16) };
  if (h.length === 6)
    return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
  return null;
}

// ─── CSS Relative Color Syntax expressions ────────────────────────────────────
//
// relColorExpr(varName, memberOk, repOk)
//   Generates an expression that evaluates to memberOk's color while tracking
//   the CSS variable varName (which holds repOk at template time).
//
//   Rep itself              → var(--color-X)
//   Near-identical member   → var(--color-X)
//   Any other member        → oklch(from var(--color-X) calc(l ± DL) calc(c ± DC) calc(h ± DH))
//
// At user customization time, the CSS engine resolves the calc() deltas against
// whatever new value the user assigns to var(--color-X), so tints, shades, and
// near-hue variants all shift in unison with the rep.

function fmtDelta(d, digits) {
  if (d >= 0) return `+ ${d.toFixed(digits)}`;
  return `- ${Math.abs(d).toFixed(digits)}`;
}

function relColorExpr(varName, memberOk, repOk) {
  const dL = memberOk.l - repOk.l;
  const dC = (memberOk.c ?? 0) - (repOk.c ?? 0);
  let   dH = (memberOk.h ?? 0) - (repOk.h ?? 0);
  if (dH >  180) dH -= 360;
  if (dH < -180) dH += 360;

  if (Math.abs(dL) < 0.0005 && Math.abs(dC) < 0.0005 && Math.abs(dH) < 0.05)
    return `var(${varName})`;

  const lPart = Math.abs(dL) < 0.0005 ? "l"   : `calc(l ${fmtDelta(dL, 4)})`;
  const cPart = Math.abs(dC) < 0.0005 ? "c"   : `calc(c ${fmtDelta(dC, 4)})`;
  const hPart = Math.abs(dH) < 0.05   ? "h"   : `calc(h ${fmtDelta(dH, 1)})`;

  return `oklch(from var(${varName}) ${lPart} ${cPart} ${hPart})`;
}

// relColorAlphaExpr — same as relColorExpr but with opacity alpha in [0,1].
// Uses color-mix(in srgb, <expr> P%, transparent) which is composable with
// any CSS expression including oklch(from …) relative colors.
function relColorAlphaExpr(varName, memberOk, repOk, alpha) {
  const base = relColorExpr(varName, memberOk, repOk);
  const pct  = (alpha * 100).toFixed(1).replace(/\.0$/, "");
  return `color-mix(in srgb, ${base} ${pct}%, transparent)`;
}

// ─── Rewrite map construction ────────────────────────────────────────────────
//
// buildRewriteMap(top5)
//   top5: ranked clusters in ordinal order (primary=0 … quinary=4)
//
// Returns:
//   hexExprMap   Map<lc-hex, css-expression>   — for #rrggbb / #rgb rewrites
//   rgbMap       Map<"r,g,b", {varName,memberOk,repOk}> — for rgba() rewrites

const ORDINAL_VARS = [
  "--color-primary",
  "--color-secondary",
  "--color-tertiary",
  "--color-quaternary",
  "--color-quinary",
];

function buildRewriteMap(top5) {
  const hexExprMap = new Map();
  const rgbMap     = new Map();

  for (let i = 0; i < top5.length; i++) {
    const cluster = top5[i];
    const varName = ORDINAL_VARS[i];
    const repOk   = cluster.ok;

    // Rep → plain var()
    hexExprMap.set(cluster.hex.toLowerCase(), `var(${varName})`);
    const repRgb = hexToRgb(cluster.hex);
    if (repRgb) rgbMap.set(`${repRgb.r},${repRgb.g},${repRgb.b}`, { varName, memberOk: repOk, repOk });

    // Members → relative color expression
    for (const member of cluster.members) {
      if (member.hex.toLowerCase() === cluster.hex.toLowerCase()) continue;
      const expr = relColorExpr(varName, member.ok, repOk);
      hexExprMap.set(member.hex.toLowerCase(), expr);
      const memberRgb = hexToRgb(member.hex);
      if (memberRgb) rgbMap.set(
        `${memberRgb.r},${memberRgb.g},${memberRgb.b}`,
        { varName, memberOk: member.ok, repOk }
      );
    }
  }

  return { hexExprMap, rgbMap };
}

// ─── Color extraction + injection ────────────────────────────────────────────

function buildExtractedThemeCss(top5) {
  const lines = ["/* Generated by extractColors.mjs */", ":root {"];
  for (let i = 0; i < top5.length; i++) {
    lines.push(`  ${ORDINAL_VARS[i]}:${" ".repeat(Math.max(1, 22 - ORDINAL_VARS[i].length))}${fmtOklch(top5[i].ok)};`);
  }
  lines.push("}");
  return lines.join("\n");
}

function rewriteCssVars(html, hexExprMap, rgbMap) {
  function rewriteCss(css) {
    // 6-digit hex → CSS expression
    let out = css.replace(/#([0-9a-fA-F]{6})\b/g, m => hexExprMap.get(m.toLowerCase()) ?? m);
    // 3-digit hex → expand then look up
    out = out.replace(/#([0-9a-fA-F]{3})\b/g, (m, d) => {
      const exp = "#" + d.split("").map(c => c + c).join("");
      return hexExprMap.get(exp.toLowerCase()) ?? m;
    });
    // rgba?() with matched r,g,b → relative color expression (with or without alpha)
    out = out.replace(
      /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+%?)\s*)?\)/g,
      (m, r, g, b, a) => {
        const info = rgbMap.get(`${+r},${+g},${+b}`);
        if (!info) return m;
        const { varName, memberOk, repOk } = info;
        if (a === undefined) return relColorExpr(varName, memberOk, repOk);
        const alpha = a.endsWith("%") ? parseFloat(a) / 100 : parseFloat(a);
        return relColorAlphaExpr(varName, memberOk, repOk, alpha);
      }
    );
    return out;
  }

  // Rewrite <style> blocks (skip extracted-theme — it uses oklch() values already)
  let result = html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (match, attrs, css) => {
    if (/id\s*=\s*["']extracted-theme["']/i.test(attrs)) return match;
    return `<style${attrs}>${rewriteCss(css)}</style>`;
  });

  // Rewrite inline style attributes
  result = result.replace(/(\bstyle\s*=\s*")([^"]*?)(")/gi, (m, open, css, close) =>
    `${open}${rewriteCss(css)}${close}`);
  result = result.replace(/(\bstyle\s*=\s*')([^']*?)(')/gi, (m, open, css, close) =>
    `${open}${rewriteCss(css)}${close}`);

  // Rewrite SVG presentation color attributes → inline style (CSS vars don't work as attrs)
  result = result.replace(
    /\b(fill|stroke|stop-color|flood-color)\s*=\s*"(#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3}))"/gi,
    (m, prop, hex) => {
      const norm = hex.length === 4
        ? "#" + hex[1]+hex[1] + hex[2]+hex[2] + hex[3]+hex[3]
        : hex;
      const expr = hexExprMap.get(norm.toLowerCase());
      return expr ? `style="${prop}: ${expr}"` : m;
    }
  );

  return result;
}

function injectColorTheme(html, threshold = THRESHOLD) {
  const { counts } = extractRegex(html);

  const candidates = [...counts.entries()]
    .map(([hex, count]) => ({ hex, count, ok: toOk(hex) }))
    .filter(e => e.ok);

  const reps     = selectReps(candidates, threshold);
  const clusters = assignMembers(candidates, reps);
  const ranked   = rankClusters(clusters);
  const top5     = ranked.slice(0, 5);
  const meta     = { k: top5.length, threshold };

  const injection = [
    `<style id="extracted-theme">`,
    buildExtractedThemeCss(top5),
    `</style>`,
    `<script type="application/json" id="color-palette">`,
    buildJson(top5, meta),
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

  const { hexExprMap, rgbMap } = buildRewriteMap(top5);
  return { html: injected, k: top5.length, top5, hexExprMap, rgbMap };
}

// ─── Strip previously injected theme blocks (for idempotent re-normalization) ─

function stripColorThemeBlocks(html) {
  return html
    .replace(/<style[^>]*id=["']extracted-theme["'][^>]*>[\s\S]*?<\/style>\s*/i, "")
    .replace(/<script[^>]*id=["']color-palette["'][^>]*>[\s\S]*?<\/script>\s*/i, "");
}

// ─── Un-rewrite old CSS variable expressions back to hex ──────────────────────
//
// Templates previously normalized with the old algorithm have `var(--color-bg)`,
// `var(--color-text)`, `rgba(var(--color-X-rgb), A)`, and
// `color-mix(in oklab, var(--color-X), white N%)` expressions in their CSS.
// Before applying the new rewrite we restore those to plain hex/rgba values so
// the new hexExprMap can map them to the current ordinal CSS variables.
//
// Skipped for templates already in the new format (palette only has 5 ordinal vars).

function unRewriteOldVars(html) {
  const scriptMatch = html.match(/<script[^>]*id=["']color-palette["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!scriptMatch) return html;
  let scheme;
  try { scheme = JSON.parse(scriptMatch[1])?.scheme; } catch { return html; }
  if (!scheme) return html;

  // New-format palettes only contain the 5 ordinal vars — nothing to un-rewrite.
  const isNewFormat = !("--color-bg" in scheme) && !("--color-text" in scheme);
  if (isNewFormat) return html;

  // Old-format: build var → hex and var-rgb → "r, g, b" maps.
  const varToHex = new Map();
  const varToRgb = new Map();
  for (const [varName, entry] of Object.entries(scheme)) {
    const hex = entry?.hex;
    if (!hex) continue;
    varToHex.set(varName, hex);
    const h = hex.replace("#", "");
    if (h.length === 6) {
      varToRgb.set(`${varName}-rgb`,
        `${parseInt(h.slice(0,2),16)}, ${parseInt(h.slice(2,4),16)}, ${parseInt(h.slice(4,6),16)}`);
    }
  }

  function unRewriteCss(css) {
    let out = css;
    // rgba(var(--color-X-rgb), A) → rgba(r, g, b, A)
    out = out.replace(/rgba?\(\s*var\(\s*(--[\w-]+-rgb)\s*\)\s*(?:,\s*([\d.]+%?)\s*)?\)/g,
      (m, rgbVar, a) => {
        const rgb = varToRgb.get(rgbVar);
        if (!rgb) return m;
        return a !== undefined ? `rgba(${rgb}, ${a})` : `rgb(${rgb})`;
      });
    // var(--color-X) → hex (handles bare var() and inner var() inside color-mix/oklch)
    out = out.replace(/var\(\s*(--color-[\w-]+)\s*\)/g, (m, varName) =>
      varToHex.get(varName) ?? m);
    return out;
  }

  let result = html;
  result = result.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (match, attrs, css) => {
    if (/id\s*=\s*["']extracted-theme["']/i.test(attrs)) return match;
    return `<style${attrs}>${unRewriteCss(css)}</style>`;
  });
  result = result.replace(/(\bstyle\s*=\s*")([^"]*?)(")/gi, (m, o, css, c) => `${o}${unRewriteCss(css)}${c}`);
  result = result.replace(/(\bstyle\s*=\s*')([^']*?)(')/gi, (m, o, css, c) => `${o}${unRewriteCss(css)}${c}`);
  return result;
}

// ─── Annotation step ─────────────────────────────────────────────────────────

async function annotateHtml(major, sampleHtml) {
  const promptTemplate = readFileSync(ANNOTATE_PROMPT_PATH, "utf-8");
  const capped = sampleHtml.length > 120000
    ? sampleHtml.slice(0, 120000) + "\n<!-- truncated -->"
    : sampleHtml;
  const prompt = promptTemplate.replace("{{NORMALIZED_HTML}}", capped);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key":         ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type":      "application/json",
    },
    body: JSON.stringify({
      model:      ANNOTATE_MODEL,
      max_tokens: ANNOTATE_MAX_TOKENS,
      system:     "You are a web template engineer. Add data-* attributes to the HTML per the instructions. Output only the annotated HTML. No markdown fences. No explanation.",
      messages:   [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.status);
    throw new Error(`API ${res.status}: ${String(err).slice(0, 200)}`);
  }

  const data = await res.json();
  const annotated = (data.content || [])
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("")
    .replace(/^```[a-zA-Z]*\n?/m, "")
    .replace(/\n?```\s*$/m, "")
    .trim();

  if (!annotated.toLowerCase().startsWith("<!doctype") && !annotated.startsWith("<html")) {
    throw new Error(`Output doesn't look like HTML. First 200 chars: ${annotated.slice(0, 200)}`);
  }

  return { annotated, usage: data.usage };
}

// ─── Main loop ────────────────────────────────────────────────────────────────

const canAnnotate = !skipAnnotate && !!ANTHROPIC_API_KEY;
console.log(`Preprocessing ${majors.length} template(s): ${majors.join(", ")}${dryRun ? " [dry-run]" : ""}${canAnnotate ? "" : " [normalize only]"}\n`);

for (const major of majors) {
  const srcPath = join(TEMPLATES, major, "sample.html");
  const annPath = join(TEMPLATES, major, "annotated.html");

  if (!existsSync(srcPath)) {
    console.warn(`⚠ Skipping ${major}: no sample.html`);
    continue;
  }

  if (dryRun) {
    console.log(`[dry-run] ${major}/sample.html${canAnnotate ? " → annotated.html (AI)" : ""} → annotated.html (colors)`);
    continue;
  }

  process.stdout.write(`Processing: ${major} … `);

  const sampleHtml = readFileSync(srcPath, "utf-8");

  // Stage 1: AI annotation — runs on sample.html so color re-runs never need AI.
  if (canAnnotate) {
    process.stdout.write("annotating …");
    try {
      const { annotated, usage } = await annotateHtml(major, sampleHtml);
      writeFileSync(annPath, annotated, "utf-8");
      const fieldCount   = (annotated.match(/data-field=/g)   || []).length;
      const sectionCount = (annotated.match(/data-section=/g) || []).length;
      const listCount    = (annotated.match(/data-list=/g)     || []).length;
      process.stdout.write(` (${usage?.input_tokens}→${usage?.output_tokens} tok, ${fieldCount} fields, ${sectionCount} sections, ${listCount} lists) … `);
    } catch (e) {
      process.stdout.write(` ⚠ annotation failed: ${e.message} … `);
    }
  }

  // Stage 2: Color normalization — deterministic, source of truth is sample.html.

  // Step 1: rename image paths
  const { html: imgRenamed, renameMap } = renameImagePaths(sampleHtml);

  // Update masthead metadata to reflect renamed paths
  const mastheadMeta = analyzeSampleMasthead(sampleHtml);
  const oldCssUrl = mastheadMeta.sampleRasterCssUrl;
  if (oldCssUrl && renameMap.has(oldCssUrl)) {
    const newName = renameMap.get(oldCssUrl);
    mastheadMeta.sampleRasterCssUrl = newName;
    if (mastheadMeta.sampleRasterBackgroundDecl) {
      mastheadMeta.sampleRasterBackgroundDecl =
        mastheadMeta.sampleRasterBackgroundDecl.split(oldCssUrl).join(newName);
    }
  }

  // Step 2: extract color theme from sample.html (source of truth)
  const { html: colorized, k, hexExprMap, rgbMap } = injectColorTheme(imgRenamed);
  const renames = renameMap.size > 0 ? `  [${[...renameMap.values()].join(", ")}]` : "";

  // Step 3: rewrite CSS hex/rgba() to CSS variable references
  const varified = rewriteCssVars(colorized, hexExprMap, rgbMap);

  // Step 4: apply color transforms to annotated.html.
  // Un-rewrite old CSS var expressions (→ hex) then strip old theme blocks so
  // the new rewrite sees only raw hex values. This makes re-runs idempotent even
  // when annotated.html was previously processed with an older algorithm.
  if (existsSync(annPath)) {
    const existing                = readFileSync(annPath, "utf-8");
    const unRewrote               = unRewriteOldVars(existing);   // must precede strip
    const rawAnnotated            = stripColorThemeBlocks(unRewrote);
    const { html: annImgRenamed } = renameImagePaths(rawAnnotated);
    // Re-use the same rewrite map derived from sample.html (canonical color source)
    const { html: annColorized }  = injectColorTheme(annImgRenamed);
    const annVarified             = rewriteCssVars(annColorized, hexExprMap, rgbMap);
    const annFinal                = embedMastheadMetaComment(annVarified, mastheadMeta);
    writeFileSync(annPath, annFinal, "utf-8");
    process.stdout.write(`normalized (${(annFinal.length / 1024).toFixed(1)} KB, k=${k} conf=Infinity)${renames}`);
  } else {
    process.stdout.write(`⚠ no annotated.html to colorize (run without --skip-annotate first)`);
  }

  console.log();
}

console.log("\nDone.");
