/**
 * Netlify Function: normalizeHtml
 * POST /.netlify/functions/normalizeHtml
 * Body: { html: string }
 * Returns: { html: string, k: number }
 *
 * Two-phase dedup pipeline:
 *   Phase 1 (dupThreshold 0.02): near-identical colors collapse to the same var expression.
 *   Phase 2 (variantThreshold 0.10): colors within range become oklch(from var(…) …) expressions.
 *   Each remaining rep farther than variantThreshold gets its own CSS variable --c-1, --c-2, …
 *
 *   1. Strip existing extracted-theme / color-palette blocks
 *   2. Un-rewrite any prior var expressions back to raw hex (idempotent re-run)
 *   3. Run dedupColors to find reps
 *   4. Insert <style id="extracted-theme"> + <script id="color-palette">
 *   5. Rewrite CSS hex / rgba() → var() / oklch(from var(…) …) / color-mix expressions
 */

import {
  extractRegex, dedupColors, toOk, fmtOklch, oklchToHex,
} from "../../extractHtmlColors/extractColors.mjs";

const DUP_THRESHOLD     = 0.02;
const VARIANT_THRESHOLD = 0.10;

function repVarName(i) { return `--c-${i + 1}`; }

// ── Hex helpers ───────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = hex.replace("#", "").toLowerCase();
  if (h.length === 3)
    return { r: parseInt(h[0]+h[0],16), g: parseInt(h[1]+h[1],16), b: parseInt(h[2]+h[2],16) };
  if (h.length === 6)
    return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
  return null;
}

// ── CSS Relative Color Syntax ─────────────────────────────────────────────────

function fmtDelta(d, digits) {
  return d >= 0 ? `+ ${d.toFixed(digits)}` : `- ${Math.abs(d).toFixed(digits)}`;
}

function relColorExpr(varName, memberOk, repOk) {
  const dL = memberOk.l - repOk.l;
  const dC = (memberOk.c ?? 0) - (repOk.c ?? 0);
  let   dH = (memberOk.h ?? 0) - (repOk.h ?? 0);
  if (dH >  180) dH -= 360;
  if (dH < -180) dH += 360;

  if (Math.abs(dL) < 0.0005 && Math.abs(dC) < 0.0005 && Math.abs(dH) < 0.05)
    return `var(${varName})`;

  const lPart = Math.abs(dL) < 0.0005 ? "l" : `calc(l ${fmtDelta(dL, 4)})`;
  const cPart = Math.abs(dC) < 0.0005 ? "c" : `calc(c ${fmtDelta(dC, 4)})`;
  const hPart = Math.abs(dH) < 0.05   ? "h" : `calc(h ${fmtDelta(dH, 1)})`;

  return `oklch(from var(${varName}) ${lPart} ${cPart} ${hPart})`;
}

function relColorAlphaExpr(varName, memberOk, repOk, alpha) {
  const base = relColorExpr(varName, memberOk, repOk);
  const pct  = (alpha * 100).toFixed(1).replace(/\.0$/, "");
  return `color-mix(in srgb, ${base} ${pct}%, transparent)`;
}

// ── Rewrite map ───────────────────────────────────────────────────────────────

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

// ── CSS rewriter ──────────────────────────────────────────────────────────────

