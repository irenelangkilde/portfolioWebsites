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
      original: normalizeHex(swatch?.original || swatch?.hex),
      current: normalizeHex(swatch?.current || swatch?.substitute || swatch?.original || swatch?.hex),
      dependents: (Array.isArray(swatch?.dependents) ? swatch.dependents : [])
        .map(dep => ({
          ordinal: String(dep?.ordinal || "").slice(0, 8),
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

function buildPrompt({ preferredColors, swatches, html }) {
  return `Generate four professional color palette suggestions for the current portfolio website.

The user listed these preferred colors:
${preferredColors}

Website HTML:
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

export async function handler(event) {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method Not Allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return jsonResponse(400, { error: "Invalid JSON body" }); }

  const preferredColors = String(body.preferredColors || "").trim();
  const swatches = normalizedSwatches(body.swatches);
  if (!preferredColors) return jsonResponse(400, { error: "Please list at least one preferred color." });
  if (swatches.length < 2) return jsonResponse(400, { error: "At least two current swatches are required." });

  const html = String(body.html || "").slice(0, 80000);
  const prompt = buildPrompt({ preferredColors, swatches, html });

  try {
    const provider = body.provider === "openai" ? "openai" : "claude";
    let activeProvider = provider;
    let raw;
    try {
      raw = await callProvider(activeProvider, prompt);
    } catch (err) {
      if (provider === "claude" && (process.env.OPENAI_API_KEY_LOCAL || process.env.OPENAI_API_KEY)) {
        activeProvider = "openai";
        raw = await callProvider(activeProvider, prompt);
      } else if (provider === "openai" && (process.env.ANTHROPIC_API_KEY_LOCAL || process.env.ANTHROPIC_API_KEY)) {
        activeProvider = "claude";
        raw = await callProvider(activeProvider, prompt);
      } else {
        throw err;
      }
    }

    let parsed = parseJsonLoose(raw);
    let palettes = normalizeAiResult(parsed, swatches);
    if (palettes.length < 4) {
      const retryPrompt = buildRetryPrompt(prompt, raw);
      raw = await callProvider(activeProvider, retryPrompt);
      parsed = parseJsonLoose(raw);
      palettes = normalizeAiResult(parsed, swatches);
    }
    if (palettes.length < 3) {
      return jsonResponse(502, { error: "Palette AI returned fewer than three distinct usable palettes." });
    }
    return jsonResponse(200, { palettes: palettes.slice(0, 4), requestedSwatchCount: swatches.length });
  } catch (err) {
    return jsonResponse(502, { error: err?.message || String(err) });
  }
}
