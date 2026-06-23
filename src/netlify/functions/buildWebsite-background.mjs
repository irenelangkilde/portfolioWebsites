import OpenAI, { toFile } from "openai";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { load as loadHtml } from "cheerio";
import { explainBlobStoreError, getPreviewImagesStore, getPreviewResultsStore } from "./blobStore.mjs";
import { assignProjectIcons } from "./projectIcons.mjs";
import { checkAndIncrementCredits, logAnonUsage, logUsageEvent } from "./usageQuota.mjs";
import { parallelCreativeFill } from "./parallelCreativeFill.mjs";
import { generateCandidateContent } from "./generateCandidateContent.mjs";
import { renderPortfolio } from "./renderPortfolio.mjs";

// ─── Stage 1: Content Extraction Prompt ──────────────────────────────────────
// Extracts all resume content into a structured JSON object.
const STAGE1_PROMPT = `You are a resume parser. Extract ALL content from the attached resume PDF and output a single JSON object — no markdown, no explanation, just the JSON.

Use this exact schema (omit fields that are absent from the resume, but never fabricate):

{
  "personal": {
    "name": "",
    "email": "",
    "phone": "",
    "linkedin": "",
    "github": "",
    "website": "",
    "location": ""
  },
  "summary": "",
  "education": [
    {
      "institution": "",
      "degree": "",
      "major": "",
      "minor": "",
      "graduation_date": "",
      "gpa": "",
      "honors": "",
      "relevant_coursework": [],
      "thesis": "",
      "activities": []
    }
  ],
  "experience": [
    {
      "company": "",
      "title": "",
      "start_date": "",
      "end_date": "",
      "location": "",
      "bullets": [],
      "technologies": []
    }
  ],
  "projects": [
    {
      "name": "",
      "description": "",
      "role": "",
      "dates": "",
      "technologies": [],
      "links": { "github": "", "demo": "", "other": "" },
      "bullets": []
    }
  ],
  "skills": {
    "technical": [],
    "tools": [],
    "programming_languages": [],
    "soft_skills": [],
    "other": []
  },
  "certifications": [
    { "name": "", "issuer": "", "date": "", "credential_id": "" }
  ],
  "awards": [
    { "title": "", "issuer": "", "date": "", "description": "" }
  ],
  "publications": [
    { "title": "", "venue": "", "date": "", "authors": [], "link": "" }
  ],
  "languages": [
    { "language": "", "proficiency": "" }
  ],
  "volunteer": [
    { "organization": "", "role": "", "dates": "", "description": "" }
  ],
  "extracurricular": [
    { "organization": "", "role": "", "dates": "", "description": "" }
  ]
}

Output the JSON only. Do not add any commentary before or after it.`;

// ─── Stage 2: JSON Validation Prompt ─────────────────────────────────────────
// Validates and normalizes the Stage 1 JSON. Flags gaps, never fabricates.
const STAGE2_PROMPT = `You are a resume content validator. You will receive a JSON object extracted from a resume.

Your tasks:
1. Fix any formatting issues: normalize dates to "Month YYYY" or "YYYY" format, trim whitespace, remove duplicate entries.
2. Ensure arrays are arrays and strings are strings (never null — use "" or [] as defaults).
3. If the "personal.name" field is empty, set it to "Unknown".
4. Add a top-level "_validation" object summarizing what was found:
   {
     "_validation": {
       "completeness_score": 0-100,
       "missing_fields": [],
       "warnings": [],
       "section_counts": {
         "education": 0,
         "experience": 0,
         "projects": 0,
         "skills_total": 0,
         "certifications": 0
       }
     }
   }
5. Do NOT add, invent, or infer any content not present in the input JSON.
6. Output the corrected JSON only — no markdown, no explanation.`;
/**
 * Netlify Background Function: buildWebsite-background
 * Netlify returns 202 immediately; this function runs for up to 15 minutes.
 * Result is stored in a Netlify Blob keyed by jobId.
 * Poll /.netlify/functions/getPreviewResult?jobId=<id> for the result.
 *
 * Pipeline:
 *   Stage 1 (optional): Extract resume PDF → structured JSON (skipped if client sends resumeAnalysisJson)
 *   Stage 2 (optional): buildContentStrategy.md → strategy JSON (skipped if strategyJson pre-computed)
 *   Stage 3: Assemble visual_direction from designSpec + colorSpec
 *   Stage 4: rendererPrompt.md → portfolio HTML
 */


async function fetchSampleHtml(url) {
  if (!url) return "";
  try {
    const parsedUrl = new URL(String(url));
    if (!/^https?:$/.test(parsedUrl.protocol)) return "";
    const res = await fetch(parsedUrl.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PortfolioBuilder/1.0)" },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return "";
    return (await res.text()).slice(0, 40000);
  } catch (err) {
    if (/invalid url/i.test(err?.message || "")) {
      console.warn(`[buildWebsite-background] Ignoring invalid sample URL: ${String(url).slice(0, 160)}`);
    }
    return "";
  }
}

function logBuildStage(stage, details = {}) {
  try {
    console.log(`[buildWebsite-background] ${stage}: ${JSON.stringify(details)}`);
  } catch {
    console.log(`[buildWebsite-background] ${stage}`);
  }
}

function normalizeFunctionResponse(result) {
  if (!result) return { statusCode: 202, body: "" };
  if (typeof result.statusCode === "number" && result.body === undefined) {
    return { ...result, body: "" };
  }
  return result;
}

async function writeFatalJobError(event, message) {
  let jobId = "";
  try {
    jobId = JSON.parse(event?.body || "{}")?.jobId || "";
  } catch {}
  if (!jobId) return;
  try {
    const { store } = getPreviewResultsStore();
    await store?.set(jobId, JSON.stringify({ status: "error", error: message }), { ttl: 3600 });
  } catch (storeErr) {
    console.error("[buildWebsite-background] Could not write fatal job error:", storeErr?.message || storeErr);
  }
}

// ─── Template usage instruction (shared by both pipelines) ──────────────────
function templateUsageInstruction(copyrightMode) {
  if (copyrightMode === "owned") {
    return "The sample website is provided with permission — reproduce its layout structure, card designs, section order, background gradient technique, and visual hierarchy as faithfully as possible. Treat it as the authoritative design specification.";
  }
  // "inspiration" or unset
  return "The sample website is provided for inspiration only — draw on its general mood, visual energy, and compositional feel, but do NOT copy its specific layout, sections, or unique structural elements. Create a clearly original design that only echoes the spirit of the sample.";
}

// ─── Strip GrapesJS-bloated duplicate style block from template HTML ─────────
// GrapesJS saves CSS with every shorthand expanded into sub-properties
// (e.g. `background` → 9 individual lines). When the template also contains
// the original compact CSS in a second <style> block, the GrapesJS block is
// redundant and ~3× larger. Remove it before sending to the renderer.
//
// Detection heuristic: a <style> block that contains the GrapesJS fingerprint
// (bare property:initial pairs with no whitespace, e.g. "background-image:initial;")
// is dropped. A block is only removed if at least one other <style> block remains.
function stripGrapesJsCss(html) {
  const styleRe = /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi;
  const blocks = [];
  let m;
  while ((m = styleRe.exec(html)) !== null) {
    blocks.push({ full: m[0], open: m[1], body: m[2], close: m[3], index: m.index });
  }
  if (blocks.length < 2) return html; // nothing to strip

  const isGrapesBlock = b =>
    /\bbackground-image\s*:\s*initial\s*;/.test(b.body) &&
    /\bpadding-top\s*:\s*0px\s*;/.test(b.body);

  const toRemove = blocks.filter(isGrapesBlock);
  const remaining = blocks.length - toRemove.length;
  if (remaining < 1 || toRemove.length === 0) return html;

  // Remove from end to start so indices stay valid
  let result = html;
  for (const b of [...toRemove].reverse()) {
    result = result.slice(0, b.index) + result.slice(b.index + b.full.length);
  }
  return result;
}

