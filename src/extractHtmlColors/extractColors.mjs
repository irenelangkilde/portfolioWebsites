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

function oklchComplement(ok) {
  return { l: ok.l, c: ok.c ?? 0, h: ((ok.h ?? 0) + 180) % 360 };
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

  const stripCssComments = css => String(css || "").replace(/\/\*[\s\S]*?\*\//g, "");
  const stripHtmlComments = markup => String(markup || "").replace(/<!--[\s\S]*?-->/g, "");
  const scanHtml = stripCssComments(stripHtmlComments(html));

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
    css = stripCssComments(css);
    for (const [, prop, val] of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)) {
      if (!COLOR_PROPS.has(prop.trim().toLowerCase())) continue;
      record(val.trim());
    }
    for (const [m] of css.matchAll(/#[0-9a-fA-F]{3,8}\b/g))   record(m);
    for (const [m] of css.matchAll(/rgba?\([^)]+\)/gi))         record(m);
    for (const [m] of css.matchAll(/hsla?\([^)]+\)/gi))         record(m);
    for (const [m] of css.matchAll(/oklch\([^)]+\)/gi))         record(m);
    for (const [m] of css.matchAll(/oklab\([^)]+\)/gi))         record(m);
    for (const [m] of css.matchAll(/lch\([^)]+\)/gi))           record(m);
    for (const [m] of css.matchAll(/lab\([^)]+\)/gi))           record(m);
    for (const [m] of css.matchAll(/color\([^)]+\)/gi))         record(m);
  }

  for (const [, css] of scanHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) sweepCss(css);
  for (const [, attr] of scanHtml.matchAll(/\bstyle="([^"]*)"/gi))  sweepCss(attr);
  for (const [, attr] of scanHtml.matchAll(/\bstyle='([^']*)'/gi))  sweepCss(attr);
  for (const [m] of scanHtml.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) record(m);

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

// ── Centroid: frequency-weighted OKLab mean → OKLCH ──────────────────────────

function computeCentroid(members) {
  let wL = 0, wA = 0, wB = 0, totalW = 0;
  for (const m of members) {
    const w = m.count;
    const a = (m.ok.c ?? 0) * Math.cos(((m.ok.h ?? 0) * Math.PI) / 180);
    const b = (m.ok.c ?? 0) * Math.sin(((m.ok.h ?? 0) * Math.PI) / 180);
    wL += w * m.ok.l; wA += w * a; wB += w * b; totalW += w;
  }
  if (!totalW) return members[0]?.ok ?? { l: 0.5, c: 0, h: 0 };
  const l = wL / totalW;
  const a = wA / totalW;
  const b = wB / totalW;
  const c = Math.sqrt(a * a + b * b);
  const h = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  return { l, c, h };
}

// ── Calinski-Harabasz index ───────────────────────────────────────────────────
//
// CH(k) = [ SSB / (k−1) ] / [ SSW / (n−k) ]
//   SSB = Σ_clusters  count_cl × dist(centroid_cl, global_centroid)²   (freq-weighted)
//   SSW = Σ_clusters  Σ_members  count_m × dist(member.ok, centroid_cl)²
//   n   = number of distinct color candidates (NOT frequency sum — this keeps the
//          degrees-of-freedom penalty proportional to cluster count)
//   k   = number of clusters
//
// Using n = distinct count makes n-k sensitive: at k=n every cluster is a singleton,
// n-k=0, and CH collapses to 0 — blocking the full-singleton degenerate solution.
// Returns 0 for k<2 or n<=k (undefined / degenerate).

function computeCH(clusters, n) {
  const k = clusters.length;
  if (k < 2 || n <= k) return 0;
  const allMembers = clusters.flatMap(cl => cl.members);
  const globalCentroid = computeCentroid(allMembers);
  let SSB = 0;
  for (const cl of clusters) {
    const clCount = cl.members.reduce((s, m) => s + m.count, 0);
    const d = oklchDist(cl.centroid, globalCentroid);
    SSB += clCount * d * d;
  }
  let SSW = 0;
  for (const cl of clusters) {
    for (const m of cl.members) {
      const d = oklchDist(m.ok, cl.centroid);
      SSW += m.count * d * d;
    }
  }
  if (SSW === 0) return Infinity;
  return (SSB / (k - 1)) / (SSW / (n - k));
}

// ── Cluster builder ───────────────────────────────────────────────────────────
//
// Phase 1 — farthest-point selection seeded on virtual {black, white} anchors.
//   Each iteration: find the candidate with the largest minEff distance from
//   the current effective-rep set (anchors + cluster centroids), seed a new
//   cluster at that point, reassign all candidates to their nearest cluster,
//   recompute each cluster's frequency-weighted centroid.
//   Stop at k ≥ maxK or absolute minEff < threshold.
//
// Phase 2a — k-means refinement.
//   Phase 1 centroids drift as new reps are added, leaving some colors assigned
//   to a sub-optimal cluster. Run reassign→recompute until convergence.
//
// Phase 2b — CH-guided merge.
//   Greedily merge cluster pairs whose union increases Calinski-Harabasz.
//   This corrects any over-clustering from Phase 1 without collapsing clusters
//   that are genuinely distinct.
//
// Caller: pass result directly to rankClusters → buildJson.

