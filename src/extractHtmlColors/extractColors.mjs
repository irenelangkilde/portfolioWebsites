#!/usr/bin/env node
/**
 * extractColors.mjs — merged pipeline
 *
 * Incorporates:
 *   loadHtml.js                          — Playwright page setup
 *   extractHeroAndContrastSectionColors.js — computed-style extraction per section
 *   convertToOKLCH.js                    — culori OKLCH conversion
 *   clusterSimilarColors.js              — perceptual distance + clustering
 *
 * Modes:
 *   default    Regex extraction from <style> blocks + inline styles (no browser needed)
 *   --browser  Playwright/Chromium for fully computed styles (handles color-mix, CSS vars)
 *
 * Usage:
 *   node extractColors.mjs <input.html> [outputDir] [--browser] [--threshold=<float>]
 *
 * Outputs:
 *   palette.json   top-5 clusters with OKLCH values, hex, and aggregate scores
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { converter, parse, formatHex } from "culori";

const toOklch = converter("oklch");

// ── OKLCH helpers ─────────────────────────────────────────────────────────────

export function toOk(colorStr) {
  if (!colorStr) return null;
  try {
    const parsed = parse(colorStr);
    if (!parsed) return null;
    const ok = toOklch(parsed);
    if (!ok || ok.l == null) return null;
    return { l: ok.l ?? 0, c: ok.c ?? 0, h: ok.h ?? 0 };
  } catch { return null; }
}

export function fmtOklch(ok) {
  const l = (ok.l * 100).toFixed(1);
  const c = (ok.c ?? 0).toFixed(3);
  const h = (ok.h ?? 0).toFixed(1);
  return `oklch(${l}% ${c} ${h})`;
}

export function oklchToHex(ok) {
  try { return formatHex({ mode: "oklch", ...ok }) ?? "#000000"; }
  catch { return "#000000"; }
}

// ── Perceptual distance ───────────────────────────────────────────────────────

export function oklchDist(a, b) {
  const dL = (a.l - b.l) * 1.5;
  const aA = (a.c ?? 0) * Math.cos(((a.h ?? 0) * Math.PI) / 180);
  const aB = (a.c ?? 0) * Math.sin(((a.h ?? 0) * Math.PI) / 180);
  const bA = (b.c ?? 0) * Math.cos(((b.h ?? 0) * Math.PI) / 180);
  const bB = (b.c ?? 0) * Math.sin(((b.h ?? 0) * Math.PI) / 180);
  return Math.sqrt(dL * dL + (aA - bA) ** 2 + (aB - bB) ** 2);
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
  const counts = new Map();

  function record(str) {
    if (!str) return;
    const s = str.trim().toLowerCase();
    if (SKIP.has(s) || s.startsWith("var(") || s.startsWith("color-mix(") || s.startsWith("oklch(from")) return;
    const ok = toOk(str.trim());
    if (!ok) return;
    const hex = oklchToHex(ok);
    if (!hex || hex === "#000000" && s !== "#000" && s !== "#000000" && s !== "black" && s !== "rgb(0,0,0)") {
      if (hex === "#000000" && !["#000","#000000","black","rgb(0,0,0)","rgb(0, 0, 0)"].includes(s)) return;
    }
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }

  function sweepCss(css) {
    for (const [, prop, val] of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)) {
      if (!COLOR_PROPS.has(prop.trim().toLowerCase())) continue;
      for (const tok of val.split(/[\s,]+/)) record(tok.replace(/[;)]+$/, ""));
      record(val.trim());
    }
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

  return { counts };
}

// ── Playwright extraction (--browser path) ────────────────────────────────────

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

// ── Rep selection ─────────────────────────────────────────────────────────────
//
// selectReps(candidates, threshold)
//   candidates: [{ hex, count, ok: {l,c,h} }]
//   threshold:  OKLCH distance below which a new rep is too close to existing ones
//
// Seed: candidate with highest count × C (most visually prominent color).
// Each subsequent pick: the remaining candidate with the greatest minimum
// "effective distance" from all current reps, where effective distance from rep r
// is min(dist(c, r), dist(c, complement(r))). Using the complement means each rep
// also covers the opposite hue zone, preventing near-complement pairs from both
// being selected as reps. Stops when best remaining effective distance < threshold.

export function selectReps(candidates, threshold = 0.20) {
  if (candidates.length === 0) return [];

  const compOk = ok => ({ l: ok.l, c: ok.c ?? 0, h: ((ok.h ?? 0) + 180) % 360 });

  // Seed: highest count × C
  const sorted = [...candidates].sort(
    (a, b) => (b.count * (b.ok.c ?? 0)) - (a.count * (a.ok.c ?? 0))
  );
  const reps    = [sorted[0]];
  const repSet  = new Set([sorted[0]]);

  while (true) {
    let bestCand = null, bestDist = -Infinity;
    for (const c of candidates) {
      if (repSet.has(c)) continue;
      let minEff = Infinity;
      for (const r of reps) {
        const dRep  = oklchDist(c.ok, r.ok);
        const dComp = oklchDist(c.ok, compOk(r.ok));
        minEff = Math.min(minEff, dRep, dComp);
      }
      if (minEff > bestDist) { bestDist = minEff; bestCand = c; }
    }
    if (!bestCand || bestDist < threshold) break;
    reps.push(bestCand);
    repSet.add(bestCand);
  }

  return reps;
}

// ── Member assignment ─────────────────────────────────────────────────────────
//
// assignMembers(candidates, reps)
//   Assigns every candidate to the nearest rep cluster by OKLCH distance.
//   Each cluster: { hex, count, ok, members: [{hex, count, ok}] }

export function assignMembers(candidates, reps) {
  if (reps.length === 0) return [];
  const clusters = reps.map(r => ({
    hex:     r.hex,
    count:   r.count,
    ok:      r.ok,
    members: [r],
  }));

  for (const c of candidates) {
    if (reps.includes(c)) continue;
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      const d = oklchDist(c.ok, clusters[i].ok);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    clusters[bestIdx].members.push(c);
  }

  return clusters;
}

// ── Cluster ranking ───────────────────────────────────────────────────────────
//
// rankClusters(clusters)
//   Computes aggregate score = sum(count × C) for all members of each cluster.
//   Returns clusters sorted descending by aggregateScore. The top-5 become the
//   user-manipulable color swatches (--color-primary … --color-quinary).

export function rankClusters(clusters) {
  return clusters
    .map(cluster => ({
      ...cluster,
      aggregateScore: cluster.members.reduce((s, m) => s + m.count * (m.ok.c ?? 0), 0),
    }))
    .sort((a, b) => b.aggregateScore - a.aggregateScore);
}

// ── JSON builder ──────────────────────────────────────────────────────────────

const ORDINAL_VARS = [
  "--color-primary",
  "--color-secondary",
  "--color-tertiary",
  "--color-quaternary",
  "--color-quinary",
];

export function buildJson(top5, meta) {
  const scheme = {};
  for (let i = 0; i < top5.length; i++) {
    const cl = top5[i];
    scheme[ORDINAL_VARS[i]] = {
      hex:            cl.hex,
      oklch:          { l: +cl.ok.l.toFixed(4), c: +(cl.ok.c ?? 0).toFixed(4), h: +(cl.ok.h ?? 0).toFixed(1) },
      count:          cl.count,
      memberCount:    cl.members.length,
      aggregateScore: +(cl.aggregateScore ?? 0).toFixed(4),
    };
  }
  return JSON.stringify({ meta, scheme }, null, 2);
}

// ── CLI (only runs when invoked directly) ─────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args        = process.argv.slice(2);
  const useBrowser  = args.includes("--browser");
  const tArg        = args.find(a => a.startsWith("--threshold="));
  const threshold   = tArg ? parseFloat(tArg.split("=")[1]) : 0.20;
  const posArgs     = args.filter(a => !a.startsWith("--"));
  const [inputPath, outputArg] = posArgs;

  if (!inputPath) {
    console.error("Usage: node extractColors.mjs <input.html> [outputDir] [--browser] [--threshold=<float>]");
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
      ({ counts } = extractRegex(readFileSync(resolve(inputPath), "utf-8")));
    }
  } else {
    ({ counts } = extractRegex(readFileSync(resolve(inputPath), "utf-8")));
    console.log(`✓ Regex extracted ${counts.size} unique colors`);
  }

  const candidates = [...counts.entries()]
    .map(([hex, count]) => ({ hex, count, ok: toOk(hex) }))
    .filter(e => e.ok);

  const reps     = selectReps(candidates, threshold);
  const clusters = assignMembers(candidates, reps);
  const ranked   = rankClusters(clusters);
  const top5     = ranked.slice(0, 5);
  const meta     = { k: top5.length, threshold };

  const jsonPath = resolve(outDir, "palette.json");
  writeFileSync(jsonPath, buildJson(top5, meta), "utf-8");

  console.log(`\nTop ${top5.length} clusters (threshold=${threshold}):`);
  for (let i = 0; i < top5.length; i++) {
    const cl = top5[i];
    console.log(`  ${ORDINAL_VARS[i].padEnd(22)}  ${fmtOklch(cl.ok)}  members=${cl.members.length}  score=${cl.aggregateScore.toFixed(3)}`);
  }
  console.log(`\n✓ ${jsonPath}`);
}
