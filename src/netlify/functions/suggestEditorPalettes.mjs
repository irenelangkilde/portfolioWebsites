/**
 * Netlify Function: suggestEditorPalettes
 * POST /.netlify/functions/suggestEditorPalettes
 * Body: {
 *   preferredColors: string,
 *   swatches: [{ id, ordinal, original, current, dependents? }],
 *   html?: string,
 *   provider?: "claude" | "openai"
 * }
 * Returns: { palettes: [{ name, rationale, colors: [{ id, ordinal, hex }] }] }
 */

const HEX_RE = /^#[0-9a-f]{6}$/i;
const AI_TIMEOUT_MS = 18000;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function normalizeHex(value) {
  const s = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    return "#" + s.slice(1).split("").map(ch => ch + ch).join("").toLowerCase();
  }
  return "";
}

function stripFence(text = "") {
  return String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseJsonLoose(text = "") {
  const clean = stripFence(text);
  try { return JSON.parse(clean); } catch {}
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(clean.slice(start, end + 1)); } catch {}
  }
  return null;
}

function normalizedSwatches(swatches) {
  return (Array.isArray(swatches) ? swatches : [])
    .map((swatch, index) => ({
      id: String(swatch?.id || `swatch-${index + 1}`).slice(0, 80),
      ordinal: String(swatch?.ordinal || "").slice(0, 8),
      variable: String(swatch?.variable || "").slice(0, 80),
      sourceVariable: String(swatch?.sourceVariable || swatch?.sourceVarName || "").slice(0, 80),
      count: Number.isFinite(Number(swatch?.count)) ? Number(swatch.count) : 0,
      chroma: Number.isFinite(Number(swatch?.chroma)) ? Number(swatch.chroma) : 0,
      original: normalizeHex(swatch?.original || swatch?.hex),
      current: normalizeHex(swatch?.current || swatch?.substitute || swatch?.original || swatch?.hex),
      dependents: (Array.isArray(swatch?.dependents) ? swatch.dependents : [])
        .map(dep => ({
          ordinal: String(dep?.ordinal || "").slice(0, 8),
          variable: String(dep?.variable || "").slice(0, 80),
          sourceVariable: String(dep?.sourceVariable || dep?.sourceVarName || "").slice(0, 80),
          count: Number.isFinite(Number(dep?.count)) ? Number(dep.count) : 0,
          original: normalizeHex(dep?.original || dep?.hex),
          current: normalizeHex(dep?.current || dep?.substitute || dep?.original || dep?.hex),
        }))
        .filter(dep => dep.original || dep.current)
        .slice(0, 12),
    }))
    .filter(swatch => swatch.original || swatch.current)
    .slice(0, 28);
}

function normalizePalette(rawPalette, swatches, index) {
  const rawColors = Array.isArray(rawPalette?.colors)
    ? rawPalette.colors
    : Array.isArray(rawPalette?.swatches)
      ? rawPalette.swatches
      : [];
  const byId = new Map();
  const byOrdinal = new Map();
  rawColors.forEach((entry, i) => {
    const hex = normalizeHex(entry?.hex || entry?.color || entry);
    if (!hex) return;
    const id = String(entry?.id || "").trim();
    const ordinal = String(entry?.ordinal || "").trim().toUpperCase();
    if (id) byId.set(id, hex);
    if (ordinal) byOrdinal.set(ordinal, hex);
    byId.set(`__index_${i}`, hex);
  });

  const colors = swatches.map((swatch, i) => {
    const hex = byId.get(swatch.id) ||
      byOrdinal.get(String(swatch.ordinal || "").toUpperCase()) ||
      byId.get(`__index_${i}`) ||
      "";
    return hex && HEX_RE.test(hex)
      ? { id: swatch.id, ordinal: swatch.ordinal, hex }
      : null;
  }).filter(Boolean);

  if (colors.length < Math.max(3, Math.ceil(swatches.length * 0.75))) return null;
  return {
    name: String(rawPalette?.name || rawPalette?.label || `Palette ${index + 1}`).slice(0, 80),
    rationale: String(rawPalette?.rationale || rawPalette?.how_used || "").slice(0, 240),
    colors,
  };
}

