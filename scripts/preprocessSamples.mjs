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
  extractRegex, dedupColors, toOk, fmtOklch, oklchToHex,
} from "../src/extractHtmlColors/extractColors.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, "..");

// ─── Annotation config ────────────────────────────────────────────────────────
const ANNOTATE_PROMPT_PATH = join(ROOT, "src/netlify/functions/AnnotateTemplate.md");
const ANNOTATE_MODEL       = "claude-sonnet-4-6";
const ANNOTATE_MAX_TOKENS  = 32000;

const DUP_THRESHOLD     = 0.02;
const VARIANT_THRESHOLD = 0.10;

function repVarName(i) { return `--c-${i + 1}`; }

const TEMPLATES = join(ROOT, "templates");

// Is this file being run as a CLI script vs. imported as a module?
// When imported (e.g. from a Netlify function), we skip all top-level CLI side effects
// so just the exported helpers are available.
const __isCli = (() => {
  try { return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]; }
  catch { return false; }
})();

const dryRun       = __isCli && process.argv.includes("--dry-run");
const skipAnnotate = __isCli && process.argv.includes("--skip-annotate");
const requested    = __isCli ? process.argv.slice(2).filter(a => !a.startsWith("--")) : [];

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (__isCli && !skipAnnotate && !dryRun && !ANTHROPIC_API_KEY) {
  console.warn("⚠ ANTHROPIC_API_KEY not set — annotation step will be skipped. Pass --skip-annotate to suppress this warning.\n");
}

const majors = __isCli
  ? (requested.length > 0
      ? requested
      : readdirSync(TEMPLATES)
          .filter(f => statSync(join(TEMPLATES, f)).isDirectory())
          .filter(f => existsSync(join(TEMPLATES, f, "sample.html")))
          .sort())
  : [];

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