export function buildClusters(
  candidates,
  { threshold = 0.20, maxK = 7 } = {}
) {
  if (!candidates.length) return [];

  const BLACK = { l: 0, c: 0, h: 0 };
  const WHITE = { l: 1, c: 0, h: 0 };

  // ── Phase 1 ─────────────────────────────────────────────────────────────────
  let clusters = [];

  while (clusters.length < maxK) {
    const effectiveReps = [BLACK, WHITE, ...clusters.map(cl => cl.centroid)];

    let bestCand = null, bestMEff = -Infinity;
    for (const c of candidates) {
      const mEff = Math.min(...effectiveReps.map(r => oklchDist(c.ok, r)));
      if (mEff > bestMEff) { bestMEff = mEff; bestCand = c; }
    }

    if (!bestCand || bestMEff < threshold) break;

    clusters.push({ centroid: { ...bestCand.ok }, members: [] });

    // Reassign all candidates to nearest cluster centroid
    const buckets = clusters.map(() => []);
    for (const c of candidates) {
      let nearestIdx = 0, nearestD = Infinity;
      for (let i = 0; i < clusters.length; i++) {
        const d = oklchDist(c.ok, clusters[i].centroid);
        if (d < nearestD) { nearestD = d; nearestIdx = i; }
      }
      buckets[nearestIdx].push(c);
    }

    for (let i = 0; i < clusters.length; i++) {
      clusters[i].members = buckets[i];
      if (buckets[i].length) clusters[i].centroid = computeCentroid(buckets[i]);
    }
    clusters = clusters.filter(cl => cl.members.length > 0);
  }

  // ── Phase 2a — k-means refinement ────────────────────────────────────────────
  //
  // Phase 1 centroids drift as each new rep is added and colours are globally
  // reassigned, so some colours end up in the wrong cluster. Iterate
  // reassign→recompute until stable (at most 20 passes).
  for (let pass = 0; pass < 20; pass++) {
    const buckets = clusters.map(() => []);
    for (const c of candidates) {
      let ni = 0, nd = Infinity;
      for (let i = 0; i < clusters.length; i++) {
        const d = oklchDist(c.ok, clusters[i].centroid);
        if (d < nd) { nd = d; ni = i; }
      }
      buckets[ni].push(c);
    }
    let changed = false;
    for (let i = 0; i < clusters.length; i++) {
      const oldSet = new Set(clusters[i].members.map(m => m.hex));
      if (buckets[i].length !== oldSet.size || buckets[i].some(m => !oldSet.has(m.hex)))
        changed = true;
      clusters[i].members = buckets[i];
      if (buckets[i].length) clusters[i].centroid = computeCentroid(buckets[i]);
    }
    clusters = clusters.filter(cl => cl.members.length > 0);
    if (!changed) break;
  }

  // ── Phase 2b — CH-guided merge ────────────────────────────────────────────────
  //
  // After k-means the cluster boundaries are optimal for the current k.
  // Now try merging pairs: if merging raises CH (clusters are not genuinely
  // distinct), apply it. n = distinct color count so (n-k) is sensitive to k,
  // preventing degenerate collapse when n is small.
  const n = candidates.length;
  let chCurrent = computeCH(clusters, n);

  while (clusters.length > 1) {
    let bestCH = chCurrent, bestMerge = null;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const mergedMembers  = [...clusters[i].members, ...clusters[j].members];
        const mergedCentroid = computeCentroid(mergedMembers);
        const hypothetical   = [
          ...clusters.slice(0, i),
          { centroid: mergedCentroid, members: mergedMembers },
          ...clusters.slice(i + 1, j),
          ...clusters.slice(j + 1),
        ];
        const chNew = computeCH(hypothetical, n);
        if (chNew > bestCH) { bestCH = chNew; bestMerge = { i, j, hypothetical }; }
      }
    }

    if (!bestMerge) break;
    clusters = bestMerge.hypothetical;
    chCurrent = bestCH;
  }

  return clusters.map(cl => ({
    centroid: cl.centroid,
    hex:      oklchToHex(cl.centroid),
    ok:       cl.centroid,
    count:    cl.members.reduce((s, m) => s + m.count, 0),
    members:  cl.members,
  }));
}

// ── Two-phase dedup ───────────────────────────────────────────────────────────
//
// dedupColors(candidates, { dupThreshold, variantThreshold })
//
// A lighter alternative to buildClusters for the editor's normalizeHtml path.
// Rather than running k-means / CH-merge, it does a single greedy pass:
//
//   - Process candidates sorted by count (descending).
//   - For each candidate, find its nearest existing rep:
//       dist < dupThreshold  → "exact duplicate": same CSS var expression
//       dist < variantThreshold → "variant": oklch(from var(…) …) expression
//       dist ≥ variantThreshold → new rep: gets its own CSS variable
//
// Returns an array of rep objects { hex, ok, count, members[] } where
// members hold both exact-duplicate and variant entries annotated with dist.
// White and black are treated as ordinary colors (no virtual anchors).

