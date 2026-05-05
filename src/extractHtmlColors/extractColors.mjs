#!/usr/bin/env node
/**
 * extractColors.mjs — merged pipeline
 *
 * Incorporates:
 *   loadHtml.js                          — Playwright page setup
 *   extractHeroAndContrastSectionColors.js — computed-style extraction per section
 *   convertToOKLCH.js                    — culori OKLCH conversion
 *   clusterSimilarColors.js              — perceptual distance + dedup
 *   generateCSS.css                      — output format (oklch + color-mix)
 *
 * Modes:
 *   default    Regex extraction from <style> blocks + inline styles (no browser needed)
 *   --browser  Playwright/Chromium for fully computed styles (handles color-mix, CSS vars)
 *
 * Usage:
 *   node extractColors.mjs <input.html> [outputDir] [--browser]
 *
 * Outputs:
 *   palette.json   all colors ranked by frequency with OKLCH values and roles
 *   theme.css      CSS custom properties — :root, .section-hero, .section-inverted
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { converter, parse, formatHex } from "culori";

const toOklch = converter("oklch");

// ── OKLCH helpers ─────────────────────────────────────────────────────────────

function toOk(colorStr) {
  if (!colorStr) return null;
  try {
    const parsed = parse(colorStr);
    if (!parsed) return null;
    const ok = toOklch(parsed);
    if (!ok || ok.l == null) return null;
    return { l: ok.l ?? 0, c: ok.c ?? 0, h: ok.h ?? 0 };
  } catch { return null; }
}

function fmtOklch(ok) {
  const l = (ok.l * 100).toFixed(1);
  const c = (ok.c ?? 0).toFixed(3);
  const h = (ok.h ?? 0).toFixed(1);
  return `oklch(${l}% ${c} ${h})`;
}

// Hex from OKLCH (for palette.json and role comparison)
function oklchToHex(ok) {
  try { return formatHex({ mode: "oklch", ...ok }) ?? "#000000"; }
  catch { return "#000000"; }
}

// ── Perceptual distance (from clusterSimilarColors.js, with hue wrap) ────────

function oklchDist(a, b) {
  const dL = (a.l - b.l) * 1.5;                              // weight lightness
  const dC = (a.c ?? 0) - (b.c ?? 0);
  const dHRaw = ((a.h ?? 0) - (b.h ?? 0) + 360) % 360;
  const dH = (dHRaw > 180 ? 360 - dHRaw : dHRaw) / 180;     // 0-1
  const chromaScale = Math.max(a.c ?? 0, b.c ?? 0);          // low-chroma = hue irrelevant
  return Math.sqrt(dL * dL + dC * dC + (dH * chromaScale) ** 2);
}

// ── Regex extraction (default path) ──────────────────────────────────────────

const COLOR_PROPS = new Set([
  "color","background","background-color","border-color","border-top-color",
  "border-right-color","border-bottom-color","border-left-color","outline-color",
  "text-decoration-color","fill","stroke","stop-color","flood-color",
  "caret-color","column-rule-color","text-emphasis-color","box-shadow","text-shadow",
]);

const SKIP = new Set([
  "transparent","none","inherit","currentcolor","currentColor",
  "initial","unset","revert","auto",
]);

export function extractRegex(html) {
  const counts = new Map();                      // hex → count

  function record(str) {
    if (!str) return;
    const s = str.trim().toLowerCase();
    if (SKIP.has(s) || s.startsWith("var(") || s.startsWith("color-mix(")) return;
    const ok = toOk(str.trim());
    if (!ok) return;
    const hex = oklchToHex(ok);
    if (!hex || hex === "#000000" && s !== "#000" && s !== "#000000" && s !== "black" && s !== "rgb(0,0,0)") {
      // avoid false #000 from parse failures — accept if string is actually black
      if (hex === "#000000" && !["#000","#000000","black","rgb(0,0,0)","rgb(0, 0, 0)"].includes(s)) return;
    }
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }

  function sweepCss(css) {
    // declarations
    for (const [, prop, val] of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)) {
      if (!COLOR_PROPS.has(prop.trim().toLowerCase())) continue;
      for (const tok of val.split(/[\s,]+/)) record(tok.replace(/[;)]+$/, ""));
      record(val.trim());
    }
    // bare tokens
    for (const [m] of css.matchAll(/#[0-9a-fA-F]{3,8}\b/g))   record(m);
    for (const [m] of css.matchAll(/rgba?\([^)]+\)/gi))         record(m);
    for (const [m] of css.matchAll(/hsla?\([^)]+\)/gi))         record(m);
    for (const [m] of css.matchAll(/oklch\([^)]+\)/gi))         record(m);
    for (const [m] of css.matchAll(/oklab\([^)]+\)/gi))         record(m);
  }

  for (const [, css] of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) sweepCss(css);
  for (const [, attr] of html.matchAll(/\bstyle="([^"]*)"/gi))  sweepCss(attr);
  for (const [, attr] of html.matchAll(/\bstyle='([^']*)'/gi))  sweepCss(attr);
  for (const [m] of html.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) record(m);

  return counts;
}

// ── Playwright extraction (--browser path) ────────────────────────────────────
// Browser-side function from extractHeroAndContrastSectionColors.js

const BROWSER_FN = () => {
  const COLOR_PROPS_BR = [
    "color","backgroundColor","borderColor","borderTopColor","borderRightColor",
    "borderBottomColor","borderLeftColor","outlineColor","boxShadow","textShadow",
    "fill","stroke",
  ];

  function isUsable(v) {
    return !(!v || v === "none" || v === "transparent" || v === "rgba(0, 0, 0, 0)");
  }

  function tokens(value) {
    return (value.match(
      /(rgba?\([^)]+\)|hsla?\([^)]+\)|oklch\([^)]+\)|oklab\([^)]+\)|lch\([^)]+\)|lab\([^)]+\)|color\([^)]+\)|#[0-9a-fA-F]{3,8})/g
    ) || []).filter(isUsable);
  }

  function visible(root) {
    return [...root.querySelectorAll("*")].filter(el => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 &&
        s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0;
    });
  }

  function collectColors(section) {
    if (!section) return [];
    const out = [];
    for (const el of [section, ...visible(section)]) {
      const s = getComputedStyle(el);
      for (const p of COLOR_PROPS_BR) {
        for (const t of tokens(s[p] || "")) {
          out.push({ color: t, property: p, tag: el.tagName.toLowerCase(),
                     cls: el.className || "", id: el.id || "" });
        }
      }
    }
    return out;
  }

  function findHero() {
    return document.querySelector(
      "section.hero,.hero,#hero,[data-section=hero],header,main section"
    );
  }

  function findInverted(hero) {
    const byClass = document.querySelector([
      "section.inverted",".inverted","section.contrast",".contrast",
      "section.dark",".dark-section",".inverse","[data-section=inverted]",
      "[data-theme=dark]","[data-theme=light]",
    ].join(","));
    if (byClass) return byClass;
    const heroBg = hero ? getComputedStyle(hero).backgroundColor : null;
    return [...document.querySelectorAll("section,main > div,article")]
      .find(s => s !== hero && getComputedStyle(s).backgroundColor !== heroBg &&
                 getComputedStyle(s).backgroundColor !== "rgba(0, 0, 0, 0)") || null;
  }

  const hero     = findHero();
  const inverted = findInverted(hero);
  const selectorFor = el => !el ? null :
    el.id ? `#${el.id}` :
    el.className ? `.${String(el.className).trim().split(/\s+/).join(".")}` :
    el.tagName.toLowerCase();

  return {
    hero:     { selector: selectorFor(hero),     colors: collectColors(hero) },
    inverted: { selector: selectorFor(inverted), colors: collectColors(inverted) },
  };
};

async function extractBrowser(htmlPath) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page    = await browser.newPage();
  // loadHtml.js pattern
  await page.goto(`file://${resolve(htmlPath)}`);
  const result = await page.evaluate(BROWSER_FN);
  await browser.close();

  const counts = new Map();
  const allColors = [
    ...result.hero.colors.map(c => ({ ...c, section: "hero" })),
    ...result.inverted.colors.map(c => ({ ...c, section: "inverted" })),
  ];
  for (const { color } of allColors) {
    const ok = toOk(color);
    if (!ok) continue;
    const hex = oklchToHex(ok);
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  return { counts, sections: result };
}


// ── Cluster building + quality scoring ───────────────────────────────────────
// buildClusters(candidates, k)
//   Greedy farthest-point split: seed with most-frequent color, then greedily
//   add whichever candidate maximises its min-distance to existing reps.
//   Each cluster tracks its members (full entries) for radius calculations.
//
// separationScore(clusters)
//   ratio = min inter-cluster gap / max intra-cluster radius
//   >= 1.5 → well-separated; < 1.5 → ambiguous / overlapping
//
// autoFit(candidates, threshold)
//   Tries k=5 down to k=2; returns first k that clears the threshold.
//   Returns { clusters, k, confidence } in all cases.

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function dedup(counts, epsilon = 0.04) {
  const entries = [...counts.entries()]
    .map(([hex, count]) => ({ hex, count, ok: toOk(hex) }))
    .filter(e => e.ok)
    .sort((a, b) => b.count - a.count);

  const reps = [];
  for (const e of entries) {
    const nearest = reps.find(r => oklchDist(r.ok, e.ok) < epsilon);
    if (nearest) { nearest.count += e.count; nearest.merged.push(e.hex); }
    else          reps.push({ ...e, merged: [] });
  }
  return reps;
}

function buildClusters(candidates, k) {
  k = Math.min(k, candidates.length);

  // Farthest-point selection
  const reps = [candidates[0]];
  while (reps.length < k) {
    let best = null, bestDist = -Infinity;
    for (const e of candidates) {
      if (reps.includes(e)) continue;
      const d = Math.min(...reps.map(r => oklchDist(r.ok, e.ok)));
      if (d > bestDist) { bestDist = d; best = e; }
    }
    if (!best) break;
    reps.push(best);
  }

  // Build cluster objects; seed members with the rep itself (distance = 0)
  const clusters = reps.map(r => ({ ...r, merged: [...r.merged], members: [r] }));

  // Assign all non-rep candidates to nearest cluster
  for (const e of candidates) {
    if (reps.includes(e)) continue;
    let best = clusters[0], bestDist = Infinity;
    for (const c of clusters) {
      const d = oklchDist(c.ok, e.ok);
      if (d < bestDist) { bestDist = d; best = c; }
    }
    best.count += e.count;
    best.merged.push(e.hex);
    best.members.push(e);
  }

  return clusters;
}

function separationScore(clusters) {
  if (clusters.length < 2) return 0;

  let interMin = Infinity;
  for (let i = 0; i < clusters.length; i++)
    for (let j = i + 1; j < clusters.length; j++)
      interMin = Math.min(interMin, oklchDist(clusters[i].ok, clusters[j].ok));

  let intraMax = 0;
  for (const c of clusters)
    for (const m of c.members)
      intraMax = Math.max(intraMax, oklchDist(c.ok, m.ok));

  return intraMax === 0 ? Infinity : interMin / intraMax;
}

export function autoFit(candidates, threshold = 1.5) {
  let best = null;
  for (let k = 5; k >= 2; k--) {
    if (candidates.length < k) continue;
    const clusters   = buildClusters(candidates, k);
    const confidence = +separationScore(clusters).toFixed(3);
    if (confidence >= threshold) return { clusters, k, confidence };
    if (!best || confidence > best.confidence) best = { clusters, k, confidence };
  }
  // No k cleared the threshold — return best attempt (or trivial k=1)
  return best ?? { clusters: buildClusters(candidates, 1), k: 1, confidence: 0 };
}

// ── Role assignment by OKLCH properties ──────────────────────────────────────

export function assignRoles(reps) {
  const sorted = [...reps].sort((a, b) => a.ok.l - b.ok.l);

  // bg: darkest rep; text: lightest rep
  const bg   = sorted[0];
  const text = sorted[sorted.length - 1];
  const mid  = sorted.slice(1, -1);

  // Among the 3 middle reps, rank by chroma descending → primary, secondary, accent
  mid.sort((a, b) => (b.ok.c ?? 0) - (a.ok.c ?? 0));

  const [primary, secondary, accent] = [
    mid[0] ?? { hex: oklchToHex({ l: 0.62, c: 0.18, h: 255 }), ok: { l: 0.62, c: 0.18, h: 255 }, count: 0, merged: [], synthetic: true },
    mid[1] ?? { hex: oklchToHex({ l: 0.74, c: 0.12, h: 150 }), ok: { l: 0.74, c: 0.12, h: 150 }, count: 0, merged: [], synthetic: true },
    mid[2] ?? { hex: oklchToHex({ l: 0.82, c: 0.20, h:  45 }), ok: { l: 0.82, c: 0.20, h:  45 }, count: 0, merged: [], synthetic: true },
  ];

  return {
    "--color-bg":        bg,
    "--color-text":      text,
    "--color-primary":   primary,
    "--color-secondary": secondary,
    "--color-accent":    accent,
  };
}

// ── CSS builder ───────────────────────────────────────────────────────────────
// Follows generateCSS.css pattern: direct oklch() for key roles,
// color-mix() for derived roles so the theme remains self-consistent.

function schemeBlock(selector, roles, isInverted = false) {
  const bg  = fmtOklch(roles["--color-bg"].ok);
  const txt = fmtOklch(roles["--color-text"].ok);
  const pri = fmtOklch(roles["--color-primary"].ok);
  const sec = fmtOklch(roles["--color-secondary"].ok);
  const acc = fmtOklch(roles["--color-accent"].ok);

  const mix = isInverted
    ? { surface: "black 6%", card: "black 10%", border: "black 14%" }
    : { surface: "white 8%", card: "white 12%", border: "white 16%" };

  return [
    `${selector} {`,
    `  --color-bg:       ${bg};`,
    `  --color-text:     ${txt};`,
    `  --color-surface:  color-mix(in oklab, var(--color-bg), ${mix.surface});`,
    `  --color-card:     color-mix(in oklab, var(--color-bg), ${mix.card});`,
    `  --color-primary:  ${pri};`,
    `  --color-secondary:${sec};`,
    `  --color-accent:   ${acc};`,
    `  --color-muted:    color-mix(in oklab, var(--color-text), var(--color-bg) 40%);`,
    `  --color-border:   color-mix(in oklab, var(--color-bg), ${mix.border});`,
    `}`,
  ].join("\n");
}

export function buildCss(roles, invertedRoles) {
  return [
    "/* Generated by extractColors.mjs — do not edit; re-run to regenerate. */",
    "",
    "/* ── Default / Hero scheme ──────────────────────────────────────────── */",
    schemeBlock(":root",         roles),
    "",
    schemeBlock(".section-hero", roles),
    "",
    "/* ── Inverted contrast section ──────────────────────────────────────── */",
    schemeBlock(".section-inverted", invertedRoles, true),
  ].join("\n");
}