function buildRewriteMap(reps) {
  const hexExprMap = new Map();
  const rgbMap     = new Map();

  for (let i = 0; i < reps.length; i++) {
    const rep     = reps[i];
    const varName = repVarName(i);
    const repOk   = rep.ok;

    hexExprMap.set(rep.hex.toLowerCase(), `var(${varName})`);
    const repRgb = hexToRgb(rep.hex);
    if (repRgb) rgbMap.set(`${repRgb.r},${repRgb.g},${repRgb.b}`, { varName, memberOk: repOk, repOk });

    for (const member of rep.members) {
      if (member.hex.toLowerCase() === rep.hex.toLowerCase()) continue;
      const expr = member.dist < DUP_THRESHOLD
        ? `var(${varName})`
        : relColorExpr(varName, member.ok, repOk);
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

function buildExtractedThemeCss(reps) {
  const lines = ["/* Generated by preprocessSamples */", ":root {"];
  for (let i = 0; i < reps.length; i++) {
    const varName = repVarName(i);
    lines.push(`  ${varName}:${" ".repeat(Math.max(1, 16 - varName.length))}${fmtOklch(reps[i].ok)};`);
  }
  lines.push("}");
  return lines.join("\n");
}

function buildPaletteJson(reps, meta) {
  const scheme = {};
  for (let i = 0; i < reps.length; i++) {
    const varName = repVarName(i);
    const rep = reps[i];
    scheme[varName] = {
      hex:     rep.hex,
      oklch:   { l: +rep.ok.l.toFixed(4), c: +(rep.ok.c ?? 0).toFixed(4), h: +(rep.ok.h ?? 0).toFixed(1) },
      count:   rep.count,
      members: rep.members.map(m => ({ hex: m.hex, count: m.count, dist: +m.dist.toFixed(4) })),
    };
  }
  return JSON.stringify({ meta, scheme }, null, 2);
}

function rewriteCssVars(html, hexExprMap, rgbMap) {
  function hexWithAlphaToExpr(rgbHex, alphaByte) {
    const r = parseInt(rgbHex.slice(0, 2), 16);
    const g = parseInt(rgbHex.slice(2, 4), 16);
    const b = parseInt(rgbHex.slice(4, 6), 16);
    const alpha = parseInt(alphaByte, 16) / 255;
    const info = rgbMap.get(`${r},${g},${b}`);
    if (!info) return null;
    const { varName, memberOk, repOk } = info;
    return relColorAlphaExpr(varName, memberOk, repOk, alpha);
  }

  function rewriteCss(css) {
    // 8-digit hex (#RRGGBBAA) → relative color expression w/ alpha. Must run before 6-digit.
    let out = css.replace(/#([0-9a-fA-F]{8})\b/g, (m, hex) => {
      const expr = hexWithAlphaToExpr(hex.slice(0, 6), hex.slice(6, 8));
      return expr ?? m;
    });
    // 4-digit hex (#RGBA) → expand each digit, then handle as 8-digit. Must run before 3-digit.
    out = out.replace(/#([0-9a-fA-F]{4})\b/g, (m, hex) => {
      const expanded = hex.split("").map(c => c + c).join("");
      const expr = hexWithAlphaToExpr(expanded.slice(0, 6), expanded.slice(6, 8));
      return expr ?? m;
    });
    // 6-digit hex → CSS expression
    out = out.replace(/#([0-9a-fA-F]{6})\b/g, m => hexExprMap.get(m.toLowerCase()) ?? m);
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

// computeColorTheme: extract reps from html and build all derived data.
// Returns { reps, hexExprMap, rgbMap, injection } where `injection` is the
// ready-to-insert HTML string for <style> + <script> blocks.
function computeColorTheme(html) {
  const { counts } = extractRegex(html);

  const candidates = [...counts.entries()]
    .map(([hex, count]) => ({ hex, count, ok: toOk(hex) }))
    .filter(e => e.ok);

  const reps = dedupColors(candidates, { dupThreshold: DUP_THRESHOLD, variantThreshold: VARIANT_THRESHOLD });
  const meta = { k: reps.length, dupThreshold: DUP_THRESHOLD, variantThreshold: VARIANT_THRESHOLD };

  const injection = [
    `<style id="extracted-theme">`,
    buildExtractedThemeCss(reps),
    `</style>`,
    `<script type="application/json" id="color-palette">`,
    buildPaletteJson(reps, meta),
    `</script>`,
  ].join("\n");

  const { hexExprMap, rgbMap } = buildRewriteMap(reps);
  return { reps, hexExprMap, rgbMap, injection, k: reps.length };
}

// insertThemeInjection: insert a pre-built injection block into an HTML document.
function insertThemeInjection(html, injection) {
  if (html.includes("</head>")) return html.replace("</head>", `${injection}\n</head>`);
  if (/<body/i.test(html)) return html.replace(/<body[^>]*>/i, m => `${injection}\n${m}`);
  return injection + "\n" + html;
}

// injectColorTheme: convenience wrapper (compute + insert) used for sample.html.
function injectColorTheme(html) {
  const theme = computeColorTheme(html);
  return { ...theme, html: insertThemeInjection(html, theme.injection) };
}

// normalizeColorsInHtml: full color-normalization pipeline as a single call.
// Idempotent — re-applying it on already-normalized HTML produces the same result
// (modulo cluster-membership shifts if the color budget changes).
//
//   1. Un-rewrite any prior CSS-var color expressions back to literal hex.
//   2. Strip the existing <style id="extracted-theme"> and <script id="color-palette"> blocks.
//   3. Extract a fresh palette via dedupColors.
//   4. Insert the new theme block (<style> + <script>).
//   5. Rewrite all hex/rgba/CSS occurrences to var(--c-N) references.
//
// Returns { html, k } where k is the number of palette reps produced.
export function normalizeColorsInHtml(html) {
  if (!html) return { html: "", k: 0 };
  const unRewrote          = unRewriteOldVars(html);
  const stripped           = stripColorThemeBlocks(unRewrote);
  const { injection, k, hexExprMap, rgbMap } = computeColorTheme(stripped);
  const withTheme          = insertThemeInjection(stripped, injection);
  const colorized          = rewriteCssVars(withTheme, hexExprMap, rgbMap);
  return { html: colorized, k };
}

// ─── Strip previously injected theme blocks (for idempotent re-normalization) ─

function stripColorThemeBlocks(html) {
  return html
    .replace(/<style[^>]*id=["']extracted-theme["'][^>]*>[\s\S]*?<\/style>\s*/i, "")
    .replace(/<script[^>]*id=["']color-palette["'][^>]*>[\s\S]*?<\/script>\s*/i, "");
}

// ─── Un-rewrite CSS variable expressions back to hex ─────────────────────────
//
// Handles all three historical formats so re-runs are idempotent:
//   Old:     var(--color-bg/text), rgba(var(--color-X-rgb), A)
//   Ordinal: var(--color-primary…quinary), oklch(from var(--color-X) …)
//   --c-N:   var(--c-N), oklch(from var(--c-N) …), color-mix(in srgb, var(--c-N) …)

function unRewriteNewVars(html, scheme) {
  const varToHex   = new Map();
  const varToOklch = new Map();
  for (const [varName, entry] of Object.entries(scheme)) {
    if (entry?.hex)   varToHex.set(varName, entry.hex);
    if (entry?.oklch) varToOklch.set(varName, entry.oklch);
  }

  function evalExpr(expr, baseVal) {
    const s = String(expr).trim();
    if (s === "l" || s === "c" || s === "h") return baseVal;
    const m = s.match(/^calc\(\s*[lch]\s*([+-])\s*([\d.]+)\s*\)$/);
    if (m) return m[1] === "+" ? baseVal + parseFloat(m[2]) : baseVal - parseFloat(m[2]);
    const n = parseFloat(s);
    return isNaN(n) ? baseVal : n;
  }

  // Regex fragment: matches a single LCH sub-expression (bare token or calc(...))
  const EXPR = /(?:calc\([^)]*\)|\S+)/;
  const EXPR_S = "(?:calc\\([^)]*\\)|\\S+)";

  function computeOklchHex(varName, lExpr, cExpr, hExpr) {
    const base = varToOklch.get(varName);
    if (!base) return null;
    const L = evalExpr(lExpr, base.l);
    const C = Math.max(0, evalExpr(cExpr, base.c));
    const H = evalExpr(hExpr, base.h);
    return oklchToHex({ l: L, c: C, h: H }) || null;
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace("#", "");
    if (h.length !== 6) return null;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function unRewriteCss(css) {
    let out = css;

    // 1. color-mix(in srgb, oklch(from var(--X) L C H) P%, transparent) → rgba
    out = out.replace(
      new RegExp(
        `color-mix\\(in srgb\\s*,\\s*oklch\\(from\\s+var\\(\\s*(--[\\w-]+)\\s*\\)\\s+(${EXPR_S})\\s+(${EXPR_S})\\s+(${EXPR_S})\\s*\\)\\s+([\\d.]+)%\\s*,\\s*transparent\\)`,
        "gi"
      ),
      (m, varName, lExpr, cExpr, hExpr, pct) => {
        const hex = computeOklchHex(varName, lExpr, cExpr, hExpr);
        if (!hex) return m;
        return hexToRgba(hex, parseFloat(pct) / 100) ?? m;
      }
    );

    // 2. color-mix(in srgb, var(--X) P%, transparent) → rgba
    out = out.replace(
      /color-mix\(in srgb\s*,\s*var\(\s*(--[\w-]+)\s*\)\s+([\d.]+)%\s*,\s*transparent\)/gi,
      (m, varName, pct) => {
        const hex = varToHex.get(varName);
        if (!hex) return m;
        return hexToRgba(hex, parseFloat(pct) / 100) ?? m;
      }
    );

    // 3. oklch(from var(--X) L C H [/ alpha]) → hex (alpha discarded; will be re-added by rewriteCssVars)
    out = out.replace(
      new RegExp(
        `oklch\\(from\\s+var\\(\\s*(--[\\w-]+)\\s*\\)\\s+(${EXPR_S})\\s+(${EXPR_S})\\s+(${EXPR_S})(?:\\s*/[^)]+)?\\s*\\)`,
        "gi"
      ),
      (m, varName, lExpr, cExpr, hExpr) => {
        return computeOklchHex(varName, lExpr, cExpr, hExpr) ?? m;
      }
    );

    // 4. var(--X) → hex  (last, so it doesn't mangle inner var() in the above)
    out = out.replace(/var\(\s*(--[\w-]+)\s*\)/g,
      (m, varName) => varToHex.get(varName) ?? m);

    return out;
  }

  let result = html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (match, attrs, css) => {
    if (/id\s*=\s*["']extracted-theme["']/i.test(attrs)) return match;
    return `<style${attrs}>${unRewriteCss(css)}</style>`;
  });
  result = result.replace(/(\bstyle\s*=\s*")([^"]*?)(")/gi, (m, o, css, c) => `${o}${unRewriteCss(css)}${c}`);
  result = result.replace(/(\bstyle\s*=\s*')([^']*?)(')/gi, (m, o, css, c) => `${o}${unRewriteCss(css)}${c}`);
  return result;
}

function unRewriteOldVars(html) {
  const scriptMatch = html.match(/<script[^>]*id=["']color-palette["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!scriptMatch) return html;
  let scheme;
  try { scheme = JSON.parse(scriptMatch[1])?.scheme; } catch { return html; }
  if (!scheme) return html;

  // Any non-old-format palette: evaluate relative-color expressions back to hex.
  const isOldFormat = "--color-bg" in scheme || "--color-text" in scheme;
  if (!isOldFormat) return unRewriteNewVars(html, scheme);

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

if (__isCli) {
const canAnnotate = !skipAnnotate && !!ANTHROPIC_API_KEY;
console.log(`Preprocessing ${majors.length} template(s): ${majors.join(", ")}${dryRun ? " [dry-run]" : ""}${canAnnotate ? "" : " [normalize only]"}\n`);

for (const major of majors) {
  const srcPath = join(TEMPLATES, major, "sample.html");
  const rawPath = join(TEMPLATES, major, "annotation.html");  // AI output, original colors
  const annPath = join(TEMPLATES, major, "annotated.html");   // color-normalized final output

  if (!existsSync(srcPath)) {
    console.warn(`⚠ Skipping ${major}: no sample.html`);
    continue;
  }

  if (dryRun) {
    console.log(`[dry-run] ${major}/sample.html${canAnnotate ? " → annotation.html (AI)" : ""} → annotated.html (colors)`);
    continue;
  }

  process.stdout.write(`Processing: ${major} … `);

  const sampleHtml = readFileSync(srcPath, "utf-8");

  // Stage 1: AI annotation — saves to annotation.html (original colors preserved).
  // Color re-runs read annotation.html as their source, so AI is never re-invoked.
  if (canAnnotate) {
    process.stdout.write("annotating …");
    try {
      const { annotated, usage } = await annotateHtml(major, sampleHtml);
      writeFileSync(rawPath, annotated, "utf-8");
      const fieldCount   = (annotated.match(/data-field=/g)   || []).length;
      const sectionCount = (annotated.match(/data-section=/g) || []).length;
      const listCount    = (annotated.match(/data-list=/g)     || []).length;
      process.stdout.write(` (${usage?.input_tokens}→${usage?.output_tokens} tok, ${fieldCount} fields, ${sectionCount} sections, ${listCount} lists) … `);
    } catch (e) {
      process.stdout.write(` ⚠ annotation failed: ${e.message} … `);
    }
  }

  // Stage 2: Color normalization

  // Step 1: rename image paths in sample.html (for masthead metadata only)
  const { renameMap } = renameImagePaths(sampleHtml);

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

  const renames = renameMap.size > 0 ? `  [${[...renameMap.values()].join(", ")}]` : "";

  // Step 2: apply color transforms to annotation.html → annotated.html.
  // Colors are extracted from annotation.html (after un-rewriting prior CSS vars back to hex)
  // so the rewrite map matches whatever hex values actually appear in the file.
  const rawExists = existsSync(rawPath) && statSync(rawPath).size > 0;
  if (rawExists) {
    const existing                = readFileSync(rawPath, "utf-8");
    const unRewrote               = unRewriteOldVars(existing);
    const rawAnnotated            = stripColorThemeBlocks(unRewrote);
    const { html: annImgRenamed } = renameImagePaths(rawAnnotated);
    const { injection, k, hexExprMap, rgbMap } = computeColorTheme(annImgRenamed);
    const annColorized            = insertThemeInjection(annImgRenamed, injection);
    const annVarified             = rewriteCssVars(annColorized, hexExprMap, rgbMap);
    const annFinal                = embedMastheadMetaComment(annVarified, mastheadMeta);
    writeFileSync(annPath, annFinal, "utf-8");
    process.stdout.write(`normalized (${(annFinal.length / 1024).toFixed(1)} KB, k=${k})${renames}`);
  } else {
    process.stdout.write(`⚠ no annotation.html (run without --skip-annotate first)`);
  }

  console.log();
}

console.log("\nDone.");
} // end if (__isCli)