function hexToOklab(hex) {
  const clean = normalizeHex(hex).slice(1);
  if (clean.length !== 6) return null;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const lin = v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l_ = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m_ = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s_ = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return {
    l: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
}

function oklabDist(a, b) {
  if (!a || !b) return 0;
  return Math.sqrt((a.l - b.l) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

function paletteDistance(a, b) {
  const aById = new Map((a.colors || []).map(color => [color.id, normalizeHex(color.hex)]));
  const bById = new Map((b.colors || []).map(color => [color.id, normalizeHex(color.hex)]));
  let compared = 0;
  let changed = 0;
  let total = 0;

  for (const [id, aHex] of aById) {
    const bHex = bById.get(id);
    if (!aHex || !bHex) continue;
    compared++;
    const d = oklabDist(hexToOklab(aHex), hexToOklab(bHex));
    total += d;
    if (d >= 0.045) changed++;
  }

  return {
    compared,
    changed,
    mean: compared ? total / compared : 0,
    changedRatio: compared ? changed / compared : 0,
  };
}

function palettesAreDistinct(a, b) {
  const d = paletteDistance(a, b);
  return d.compared >= 3 && d.mean >= 0.055 && d.changedRatio >= 0.45;
}

function selectDistinctPalettes(palettes) {
  // First 3 palettes: must be mutually distinct.
  // 4th palette (inversion): always kept if present — structural inversion is distinct by definition.
  const first3 = [];
  let inversion = null;
  for (const palette of palettes) {
    if (palette._isInversion) { inversion = palette; continue; }
    if (first3.length < 3 && first3.every(existing => palettesAreDistinct(existing, palette))) {
      first3.push(palette);
    }
  }
  // Fallback: if AI didn't tag the inversion, treat the last palette as inversion
  if (!inversion && palettes.length >= 4) inversion = palettes[palettes.length - 1];
  return inversion ? [...first3, inversion] : first3;
}

function normalizeAiResult(result, swatches) {
  const raw = Array.isArray(result?.palettes) ? result.palettes : [];
  const palettes = raw
    .map((palette, index) => {
      const normalized = normalizePalette(palette, swatches, index);
      if (normalized && (palette.inversion === true || palette._isInversion === true)) {
        normalized._isInversion = true;
      }
      return normalized;
    })
    .filter(Boolean);
  return selectDistinctPalettes(palettes);
}

function htmlText(html = "") {
  return String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripCssComments(css = "") {
  return String(css || "").replace(/\/\*[\s\S]*?\*\//g, " ");
}

function extractStyleText(html = "") {
  return [...String(html || "").matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map(match => match[1] || "")
    .join("\n");
}

function isColorDeclaration(property, value) {
  const prop = String(property || "").toLowerCase();
  const val = String(value || "").toLowerCase();
  return /(color|background|border|outline|shadow|fill|stroke|accent|caret|decoration|gradient)/.test(prop) ||
    /(?:var\(--|#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|color-mix\(|linear-gradient|radial-gradient)/i.test(val);
}

function compactCssRules(css = "") {
  const clean = stripCssComments(css);
  const rules = [];
  for (const match of clean.matchAll(/([^{}@][^{}]{0,220})\{([^{}]{0,1800})\}/g)) {
    const selector = String(match[1] || "").replace(/\s+/g, " ").trim();
    if (!selector || selector.includes("@keyframes")) continue;
    const declarations = String(match[2] || "")
      .split(";")
      .map(part => part.trim())
      .map(part => {
        const colon = part.indexOf(":");
        if (colon < 1) return null;
        const property = part.slice(0, colon).trim();
        const value = part.slice(colon + 1).replace(/\s+/g, " ").trim();
        if (!isColorDeclaration(property, value)) return null;
        return {
          property: property.slice(0, 64),
          value: value.slice(0, 180),
        };
      })
      .filter(Boolean)
      .slice(0, 12);
    if (declarations.length) {
      rules.push({
        selector: selector.slice(0, 160),
        declarations,
      });
    }
    if (rules.length >= 140) break;
  }
  return rules;
}

function compactInlineColorStyles(html = "") {
  const out = [];
  for (const match of String(html || "").matchAll(/<([a-z0-9-]+)\b([^>]*)\sstyle\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const tag = String(match[1] || "").toLowerCase();
    const attrs = String(match[2] || "");
    const cls = (attrs.match(/\bclass\s*=\s*["']([^"']+)["']/i)?.[1] || "").replace(/\s+/g, ".").slice(0, 100);
    const id = (attrs.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1] || "").slice(0, 80);
    const declarations = String(match[3] || "")
      .split(";")
      .map(part => part.trim())
      .filter(part => {
        const colon = part.indexOf(":");
        return colon > 0 && isColorDeclaration(part.slice(0, colon), part.slice(colon + 1));
      })
      .slice(0, 8);
    if (declarations.length) {
      out.push({
        element: `${tag}${id ? "#" + id : ""}${cls ? "." + cls : ""}`.slice(0, 160),
        declarations,
      });
    }
    if (out.length >= 60) break;
  }
  return out;
}

function variableUsageMap(rules) {
  const usage = new Map();
  for (const rule of rules) {
    for (const declaration of rule.declarations || []) {
      for (const match of String(declaration.value || "").matchAll(/var\(\s*(--[a-z0-9_-]+)/gi)) {
        const name = match[1];
        if (!usage.has(name)) usage.set(name, []);
        usage.get(name).push({
          selector: rule.selector,
          property: declaration.property,
        });
      }
    }
  }
  return [...usage.entries()].map(([variable, uses]) => ({
    variable,
    uses: uses.slice(0, 18),
  })).slice(0, 80);
}

function summarizeHtmlForPalettePrompt(html = "") {
  const source = String(html || "");
  const title = (source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim();
  const styleText = extractStyleText(source);
  const cssVars = [...source.matchAll(/--[a-z0-9_-]+\s*:\s*[^;{}]{1,120};/gi)]
    .map(match => match[0].trim())
    .filter((value, index, list) => list.indexOf(value) === index)
    .slice(0, 140);
  const classHints = [...source.matchAll(/\bclass\s*=\s*["']([^"']+)["']/gi)]
    .flatMap(match => String(match[1] || "").split(/\s+/))
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .slice(0, 90);
  const colorRules = compactCssRules(styleText);
  return JSON.stringify({
    title,
    cssVariables: cssVars,
    colorRules,
    variableUsage: variableUsageMap(colorRules),
    inlineColorStyles: compactInlineColorStyles(source),
    classHints,
  }, null, 2);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hexToRgbObj(hex) {
  const clean = normalizeHex(hex).slice(1);
  if (clean.length !== 6) return null;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function rgbToHexObj({ r, g, b }) {
  return "#" + [r, g, b]
    .map(value => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0"))
    .join("");
}

function rgbToHslObj({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h / 6, s, l };
}

function hslToRgbObj({ h, s, l }) {
  h = ((h % 1) + 1) % 1;
  if (!s) {
    const value = Math.round(l * 255);
    return { r: value, g: value, b: value };
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

function rotateHue(h, degrees) {
  return ((h + degrees / 360) % 1 + 1) % 1;
}

function mixHue(a, b, weight = 0.5) {
  let delta = b - a;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return ((a + delta * weight) % 1 + 1) % 1;
}

const NAMED_COLORS = {
  black: "#111111", white: "#ffffff", ivory: "#fffff0", cream: "#fff7df",
  beige: "#d8c5a6", gray: "#808080", grey: "#808080", slate: "#334155",
  navy: "#0f2742", blue: "#2563eb", cyan: "#06b6d4", teal: "#0f766e",
  green: "#16a34a", mint: "#98ffd6", yellow: "#facc15", gold: "#d4af37",
  orange: "#f97316", copper: "#b87333", red: "#dc2626", crimson: "#9b2226",
  coral: "#ff6f61", pink: "#ec4899", rose: "#f43f5e", purple: "#7c3aed",
  lavender: "#b298dc", brown: "#7c4a2d",
};

function preferredColorAnchors(preferredColors, swatches) {
  const text = String(preferredColors || "").toLowerCase();
  const hexes = [...text.matchAll(/#[0-9a-f]{3,6}\b/gi)].map(match => normalizeHex(match[0])).filter(Boolean);
  const named = [...text.matchAll(/[a-z]+/g)]
    .map(match => NAMED_COLORS[match[0]])
    .filter(Boolean);
  const fromSwatches = swatches.map(swatch => normalizeHex(swatch.current || swatch.original)).filter(Boolean);
  return [...hexes, ...named, ...fromSwatches].filter(Boolean).slice(0, 12);
}

function invertedLightness(lightness) {
  if (lightness < 0.35) return clamp(0.9 - lightness * 0.2, 0.78, 0.96);
  if (lightness > 0.65) return clamp(0.12 + (1 - lightness) * 0.18, 0.07, 0.24);
  return clamp(1 - lightness, 0.28, 0.72);
}

function fallbackColorForSwatch(swatch, anchorHex, spec, index) {
  const baseHex = normalizeHex(swatch.current || swatch.original) || "#777777";
  const base = rgbToHslObj(hexToRgbObj(baseHex) || { r: 119, g: 119, b: 119 });
  const anchor = rgbToHslObj(hexToRgbObj(anchorHex) || { r: 102, g: 126, b: 234 });
  const neutral = base.s < 0.08;
  const h = neutral
    ? rotateHue(anchor.h, spec.hueShift + index * 5)
    : mixHue(base.h, rotateHue(anchor.h, spec.hueShift), spec.hueWeight);
  const s = neutral
    ? clamp(anchor.s * spec.neutralSat, 0.025, spec.inversion ? 0.16 : 0.24)
    : clamp(base.s * spec.baseSat + anchor.s * spec.anchorSat, 0.08, 0.78);
  const l = spec.inversion
    ? invertedLightness(base.l)
    : clamp(base.l + spec.lightnessShift, 0.07, 0.96);
  return rgbToHexObj(hslToRgbObj({ h, s, l }));
}

function fallbackPalettes({ preferredColors, swatches, reason = "" }) {
  const anchors = preferredColorAnchors(preferredColors, swatches);
  const specs = [
    { name: "Preferred Balance", hueShift: 0, hueWeight: 0.56, baseSat: 0.35, anchorSat: 0.52, neutralSat: 0.22, lightnessShift: 0, inversion: false, rationale: "Uses the requested colors while preserving the current light and dark structure." },
    { name: "Cool Contrast", hueShift: -34, hueWeight: 0.68, baseSat: 0.28, anchorSat: 0.66, neutralSat: 0.28, lightnessShift: -0.015, inversion: false, rationale: "Turns the requested colors into a cooler, higher-contrast palette." },
    { name: "Warm Editorial", hueShift: 28, hueWeight: 0.62, baseSat: 0.25, anchorSat: 0.58, neutralSat: 0.26, lightnessShift: 0.018, inversion: false, rationale: "Warms the requested colors into a softer editorial palette." },
    { name: "Light/Dark Inversion", hueShift: 8, hueWeight: 0.5, baseSat: 0.25, anchorSat: 0.45, neutralSat: 0.16, lightnessShift: 0, inversion: true, rationale: "Flips the original light and dark structure while keeping the requested colors as accents." },
  ];
  const suffix = reason ? " Generated locally because the AI palette request was unavailable or too slow." : "";
  return specs.map((spec, paletteIndex) => ({
    name: spec.name,
    rationale: spec.rationale + suffix,
    inversion: spec.inversion,
    _isInversion: spec.inversion || undefined,
    colors: swatches.map((swatch, index) => ({
      id: swatch.id,
      ordinal: swatch.ordinal,
      hex: fallbackColorForSwatch(swatch, anchors[(index + paletteIndex) % anchors.length] || "#667eea", spec, index),
    })),
  }));
}

function mergeWithFallback(palettes, fallback) {
  const out = [...palettes];
  const hasInversion = out.some(palette => palette._isInversion);
  for (const palette of fallback) {
    if (out.length >= 4) break;
    if (palette._isInversion && hasInversion) continue;
    out.push(palette);
  }
  if (!out.some(palette => palette._isInversion) && fallback[3]) {
    if (out.length >= 4) out[3] = fallback[3];
    else out.push(fallback[3]);
  }
  return out.slice(0, 4);
}

function buildPrompt({ preferredColors, swatches, html }) {
  return `Generate four professional color palette suggestions for the current portfolio website.

The user listed these preferred colors:
${preferredColors}

Website color-structure summary:
${html}

Current independent swatches (the CSS variables you must assign new colors to):
${JSON.stringify(swatches, null, 2)}

Return valid JSON only, with this exact shape:
{
  "palettes": [
    {
      "name": "short palette name",
      "rationale": "one concise sentence about how it uses the user's colors",
      "inversion": false,
      "colors": [
        { "id": "same id as input swatch", "ordinal": "same ordinal", "hex": "#123456" }
      ]
    }
  ]
}

Rules:
- Return exactly 4 palettes.
- Each palette must include one color object for every input swatch id, in the same order.
- Every hex value must be a 6-digit #rrggbb color.
- Use the user's preferred colors as anchors, but build complete, usable palettes rather than repeating one hue.
- Use the website color-structure summary to preserve how colors interact: foreground/background contrast, gradients, borders, shadows, cards, pills, navigation, and dependent variables should remain coherent.
- Palettes 1–3: preserve the current website's light/dark structure (dark swatches stay dark, light swatches stay light, accents shift freely). Set "inversion": false on all three.
  - Palette 1 should be the most faithful to the user's preferred colors.
  - Palette 2 should be a cooler or more technical/high-contrast interpretation.
  - Palette 3 should be a warmer, editorial, or unexpected but still professional interpretation.
  - Between any two of these three palettes, at least half of the swatches must visibly change.
  - Do not return three palettes that share the same neutrals with only small accent variations.
- Palette 4: a light/dark inversion of the original structure. If the original site has dark backgrounds and light text, palette 4 must use light or white backgrounds with dark text. If the original site has light backgrounds and dark text, palette 4 must use dark backgrounds with light text. Adapt the user's preferred colors to fit this inverted structure. Set "inversion": true on this palette.
- Avoid muddy, low-contrast, mostly beige, mostly purple, or one-note palettes.
- Do not include markdown, comments, or prose outside the JSON.`;
}

function buildRetryPrompt(basePrompt, rawText) {
  return `${basePrompt}

Your previous answer was rejected because palettes 1–3 were too similar, or palette 4 did not genuinely invert the light/dark structure.

Previous answer:
${String(rawText || "").slice(0, 8000)}

Regenerate the JSON from scratch:
- Make palettes 1–3 substantially different from each other (change neutrals and multiple accents, not just one or two swatches).
- Palette 4 MUST flip light backgrounds to dark (or dark to light) — a cosmetic hue shift does not count as an inversion.
- Keep every palette complete with one color per input swatch id.
- Return exactly the same JSON shape with "inversion": true on palette 4, and no markdown.`;
}

async function callClaude(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY_LOCAL || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 6000,
      system: "You are a senior web color designer. Return strict JSON only.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = {}; }
  if (!res.ok) throw new Error("Claude API error: " + text.slice(0, 300));
  return (json.content || []).filter(block => block.type === "text").map(block => block.text).join("").trim();
}

async function callOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY_LOCAL || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      instructions: "You are a senior web color designer. Return strict JSON only.",
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
      max_output_tokens: 6000,
    }),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = {}; }
  if (!res.ok) throw new Error("OpenAI API error: " + text.slice(0, 300));
  return (json.output_text || "").trim();
}

async function callProvider(provider, prompt) {
  return provider === "openai" ? await callOpenAI(prompt) : await callClaude(prompt);
}

function isTimeoutError(err) {
  return err?.name === "TimeoutError" || /timeout|timed out|aborted/i.test(String(err?.message || err || ""));
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method Not Allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return jsonResponse(400, { error: "Invalid JSON body" }); }

  const preferredColors = String(body.preferredColors || "").trim();
  const swatches = normalizedSwatches(body.swatches);
  if (!preferredColors) return jsonResponse(400, { error: "Please list at least one preferred color." });
  if (swatches.length < 2) return jsonResponse(400, { error: "At least two current swatches are required." });

  const html = summarizeHtmlForPalettePrompt(body.html);
  const prompt = buildPrompt({ preferredColors, swatches, html });
  const fallback = fallbackPalettes({ preferredColors, swatches });

  try {
    const provider = body.provider === "openai" ? "openai" : "claude";
    let activeProvider = provider;
    let raw;
    try {
      raw = await callProvider(activeProvider, prompt);
    } catch (err) {
      if (!isTimeoutError(err) && provider === "claude" && (process.env.OPENAI_API_KEY_LOCAL || process.env.OPENAI_API_KEY)) {
        activeProvider = "openai";
        raw = await callProvider(activeProvider, prompt);
      } else if (!isTimeoutError(err) && provider === "openai" && (process.env.ANTHROPIC_API_KEY_LOCAL || process.env.ANTHROPIC_API_KEY)) {
        activeProvider = "claude";
        raw = await callProvider(activeProvider, prompt);
      } else {
        throw err;
      }
    }

    let parsed = parseJsonLoose(raw);
    let palettes = normalizeAiResult(parsed, swatches);
    palettes = mergeWithFallback(
      palettes,
      palettes.length < 4
        ? fallbackPalettes({ preferredColors, swatches, reason: "AI returned incomplete palettes." })
        : fallback
    );
    return jsonResponse(200, {
      palettes,
      requestedSwatchCount: swatches.length,
      fallback: palettes.some(palette => /Generated locally/.test(palette.rationale || "")),
    });
  } catch (err) {
    return jsonResponse(200, {
      palettes: fallbackPalettes({ preferredColors, swatches, reason: err?.message || String(err) }),
      requestedSwatchCount: swatches.length,
      fallback: true,
      warning: err?.message || String(err),
    });
  }
}