// ── Inverted scheme ───────────────────────────────────────────────────────────

export function invertRoles(roles) {
  const bg  = roles["--color-bg"].ok;
  const txt = roles["--color-text"].ok;

  // swap bg ↔ text
  const inv = {
    "--color-bg":   { ...roles["--color-text"], ok: txt },
    "--color-text": { ...roles["--color-bg"],   ok: bg  },
  };

  // darken primary/secondary/accent to remain readable on light background
  for (const key of ["--color-primary", "--color-secondary", "--color-accent"]) {
    const e = roles[key];
    const newL = clamp(e.ok.l > 0.50 ? e.ok.l - 0.18 : e.ok.l, 0.28, 0.58);
    inv[key] = { ...e, ok: { ...e.ok, l: newL }, hex: oklchToHex({ ...e.ok, l: newL }), synthetic: true };
  }

  return inv;
}

// ── JSON builder ──────────────────────────────────────────────────────────────

export function buildJson(clusters, roles, invertedRoles, meta) {
  const roleMap = new Map(Object.entries(roles).map(([k, e]) => [e.hex, k]));

  const palette = clusters.slice(0, 40).map(e => ({
    hex:       e.hex,
    oklch:     { l: +e.ok.l.toFixed(4), c: +(e.ok.c ?? 0).toFixed(4), h: +(e.ok.h ?? 0).toFixed(1) },
    count:     e.count,
    role:      roleMap.get(e.hex) ?? null,
    merged:    e.merged,
  }));

  const fmtRole = ([k, e]) => [k, {
    hex:       e.hex,
    oklch:     { l: +e.ok.l.toFixed(4), c: +(e.ok.c ?? 0).toFixed(4), h: +(e.ok.h ?? 0).toFixed(1) },
    css:       fmtOklch(e.ok),
    synthetic: e.synthetic ?? false,
  }];

  return JSON.stringify({
    meta: {
      k:             meta.k,
      confidence:    meta.confidence,
      threshold:     meta.threshold,
      well_separated: meta.confidence >= meta.threshold,
    },
    palette,
    scheme:         Object.fromEntries(Object.entries(roles).map(fmtRole)),
    invertedScheme: Object.fromEntries(Object.entries(invertedRoles).map(fmtRole)),
  }, null, 2);
}