// ─── HTML post-processing (shared by both pipelines) ────────────────────────
function cleanHtml(rawHtml) {
  // Strip markdown fences if model wrapped the output
  let html = rawHtml.replace(/^```[a-zA-Z]*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
  // Fix invalid CSS: GrapesJS (and sometimes the model) expands `background` shorthand into
  // `background-image: ..., initial` — the stray `initial` in a comma list is invalid and
  // drops the whole declaration. Use a depth-aware splitter to handle nested gradient commas.
  html = html.replace(/background-image\s*:([^;]+);/g, (_match, value) => {
    const parts = [];
    let depth = 0, curr = "";
    for (const ch of value) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (ch === "," && depth === 0) { parts.push(curr.trim()); curr = ""; }
      else curr += ch;
    }
    if (curr.trim()) parts.push(curr.trim());
    const cleaned = parts.filter(p => p.toLowerCase() !== "initial");
    return cleaned.length ? `background-image:${cleaned.join(", ")};` : "";
  });
  // Remove background sub-properties whose values are entirely "initial" keywords
  html = html.replace(
    /background-(?:position-x|position-y|size|repeat|attachment|origin|clip)\s*:\s*(?:initial\s*,?\s*)+;/g, ""
  );
  return html;
}

// ─── Color slot parser for pre-normalized templates ──────────────────────────
// Reads the five --color-* hex values from a :root block that already has numbered
// role comments (e.g. /* 1. Background — ... */). Returns { slot1: "#...", ... }.
function parseNormalizedColorSlots(html) {
  const rootMatch = (html || "").match(/:root\s*\{([\s\S]*?)\}/);
  if (!rootMatch) return {};
  const slots = {};
  const re = /--color-[\w-]+\s*:\s*(#[0-9a-fA-F]{3,8})[^;]*;\s*\/\*\s*(\d+)\./g;
  let m;
  while ((m = re.exec(rootMatch[1])) !== null) {
    const idx = parseInt(m[2]);
    if (idx >= 1 && idx <= 5) slots[`slot${idx}`] = m[1].toLowerCase();
  }
  return slots;
}

// ─── Prompt loaders ──────────────────────────────────────────────────────────
function loadPromptFile(filename) {
  const cwd = process.cwd();
  let here = null;
  try { here = dirname(fileURLToPath(import.meta.url)); } catch {}
  const candidates = [
    resolve(cwd, `src/netlify/functions/${filename}`),
    resolve(cwd, `netlify/functions/${filename}`),
    resolve(cwd, filename),
  ];
  if (here) candidates.unshift(resolve(here, filename));
  for (const candidate of candidates) {
    try { return readFileSync(candidate, "utf-8"); } catch {}
  }
  throw new Error(`Could not load ${filename} (cwd=${cwd}, here=${here})`);
}

function parseJsonResponse(raw) {
  const cleaned = raw.trim()
    .replace(/^```[a-zA-Z]*\r?\n?/, "").replace(/\r?\n?```\s*$/, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const first = cleaned.indexOf("{"), last = cleaned.lastIndexOf("}");
  if (first !== -1 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
  throw new Error("Response was not valid JSON");
}

const COLOR_ROLE_KEYS = ["primary", "secondary", "accent", "quaternary", "quinary"];

function normalizeColorSpec(colorSpec = {}) {
  const normalized = { use_sample_colors: !!colorSpec?.use_sample_colors };
  normalized.primary    = colorSpec?.primary    ?? colorSpec?.slot1 ?? null;
  normalized.secondary  = colorSpec?.secondary  ?? colorSpec?.slot2 ?? null;
  normalized.accent     = colorSpec?.accent     ?? colorSpec?.tertiary ?? colorSpec?.slot3 ?? null;
  normalized.quaternary = colorSpec?.quaternary ?? colorSpec?.foreground ?? colorSpec?.accent2 ?? colorSpec?.slot4 ?? null;
  normalized.quinary    = colorSpec?.quinary    ?? colorSpec?.background ?? colorSpec?.accent1 ?? colorSpec?.slot5 ?? null;

  // Aliases for backward compatibility with older prompts and editor code.
  normalized.tertiary   = normalized.accent;
  normalized.background = normalized.quinary;
  normalized.foreground = normalized.quaternary;
  normalized.accent1    = normalized.quinary;
  normalized.accent2    = normalized.quaternary;
  normalized.slot1      = normalized.primary;
  normalized.slot2      = normalized.secondary;
  normalized.slot3      = normalized.accent;
  normalized.slot4      = normalized.quaternary;
  normalized.slot5      = normalized.quinary;
  if (colorSpec?.note) normalized.note = colorSpec.note;
  return normalized;
}

/**
 * Formats user color preferences as a guidance paragraph for AI prompts.
 * Returns "" when the user hasn't supplied anything — prompts should handle empty gracefully.
 *
 * `colorPreferences` shape: { mode: "swatches"|"text", swatches: string[], text: string }
 *
 * The framing intentionally calls them "key/anchor" colors rather than a complete palette,
 * so the AI knows it may fill remaining slots with neutrals and supporting tones.
 */
function formatColorPreferencesGuidance(prefs) {
  if (!prefs || typeof prefs !== "object") return "";
  if (prefs.mode === "swatches" && Array.isArray(prefs.swatches) && prefs.swatches.length) {
    const list = prefs.swatches.map(h => String(h)).filter(h => /^#[0-9a-fA-F]{3,8}$/.test(h)).join(", ");
    if (!list) return "";
    return `USER COLOR PREFERENCES: The user selected these as KEY anchor colors they want prominently featured: ${list}. Treat them as anchors, not the complete palette — you may add complementary neutrals and supporting tones to round out the design.`;
  }
  if (prefs.mode === "text" && typeof prefs.text === "string" && prefs.text.trim()) {
    const text = prefs.text.trim().slice(0, 500);
    return `USER COLOR PREFERENCES: The user described their color intent in words: "${text}". Interpret this as anchor preferences (not a fixed palette) and choose actual hex values that honor the described mood/colors. Add complementary neutrals and supporting tones as needed.`;
  }
  return "";
}

function serializeColorSpecForAI(colorSpec = {}) {
  const normalized = normalizeColorSpec(colorSpec);
  return {
    use_sample_colors: !!normalized.use_sample_colors,
    primary:    normalized.primary,
    secondary:  normalized.secondary,
    accent:     normalized.accent,
    quaternary: normalized.quaternary,
    quinary:    normalized.quinary,
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripCssComments(value = "") {
  return String(value).replace(/\/\*[\s\S]*?\*\//g, "").trim();
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findBalancedElementByClass(html, className, startIndex = 0) {
  const openRe = new RegExp(`<([a-z0-9:-]+)\\b[^>]*class=["'][^"']*\\b${escapeRegExp(className)}\\b[^"']*["'][^>]*>`, "ig");
  openRe.lastIndex = startIndex;
  const openMatch = openRe.exec(html);
  if (!openMatch) return null;
  const tagName = openMatch[1];
  const openIndex = openMatch.index;
  const tagRe = new RegExp(`<\\/?${escapeRegExp(tagName)}\\b[^>]*>`, "ig");
  tagRe.lastIndex = openIndex;
  let depth = 0;
  let tagMatch;
  while ((tagMatch = tagRe.exec(html)) !== null) {
    const token = tagMatch[0];
    const isClose = /^<\//.test(token);
    if (!isClose && !/\/>$/.test(token)) depth += 1;
    else if (isClose) depth -= 1;
    if (depth === 0) {
      return {
        start: openIndex,
        end: tagRe.lastIndex,
        html: html.slice(openIndex, tagRe.lastIndex),
        tagName
      };
    }
  }
  return null;
}

function findBalancedElementByTagContaining(html, tagNames, innerPattern, startIndex = 0) {
  const tagsAlt = tagNames.map(escapeRegExp).join("|");
  const openRe = new RegExp(`<(${tagsAlt})\\b[^>]*>`, "ig");
  openRe.lastIndex = startIndex;
  let openMatch;
  while ((openMatch = openRe.exec(html)) !== null) {
    const tagName = openMatch[1];
    const openIndex = openMatch.index;
    const tagRe = new RegExp(`<\\/?${escapeRegExp(tagName)}\\b[^>]*>`, "ig");
    tagRe.lastIndex = openIndex;
    let depth = 0;
    let tagMatch;
    while ((tagMatch = tagRe.exec(html)) !== null) {
      const token = tagMatch[0];
      const isClose = /^<\//.test(token);
      if (!isClose && !/\/>$/.test(token)) depth += 1;
      else if (isClose) depth -= 1;
      if (depth === 0) {
        const blockHtml = html.slice(openIndex, tagRe.lastIndex);
        if (innerPattern.test(blockHtml)) {
          return {
            start: openIndex,
            end: tagRe.lastIndex,
            html: blockHtml,
            tagName
          };
        }
        break;
      }
    }
  }
  return null;
}

const MASTHEAD_PLACEHOLDER_URL = "braid-masthead.png";

function isLikelyProfileOrBrandImage(imgTag = "", src = "") {
  const haystack = `${imgTag} ${src}`.toLowerCase();
  return /\b(headshot|profile|avatar|portrait|logo|brand|selfie|photo)\b|stockphoto|youngman|youngwoman|person/.test(haystack);
}

function isLikelyMastheadImageTag(imgTag = "", src = "") {
  if (isLikelyProfileOrBrandImage(imgTag, src)) return false;
  const haystack = `${imgTag} ${src}`.toLowerCase();
  return /\b(masthead|banner|cover|splash|hero[-_\s]?(image|visual|media|art|bg|background)|featured[-_\s]?image)\b/.test(haystack);
}

function analyzeSampleMasthead(sampleHtml = "", domainContext = "") {
  let sampleHasRasterHeroImage = false;
  let sampleRasterCssUrl = "";
  let sampleRasterCssSelector = "";
  let sampleRasterBackgroundDecl = "";
  let sampleRasterImgSrc = "";
  let sampleHeaderContainsHero = false;

  const headerMatch = sampleHtml.match(/<header\b[^>]*>([\s\S]{0,8000})<\/header>/i);
  const heroMatch = sampleHtml.match(/<(?:section|header|div)[^>]*(?:id|class)=["'][^"']*hero[^"']*["'][^>]*>([\s\S]{0,5000})/i);
  const searchRegions = [headerMatch?.[1], heroMatch?.[1], sampleHtml.slice(0, 6000)]
    .filter(Boolean)
    .join("\n");
  const styleBlock = (sampleHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/i) || [])[1] || "";
  const rasterImgMatch = [...searchRegions.matchAll(
    /<img\b[^>]*src=["']((?!data:)[^"']+\.(?:png|jpe?g)(?:\?[^"']*)?)["'][^>]*>/ig
  )].find(match => isLikelyMastheadImageTag(match[0], match[1]));
  sampleRasterImgSrc = rasterImgMatch?.[1] || "";
  const cssBlocks = [...styleBlock.matchAll(/([^{}]+)\{([\s\S]*?)\}/g)];
  const rasterBgBlock = cssBlocks.find(([, selector, body]) =>
    /(header|\bhero\b)/i.test(selector) &&
    /url\(\s*["']?[^"')]+\.(?:png|jpe?g)(?:\?[^"')]*)?["']?\s*\)/i.test(body)
  );
  sampleRasterCssSelector = stripCssComments(rasterBgBlock?.[1] || "");
  sampleRasterBackgroundDecl = rasterBgBlock?.[2]?.match(/background\s*:\s*[\s\S]*?;/i)?.[0]?.trim() || "";
  const rasterBgMatch = rasterBgBlock
    ? (rasterBgBlock[2].match(/url\(\s*["']?([^"')]+\.(?:png|jpe?g)(?:\?[^"')]*)?)["']?\s*\)/i) || [])[1] || true
    : null;
  sampleRasterCssUrl = typeof rasterBgMatch === "string" ? rasterBgMatch : "";
  sampleHeaderContainsHero = /class=["'][^"']*\bhero\b[^"']*["']/i.test(headerMatch?.[1] || "");
  sampleHasRasterHeroImage = !!(rasterImgMatch || rasterBgMatch);

  const meta = {
    sampleHasRasterHeroImage,
    sampleRasterCssUrl,
    sampleRasterCssSelector,
    sampleRasterBackgroundDecl,
    sampleRasterImgSrc,
    sampleHeaderContainsHero,
    mastheadPlaceholderUrl: MASTHEAD_PLACEHOLDER_URL,
    domainContext
  };

  console.log(
    `[buildWebsite-background] Header/hero raster detection: ${JSON.stringify({
      hasHeaderRegion: !!headerMatch,
      hasHeroRegion: !!heroMatch,
      sampleHeaderContainsHero,
      foundRasterImgTag: !!rasterImgMatch,
      foundRasterCssBackground: !!rasterBgMatch,
      matchedRasterImgSrc: sampleRasterImgSrc,
      matchedRasterCssUrl: typeof rasterBgMatch === "string" ? rasterBgMatch : ""
    })}`
  );

  return meta;
}

function buildMastheadImageInstruction(meta = {}, domainContext = "") {
  if (meta.sampleHasRasterHeroImage) {
    if (meta.sampleRasterCssUrl) {
      return (
        `The sample masthead uses a raster image inside a CSS background declaration (detected server-side).\n` +
        `  Preserve the existing masthead selector, gradient layers, background shorthand, positioning, sizing,\n` +
        `  repeat behavior, and all surrounding CSS exactly as in the sample.\n` +
        `  Change only the raster image URL inside that masthead background declaration to:\n` +
        `    url("${meta.mastheadPlaceholderUrl || MASTHEAD_PLACEHOLDER_URL}")\n` +
        `  Do not add an <img> tag. Do not simplify or rewrite the masthead background styling.`
      );
    }
    if (meta.sampleRasterImgSrc) {
      return (
        `The sample masthead contains a JPG/PNG image tag (detected server-side).\n` +
        `  Preserve the existing image element, layout, sizing, radius, and alignment.\n` +
        `  Change only that image src from "${meta.sampleRasterImgSrc}" to "${meta.mastheadPlaceholderUrl || MASTHEAD_PLACEHOLDER_URL}".`
      );
    }
    return (
      `The sample masthead contains a JPG/PNG image (detected server-side).\n` +
      `  Do NOT generate an SVG illustration. Instead, place exactly this element where the masthead image belongs:\n` +
      `    <img id="braid-img" src="" alt="${domainContext}" style="max-width:100%;border-radius:inherit;">\n` +
      `  The src will be filled in automatically after generation. Preserve all surrounding layout,\n` +
      `  sizing, and positional CSS from the sample so the injected image fits naturally.`
    );
  }
  return (
    `The sample masthead has no JPG/PNG image (detected server-side).\n` +
    `  A generated raster masthead image will be injected via the --hero-bg-image CSS variable.\n` +
    `  You MUST follow Part 2 Step 4 exactly:\n` +
    `    1. Declare inside :root:  --hero-bg-image: none;\n` +
    `    2. In the hero/masthead CSS use:  background-image: var(--hero-bg-image), <your gradient layers>;\n` +
    `  Do NOT create an inline SVG illustration as the primary masthead visual.\n` +
    `  The injected image will appear behind text; pair it with a semi-transparent dark gradient overlay\n` +
    `  so headline text remains readable.`
  );
}

function serializePaletteForImagePrompt(colorSpec = {}) {
  const normalized = normalizeColorSpec(colorSpec);
  return COLOR_ROLE_KEYS
    .map((roleKey) => `${roleKey}=${normalized[roleKey] || "unspecified"}`)
    .join(", ");
}

function buildMastheadImagePrompt(page1 = {}, colorSpec = {}) {
  const { major = "", specialization = "" } = page1;
  const paletteGuide = serializePaletteForImagePrompt(colorSpec);
  return (
    `Generate a professional masthead background image for a portfolio website of a person majoring in ${major} and specializing in ${specialization}. ` +
    `Use the user's selected palette as guiding colors: ${paletteGuide}. ` +
    `Do not depict identifiable people or any human figure with discernable ethnicity, race, or facial identity. ` +
    `Prefer abstract, environmental, technical, scientific, or object-based imagery instead of portraits or human subjects. ` +
    `The image must have a direct, concrete connection to the stated major and specialization. ` +
    `It must read clearly behind headline text, with strong midtone and dark-value contrast, no washed-out white background, ` +
    `no large pale blank areas, and a visually distinct engineering/scientific subject. ` +
    `Avoid fog, haze, pastel washes, cloudy emptiness, cream backdrops, soft white gradients, or low-contrast atmospheric scenes. ` +
    `Use a darker full-bleed composition with clear subject matter spanning most of the frame, so the masthead does not look blank or faded. ` +
    `Compose it as a wide cinematic masthead image that still looks visible under a semi-transparent dark gradient overlay. ` +
    `The image must contain absolutely no text, words, letters, numbers, watermarks, captions, labels, or any written characters of any kind.`
  );
}

function buildEditorImagePrompt(page1 = {}, colorSpec = {}, imageContext = {}) {
  const { major = "", specialization = "" } = page1;
  const paletteGuide = serializePaletteForImagePrompt(colorSpec);
  const contextBits = [
    imageContext?.altText ? `Alt text: ${imageContext.altText}.` : "",
    imageContext?.nearbyHeading ? `Nearby heading: ${imageContext.nearbyHeading}.` : "",
    imageContext?.contextText ? `Surrounding context: ${imageContext.contextText}.` : "",
    imageContext?.userPrompt ? `Specific request: ${imageContext.userPrompt}.` : ""
  ].filter(Boolean).join(" ");
  return (
    `Generate an image suitable for the resume/portfolio website of a person majoring in ${major} and specializing in ${specialization}. ` +
    `Use the user's selected palette as guiding colors: ${paletteGuide}. ` +
    `Do not depict identifiable people or any human figure with discernable ethnicity, race, or facial identity. ` +
    `Prefer abstract, environmental, technical, scientific, futuristic, or object-based imagery instead of portraits or human subjects. ` +
    `The image must have a direct, concrete connection to the stated major and specialization. ` +
    `Avoid washed-out white backgrounds, pastel haze, fog, cloudy emptiness, or large pale blank areas. ` +
    `Match a professional, recruiter-facing website style rather than a poster. ${contextBits} ` +
    `Avoid watermarks, captions, and embedded text.`
  ).trim();
}

async function generateImageDataUri({ prompt, size = "1024x1024", stageLabel = "Image" }) {
  const keyCandidates = [
    ["OPENAI_API_KEY_LOCAL", process.env.OPENAI_API_KEY_LOCAL],
    ["OPENAI_API_KEY", process.env.OPENAI_API_KEY],
  ]
    .map(([source, key]) => [source, String(key || "").trim()])
    .filter(([, key], idx, arr) => key && arr.findIndex(([, seen]) => seen === key) === idx);
  const configuredModels = String(process.env.OPENAI_IMAGE_MODELS || process.env.OPENAI_IMAGE_MODEL || "")
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean);
  const imageModels = [...configuredModels, "gpt-image-1", "gpt-image-1-mini"]
    .filter((model, idx, arr) => model && arr.indexOf(model) === idx);
  console.log(
    `[buildWebsite-background] ${stageLabel} API key candidates:`,
    keyCandidates.map(([source]) => source).join(", ") || "none"
  );
  console.log(`[buildWebsite-background] ${stageLabel} model candidates: ${imageModels.join(", ")}`);
  if (!keyCandidates.length) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  console.log(`[buildWebsite-background] ${stageLabel} prompt: ${prompt}`);

  let imgResp = null;
  let lastImgErr = null;
  let successfulModel = imageModels[0];
  const imageRequestTimeoutMs = 330000;
  const maxAttempts = 1;
  for (let keyIndex = 0; keyIndex < keyCandidates.length; keyIndex += 1) {
    const [openaiKeySource, openaiKey] = keyCandidates[keyIndex];
    const openaiImgClient = new OpenAI({ apiKey: openaiKey, timeout: imageRequestTimeoutMs, maxRetries: 0 });
    let tryNextKey = false;
    for (let modelIndex = 0; modelIndex < imageModels.length; modelIndex += 1) {
      const imageModel = imageModels[modelIndex];
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          console.log(
            `[buildWebsite-background] ${stageLabel} generation attempt ${attempt}/${maxAttempts} ` +
            `using ${openaiKeySource} and ${imageModel}`
          );
          console.log(
            `[buildWebsite-background] Image request payload: ${JSON.stringify({
              model: imageModel,
              prompt,
              n: 1,
              size
            })}`
          );
          imgResp = await openaiImgClient.images.generate({
            model: imageModel,
            prompt,
            n: 1,
            size
          }, { timeout: imageRequestTimeoutMs });
          successfulModel = imageModel;
          lastImgErr = null;
          break;
        } catch (err) {
          lastImgErr = err;
          const status = err?.status ?? err?.response?.status ?? null;
          const msg = err?.message || String(err);
          const modelUnavailable = /unable to find a suitable provider|invalid.*model|model.*not.*found|model.*not.*available|unsupported model|does not exist/i.test(msg);
          const connectionError = /connection error|network error|fetch failed|socket hang up|econnreset|enotfound|eai_again/i.test(msg);
          const shouldRetry = attempt < maxAttempts && (connectionError || status === 429 || (status != null && status >= 500));
          console.warn(
            `[buildWebsite-background] ${stageLabel} generation attempt ${attempt} failed with ` +
            `${openaiKeySource}/${imageModel}: ${status || "no-status"} ${msg}`
          );
          if ((status === 401 || status === 403) && keyIndex < keyCandidates.length - 1) {
            console.warn(`[buildWebsite-background] ${openaiKeySource} failed with ${status}; trying ${keyCandidates[keyIndex + 1][0]}`);
            tryNextKey = true;
            break;
          }
          if (status === 401) {
            throw new Error(`OpenAI authentication failed for image generation (401). Check ${openaiKeySource}; the key is missing, expired, revoked, or from the wrong project.`);
          }
          if (status === 403) {
            throw new Error(`OpenAI image generation is not allowed for this key or project (403). Check access to ${imageModel} for ${openaiKeySource}.`);
          }
          if (modelUnavailable && modelIndex < imageModels.length - 1) {
            console.warn(`[buildWebsite-background] ${imageModel} unavailable; trying ${imageModels[modelIndex + 1]}`);
            break;
          }
          if (!shouldRetry) break;
          await sleep(900 * attempt);
        }
      }
      if (imgResp || tryNextKey) break;
    }
    if (imgResp) break;
  }
  if (lastImgErr) {
    const msg = lastImgErr?.message || String(lastImgErr);
    if (/unable to find a suitable provider|invalid.*model|model.*not.*found|model.*not.*available|unsupported model|does not exist/i.test(msg)) {
      throw new Error(
        `OpenAI image model unavailable (${imageModels.join(", ")}). ` +
        `Set OPENAI_IMAGE_MODEL to an Image API generation model available to this project. Last error: ${msg}`
      );
    }
    throw lastImgErr;
  }
  const b64 = imgResp?.data?.[0]?.b64_json || "";
  console.log(`[buildWebsite-background] ${stageLabel} generated:`, !!b64);
  return {
    dataUri: b64 ? `data:image/png;base64,${b64}` : "",
    model: successfulModel
  };
}

// ─── Post-render CSS color injection ─────────────────────────────────────────
// Replaces --color-* hex values in the rendered HTML using the user's colorSpec
// and the template's embedded default_color_scheme metadata comment.
function injectCssColors(html, colorSpec, templateHtml) {
  const normalizedColorSpec = normalizeColorSpec(colorSpec);
  if (!normalizedColorSpec || normalizedColorSpec.use_sample_colors) return html;
  // Parse --color-* variable declarations with their adjacent numbered role comments.
  // Numbered sample slots map to semantic roles:
  // 1→background, 2→foreground, 3→primary, 4→secondary, 5→accent.
  const rootMatch = (templateHtml || "").match(/:root\s*\{([\s\S]*?)\}/);
  if (!rootMatch) return html;
  const colorVars = [];
  const re = /(--color-[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})[^;]*;\s*\/\*\s*(\d+)\.\s*([^*]+)\*\//g;
  let m;
  while ((m = re.exec(rootMatch[1])) !== null) {
    colorVars.push({ varName: m[1], hex: m[2], index: parseInt(m[3]), label: m[4].trim() });
  }
  if (!colorVars.length) return html;
  colorVars.sort((a, b) => a.index - b.index);
  const slots = ["background", "foreground", "primary", "secondary", "accent"];
  const varToSlot = {};
  colorVars.forEach((cv, i) => {
    if (i < slots.length) varToSlot[cv.varName] = slots[i];
  });

  if (!Object.keys(varToSlot).length) return html;
  return html.replace(/(--color-[\w-]+)(\s*:\s*)#[0-9a-fA-F]{3,8}/g, (match, varName, colon) => {
    const slot = varToSlot[varName];
    return (slot && normalizedColorSpec[slot]) ? varName + colon + normalizedColorSpec[slot] : match;
  });
}