export function dedupColors(
  candidates,
  { dupThreshold = 0.02, variantThreshold = 0.10 } = {}
) {
  const sorted = [...candidates].sort((a, b) => b.count - a.count);
  const reps = [];

  for (const c of sorted) {
    let nearestIdx = -1, nearestDist = Infinity;
    for (let i = 0; i < reps.length; i++) {
      const d = oklchDist(c.ok, reps[i].ok);
      if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
    }

    if (nearestIdx < 0 || nearestDist >= variantThreshold) {
      reps.push({ hex: c.hex, ok: c.ok, count: c.count, members: [] });
    } else {
      reps[nearestIdx].count += c.count;
      reps[nearestIdx].members.push({ hex: c.hex, ok: c.ok, count: c.count, dist: nearestDist });
    }
  }

  return reps;
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

export function annotateComplementMembers(topClusters, candidates, { threshold = 0.20 } = {}) {
  if (!Array.isArray(topClusters) || !topClusters.length || !Array.isArray(candidates)) {
    return topClusters || [];
  }

  const clusters = topClusters.map(cluster => ({ ...cluster, complementMembers: [] }));
  const complementSeen = clusters.map(() => new Set());

  for (const candidate of candidates) {
    if (!candidate?.ok || !candidate?.hex) continue;

    let best = { distance: Infinity, index: -1, side: "rep" };
    clusters.forEach((cluster, index) => {
      const repDistance = oklchDist(candidate.ok, cluster.ok);
      if (repDistance < best.distance) {
        best = { distance: repDistance, index, side: "rep" };
      }

      const complementDistance = oklchDist(candidate.ok, oklchComplement(cluster.ok));
      if (complementDistance < best.distance) {
        best = { distance: complementDistance, index, side: "complement" };
      }
    });

    if (best.index < 0 || best.side !== "complement" || best.distance >= threshold) continue;

    const cluster = clusters[best.index];
    if (candidate.hex.toLowerCase() === cluster.hex.toLowerCase()) continue;

    const seenKey = candidate.hex.toLowerCase();
    if (complementSeen[best.index].has(seenKey)) continue;
    complementSeen[best.index].add(seenKey);
    cluster.complementMembers.push(candidate);
  }

  return clusters;
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
    const entry = {
      hex:            cl.hex,
      oklch:          { l: +cl.ok.l.toFixed(4), c: +(cl.ok.c ?? 0).toFixed(4), h: +(cl.ok.h ?? 0).toFixed(1) },
      count:          cl.count,
      memberCount:    cl.members.length,
      aggregateScore: +(cl.aggregateScore ?? 0).toFixed(4),
      members:        cl.members.map(m => ({
        hex:   m.hex,
        count: m.count,
        score: +((m.count * (m.ok.c ?? 0)).toFixed(4)),
      })),
    };

    if (Array.isArray(cl.complementMembers) && cl.complementMembers.length) {
      const complementOk = computeCentroid(cl.complementMembers);
      entry.complement = {
        hex:         oklchToHex(complementOk),
        oklch:       { l: +complementOk.l.toFixed(4), c: +(complementOk.c ?? 0).toFixed(4), h: +(complementOk.h ?? 0).toFixed(1) },
        count:       cl.complementMembers.reduce((sum, member) => sum + member.count, 0),
        memberCount: cl.complementMembers.length,
      };
    }

    scheme[ORDINAL_VARS[i]] = entry;
  }
  return JSON.stringify({ meta, scheme }, null, 2);
}

// ── CLI (only runs when invoked directly) ─────────────────────────────────────

/* @__PURE__ */ (() => { if (typeof import.meta.url === "string" && process.argv[1] === fileURLToPath(import.meta.url)) (async () => {
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

    const clusters = buildClusters(candidates, { threshold });
    const ranked   = rankClusters(clusters);
    const top5     = annotateComplementMembers(ranked.slice(0, 5), candidates, { threshold });
    const meta     = { k: top5.length, threshold };

    const jsonPath = resolve(outDir, "palette.json");
    writeFileSync(jsonPath, buildJson(top5, meta), "utf-8");

    console.log(`\nTop ${top5.length} clusters (threshold=${threshold}):`);
    for (let i = 0; i < top5.length; i++) {
      const cl = top5[i];
      console.log(`  ${ORDINAL_VARS[i].padEnd(22)}  ${fmtOklch(cl.ok)}  members=${cl.members.length}  score=${cl.aggregateScore.toFixed(3)}`);
    }
    console.log(`\n✓ ${jsonPath}`);
  })(); })();