// ── CLI (only runs when invoked directly) ─────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args       = process.argv.slice(2);
  const useBrowser = args.includes("--browser");
  const sepArg     = args.find(a => a.startsWith("--min-separation="));
  const minSep     = sepArg ? parseFloat(sepArg.split("=")[1]) : 1.5;
  const posArgs    = args.filter(a => !a.startsWith("--"));
  const [inputPath, outputArg] = posArgs;

  if (!inputPath) {
    console.error("Usage: node extractColors.mjs <input.html> [outputDir] [--browser] [--min-separation=<float>]");
    process.exit(1);
  }

  const outDir = resolve(outputArg ?? dirname(resolve(inputPath)));
  mkdirSync(outDir, { recursive: true });

  let counts;
  if (useBrowser) {
    console.log("🌐 Launching Chromium for computed styles…");
    try {
      ({ counts } = await extractBrowser(inputPath));
      console.log(`✓ Browser extracted ${counts.size} raw color tokens`);
    } catch (err) {
      console.warn(`⚠  Browser failed (${err.message}) — falling back to regex`);
      counts = extractRegex(readFileSync(resolve(inputPath), "utf-8"));
    }
  } else {
    counts = extractRegex(readFileSync(resolve(inputPath), "utf-8"));
    console.log(`✓ Regex extracted ${counts.size} unique colors`);
  }

  const candidates = dedup(counts);
  const fit        = autoFit(candidates, minSep);
  const { clusters, confidence } = fit;
  const k = fit.k;

  const roles         = assignRoles(clusters);
  const invertedRoles = invertRoles(roles);

  const cssPath  = resolve(outDir, "theme.css");
  const jsonPath = resolve(outDir, "palette.json");
  const meta     = { k, confidence, threshold: minSep };

  writeFileSync(jsonPath, buildJson(clusters, roles, invertedRoles, meta), "utf-8");

  if (confidence < minSep) {
    console.warn(`\n⚠  Confidence ${confidence} below threshold ${minSep} (best at k=${k}) — palette not well-separated. Skipping theme.css.`);
    console.log(`✓ ${jsonPath}`);
    process.exit(0);
  }

  writeFileSync(cssPath, buildCss(roles, invertedRoles), "utf-8");

  const roleLines = Object.entries(roles)
    .map(([prop, e]) => `  ${prop.padEnd(22)} ${fmtOklch(e.ok)}${e.synthetic ? "  (synth)" : ""}`)
    .join("\n");

  console.log(`\nAssigned roles (k=${k}, confidence=${confidence}):\n${roleLines}`);
  console.log(`\n✓ ${cssPath}`);
  console.log(`✓ ${jsonPath}`);
}