// ─── Template metadata comment parser ────────────────────────────────────────
// Extracts the JSON payload from <!-- { ... } --> embedded in <head>.
function parseTemplateMetadata(html) {
  const m = (html || "").match(/<!--\s*(\{[\s\S]*?\})\s*-->/);
  if (!m) return {};
  try { return JSON.parse(m[1]); } catch { return {}; }
}

function normalizeTemplateText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function classifyHeroCard(label, sampleItems = [], hasListBody = false) {
  const labelText = normalizeTemplateText(label).toLowerCase();
  const sampleText = sampleItems.map(normalizeTemplateText).join(" ").toLowerCase();
  const haystack = `${labelText} ${sampleText}`;
  if (/\b(links?|connect|social)\b/.test(labelText) || /\b(linkedin|github|resume|website|email)\b/.test(haystack)) {
    return "links";
  }
  if (/\b(snapshot|strength)\b/.test(labelText)) return "snapshot";
  if (/\b(highlights?|at[-\s]?a[-\s]?glance)\b/.test(labelText) || hasListBody) return "highlights";
  return "skill_group";
}

function dataWordCountFromEl($, el) {
  const n = parseInt($(el).attr("data-word-count") || "", 10);
  if (Number.isFinite(n) && n > 0) return n;
  const text = normalizeTemplateText($(el).text());
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function shallowDataItems($, rootEl) {
  const $root = $(rootEl);
  const root = $root[0];
  const $all = $root.find("[data-item]");
  const $shallow = $all.filter((_, el) => (
    $(el).parentsUntil(root, "[data-list], [data-section], [data-item='hero_card']").length === 0
  ));
  return $shallow.length ? $shallow : $all;
}

function inferListShapes($, cardEl) {
  const $card = $(cardEl);
  const shapes = {};
  $card.find("[data-list]").each((_, listEl) => {
    if ($(listEl).parents("[data-item='hero_card']").first()[0] !== cardEl) return;
    const key = $(listEl).attr("data-list");
    if (!key) return;
    const $items = shallowDataItems($, listEl);
    const samples = [];
    const wordCounts = [];
    $items.each((_, itemEl) => {
      const text = normalizeTemplateText($(itemEl).text());
      if (text) samples.push(text);
      const wc = dataWordCountFromEl($, itemEl);
      if (wc) wordCounts.push(wc);
    });
    shapes[key] = {
      count: $items.length,
      word_counts: wordCounts,
      sample_items: samples,
    };
  });
  return shapes;
}

export function inferHeroCardMapFromAnnotatedHtml(html) {
  if (!html || !/\bdata-section=["']hero_cards["']/.test(html)) return [];

  const $ = loadHtml(html, { decodeEntities: false });
  const $section = $("[data-section='hero_cards']").first();
  if (!$section.length) return [];

  const cards = [];
  $section.find("[data-item='hero_card']").each((_, el) => {
    if ($(el).parents("[data-item='hero_card']").length) return;
    cards.push(el);
  });

  return cards.map(card => {
    const $card = $(card);
    const $labelEl = $card
      .find("[data-field='card_label'],[data-field='group_name'],h1,h2,h3,h4,h5,h6,.mono,.card-title")
      .first();
    const originalLabel = normalizeTemplateText($labelEl.text());
    const $body = $card.find("[data-hero-body]").first();
    const $sampleRoot = $body.length ? $body : $card;
    const sampleItems = [];

    $sampleRoot.find("li,.chip,.pill,.tag,a").each((_, itemEl) => {
      const value = normalizeTemplateText($(itemEl).text());
      if (value && !sampleItems.includes(value)) sampleItems.push(value);
    });

    const type = classifyHeroCard(originalLabel, sampleItems, $sampleRoot.find("li").length > 0);
    const fallbackLabel = type === "highlights"
      ? "Highlights"
      : type === "snapshot"
        ? "Strengths Snapshot"
        : type === "links"
          ? "Links"
          : "";

    return {
      original_label: originalLabel || fallbackLabel,
      type,
      display_label: originalLabel || fallbackLabel,
      sample_items: sampleItems.slice(0, 4),
      lists: inferListShapes($, card),
    };
  }).filter(entry => entry.original_label || entry.type);
}

export function inferAboutMetaFromTemplateHtml(html) {
  const source = String(html || "");
  if (!source) {
    return {
      has_about: false,
      about_word_count: 0,
      hero_about_word_count: 0,
      about_full_word_count: 0,
      about_full_paragraph_count: 0,
    };
  }

  const hasAboutToken = /\bdata-(?:html-)?field=["']about_full["']/.test(source) || /\{\{\s*about_full\s*\}\}/.test(source);
  const hasAboutContainer = /\bid=["']about["']/.test(source) || /\bclass=["'][^"']*\babout(?:-[\w-]+)?\b/i.test(source);
  let heroAboutWordCount = 0;
  let aboutFullWordCount = 0;
  let aboutFullParagraphCount = 0;

  try {
    const $ = loadHtml(source, { decodeEntities: false });
    const $heroAboutField = $("[data-field='about']").first();
    const heroAttrCount = parseInt($heroAboutField.attr("data-word-count") || "", 10);
    if (Number.isFinite(heroAttrCount) && heroAttrCount > 0) heroAboutWordCount = heroAttrCount;
    else if ($heroAboutField.length) heroAboutWordCount = normalizeTemplateText($heroAboutField.text()).split(/\s+/).filter(Boolean).length;

    const $aboutField = $("[data-html-field='about_full'],[data-field='about_full']").first();
    const attrCount = parseInt($aboutField.attr("data-word-count") || "", 10);
    if (Number.isFinite(attrCount) && attrCount > 0) aboutFullWordCount = attrCount;
    else if ($aboutField.length) aboutFullWordCount = normalizeTemplateText($aboutField.text()).split(/\s+/).filter(Boolean).length;

    if ($aboutField.length) {
      const $container = $aboutField.parent();
      const siblingParagraphs = $container.children("p,[data-html-field='about_full'],[data-field='about_full']")
        .filter((_, el) => normalizeTemplateText($(el).text()).length > 0)
        .length;
      aboutFullParagraphCount = Math.max(1, siblingParagraphs || ($aboutField.is("p") ? 1 : $aboutField.find("p").length));
    }
  } catch {}

  return {
    has_about: Boolean(hasAboutToken || hasAboutContainer),
    about_word_count: heroAboutWordCount || aboutFullWordCount,
    hero_about_word_count: heroAboutWordCount,
    about_full_word_count: aboutFullWordCount,
    about_full_paragraph_count: aboutFullParagraphCount,
  };
}

// ─── Code-level visual_direction assembly (replaces blendWebsite.md AI call) ─
function buildVisualDirection(motifs, designSpec, colorSpec, visualsJson) {
  const normalizedColorSpec = normalizeColorSpec(colorSpec);
  const attrs   = designSpec?.exemplary_attributes || {};
  const factors = designSpec?.design_factors || {};
  const density            = designSpec?.density            || attrs.section_density || factors.density || "medium";
  const useEmojiIcons      = designSpec?.use_emoji_icons      ?? true;
  const alternateSections  = designSpec?.alternate_sections   ?? true;
  const visualMotifs = motifs?.potential_visual_motifs || [];
  const domain = motifs?.broad_primary_domain || "professional";

  const heroConcept = visualMotifs.length > 0
    ? `${visualMotifs[0]} — ${domain} field concept with ${(motifs?.symbolic_objects || [])[0] || "field-specific imagery"}`
    : `Abstract representation of the ${domain} domain using layered gradients and symbolic shapes`;

  const rendering = factors.rendering_style
    || (Array.isArray(motifs?.rendering_style) ? motifs.rendering_style[0] : motifs?.rendering_style)
    || "clean editorial vector";

  const isUseSampleColors = normalizedColorSpec?.use_sample_colors;
  const colorApp = isUseSampleColors
    ? {
        background_use: "Preserve the sample's page canvas and large-area background treatment.",
        foreground_use: "Preserve the sample's readable ink / text contrast treatment.",
        primary_use: "Preserve the sample's main brand/action emphasis.",
        secondary_use: "Preserve the sample's secondary accent and hierarchy support.",
        accent_use: "Preserve the sample's fifth contrast color for highlights and supporting emphasis.",
        gradient_notes: "Use template's existing gradient patterns"
      }
    : {
        background_use: `${normalizedColorSpec?.background || "background"} — page canvas, large surfaces, or atmospheric wash.`,
        foreground_use: `${normalizedColorSpec?.foreground || "foreground"} — readable text, dark/light ink, and contrast support.`,
        primary_use: `${normalizedColorSpec?.primary || "primary"} — main CTA, headline emphasis, and strongest brand/action color.`,
        secondary_use: `${normalizedColorSpec?.secondary || "secondary"} — supporting accent used for chips, panels, or secondary emphasis.`,
        accent_use: `${normalizedColorSpec?.accent || "accent"} — orthogonal highlight color for contrast, detail, and selective emphasis.`,
        gradient_notes: `Preserve the template's gradient structure while using background/foreground for readability and primary/secondary/accent for hierarchy.`
      };

  const pace = (attrs.pacing || "").toLowerCase();
  const animationGuidance = [];
  if (pace.includes("fast") || pace.includes("dynamic") || pace.includes("energet")) {
    animationGuidance.push("Fast scroll reveals: 0.3s fade-in with slight translateY(-10px)");
    animationGuidance.push("Subtle parallax on hero background layers");
  } else if (pace.includes("slow") || pace.includes("calm") || pace.includes("elegance") || pace.includes("minimal")) {
    animationGuidance.push("Gentle fade-in on scroll: 0.6s ease-out, staggered by 100ms per card");
    animationGuidance.push("Soft hover lift on cards: translateY(-3px) with deepened box-shadow");
  } else {
    animationGuidance.push("Fade-in on scroll via IntersectionObserver: 0.5s ease");
    animationGuidance.push("Card hover: translateY(-3px) with box-shadow transition 0.25s");
  }
  animationGuidance.push("Sticky frosted-glass navbar: backdrop-filter blur(12px) with subtle border");
  animationGuidance.push("CTA buttons: scale(1.03) on hover with 0.2s ease");

  const visualPlacements = (visualsJson || []).map(a => {
    const t = (a.type || "").toLowerCase();
    const lbl = (a.label || a.name || "").toLowerCase();
    let section = "about or projects";
    let notes = "Linked with a descriptive anchor button";
    if (t.includes("image") || t.includes("photo")) { section = "hero or about"; notes = "Displayed inline as a rounded portrait or project thumbnail"; }
    else if (t.includes("video")) { section = "projects"; notes = "Embedded as autoplay muted loop or linked thumbnail"; }
    else if (t.includes("pdf") || lbl.includes("resume")) { section = "hero"; notes = "Linked as a 'Download Resume' button"; }
    else if (lbl.includes("project") || lbl.includes("demo")) { section = "projects"; notes = "Linked as 'View Project' button with short description"; }
    return { visual_label: a.label || a.name || "visual", visual_type: a.type || "file", placement_section: section, presentation_notes: notes };
  });

  return {
    visual_direction: {
      mood:                     attrs.mood             || "professional, modern",
      compositional_feel:       attrs.compositional_feel || "balanced, content-rich",
      section_density:          density,
      use_emoji_icons:          useEmojiIcons,
      alternate_sections:       alternateSections,
      visual_treatment:         attrs.visual_treatment || "clean with subtle depth and card layering",
      composition_choice:       factors.composition_option || "split",
      rendering_style:          rendering,
      hero_concept:             heroConcept,
      visual_motifs:            visualMotifs,
      symbolic_objects:         motifs?.symbolic_objects || [],
      animation_guidance:       animationGuidance,
      template_inspiration_notes: `Style token: ${factors.style_token || "clean-minimal"}. Pacing: ${attrs.pacing || "moderate"}. Preserve this visual character throughout.`,
      color_application:        colorApp,
      visual_placements:        visualPlacements
    }
  };
}

// ─── Mojibake fixer ──────────────────────────────────────────────────────────
// PDF text extraction sometimes yields UTF-8 bytes decoded as Latin-1, producing
// sequences like â\u0080\u0094 for an em dash. Detect and restore them.
function fixMojibake(str) {
  if (typeof str !== "string") return str;
  return str
    .replace(/\u00e2\u0080\u0094/g, "\u2014")  // — em dash
    .replace(/\u00e2\u0080\u0093/g, "\u2013")  // – en dash
    .replace(/\u00e2\u0080\u0099/g, "\u2019")  // ' right single quote
    .replace(/\u00e2\u0080\u009c/g, "\u201c")  // " left double quote
    .replace(/\u00e2\u0080\u009d/g, "\u201d")  // " right double quote
    .replace(/\u00e2\u0080\u00a6/g, "\u2026")  // … ellipsis
    .replace(/\u00c2\u00b7/g,       "\u00b7")  // · middle dot
    .replace(/\u00c2\u00a9/g,       "\u00a9")  // © copyright
    .replace(/\u00c2\u00ae/g,       "\u00ae")  // ® registered trademark
    .replace(/\u00c2\u00a0/g,       " ");      // non-breaking space → regular space
}

function fixMojibakeDeep(val) {
  if (typeof val === "string") return fixMojibake(val);
  if (Array.isArray(val))      return val.map(fixMojibakeDeep);
  if (val && typeof val === "object") {
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = fixMojibakeDeep(v);
    return out;
  }
  return val;
}

/**
 * Normalizes either the new split schema (resume_facts with identity/factual_profile)
 * or the old flat schema (personal, education, etc. at top level) to the flat format
 * that flattenCandidateData expects.
 */
function toFlatResumeSchema(f) {
  if (!f) return {};
  if (f.resume_facts) return toFlatResumeSchema(f.resume_facts);
  // Already flat schema (STAGE1_PROMPT output or old cache)
  if (f.personal !== undefined || f.education !== undefined) return f;
  // New split schema: identity + factual_profile
  const identity = f.identity || {};
  const profile  = f.factual_profile || {};
  const contact  = identity.contact || {};
  const links    = contact.other_links || [];
  const linkUrl = (link) => typeof link === "string" ? link : (link?.url || link?.href || "");
  const findLink = (pred) => linkUrl(links.find(l => pred(linkUrl(l)))) || "";
  const education = profile.education || [];
  const firstEducation = education[0] || {};
  return {
    personal: {
      name:     identity.name     || "",
      email:    contact.email     || "",
      phone:    contact.phone     || "",
      linkedin: contact.linkedin  || "",
      github:   findLink(u => /github/i.test(u)),
      website:  findLink(u => u && !/github|linkedin/i.test(u)),
      location: contact.location  || ""
    },
    major:           identity.major || firstEducation.major || "",
    specialization:  identity.specialization || firstEducation.minor || identity.major || firstEducation.major || "",
    summary:         profile.about          || "",
    education,
    experience:      profile.experience     || [],
    projects:        profile.projects       || [],
    skills:          profile.skills         || {},
    certifications:         profile.certifications        || [],
    publications:           profile.publications           || [],
    awards:                 profile.honors_and_awards      || [],
    volunteer:              profile.volunteer_experience   || [],
    extracurricular: [
      ...(profile.leadership || []),
      ...(profile.organizations || []).map(o => ({
        organization: o.organization || o.name || "",
        role: o.role || "",
        dates: o.dates || "",
        description: o.description || ""
      }))
    ],
    desired_roles:          profile.desired_roles          || [],
    professional_interests: profile.professional_interests || []
  };
}

/**
 * Maps contentJson + resumeJson into a flat data object consumed by the slot-fill
 * renderer (Cheerio-based, against annotated.html).
 * colorSpec: { background, foreground, primary, secondary, accent } — user's palette choice
 */
function trimAboutToLength(text, targetWords) {
  text = String(text || "").trim();
  if (!targetWords || targetWords <= 0) return text;
  const words = text.split(/\s+/);
  if (words.length <= targetWords * 1.3) return text;  // within 30% — keep as-is

  // Split into sentences, accumulate until we reach the target word count
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let result = "";
  let count = 0;
  for (const s of sentences) {
    const sw = s.trim().split(/\s+/).length;
    if (count > 0 && count + sw > targetWords * 1.35) break;
    result += (result ? " " : "") + s.trim();
    count += sw;
    if (count >= targetWords * 0.85) break;
  }
  return result || text;
}

function dedupeStrings(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = String((value?.label ?? value?.card_label ?? value?.name ?? value?.title ?? value) || "").replace(/\s+/g, " ").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function toLabelItems(values = [], count = 0, fallbacks = []) {
  const labels = dedupeStrings([...values, ...fallbacks]);
  const shaped = count > 0 ? labels.slice(0, count) : labels;
  return shaped.map(label => ({ label }));
}

function splitTextSentences(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g)
    ?.map(s => s.trim())
    .filter(Boolean) || [];
}

function firstTextSentence(value) {
  return splitTextSentences(value)[0] || String(value || "").trim();
}

function normalizeCopyText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function copyRepeats(a, b) {
  const left = normalizeCopyText(a);
  const right = normalizeCopyText(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (Math.min(left.length, right.length) >= 32 && (left.includes(right) || right.includes(left))) return true;

  const leftTokens = new Set(left.split(" ").filter(token => token.length > 2));
  const rightTokens = new Set(right.split(" ").filter(token => token.length > 2));
  if (leftTokens.size < 4 || rightTokens.size < 4) return false;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap++;
  return overlap / Math.min(leftTokens.size, rightTokens.size) >= 0.72;
}

function pickDistinctCopy(candidates = [], avoid = [], fallback = "") {
  const avoidTexts = avoid.flatMap(value => [value, firstTextSentence(value)]).filter(Boolean);
  for (const candidate of candidates) {
    const text = String(candidate || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (avoidTexts.some(other => copyRepeats(text, other))) continue;
    return text;
  }
  return fallback;
}

function removeRepeatedLeadSentence(body, avoid = []) {
  const text = String(body || "").trim();
  if (!text) return text;
  const avoidTexts = avoid.flatMap(value => [value, firstTextSentence(value)]).filter(Boolean);
  const paragraphs = text.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
  if (!paragraphs.length) return text;

  const leadSentences = splitTextSentences(paragraphs[0]);
  const lead = leadSentences[0] || paragraphs[0];
  if (!avoidTexts.some(other => copyRepeats(lead, other))) return text;

  const remainingLead = leadSentences.slice(1).join(" ").trim();
  const nextParagraphs = remainingLead ? [remainingLead, ...paragraphs.slice(1)] : paragraphs.slice(1);
  return nextParagraphs.length ? nextParagraphs.join("\n\n") : text;
}

function shapeParagraphText(value, targetParagraphs = 0, targetWords = 0) {
  const trimmed = trimAboutToLength(value, targetWords);
  if (!targetParagraphs || targetParagraphs <= 1 || /\n\s*\n/.test(trimmed)) return trimmed;
  const sentences = splitTextSentences(trimmed);
  if (sentences.length < targetParagraphs * 2) return trimmed;
  const perParagraph = Math.ceil(sentences.length / targetParagraphs);
  const paragraphs = [];
  for (let i = 0; i < sentences.length; i += perParagraph) {
    paragraphs.push(sentences.slice(i, i + perParagraph).join(" "));
  }
  return paragraphs.filter(Boolean).join("\n\n");
}

function listShapeCount(heroMapEntry, key) {
  const shape = heroMapEntry?.lists?.[key];
  const n = Number(shape?.count);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function sourceForHeroList(key, sources) {
  if (/status_badges?|badges?|pills?/i.test(key)) return sources.statusBadges;
  if (/bullets?|highlights?/i.test(key)) return sources.highlights;
  if (/snapshot|strength/i.test(key)) return sources.strengths;
  if (/open_to|roles?/i.test(key)) return sources.openTo;
  if (/links?/i.test(key)) return [];
  return sources.skills;
}

function applyHeroListShapes(heroEntry, heroMapEntry, sources) {
  const lists = heroMapEntry?.lists || {};
  for (const [key, shape] of Object.entries(lists)) {
    const count = Number(shape?.count) || 0;
    if (!count) continue;
    heroEntry[key] = toLabelItems(sourceForHeroList(key, sources), count);
  }
  return heroEntry;
}

function flattenCandidateData(strategy, resumeJson, colorSpec, resumeStrategy = null, aboutWordCount = 0, heroCardMap = null, creativePack = null, augmentedProjects = null, templateMeta = null) {
  const heroAboutWordCount = templateMeta?.hero_about_word_count || aboutWordCount || 0;
  const aboutFullWordCount = templateMeta?.about_full_word_count || aboutWordCount || 0;
  const aboutFullParagraphCount = templateMeta?.about_full_paragraph_count || 0;
  const personal = resumeJson?.personal || {};
  // resolved strategy (job_resolved or resume_resolved) has strategy.positioning.{headline,subheadline,value_proposition}
  const _coreStory = strategy?.editorial_direction?.core_story || "";
  const _firstSentence = _coreStory.match(/^[^.!?]*[.!?]/)?.[0]?.trim() || _coreStory;
  const pos = strategy?.positioning || {
    headline:          strategy?.website_copy_seed?.hero_headline_options?.[0]    || "",
    subheadline:       strategy?.website_copy_seed?.hero_subheadline_options?.[0] || "",
    value_proposition: strategy?.website_copy_seed?.value_propositions?.[0]
                       || strategy?.website_copy_seed?.about_angle
                       || _firstSentence || ""
  };
  const edu0 = (resumeJson?.education || [])[0] || {};
  const major = resumeJson?.major || edu0.major || "";
  const specialization = resumeJson?.specialization || edu0.minor || major;

  // Merged copy seed: prefer resolved strategy (job_resolved/resume_resolved) copy seed; fall back to resume_strategy options
  const copySeed = strategy?.website_copy_seed || resumeStrategy?.website_copy_seed || {};
  const openToRaw = String(copySeed.open_to || "").trim();

  const buildOpenToItems = (value, fallbackRoles = []) => {
    if (!value) return [];
    const cleaned = value
      .replace(/^[A-Za-z ]{0,24}:\s*/, "")
      .replace(/\s+[—-]\s+(based in|located in|near|open to relocation|remote|hybrid)\b.*$/i, "")
      .trim();
    const isShortChip = label => {
      const words = label.trim().split(/\s+/).filter(Boolean);
      return label.length <= 32 && words.length >= 1 && words.length <= 4;
    };
    const normalizeChip = label => label
      .replace(/\b(roles?|positions?|opportunities|companies|company)\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim()
      .replace(/^[,;:./\s-]+|[,;:./\s-]+$/g, "");

    const explicitParts = cleaned
      .split(/\s*[•|;]\s*|\s+[·•]\s+/)
      .map(part => normalizeChip(part))
      .filter(Boolean);
    if (explicitParts.length > 1 && explicitParts.every(isShortChip)) {
      return explicitParts.slice(0, 4).map(label => ({ label }));
    }

    const roleIndustryMatch = cleaned.match(/^(.*?)\s+\bat\b\s+(.*)$/i);
    if (roleIndustryMatch) {
      const roleParts = roleIndustryMatch[1]
        .split(/\s+\bor\b\s+|\s+\band\b\s+/i)
        .map(part => normalizeChip(part))
        .filter(Boolean);
      const industryParts = roleIndustryMatch[2]
        .split(/\s+\bor\b\s+|\s+\band\b\s+/i)
        .map(part => normalizeChip(part))
        .filter(Boolean);
      const combined = [...roleParts, ...industryParts].filter(isShortChip).slice(0, 4);
      if (combined.length >= 2) return combined.map(label => ({ label }));
    }

    const roleParts = cleaned
      .split(/\s+\bor\b\s+|\s+\band\b\s+/i)
      .map(part => normalizeChip(part))
      .filter(Boolean);
    if (roleParts.length > 1 && roleParts.every(isShortChip)) {
      return roleParts.slice(0, 4).map(label => ({ label }));
    }

    const roleFallback = fallbackRoles
      .map(role => String(role || "").trim())
      .map(normalizeChip)
      .filter(Boolean)
      .filter(isShortChip)
      .slice(0, 4);
    return roleFallback.map(label => ({ label }));
  };

  // Convert skills object → skill_groups array, applying AI-generated subcategory labels
  const skills = resumeJson?.skills || {};
  const labelMap = Object.fromEntries(
    (copySeed.skills_subcategory_labels || []).map(({ group, label }) => [group, label])
  );
  const skillGroupDefs = [
    { group_name: labelMap.programming_languages || "Programming Languages", arr: skills.programming_languages },
    { group_name: labelMap.technical             || "Technical Skills",      arr: skills.technical },
    { group_name: labelMap.tools                 || "Tools",                 arr: skills.tools },
    { group_name: labelMap.domains               || "Domains",               arr: skills.domains },
    { group_name: labelMap.soft_skills           || "Soft Skills",           arr: skills.soft_skills },
    { group_name: labelMap.other                 || "Other",                 arr: skills.other }
  ];
  const skill_groups = skillGroupDefs
    .filter(g => Array.isArray(g.arr) && g.arr.length)
    .map(g => ({ group_name: g.group_name, skills: g.arr }));

  // Build hero_cards: all at-a-glance cards sorted by total character count so that
  // similarly-sized cards end up in the same row of the 2-column grid.
  const charCount = arr => arr.reduce((n, s) => n + String(s).length, 0);

  const experienceBullets = (resumeJson?.experience || []).flatMap(e => e.bullets || []).filter(Boolean);
  const projectBullets = (resumeJson?.projects || []).flatMap(p => p.bullets || []).filter(Boolean);
  const skillLabels = skill_groups.flatMap(g => g.skills || []);

  // Highlights: prefer AI-generated copy seed bullets, then resume/project evidence.
  const highlightBullets = dedupeStrings([
    ...(copySeed.highlights || []),
    ...experienceBullets,
    ...projectBullets,
    pos.value_proposition,
    _firstSentence,
  ]);

  // Strengths snapshot: prefer AI-generated phrases; fall back to strategy and skills.
  const strengths = dedupeStrings([
    ...(copySeed.strengths_snapshot || []),
    ...(strategy?.editorial_direction?.strengths_to_emphasize || []),
    ...skillLabels,
  ]);
  const desiredRoles = (resumeJson?.desired_roles?.length ? resumeJson.desired_roles
    : strategy?.desired_roles?.length ? strategy.desired_roles
    : (resumeStrategy?.desired_roles || [])).slice(0, 3);
  const open_to_items = buildOpenToItems(openToRaw, desiredRoles);
  const open_to_roles = open_to_items; // renamed token — same data
  const open_to_display = open_to_items.map(item => item.label).join(" • ");
  const openToResolved = open_to_items.length ? open_to_display : "";
  const normalizedOpenToText = `${openToRaw} ${open_to_items.map(item => item.label).join(" ")}`.toLowerCase();
  // work_domains: work settings/sectors the candidate wants to work in.
  // Sourced from resumeJson.work_domains if the extractor produces it;
  // falls back to professional_interests which overlap semantically.
  const work_domains = (
    resumeJson?.work_domains ||
    strategy?.work_domains ||
    resumeJson?.professional_interests ||
    []
  ).slice(0, 6).map(d => (typeof d === "string" ? { label: d } : d));

  const statusBadgeLabels = dedupeStrings([
    ...(copySeed.status_badges || []),
    major,
    specialization && specialization !== major ? specialization : "",
    edu0.degree,
    edu0.graduation_date,
    ...work_domains.map(item => item.label || item),
    ...skillLabels,
  ])
    .filter(label => !/^(seeking|open to|available|based in|located in)\b/i.test(label))
    .filter(label => {
      const lc = label.toLowerCase();
      return !normalizedOpenToText || !normalizedOpenToText.includes(lc);
    });
  const status_badges = statusBadgeLabels.map(label => ({ label }));
  const status_badges_inline = status_badges.map(item => item.label).join(" • ");
  const heroLinkFields = {
    email: personal.email || "",
    phone: personal.phone || "",
    linkedin: personal.linkedin || "",
    github: personal.github || "",
    website: personal.website || "",
    has_email: !!personal.email,
    has_phone: !!personal.phone,
    has_linkedin: !!personal.linkedin,
    has_github: !!personal.github,
    has_website: !!personal.website,
  };

  // Build hero_cards from hero_card_map (metadata mapping original title → type → display label).
  // Falls back to a default three-card set for old templates without hero_card_map.
  let hero_cards;
  const heroListSources = {
    statusBadges: statusBadgeLabels,
    highlights: highlightBullets,
    strengths,
    openTo: open_to_items.map(item => item.label || item),
    skills: skillLabels,
  };
  if (heroCardMap && heroCardMap.length) {
    let skillGroupIdx = 0;
    hero_cards = heroCardMap.map(entry => {
      const label = entry.display_label || entry.original_label || "";
      switch (entry.type) {
        case "highlights": {
          const count = listShapeCount(entry, "highlights") || listShapeCount(entry, "bullets") || 4;
          return applyHeroListShapes({ group_name: label, card_label: label, skills: [],
            highlights: toLabelItems(highlightBullets, count), bullets: toLabelItems(highlightBullets, count),
            is_highlights: true, _size: charCount(highlightBullets) }, entry, heroListSources);
        }
        case "snapshot": {
          const count = listShapeCount(entry, "snapshot") || listShapeCount(entry, "bullets") || 4;
          return applyHeroListShapes({ group_name: label, card_label: label, skills: [],
            snapshot: toLabelItems(strengths, count), bullets: toLabelItems(strengths, count),
            is_snapshot: true, _size: charCount(strengths) }, entry, heroListSources);
        }
        case "links":
          return applyHeroListShapes(
            { group_name: label, card_label: label, skills: [], is_links: true, _size: 30, ...heroLinkFields },
            entry,
            heroListSources
          );
        case "skill_group": {
          const g = skill_groups[skillGroupIdx++];
          if (!g) return { group_name: label, card_label: label, skills: [], _size: 0 };
          const count = listShapeCount(entry, "skills") || listShapeCount(entry, "tags") || listShapeCount(entry, "bullets") || 4;
          const skills = g.skills.slice(0, count);
          return applyHeroListShapes({ ...g, card_label: label || g.group_name, skills, _size: charCount(skills) }, entry, {
            ...heroListSources,
            skills,
          });
        }
        default: return null;
      }
    }).filter(Boolean);
  } else {
    // Legacy fallback: highlights + snapshot (if data available) + links
    hero_cards = [
      { group_name: "Highlights", card_label: "Highlights", skills: [],
        highlights: toLabelItems(highlightBullets, 4), is_highlights: true, _size: charCount(highlightBullets) },
      ...(strengths.length ? [{ group_name: "Strengths Snapshot", card_label: "Strengths Snapshot", skills: [],
        snapshot: toLabelItems(strengths, 4), is_snapshot: true, _size: charCount(strengths) }] : []),
      { group_name: "Links", card_label: "Links", skills: [], is_links: true, _size: 30, ...heroLinkFields }
    ];
  }

  // Combine volunteer + extracurricular into leadership, dropping blank entries
  const leadership = [
    ...(resumeJson?.volunteer      || []).map(v => ({ role: v.role, organization: v.organization, dates: v.dates, description: v.description })),
    ...(resumeJson?.extracurricular|| []).map(e => ({ role: e.role, organization: e.organization, dates: e.dates, description: e.description }))
  ].filter(l => (l.role && l.organization) || l.description);

  // Theme color variables for templates that expose CSS custom properties
  const normalizedTheme = normalizeColorSpec(colorSpec);
  const tp = normalizedTheme.primary || "#2563eb";
  const ts = normalizedTheme.secondary || "#22c55e";
  const td = normalizedTheme.foreground || "#0f172a";
  const tb = normalizedTheme.background || "#f8fafc";
  const ta = normalizedTheme.accent || "#8de0ff";
  const rawAbout = trimAboutToLength(
    resumeJson?.summary || creativePack?.about_full || _coreStory || _firstSentence || "",
    heroAboutWordCount
  );
  const rawAboutFull = shapeParagraphText(
    creativePack?.about_full || resumeJson?.summary || _coreStory || "",
    aboutFullParagraphCount,
    aboutFullWordCount
  );
  const aboutSectionSubheadline = pickDistinctCopy([
    creativePack?.section_intros?.about,
    copySeed.about_angle,
    pos.value_proposition,
    _coreStory,
    "What I've built and where I'm headed."
  ], [
    pos.subheadline,
    firstTextSentence(rawAboutFull),
    pos.headline,
  ], "What I've built and where I'm headed.");
  const aboutFull = removeRepeatedLeadSentence(rawAboutFull, [
    pos.subheadline,
    aboutSectionSubheadline,
    pos.value_proposition,
    rawAbout,
    pos.headline,
  ]);
  const about = copyRepeats(firstTextSentence(rawAbout), pos.subheadline)
    ? pickDistinctCopy([
      _coreStory,
      pos.value_proposition,
      copySeed.about_angle,
    ], [
      pos.subheadline,
      aboutSectionSubheadline,
      firstTextSentence(aboutFull),
    ], rawAbout)
    : rawAbout;

  return {
    // ── Theme colors ──
    theme_background: tb,
    theme_foreground: td,
    theme_primary:   tp,
    theme_secondary: ts,
    theme_accent:    ta,
    theme_dark:      td,

    name:              personal.name     || "",
    first_name:        (personal.name || "").split(" ")[0] || "",
    last_name:         (personal.name || "").split(" ").slice(1).join(" ") || "",
    headline:          pos.headline      || "",
    subheadline:       pos.subheadline   || "",
    value_proposition: pos.value_proposition || "",
    about,
    about_full:        aboutFull,
    about_section_subheadline: aboutSectionSubheadline,
    email:             personal.email    || "",
    phone:             personal.phone    || "",
    linkedin:          personal.linkedin || "",
    github:            personal.github   || "",
    website:           personal.website  || "",
    location:          personal.location || "",
    major,
    graduation_date:   edu0.graduation_date || "",
    specialization,
    current_year:      new Date().getFullYear(),
    desired_roles:     desiredRoles,
    desired_role:      desiredRoles[0] || "",

    open_to:               openToResolved,
    open_to_display,
    open_to_items,                                // legacy alias
    open_to_roles,                                // renamed token
    has_open_to:           open_to_items.length > 0,
    has_open_to_items:     open_to_items.length > 0, // legacy alias
    has_open_to_roles:     open_to_roles.length > 0,
    work_domains,
    has_work_domains:      work_domains.length > 0,
    status_badges,
    status_badges_inline,
    has_status_badges:     status_badges.length > 0,
    has_status_badges_inline: status_badges.length > 0,

    // ── Creative pack slots (from parallelCreativeFill) ──────────────────────
    projects_section_title:   creativePack?.section_arc?.projects   || "Selected Projects",
    skills_section_title:     creativePack?.section_arc?.skills     || "Skills",
    experience_section_title: creativePack?.section_arc?.experience || "Experience",
    contact_section_title:    creativePack?.section_arc?.contact    || "Contact",
    about_section_title:      creativePack?.section_arc?.about      || "About",
    projects_intro:           creativePack?.section_intros?.projects   || "",
    experience_intro:         creativePack?.section_intros?.experience || "",
    cta_tagline:              creativePack?.cta_tagline || openToResolved || "",
    has_projects_intro:       !!(creativePack?.section_intros?.projects),
    has_experience_intro:     !!(creativePack?.section_intros?.experience),

    has_github:   !!(personal.github),
    has_linkedin: !!(personal.linkedin),
    has_website:  !!(personal.website),
    has_phone:    !!(personal.phone),

    experience: (resumeJson?.experience || []).map(e => ({
      title:       e.title      || "",
      company:     e.company    || "",
      start_date:  e.start_date || "",
      end_date:    e.end_date   || "Present",
      location:    e.location   || "",
      description: (e.bullets || [])[0] || "",
      bullets:     e.bullets    || [],
      technologies:e.technologies || []
    })),
    has_experience: (resumeJson?.experience || []).length > 0,

    projects: assignProjectIcons(augmentedProjects || resumeJson?.projects || [], resumeJson).map((p) => ({
      name:        p.name        || "",
      description: p.description || "",
      role:        p.role        || "",
      dates:       p.dates       || "",
      bullets:     p.bullets     || [],
      technologies:p.technologies || [],
      github_link: p.links?.github || "",
      demo_link:   p.links?.demo   || "",
      project_icon: p.project_icon || "🔭"
    })),

    education: (resumeJson?.education || []).map(e => ({
      institution:      e.institution      || "",
      degree:           e.degree           || "",
      major:            e.major            || "",
      graduation_date:  e.graduation_date  || "",
      gpa:              e.gpa              || "",
      honors:           e.honors           || "",
      activities:       e.activities       || []
    })),

    education_stats: (() => {
      const stats = [];
      if (edu0.graduation_date) stats.push({ stat_number: edu0.graduation_date, stat_label: edu0.degree || "Degree" });
      if (edu0.major)           stats.push({ stat_number: edu0.major,           stat_label: edu0.institution || "University" });
      if (edu0.gpa)             stats.push({ stat_number: edu0.gpa,             stat_label: "GPA" });
      if (edu0.honors)          stats.push({ stat_number: "🏅",                 stat_label: edu0.honors });
      return stats.slice(0, 4);
    })(),

    skill_groups,
    hero_cards,

    has_certifications:          (resumeJson?.certifications        || []).length > 0,
    has_publications:            (resumeJson?.publications           || []).length > 0,
    has_leadership:              leadership.length > 0,
    // Fall back to motifs.resume_keywords (already sorted by pertinence) when no explicit interests listed.
    professional_interests: (resumeJson?.professional_interests?.length
      ? resumeJson.professional_interests
      : (resumeStrategy?.motifs?.resume_keywords || []).slice(0, 6)),

    has_professional_interests: !!(resumeJson?.professional_interests?.length
      || (resumeStrategy?.motifs?.resume_keywords || []).length),

    certifications: (resumeJson?.certifications || []).map(c => ({
      name:   c.name   || "",
      issuer: c.issuer || "",
      date:   c.date   || ""
    })),

    publications: (resumeJson?.publications || []).map(p => ({
      title: p.title || "",
      venue: p.venue || "",
      date:  p.date  || "",
      link:  p.link  || ""
    })),

    leadership
  };
}

// ─── Provider-agnostic AI call helper ────────────────────────────────────────
// creds: { openaiClient, claudeKey }
// opts:  { system?, userText, pdfBuffer?, maxTokens? }
// returns: { text, model, truncated }
async function callAI(provider, creds, { system, userText, pdfBuffer, maxTokens = 8000 }) {
  if (provider === "openai") {
    const { openaiClient } = creds;
    if (pdfBuffer) {
      const uploadedFile = await openaiClient.files.create({
        file: await toFile(pdfBuffer, "resume.pdf", { type: "application/pdf" }),
        purpose: "user_data"
      });
      try {
        const r = await openaiClient.responses.create({
          model: "gpt-4o",
          ...(system ? { instructions: system } : {}),
          input: [{ role: "user", content: [
            { type: "input_file", file_id: uploadedFile.id },
            { type: "input_text", text: userText }
          ]}],
          max_output_tokens: maxTokens
        });
        const usage = { input: r.usage?.input_tokens ?? null, output: r.usage?.output_tokens ?? null };
      return { text: r.output_text, model: r.model || "gpt-4o", truncated: r.incomplete_details?.reason === "max_output_tokens", usage };
      } finally {
        openaiClient.files.del(uploadedFile.id).catch(() => {});
      }
    }
    const r = await openaiClient.responses.create({
      model: "gpt-4o",
      ...(system ? { instructions: system } : {}),
      input: [{ role: "user", content: [{ type: "input_text", text: userText }] }],
      max_output_tokens: maxTokens
    });
    const usage = { input: r.usage?.input_tokens ?? null, output: r.usage?.output_tokens ?? null };
    return { text: r.output_text, model: r.model || "gpt-4o", truncated: r.incomplete_details?.reason === "max_output_tokens", usage };
  } else {
    // Claude
    const claudeModel = "claude-sonnet-4-6";
    const userContent = pdfBuffer
      ? [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBuffer.toString("base64") } },
          { type: "text", text: userText }
        ]
      : [{ type: "text", text: userText }];
    const reqBody = { model: claudeModel, max_tokens: maxTokens, messages: [{ role: "user", content: userContent }] };
    if (system) reqBody.system = system;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": creds.claudeKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(reqBody),
      signal: AbortSignal.timeout(600000) // 10 minutes max per AI call
    });
    const json = await res.json();
    if (!res.ok) throw new Error("Claude API error: " + (json.error?.message || JSON.stringify(json).slice(0, 200)));
    const text = (json.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const usage = { input: json.usage?.input_tokens ?? null, output: json.usage?.output_tokens ?? null };
    return { text, model: json.model || claudeModel, truncated: json.stop_reason === "max_tokens", usage };
  }
}

// ─── Unify resume + job analyses (stage 2 only) ──────────────────────────────
// Receives pre-extracted resume JSON and structured job ad, runs content strategy.
// Result is stored in the blob and consumed by the full pipeline to skip Stage 2.
async function unifyResumeAndJobAnalyses(provider, creds, store, jobId, {
  pdfBuffer, resumeAnalysisJson, jobAdJson = null
}) {
  const tokenReport = [];
  // Stage 1 (optional): Extract resume PDF → JSON — skipped when resumeAnalysisJson is pre-computed
  let resumeJson = resumeAnalysisJson;
  if (!resumeJson) {
    await store.set(jobId, JSON.stringify({
      status: "pending", stage: "Extracting resume content (1/2)…"
    }), { ttl: 3600 });

    const r1 = await callAI(provider, creds, { userText: STAGE1_PROMPT, pdfBuffer, maxTokens: 8000 });
    tokenReport.push({ stage: "1a · Resume extract", model: r1.model, ...r1.usage });
    const stage1Json = parseJsonResponse(r1.text);

    const r2 = await callAI(provider, creds, {
      userText: `${STAGE2_PROMPT}\n\nJSON to validate:\n${JSON.stringify(stage1Json, null, 2)}`,
      maxTokens: 8000
    });
    tokenReport.push({ stage: "1b · Resume validate", model: r2.model, ...r2.usage });
    resumeJson = parseJsonResponse(r2.text);
  }

  // Stage 2: job_resolved is already the resolved strategy — no separate unification step needed
  const jobResolved = jobAdJson?.job_resolved ?? null;

  await store.set(jobId, JSON.stringify({
    status:        "done",
    strategy_json: jobResolved,  // job_resolved IS the resolved strategy
    resume_json:   resumeJson,   // full object with resume_facts + resume_strategy + resume_resolved
    token_report:  tokenReport
  }), { ttl: 3600 });
}

// ─── Annotated render pipeline ───────────────────────────────────────────────
// New pipeline: generateCandidateContent (3 prompts) → renderPortfolio (cheerio).
// Expects an annotated HTML template (data-* attributes) from the offline pipeline.

async function renderAnnotatedPortfolio(provider, creds, store, jobId, body, userId) {
  const {
    annotatedHtml  = "",
    resumeFacts    = null,
    resolved       = null,
    jobContext     = "",
    colorSpec      = {},
    headshotName   = "",
  } = body;
  const safeColorSpec = colorSpec && typeof colorSpec === "object" ? colorSpec : {};

  if (!annotatedHtml) {
    await store.set(jobId, JSON.stringify({ status: "error", error: "annotatedHtml is required for render-annotated mode." }), { ttl: 3600 });
    return;
  }
  if (!resumeFacts || !resolved) {
    await store.set(jobId, JSON.stringify({ status: "error", error: "resumeFacts and resolved are required for render-annotated mode." }), { ttl: 3600 });
    return;
  }

  await store.set(jobId, JSON.stringify({ status: "pending", stage: "Generating portfolio copy…" }), { ttl: 3600 });

  const callAIFn = (opts) => callAI(provider, creds, opts);

  let candidateData, tokenReports;
  try {
    ({ candidateData, tokenReports } = await generateCandidateContent(callAIFn, {
      resumeFacts,
      resolved,
      jobContext,
    }));
  } catch (err) {
    await store.set(jobId, JSON.stringify({ status: "error", error: "Content generation failed: " + (err?.message || String(err)) }), { ttl: 3600 });
    return;
  }

  await store.set(jobId, JSON.stringify({ status: "pending", stage: "Assembling portfolio…" }), { ttl: 3600 });

  const normalizedColor = normalizeColorSpec({
    background: safeColorSpec.background,
    foreground: safeColorSpec.foreground,
    primary:    safeColorSpec.primary,
    secondary:  safeColorSpec.secondary,
    accent:     safeColorSpec.accent,
    use_sample_colors: safeColorSpec.use_sample_colors,
  });

  if (headshotName) {
    candidateData.headshot = headshotName;
  }

  let siteHtml;
  try {
    siteHtml = renderPortfolio(annotatedHtml, candidateData, normalizedColor);
  } catch (err) {
    await store.set(jobId, JSON.stringify({ status: "error", error: "Render failed: " + (err?.message || String(err)) }), { ttl: 3600 });
    return;
  }

  const mastheadMeta = analyzeSampleMasthead(annotatedHtml, "");

  await store.set(jobId, JSON.stringify({
    status:        "done",
    site_html:     siteHtml,
    masthead_meta: mastheadMeta,
    model:         "render-annotated",
    token_report:  tokenReports,
  }), { ttl: 3600 });

  try {
    await logUsageEvent(userId, { event_type: "generation", provider, model: "render-annotated", success: !!siteHtml });
  } catch (e) {
    console.error("Non-fatal render-annotated usage logging error:", e?.message);
  }
}

// ─── Slot-fill pipeline ───────────────────────────────────────────────────────
// Uses the annotated.html template (data-* attributes), fills candidate data via
// flattenCandidateData(), fires parallel LLM calls for creative slots (section arc,
// about, project augmentation), then renders with renderPortfolio (Cheerio).

async function slotFillPortfolioWebsite(provider, creds, store, jobId, body, userId) {
  const {
    page1            = {},
    resumeFacts      = null,
    resolvedStrategy = null,
    sampleHtml       = "",          // annotated.html (data-* attributes)
    mastheadMeta: providedMastheadMeta = null,
    colorSpec        = {},
    colorPreferences = null,        // { mode: "swatches"|"text", swatches: string[], text: string }
    headshotName     = "",
    templateColorSlots = null,
  } = body;
  const safeColorSpec = colorSpec && typeof colorSpec === "object" ? colorSpec : {};

  await store.set(jobId, JSON.stringify({
    status: "pending", stage: "Generating portfolio content…"
  }), { ttl: 3600 });

  const flatResumeFacts = toFlatResumeSchema(resumeFacts);

  // Derive template metadata from the embedded JSON comment in the template HTML
  const metaMatch  = sampleHtml.match(/<!--\s*(\{[\s\S]*?\})\s*-->/);
  const metaJson   = metaMatch ? (() => { try { return JSON.parse(metaMatch[1]); } catch { return {}; } })() : {};
  const aboutMeta  = inferAboutMetaFromTemplateHtml(sampleHtml);
  const hasAbout   = Boolean(metaJson.has_about || aboutMeta.has_about);
  const heroCardMap = Array.isArray(metaJson.hero_card_map) && metaJson.hero_card_map.length
    ? metaJson.hero_card_map
    : inferHeroCardMapFromAnnotatedHtml(sampleHtml);
  const templateMeta = {
    has_about:      hasAbout,
    has_projects:   /\{\{#projects\}\}/.test(sampleHtml),
    has_experience: /\{\{#experience\}\}/.test(sampleHtml),
    about_word_count: metaJson.about_word_count || aboutMeta.about_word_count || 0,
    hero_about_word_count: metaJson.hero_about_word_count || aboutMeta.hero_about_word_count || metaJson.about_word_count || 0,
    about_full_word_count: metaJson.about_full_word_count || aboutMeta.about_full_word_count || 0,
    about_full_paragraph_count: metaJson.about_full_paragraph_count || aboutMeta.about_full_paragraph_count || 0,
    hero_card_map:    heroCardMap,
  };

  // Job context: brief summary for prompts (not the full job ad)
  const strat = resolvedStrategy || {};
  const jobContext = [
    strat.role_title   ? `Role: ${strat.role_title}`   : "",
    strat.company      ? `Company: ${strat.company}`    : "",
    strat.industry     ? `Industry: ${strat.industry}`  : "",
    (strat.target_keywords || []).slice(0, 8).join(", "),
  ].filter(Boolean).join("\n");

  const callAIFn = (opts) => callAI(provider, creds, opts);

  // Parallel: creative pack LLM calls + color/masthead setup (no LLM)
  const domainContext = [
    strat.motifs?.broad_primary_domain,
    (strat.motifs?.potential_visual_motifs || []).slice(0, 3).join(", "),
  ].filter(Boolean).join(" — ");

  const mastheadMeta = providedMastheadMeta || analyzeSampleMasthead(sampleHtml, domainContext);

  const [{ creativePack, augmentedProjects, tokenReports }] = await Promise.all([
    parallelCreativeFill(callAIFn, {
      resolvedStrategy,
      resumeFacts: flatResumeFacts,
      templateMeta,
      jobContext,
      colorPreferences,
    }),
  ]);

  await store.set(jobId, JSON.stringify({
    status: "pending", stage: "Assembling portfolio…"
  }), { ttl: 3600 });

  const theme = normalizeColorSpec({
    background: safeColorSpec.background,
    foreground: safeColorSpec.foreground,
    primary:    safeColorSpec.primary,
    secondary:  safeColorSpec.secondary,
    accent:     safeColorSpec.accent,
    use_sample_colors: safeColorSpec.use_sample_colors,
  });

  const candidateData = flattenCandidateData(
    resolvedStrategy,
    flatResumeFacts,
    theme,
    null,
    templateMeta.about_word_count,
    templateMeta.hero_card_map,
    creativePack,
    augmentedProjects,
    templateMeta,
  );

  if (headshotName) candidateData.headshot = headshotName;

  let siteHtml;
  try {
    siteHtml = renderPortfolio(sampleHtml, candidateData, theme);
  } catch (err) {
    await store.set(jobId, JSON.stringify({ status: "error", error: `Render failed: ${err.message}` }), { ttl: 3600 });
    return;
  }

  siteHtml = embedMastheadMetaComment(siteHtml, mastheadMeta);

  const truncated = !siteHtml.includes("</html>");
  const tokenReport = [
    { stage: "slot-fill · creative pack", ...tokenReports },
  ];

  await store.set(jobId, JSON.stringify({
    status:       "done",
    site_html:    siteHtml,
    masthead_meta: mastheadMeta,
    model:        "slot-fill",
    truncated,
    token_report: tokenReports,
  }), { ttl: 3600 });

  try {
    await logUsageEvent(userId, { event_type: "generation", provider, model: "slot-fill", success: !!siteHtml });
  } catch (e) {
    console.error("Non-fatal slot-fill usage logging error:", e?.message);
  }
}

// ─── Braid pipeline ──────────────────────────────────────────────────────────
async function braidPortfolioWebsite(provider, creds, store, jobId, body, userId) {
  const {
    page1            = {},
    resumeFacts      = null,
    resolvedStrategy = null,
    sampleHtml       = "",
    mastheadMeta: providedMastheadMeta = null,
    colorSpec        = {},
    colorPreferences = null,        // { mode: "swatches"|"text", swatches: string[], text: string }
    headshotName         = "",
    templateColorSlots   = null,  // pre-extracted from color-normalized sample (optional)
  } = body;
  const safeColorSpec = colorSpec && typeof colorSpec === "object" ? colorSpec : {};

  await store.set(jobId, JSON.stringify({
    status: "pending", stage: "Braiding portfolio website…"
  }), { ttl: 3600 });

  // Derive helper values for prompt substitution
  const flatResumeFacts = toFlatResumeSchema(resumeFacts);
  const name = flatResumeFacts?.personal?.name || resumeFacts?.identity?.name || "";
  const initials = name.split(/\s+/).map(w => w[0] || "").join("").toUpperCase().slice(0, 2) || "?";
  const currentYear = new Date().getFullYear();

  const motifs = resolvedStrategy?.motifs || {};
  const domainContext = [
    motifs.broad_primary_domain,
    (motifs.potential_visual_motifs || []).slice(0, 3).join(", "),
    (motifs.symbolic_objects        || []).slice(0, 3).join(", ")
  ].filter(Boolean).join(" — ") || name;

  const headshotHtml = headshotName
    ? `<img src="${headshotName}" alt="${name}" class="headshot" />`
    : "";

  const theme = normalizeColorSpec({
    background: safeColorSpec.background,
    foreground: safeColorSpec.foreground,
    primary: safeColorSpec.primary,
    secondary: safeColorSpec.secondary,
    accent: safeColorSpec.accent,
    use_sample_colors: safeColorSpec.use_sample_colors
  });

  // Cap sample HTML to avoid exceeding model context.
  // If the sample was pre-normalized, prepend a comment listing the extracted palette so
  // the braid AI can read the semantic roles directly instead of doing color archaeology.
  const samplePaletteRef = templateColorSlots ? normalizeColorSpec(templateColorSlots) : null;
  const samplePrefix = (samplePaletteRef && [samplePaletteRef.background, samplePaletteRef.foreground, samplePaletteRef.primary, samplePaletteRef.secondary, samplePaletteRef.accent].filter(Boolean).length >= 3)
    ? `<!--\n  PRE-EXTRACTED SAMPLE PALETTE:\n  background = ${samplePaletteRef.background || ""}\n  foreground = ${samplePaletteRef.foreground || ""}\n  primary = ${samplePaletteRef.primary || ""}\n  secondary = ${samplePaletteRef.secondary || ""}\n  accent = ${samplePaletteRef.accent || ""}\n  The sample HTML is color-normalized. Treat these semantic roles as the authoritative sample-reference palette for Part 2, even if the CSS still contains numbered legacy comments.\n-->\n`
    : "";
  const cappedSampleHtml = samplePrefix + (sampleHtml.length > 80000
    ? sampleHtml.slice(0, 80000) + "\n<!-- truncated -->"
    : sampleHtml);

  const mastheadMeta = providedMastheadMeta || analyzeSampleMasthead(sampleHtml, domainContext);
  const mastheadImageInstruction = buildMastheadImageInstruction(mastheadMeta, domainContext);
  console.log(`[buildWebsite-background] Masthead image instruction: ${mastheadImageInstruction}`);

  let prompt;
  try {
    prompt = loadPromptFile("braidWebsite.md")
      .replace("{{HEADSHOT_HTML}}",        headshotHtml)
      .replace("{{CANDIDATE_INITIALS}}",   initials)
      .replace("{{CANDIDATE_NAME}}",       name)
      .replace("{{CURRENT_YEAR}}",         String(currentYear))
      .replace("{{DOMAIN_CONTEXT}}",       domainContext)
      .replace("{{HERO_IMAGE_INSTRUCTION}}", mastheadImageInstruction)
      .replace("{{RESUME_FACTS_JSON}}",    JSON.stringify(resumeFacts,      null, 2))
      .replace("{{RESOLVED_STRATEGY_JSON}}", JSON.stringify(resolvedStrategy, null, 2))
      .replace("{{COLOR_PREFERENCES_GUIDANCE}}", formatColorPreferencesGuidance(colorPreferences))
      .replace("{{SAMPLE_HTML}}",          cappedSampleHtml);
  } catch (err) {
    await store.set(jobId, JSON.stringify({ status: "error", error: err.message }), { ttl: 3600 });
    return;
  }

  let r;
  try {
    r = await callAI(provider, creds, {
      system: "You are an HTML code generator. Output only a single complete HTML file starting with <!DOCTYPE html>. No markdown. No explanation.",
      userText: prompt,
      maxTokens: 40000
    });
  } catch (aiErr) {
    await store.set(jobId, JSON.stringify({
      status: "error",
      error: "Braid AI error: " + (aiErr?.message || String(aiErr))
    }), { ttl: 3600 });
    return;
  }

  let siteHtml = cleanHtml(r.text || "");
  const truncated = !siteHtml.includes("</html>");
  const tokenReport = [{ stage: "braid · Renderer", model: r.model, ...r.usage }];
  const hasHeroPlaceholder = siteHtml.includes('id="braid-img"');
  const hasSampleRasterCssUrl = !!(mastheadMeta.sampleRasterCssUrl && siteHtml.includes(mastheadMeta.sampleRasterCssUrl));
  const hasMastheadPlaceholderUrl = siteHtml.includes(mastheadMeta.mastheadPlaceholderUrl);
  const hasHeroBgImageSlot = /--hero-bg-image\s*:\s*none\s*;/i.test(siteHtml);
  console.log("[buildWebsite-background] Masthead image placeholder present:", hasHeroPlaceholder);
  console.log("[buildWebsite-background] Sample requires generated masthead image:", mastheadMeta.sampleHasRasterHeroImage);
  console.log(
    `[buildWebsite-background] Masthead injection slots: ${JSON.stringify({
      sampleRasterCssUrl: mastheadMeta.sampleRasterCssUrl,
      hasSampleRasterCssUrl,
      mastheadPlaceholderUrl: mastheadMeta.mastheadPlaceholderUrl,
      hasMastheadPlaceholderUrl,
      hasHeroBgImageSlot
    })}`
  );

  await store.set(jobId, JSON.stringify({
    status: "done",
    site_html:    siteHtml,
    masthead_meta: mastheadMeta,
    model:        r.model,
    truncated,
    token_report: tokenReport
  }), { ttl: 3600 });

  try {
    await logUsageEvent(userId, {
      event_type: "generation",
      provider,
      model: r.model,
      success: !!siteHtml
    });
  } catch (usageErr) {
    console.error("Non-fatal braid usage logging error:", usageErr?.message || usageErr);
  }
}

async function generateImageJob(store, jobId, body, userId) {
  const {
    imageKind = "masthead",
    page1 = {},
    colorSpec = {},
    sampleHtml = "",
    mastheadMeta: providedMastheadMeta = null,
    imageContext = {},
    provider = "openai"
  } = body;

  await store.set(jobId, JSON.stringify({
    status: "pending",
    stage: imageKind === "masthead" ? "Generating masthead image…" : "Generating image…"
  }), { ttl: 3600 });

  const theme = normalizeColorSpec(colorSpec);
  let prompt = "";
  let size = "1024x1024";
  let stageLabel = "Editor image";
  let mastheadMeta = null;

  if (imageKind === "masthead") {
    mastheadMeta = providedMastheadMeta || analyzeSampleMasthead(sampleHtml, "");
    // Normalized samples have no raster images (replaced with SVG/gradients), so
    // sampleHasRasterHeroImage is always false for them. Always generate the masthead
    // image — the --hero-bg-image CSS variable slot in the braid output will receive it.
    prompt = buildMastheadImagePrompt(page1, theme);
    size = "1536x1024";
    stageLabel = "Masthead image";
    console.log(
      `[buildWebsite-background] Masthead image prompt inputs: ${JSON.stringify({
        major: page1?.major || "",
        specialization: page1?.specialization || "",
        colors: serializeColorSpecForAI(theme)
      })}`
    );
  } else {
    prompt = buildEditorImagePrompt(page1, theme, imageContext);
    stageLabel = "Editor image";
    console.log(
      `[buildWebsite-background] Editor image prompt inputs: ${JSON.stringify({
        major: page1?.major || "",
        specialization: page1?.specialization || "",
        colors: serializeColorSpecForAI(theme),
        imageContext
      })}`
    );
  }

  try {
    const { dataUri, model } = await generateImageDataUri({ prompt, size, stageLabel });
    if (!dataUri) {
      await store.set(jobId, JSON.stringify({
        status: "error",
        error: `${stageLabel} generation returned no image data.`
      }), { ttl: 3600 });
      return;
    }

    // Store raw base64 bytes in a separate blob store so the job result stays small
    // and the HTML can reference the image via a short URL instead of a data URI.
    const b64 = dataUri.replace(/^data:[^;]+;base64,/, "");
    const { store: imgStore } = getPreviewImagesStore();
    if (imgStore) {
      await imgStore.set(jobId, b64, { ttl: 2592000 }); // 30 days
    }
    const imageUrl = `/.netlify/functions/getPreviewImage?key=${encodeURIComponent(jobId)}`;

    await store.set(jobId, JSON.stringify({
      status: "done",
      image_kind: imageKind,
      image_url: imageUrl,
      image_key: jobId,
      image_prompt: prompt,
      masthead_meta: mastheadMeta,
      model,
      token_report: [{ stage: `${imageKind} · Image`, model }]
    }), { ttl: 3600 });
    try {
      await logUsageEvent(userId, {
        event_type: "generation",
        provider,
        model,
        success: true
      });
    } catch (usageErr) {
      console.error("Non-fatal image usage logging error:", usageErr?.message || usageErr);
    }
  } catch (imgErr) {
    const msg = imgErr?.message || String(imgErr);
    const isAuthError = /401|403|authentication failed|not allowed/i.test(msg)
      || imgErr?.status === 401 || imgErr?.status === 403;
    const isTimeoutError = /timeout|timed out|aborted|abort/i.test(msg)
      || imgErr?.code === "ETIMEDOUT"
      || imgErr?.name === "AbortError";
    const isProviderUnavailable = /unable to find a suitable provider|image model unavailable|invalid.*model|model.*not.*found|model.*not.*available|unsupported model|does not exist/i.test(msg);
    const isConnectionError = /connection error|network error|fetch failed|socket hang up|econnreset|enotfound|eai_again/i.test(msg)
      || imgErr?.code === "ECONNRESET"
      || imgErr?.code === "ENOTFOUND"
      || imgErr?.code === "EAI_AGAIN";

    if (isAuthError || isTimeoutError || isProviderUnavailable || isConnectionError) {
      const skipReason = isTimeoutError ? "image_generation_timeout" : "image_service_unavailable";
      console.warn(`[buildWebsite-background] ${stageLabel} skipped: ${skipReason} (${msg.slice(0, 120)})`);
      await store.set(jobId, JSON.stringify({
        status: "done",
        skipped: true,
        image_kind: imageKind,
        skip_reason: skipReason,
        skip_message: `${stageLabel} skipped: ${isTimeoutError ? "image generation timed out" : "image service unavailable"}.`,
      }), { ttl: 3600 });
    } else {
      await store.set(jobId, JSON.stringify({
        status: "error",
        error: `${stageLabel} generation failed: ${msg}`
      }), { ttl: 3600 });
    }
  }
}

// ─── Main pipeline ───────────────────────────────────────────────────────────
async function runPortfolioWebsitePipeline(provider, creds, store, jobId, opts) {
  const {
    page1, page2, pdfBuffer,
    sampleHtml, theme, headshotName,
    resumeAnalysisJson, templateAnalysisJson, templateHtml,
    artifactsData = [],
    strategyJson = null,  // pre-computed by unifyResumeAndJobAnalyses — skips Stage 2
    bridgeJson   = null   // pre-computed by bridgeContentAndDesign mode — skips Stage 3
  } = opts;
  const tokenReport = [];
  const isDesignOptionsMode = (page1?.template_source || "").toLowerCase() === "none";
  const totalStages = isDesignOptionsMode ? 3 : 4;
  // ── Stage 1 (optional): Extract resume PDF → JSON ───────────────────────────
  let resumeJson = resumeAnalysisJson;
  if (!resumeJson) {
    await store.set(jobId, JSON.stringify({
      status: "pending", stage: `Extracting resume content (1/${totalStages})…`
    }), { ttl: 3600 });

    const r1 = await callAI(provider, creds, { userText: STAGE1_PROMPT, pdfBuffer, maxTokens: 8000 });
    tokenReport.push({ stage: "1a · Resume extract", model: r1.model, ...r1.usage });
    const stage1Json = parseJsonResponse(r1.text);

    const r2 = await callAI(provider, creds, {
      userText: `${STAGE2_PROMPT}\n\nJSON to validate:\n${JSON.stringify(stage1Json, null, 2)}`,
      maxTokens: 8000
    });
    tokenReport.push({ stage: "1b · Resume validate", model: r2.model, ...r2.usage });
    resumeJson = parseJsonResponse(r2.text);
  }

  // ── Stage 2: resolve strategy ────────────────────────────────────────────────
  // strategyJson is job_resolved (job path) or resume_resolved (no-job path) — use directly.
  // Falls back to resume_resolved embedded in resumeJson, then to buildContentStrategy.md legacy path.
  const resumeFacts    = resumeJson?.resume_facts    ?? resumeJson;   // fallback: old flat schema
  const resumeStrategy = resumeJson?.resume_strategy ?? null;

  let aiStrategy;
  if (strategyJson) {
    // New split schema: strategyJson IS the resolved strategy (job_resolved or resume_resolved)
    aiStrategy = strategyJson;
  } else if (resumeJson?.resume_resolved) {
    // No job — use resume_resolved embedded in the resume analysis
    aiStrategy = resumeJson.resume_resolved;
  } else {
    // Legacy fallback: run buildContentStrategy.md for old analyses without resume_resolved
    await store.set(jobId, JSON.stringify({
      status: "pending", stage: `Content strategy (2/${totalStages})…`
    }), { ttl: 3600 });

    const contentPrompt = loadPromptFile("buildContentStrategy.md")
      .replace("{{RESUME_STRATEGY_JSON}}", JSON.stringify(resumeStrategy, null, 2))
      .replace("{{JOB_STRATEGY_JSON}}",   JSON.stringify(null, null, 2))
      .replace("{{RESUME_FACTS_JSON}}",   JSON.stringify(resumeFacts, null, 2));

    const contentResponse = await callAI(provider, creds, { userText: contentPrompt, maxTokens: 8000 });
    tokenReport.push({ stage: "2 · Content strategy (legacy)", model: contentResponse.model, ...contentResponse.usage });
    const legacyResult = parseJsonResponse(contentResponse.text);
    aiStrategy = legacyResult.unified_strategy ?? legacyResult.strategy ?? legacyResult;
  }

  // Construct source_facts from resume_facts — no AI re-extraction.
  const coreContent = {
    strategy: aiStrategy,
    source_facts: {
      identity: resumeFacts.identity ?? {},
      ...(resumeFacts.factual_profile ?? {})
    }
  };

  if (isDesignOptionsMode) {
    await store.set(jobId, JSON.stringify({
      status: "pending", stage: `Generating portfolio website (3/${totalStages})…`
    }), { ttl: 3600 });

    const candidateName = coreContent.source_facts?.identity?.name || "";
    const headshotHint  = headshotName
      ? `provided — use <img src='${headshotName}' alt='${candidateName}'>`
      : `not provided — render a CSS monogram using the initials of "${candidateName}"`;

    const directDesignSpec = {
      composition:         page1?.design_composition || "",
      style:               page1?.design_style || "",
      render_mode:         page1?.design_render_mode || "",
      density:             page1?.design_density || "medium",
      use_emoji_icons:     page1?.use_emoji_icons ?? true,
      alternate_sections:  page1?.alternate_sections ?? true
    };

    const directColorSpec = { ...theme, use_sample_colors: false };

    const directPrompt = loadPromptFile("renderFromDesignSpec.md")
      .replace(/\{\{MAJOR\}\}/g, page1?.major || "")
      .replace(/\{\{SPECIALIZATION\}\}/g, page1?.specialization || "")
      .replace(/\{\{RESUME_FACTS_JSON\}\}/g, JSON.stringify(resumeFacts, null, 2))
      .replace(/\{\{RESOLVED_STRATEGY_JSON\}\}/g, JSON.stringify(aiStrategy, null, 2))
      .replace(/\{\{DESIGN_SPEC_JSON\}\}/g, JSON.stringify(directDesignSpec, null, 2))
      .replace(/\{\{COLOR_SPEC_JSON\}\}/g, JSON.stringify(directColorSpec, null, 2))
      .replace(/\{\{HEADSHOT\}\}/g, headshotHint)
      .replace(/\{\{YEAR\}\}/g, new Date().getFullYear().toString());

    const directSystem = "You are an HTML code generator for a legitimate professional portfolio website builder service. Output exactly one complete HTML file starting with <!DOCTYPE html>. Do not output markdown, explanations, or commentary.";
    const directResponse = await callAI(provider, creds, {
      system: directSystem,
      userText: directPrompt,
      maxTokens: 32000
    });
    tokenReport.push({ stage: "3 · Direct renderer", model: directResponse.model, ...directResponse.usage });

    const siteHtml = cleanHtml(directResponse.text);
    if (!/<[a-z]/i.test(siteHtml)) {
      let reason;
      if (!directResponse.text?.trim()) {
        reason = "The AI returned an empty response. This is usually a transient error — please resubmit.";
      } else if (directResponse.truncated) {
        reason = "The AI's output was cut off before any HTML was produced (token limit reached). Try a shorter job description or fewer visuals, then resubmit.";
      } else {
        reason = `The AI did not return valid HTML. Raw output started with: "${directResponse.text?.slice(0, 120)}"`;
      }
      await store.set(jobId, JSON.stringify({ status: "error", error: reason }), { ttl: 3600 });
      return;
    }

    await store.set(jobId, JSON.stringify({
      status: "done",
      model: directResponse.model,
      site_html: siteHtml,
      resume_json: resumeJson,
      strategy_json: coreContent.strategy,
      visual_direction_json: directDesignSpec,
      truncated: directResponse.truncated,
      token_report: tokenReport
    }), { ttl: 3600 });

    await logUsageEvent(opts.userId, {
      event_type: "generation",
      provider: opts.provider || "claude",
      model: directResponse.model,
      success: true
    });
    return;
  }

  // ── Stage 3: code-level visual_direction assembly ────────────────────────────
  await store.set(jobId, JSON.stringify({
    status: "pending", stage: "Assembling visual direction (3/4)…"
  }), { ttl: 3600 });

  const colorSpec = page2?.use_sample_colors
    ? { use_sample_colors: true, note: "Preserve the template's exact color scheme." }
    : normalizeColorSpec({ ...theme, use_sample_colors: false });

  // Enrich user-supplied artifacts with source and colorized fields.
  const COLORIZABLE_TYPES = new Set(["image", "html", "text"]);
  const userArtifacts = (artifactsData || []).map(a => ({
    ...a,
    source: "user",
    colorized: COLORIZABLE_TYPES.has((a.type || "").toLowerCase())
  }));

  // Stage 3: Build visual_direction using user artifacts only (for placement guidance).
  // Merge page1 user preferences on top of templateAnalysisJson so they always win,
  // regardless of which template source (option 1/2/3) was used.
  const designSpec = {
    ...(templateAnalysisJson || {}),
    ...(page1.design_density     !== undefined && { density:           page1.design_density }),
    ...(page1.use_emoji_icons    !== undefined && { use_emoji_icons:   page1.use_emoji_icons }),
    ...(page1.alternate_sections !== undefined && { alternate_sections: page1.alternate_sections }),
  };
  // If a pre-computed bridge_json was supplied by the bridgeContentAndDesign stage, use its
  // visual_direction directly and skip the code-level buildVisualDirection() call.
  const blendResult = (bridgeJson?.visual_direction)
    ? { visual_direction: bridgeJson.visual_direction }
    : buildVisualDirection(resumeStrategy?.motifs ?? {}, designSpec, colorSpec, userArtifacts);

  // ── Stage 3.5: Merge template visual elements into artifact list ─────────────
  await store.set(jobId, JSON.stringify({
    status: "pending", stage: "Merging artifacts (3/4)…"
  }), { ttl: 3600 });

  const templateVisuals = templateAnalysisJson?.visual_elements;
  const templateImageArtifacts = (templateVisuals?.images || []).map(img => ({
    type: "image",
    label: img.src_file_name || img.role || "template image",
    content: img.src_file_name || "",
    tagline: img.role || "",
    selector: img.selector || "",
    source: "example website",
    colorized: false
  }));
  const templateAnimationArtifacts = (templateVisuals?.animations || []).map(anim => ({
    type: "animation",
    label: anim.src_file_name || anim.name || "template animation",
    content: anim.src_file_name || "",
    tagline: anim.name || "",
    selector: anim.selector || "",
    source: "example website",
    colorized: false
  }));
  const artifactsJson = [...userArtifacts, ...templateImageArtifacts, ...templateAnimationArtifacts];

  // ── Assemble renderer inputs ─────────────────────────────────────────────────
  const candidateName = coreContent.source_facts?.identity?.name || "";
  const headshotHint  = headshotName
    ? `provided — use <img src='${headshotName}' alt='${candidateName}'>`
    : `not provided — render a CSS monogram using the initials of "${candidateName}"`;

  // content_json: strategy + facts + rendering metadata
  const contentJson = {
    strategy:          coreContent.strategy,
    source_facts:      coreContent.source_facts,
    value_propositions: resumeStrategy?.website_copy_seed?.value_propositions || [],
    candidate_name:    candidateName || "UNKNOWN — check source_facts.identity.name"
  };

  // ── Stage 4: fill template → HTML ────────────────────────────────────────────
  await store.set(jobId, JSON.stringify({
    status: "pending", stage: "Generating portfolio website (4/4)…"
  }), { ttl: 3600 });

  // Use the template HTML sent by the client (from extractedTemplateCache.templateHtml).
  // Fall back to the separately-fetched sampleHtml for URL-based templates.
  const rendererSampleHtml = stripGrapesJsCss(templateHtml || sampleHtml || "(No sample website provided)");

  let siteHtml, usedModel, truncated;

  {
    // ── AI renderer path ─────────────────────────────────────────────────────
    const rendererPrompt = loadPromptFile("rendererPrompt.md")
      .replace("{{CONTENT_JSON}}",    JSON.stringify(contentJson, null, 2))
      .replace("{{VISUAL_DIRECTION}}", JSON.stringify(blendResult.visual_direction, null, 2))
      .replace("{{VISUALS_JSON}}",    JSON.stringify(artifactsJson, null, 2))
      .replace("{{SAMPLE_HTML}}",     rendererSampleHtml)
      .replace("{{HEADSHOT}}",        headshotHint)
      .replace("{{TEMPLATE_USAGE}}",  templateUsageInstruction(page1.template_copyright_mode))
      .replace("{{YEAR}}",            new Date().getFullYear().toString());

    const rendererSystem = "You are an HTML code generator for a legitimate professional portfolio website builder service. Your sole task is to output a single complete HTML file as requested. This is a standard web development task. Output only raw HTML starting with <!DOCTYPE html> — no explanations, no refusals, no markdown, no commentary of any kind.";
    const rendererResponse = await callAI(provider, creds, {
      system: rendererSystem,
      userText: "Generate the portfolio HTML file per the spec below.\n\n" + rendererPrompt,
      maxTokens: 32000
    });
    tokenReport.push({ stage: "5 · Renderer", model: rendererResponse.model, ...rendererResponse.usage });

    siteHtml = cleanHtml(rendererResponse.text);
    usedModel = rendererResponse.model;
    truncated = rendererResponse.truncated;

    if (!/<[a-z]/i.test(siteHtml)) {
      let reason;
      if (!rendererResponse.text?.trim()) {
        reason = "The AI returned an empty response. This is usually a transient error — please resubmit.";
      } else if (rendererResponse.truncated) {
        reason = "The AI's output was cut off before any HTML was produced (token limit reached). Try a shorter job description or fewer visuals, then resubmit.";
      } else {
        reason = `The AI did not return valid HTML. Raw output started with: "${rendererResponse.text?.slice(0, 120)}"`;
      }
      await store.set(jobId, JSON.stringify({ status: "error", error: reason }), { ttl: 3600 });
      return;
    }
  }

  await store.set(jobId, JSON.stringify({
    status: "done",
    model: usedModel,
    site_html: siteHtml,
    resume_json: resumeJson,
    strategy_json: coreContent.strategy,
    visual_direction_json: blendResult.visual_direction,
    truncated,
    token_report: tokenReport
  }), { ttl: 3600 });

  await logUsageEvent(opts.userId, {
    event_type: "generation",
    provider: opts.provider || "claude",
    model: usedModel,
    success: true
  });
}

// ─── Template color normalization pipeline ───────────────────────────────────
// Rewrites all color values in a sample HTML as 5 named --color-* CSS variables,
// preserving visual appearance. Used offline (preprocessing script) and in-flow.
async function normalizeTemplateColorsJob(provider, creds, store, jobId, body) {
  const sampleHtml = body.sampleHtml || "";
  await store.set(jobId, JSON.stringify({ status: "pending", stage: "Normalizing template colors…" }), { ttl: 3600 });
  const mastheadMeta = analyzeSampleMasthead(sampleHtml, "");
  let prompt;
  try {
    const rawHtml = sampleHtml.length > 80000 ? sampleHtml.slice(0, 80000) + "\n<!-- truncated -->" : sampleHtml;
    prompt = loadPromptFile("ExtractVisuals.md").replace("{{EXAMPLE_HTML}}", rawHtml);
  } catch (err) {
    await store.set(jobId, JSON.stringify({ status: "error", error: err.message }), { ttl: 3600 });
    return;
  }
  let r;
  try {
    r = await callAI(provider, creds, {
      system: "You are an HTML engineer. Rewrite the HTML to replace all color values with exactly 5 named CSS custom properties in :root, following the instructions in the prompt. Output only raw HTML starting with <!DOCTYPE html>. No markdown. No explanation.",
      userText: prompt,
      maxTokens: 40000
    });
  } catch (err) {
    await store.set(jobId, JSON.stringify({ status: "error", error: err.message }), { ttl: 3600 });
    return;
  }
  const normalizedHtml = embedMastheadMetaComment(cleanHtml(r.text || ""), mastheadMeta);
  const colorSlots = parseNormalizedColorSlots(normalizedHtml);
  await store.set(jobId, JSON.stringify({
    status: "done",
    normalizedHtml,
    colorSlots,
    mastheadMeta,
    token_report: [{ stage: "normalizeTemplate", model: r.model, ...r.usage }]
  }), { ttl: 3600 });
}

export async function handler(event) {
  try {
    return normalizeFunctionResponse(await handleBuildWebsiteBackground(event));
  } catch (err) {
    const msg = explainBlobStoreError(err);
    console.error("[buildWebsite-background] top-level fatal:", msg, err?.stack);
    await writeFatalJobError(event, msg);
    return { statusCode: 202, body: JSON.stringify({ error: msg }) };
  }
}

async function handleBuildWebsiteBackground(event) {
  logBuildStage("handler entered", {
    method: event?.httpMethod || event?.method || "",
    path: event?.path || event?.rawUrl || "",
    bodyLength: typeof event?.body === "string" ? event.body.length : 0,
  });

  // Parse body and jobId FIRST so the catch block can always reference them
  let body, jobId, store;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }
  jobId = body.jobId;
  if (!jobId) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing jobId" }) };
  }
  logBuildStage("body parsed", {
    jobId,
    mode: body.mode || "full",
    provider: body.provider || "claude",
    imageKind: body.imageKind || "",
    sampleHtmlLength: typeof body.sampleHtml === "string" ? body.sampleHtml.length : 0,
    resumePdfLength: typeof body.resumePdfBase64 === "string" ? body.resumePdfBase64.length : 0,
    hasUserId: !!body.userId,
  });

  try {
    const { store: previewStore, configError } = getPreviewResultsStore();
    logBuildStage("preview store resolved", { jobId, hasStore: !!previewStore, configError: configError || "" });
    if (!previewStore) {
      return { statusCode: 500, body: JSON.stringify({ error: configError }) };
    }
    store = previewStore;

    // Write pending status immediately so the poller knows the function started
    await store.set(jobId, JSON.stringify({ status: "pending" }), { ttl: 3600 });
    logBuildStage("pending status written", { jobId });

    const {
      page1 = {}, page2 = {}, page3 = {},
      artifactsData = [],
      resumePdfBase64 = "", headshotName = "",
      resumeAnalysisJson = null, templateAnalysisJson = null, templateHtml = null,
      mode = "full",          // "full" | "braid" | "generateImage" | "analyzeJob" | "extractJobAd" | "bridgeContentAndDesign"
      strategyJson = null,    // pre-computed strategy from analyzeJob mode
      bridgeJson   = null,    // pre-computed visual_direction from bridgeContentAndDesign mode
      provider = "claude",    // "claude" (default) | "openai"
      userId = null           // Supabase user UUID — sent by client when logged in
    } = body;
    logBuildStage("dispatching mode", { jobId, mode, provider });

    // ── Quota check (billable AI generation steps) ──
    if (mode === "full" || mode === "braid" || mode === "slot-fill") {
      if (!userId) {
        // Anonymous user — soft limit enforced client-side via localStorage.
        // Log to aggregate counter so usage can be monitored.
        await logAnonUsage();
      } else {
        const quota = await checkAndIncrementCredits(userId);
        if (!quota.allowed) {
          await store.set(jobId, JSON.stringify({ status: "error", error: quota.reason, quota: true, tier: quota.tier, used: quota.used, limit: quota.limit }), { ttl: 3600 });
          return { statusCode: 202 };
        }
      }
    }

    if (mode === "analyzeJob") {
      if (!resumePdfBase64 && !resumeAnalysisJson) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "Resume PDF or pre-computed analysis required." }), { ttl: 3600 });
        return { statusCode: 202 };
      }
    } else if (mode === "braid" || mode === "slot-fill" || mode === "normalizeTemplate") {
      if (!body.sampleHtml) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "sampleHtml is required for this mode." }), { ttl: 3600 });
        return { statusCode: 202 };
      }
    } else if (mode === "generateImage") {
      if ((body.imageKind || "masthead") === "masthead" && !body.sampleHtml) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "sampleHtml is required for masthead image generation." }), { ttl: 3600 });
        return { statusCode: 202 };
      }
    } else if (mode !== "bridgeContentAndDesign" && mode !== "extractJobAd") {
      if (!resumePdfBase64) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "Resume PDF is required." }), { ttl: 3600 });
        return { statusCode: 202 };
      }
    }

    // Build provider credentials
    let creds;
    if (mode === "generateImage") {
      creds = {};
    } else if (provider === "openai") {
      const openaiKey = process.env.OPENAI_API_KEY_LOCAL || process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "OPENAI_API_KEY is not set." }), { ttl: 3600 });
        return { statusCode: 202 };
      }
      creds = { openaiClient: new OpenAI({ apiKey: openaiKey }) };
    } else {
      const claudeKey = process.env.ANTHROPIC_API_KEY_LOCAL || process.env.ANTHROPIC_API_KEY;
      if (!claudeKey) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "ANTHROPIC_API_KEY is not set." }), { ttl: 3600 });
        return { statusCode: 202 };
      }
      creds = { claudeKey };
    }

    // extractJobAd mode: extract structured job ad info from raw posting text
    if (mode === "extractJobAd") {
      if (userId) {
        const quota = await checkAndIncrementCredits(userId);
        if (!quota.allowed) {
          await store.set(jobId, JSON.stringify({
            status: "error",
            error: quota.reason,
            quota: true,
            tier: quota.tier,
            used: quota.used,
            limit: quota.limit
          }), { ttl: 3600 });
          return { statusCode: 202 };
        }
      }
      const rawJobAd = body.jobAdText || "";
      if (!rawJobAd.trim()) {
        await store.set(jobId, JSON.stringify({ status: "done", job_ad: null }), { ttl: 3600 });
        return { statusCode: 202 };
      }
      const resumeStrategy = body.resumeStrategy || null;
      const resumeFacts    = body.resumeFacts    || null;
      const prompt = loadPromptFile("extractJobAdInfo.md")
        .replace("{{RESUME_STRATEGY_JSON}}", JSON.stringify(resumeStrategy, null, 2))
        .replace("{{RESUME_FACTS_JSON}}",    JSON.stringify(resumeFacts, null, 2))
        .replace("{{JOB_AD}}", rawJobAd);
      let r;
      try {
        r = await callAI(provider, creds, { userText: prompt, maxTokens: 8000 });
      } catch (aiErr) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "Job extraction AI error: " + (aiErr?.message || String(aiErr)) }), { ttl: 3600 });
        return { statusCode: 202 };
      }
      let parsed = null;
      try { parsed = parseJsonResponse(r.text); } catch {}
      const jobResolved = parsed?.job_resolved ?? parsed ?? null;
      await store.set(jobId, JSON.stringify({
        status:       jobResolved ? "done" : "error",
        job_resolved: jobResolved,
        error:        jobResolved ? undefined : "Job extraction returned no valid JSON. Raw: " + (r.text || "").slice(0, 300),
        model:        r.model,
        token_report: [{ stage: "2a · Job ad extract", model: r.model, ...r.usage }]
      }), { ttl: 3600 });
      await logUsageEvent(userId, {
        event_type: "job_analysis",
        provider,
        model: r.model,
        success: !!jobResolved
      });
      return { statusCode: 202 };
    }

    // normalizeTemplate mode: rewrite sample HTML with 5 named --color-* CSS variables
    if (mode === "normalizeTemplate") {
      await normalizeTemplateColorsJob(provider, creds, store, jobId, body);
      return { statusCode: 202 };
    }

    // slot-fill: fast Cheerio-based pipeline (annotated.html) with parallel creative LLM calls
    if (mode === "slot-fill") {
      await slotFillPortfolioWebsite(provider, creds, store, jobId, body, userId);
      return { statusCode: 202 };
    }

    // render-annotated: generateCandidateContent + renderPortfolio (new cheerio pipeline)
    if (mode === "render-annotated") {
      await renderAnnotatedPortfolio(provider, creds, store, jobId, body, userId);
      return { statusCode: 202 };
    }

    // braid mode: single-pass layout clone + content substitution + color encoding
    if (mode === "braid") {
      await braidPortfolioWebsite(provider, creds, store, jobId, body, userId);
      return { statusCode: 202 };
    }

    if (mode === "generateImage") {
      if (!userId) {
        await logAnonUsage();
      } else {
        const quota = await checkAndIncrementCredits(userId);
        if (!quota.allowed) {
          await store.set(jobId, JSON.stringify({ status: "error", error: quota.reason, quota: true, tier: quota.tier, used: quota.used, limit: quota.limit }), { ttl: 3600 });
          return { statusCode: 202 };
        }
      }
      await generateImageJob(store, jobId, body, userId);
      return { statusCode: 202 };
    }

    // bridgeContentAndDesign mode: merge profile + design → visual_direction + page_concept
    if (mode === "bridgeContentAndDesign") {
      const templateHtmlInput = body.templateHtml || "";
      const contentJson       = body.contentJson  || body.strategyJson || null;
      const colorSpec         = body.colorSpec    || {};
      const templateMode      = body.templateMode || "none";
      const bridgePrompt = loadPromptFile("bridgeContentAndDesign.md")
        .replace("{{CONTENT_JSON}}",   JSON.stringify(contentJson, null, 2))
        .replace("{{COLOR_SPEC_JSON}}", JSON.stringify(serializeColorSpecForAI(colorSpec), null, 2))
        .replace("{{TEMPLATE_MODE}}",  templateMode)
        .replace("{{EXAMPLE_WEBSITE}}", templateHtmlInput);
      const r = await callAI(provider, creds, { userText: bridgePrompt, maxTokens: 20000 });
      let bridge_json = null;
      let bridge_parse_error = null;
      try { bridge_json = parseJsonResponse(r.text); } catch (e) { bridge_parse_error = e?.message || "parse failed"; }
      await store.set(jobId, JSON.stringify({
        status: "done", bridge_json, model: r.model,
        token_report: [{ stage: "4 · Bridge", model: r.model, ...r.usage }],
        ...(bridge_json ? {} : { bridge_raw: r.text?.slice(0, 2000), bridge_parse_error })
      }), { ttl: 3600 });
      return { statusCode: 202 };
    }

    // analyzeJob mode: stage 2 (content strategy using pre-computed resume + job ad JSONs)
    if (mode === "analyzeJob") {
      const pdfBuf = resumePdfBase64 ? Buffer.from(resumePdfBase64, "base64") : null;
      await unifyResumeAndJobAnalyses(provider, creds, store, jobId, {
        pdfBuffer: pdfBuf, resumeAnalysisJson, jobAdJson: body.jobAdJson || null
      });
      return { statusCode: 202 };
    }

    const theme = normalizeColorSpec({
      background: page2?.theme?.background,
      foreground: page2?.theme?.foreground,
      primary: page2?.theme?.primary,
      secondary: page2?.theme?.secondary,
      accent: page2?.theme?.accent
    });

    const sampleHtml = await fetchSampleHtml(page1.model_template);
    const pdfBuffer  = Buffer.from(resumePdfBase64, "base64");

    await runPortfolioWebsitePipeline(provider, creds, store, jobId, {
      page1, page2, page3, pdfBuffer,
      sampleHtml, theme, headshotName,
      resumeAnalysisJson, templateAnalysisJson, templateHtml,
      artifactsData,
      strategyJson,
      bridgeJson,
      userId,
      provider
    });
  } catch (err) {
    const msg = explainBlobStoreError(err);
    console.error("buildWebsite-background error:", msg, err?.stack);
    if (store) {
      try {
        await store.set(jobId, JSON.stringify({ status: "error", error: msg }), { ttl: 3600 });
      } catch (blobErr) {
        console.error("Failed to write error to blob:", blobErr?.message);
      }
    }
    // Return error details in body so they're visible in function logs
    return { statusCode: 202, body: JSON.stringify({ error: msg }) };
  }

  return { statusCode: 202 };
}