function rewriteCssVars(html, hexExprMap, rgbMap) {
  function rewriteCss(css) {
    let out = css.replace(/#([0-9a-fA-F]{6})\b/g, m => hexExprMap.get(m.toLowerCase()) ?? m);
    out = out.replace(/#([0-9a-fA-F]{3})\b/g, (m, d) => {
      const exp = "#" + d.split("").map(c => c + c).join("");
      return hexExprMap.get(exp.toLowerCase()) ?? m;
    });
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

  let result = html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (match, attrs, css) => {
    if (/id\s*=\s*["']extracted-theme["']/i.test(attrs)) return match;
    return `<style${attrs}>${rewriteCss(css)}</style>`;
  });
  result = result.replace(/(\bstyle\s*=\s*")([^"]*?)(")/gi, (m, o, css, c) => `${o}${rewriteCss(css)}${c}`);
  result = result.replace(/(\bstyle\s*=\s*')([^']*?)(')/gi, (m, o, css, c) => `${o}${rewriteCss(css)}${c}`);
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

// ── Theme block helpers ───────────────────────────────────────────────────────

function buildExtractedThemeCss(reps) {
  const lines = ["/* Generated by normalizeHtml */", ":root {"];
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

function stripColorThemeBlocks(html) {
  return html
    .replace(/<style[^>]*id=["']extracted-theme["'][^>]*>[\s\S]*?<\/style>\s*/i, "")
    .replace(/<script[^>]*id=["']color-palette["'][^>]*>[\s\S]*?<\/script>\s*/i, "");
}

function insertThemeInjection(html, injection) {
  if (html.includes("</head>")) return html.replace("</head>", `${injection}\n</head>`);
  if (/<body/i.test(html)) return html.replace(/<body[^>]*>/i, m => `${injection}\n${m}`);
  return injection + "\n" + html;
}

// ── Un-rewrite prior var expressions back to hex (idempotency) ───────────────
//
// Handles all three historical formats:
//   Old:     rgba(var(--color-X-rgb), A), var(--color-bg/text)
//   Ordinal: var(--color-primary…quinary), oklch(from var(--color-X) …)
//   --c-N:   var(--c-N), oklch(from var(--c-N) …)

function unRewriteVars(html) {
  const scriptMatch = html.match(/<script[^>]*id=["']color-palette["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!scriptMatch) return html;
  let palette;
  try { palette = JSON.parse(scriptMatch[1]); } catch { return html; }
  const scheme = palette?.scheme;
  if (!scheme || !Object.keys(scheme).length) return html;

  const isOldFormat = "--color-bg" in scheme || "--color-text" in scheme;
  if (isOldFormat) {
    const varToHex = new Map();
    const varToRgb = new Map();
    for (const [k, entry] of Object.entries(scheme)) {
      const hex = entry?.hex;
      if (!hex) continue;
      varToHex.set(k, hex);
      const h = hex.replace("#", "");
      if (h.length === 6)
        varToRgb.set(`${k}-rgb`,
          `${parseInt(h.slice(0,2),16)}, ${parseInt(h.slice(2,4),16)}, ${parseInt(h.slice(4,6),16)}`);
    }
    function oldUnRewrite(css) {
      let out = css.replace(/rgba?\(\s*var\(\s*(--[\w-]+-rgb)\s*\)\s*(?:,\s*([\d.]+%?)\s*)?\)/g,
        (m, rv, a) => { const rgb = varToRgb.get(rv); return rgb ? (a !== undefined ? `rgba(${rgb}, ${a})` : `rgb(${rgb})`) : m; });
      out = out.replace(/var\(\s*(--color-[\w-]+)\s*\)/g, (m, v) => varToHex.get(v) ?? m);
      return out;
    }
    return applyToCss(html, oldUnRewrite);
  }

  // New format (ordinal --color-X or --c-N): evaluate relative-color expressions back to hex
  const varToHex   = new Map();
  const varToOklch = new Map();
  for (const [k, entry] of Object.entries(scheme)) {
    if (entry?.hex)   varToHex.set(k, entry.hex);
    if (entry?.oklch) varToOklch.set(k, entry.oklch);
  }

  function evalExpr(expr, baseVal) {
    const s = String(expr).trim();
    if (s === "l" || s === "c" || s === "h") return baseVal;
    const m = s.match(/^calc\(\s*[lch]\s*([+-])\s*([\d.]+)\s*\)$/);
    if (m) return m[1] === "+" ? baseVal + parseFloat(m[2]) : baseVal - parseFloat(m[2]);
    const n = parseFloat(s);
    return isNaN(n) ? baseVal : n;
  }

  const EXPR_S = "(?:calc\\([^)]*\\)|\\S+)";

  function computeOklchHex(varName, lE, cE, hE) {
    const base = varToOklch.get(varName);
    if (!base) return null;
    const L = evalExpr(lE, base.l);
    const C = Math.max(0, evalExpr(cE, base.c));
    const H = evalExpr(hE, base.h);
    return oklchToHex({ l: L, c: C, h: H }) || null;
  }

  function hexToRgbaStr(hex, alpha) {
    const h = hex.replace("#", "");
    if (h.length !== 6) return null;
    const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function newUnRewrite(css) {
    let out = css;
    // color-mix(in srgb, oklch(from var(--X) L C H) P%, transparent) → rgba
    out = out.replace(new RegExp(
      `color-mix\\(in srgb\\s*,\\s*oklch\\(from\\s+var\\(\\s*(--[\\w-]+)\\s*\\)\\s+(${EXPR_S})\\s+(${EXPR_S})\\s+(${EXPR_S})\\s*\\)\\s+([\\d.]+)%\\s*,\\s*transparent\\)`, "gi"),
      (m, vn, lE, cE, hE, pct) => { const hex = computeOklchHex(vn, lE, cE, hE); return hex ? (hexToRgbaStr(hex, parseFloat(pct)/100) ?? m) : m; });
    // color-mix(in srgb, var(--X) P%, transparent) → rgba
    out = out.replace(/color-mix\(in srgb\s*,\s*var\(\s*(--[\w-]+)\s*\)\s+([\d.]+)%\s*,\s*transparent\)/gi,
      (m, vn, pct) => { const hex = varToHex.get(vn); if (!hex) return m; return hexToRgbaStr(hex, parseFloat(pct)/100) ?? m; });
    // oklch(from var(--X) L C H) → hex
    out = out.replace(new RegExp(
      `oklch\\(from\\s+var\\(\\s*(--[\\w-]+)\\s*\\)\\s+(${EXPR_S})\\s+(${EXPR_S})\\s+(${EXPR_S})(?:\\s*/[^)]+)?\\s*\\)`, "gi"),
      (m, vn, lE, cE, hE) => computeOklchHex(vn, lE, cE, hE) ?? m);
    // var(--X) → hex
    out = out.replace(/var\(\s*(--[\w-]+)\s*\)/g, (m, v) => varToHex.get(v) ?? m);
    return out;
  }

  return applyToCss(html, newUnRewrite);
}

function applyToCss(html, fn) {
  let result = html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (match, attrs, css) => {
    if (/id\s*=\s*["']extracted-theme["']/i.test(attrs)) return match;
    return `<style${attrs}>${fn(css)}</style>`;
  });
  result = result.replace(/(\bstyle\s*=\s*")([^"]*?)(")/gi, (m, o, css, c) => `${o}${fn(css)}${c}`);
  result = result.replace(/(\bstyle\s*=\s*')([^']*?)(')/gi, (m, o, css, c) => `${o}${fn(css)}${c}`);
  return result;
}

// ── Core pipeline ─────────────────────────────────────────────────────────────

function normalizeHtmlString(rawHtml) {
  const stripped  = unRewriteVars(stripColorThemeBlocks(rawHtml));
  const { counts } = extractRegex(stripped);

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
  const withTheme  = insertThemeInjection(stripped, injection);
  const rewritten  = rewriteCssVars(withTheme, hexExprMap, rgbMap);

  return { html: rewritten, k: reps.length };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const rawHtml = body.html;
  if (typeof rawHtml !== "string" || !rawHtml.trim()) {
    return { statusCode: 400, body: "Missing html field" };
  }

  try {
    const result = normalizeHtmlString(rawHtml);
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error("[normalizeHtml] error:", err.message);
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }
}
