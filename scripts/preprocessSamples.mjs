#!/usr/bin/env node
/**
 * One-time preprocessing script — normalizes gallery sample HTML files.
 *
 * Reads html/*Grad*.html (excluding _template, _mustache, _normalized variants),
 * calls Claude to replace all colors with 5 named CSS custom properties following
 * the ExtractVisuals.md prompt, and writes html/*_normalized.html.
 *
 * These normalized files are used by the braid pipeline when the user selects
 * "Choose by name" (option 1) on the Design page, avoiding an in-flow AI call.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node scripts/preprocessSamples.mjs [--dry-run] [substr]
 *
 *   substr  — optional substring to filter filenames (default: "Grad")
 *             e.g. "biology" processes only biologyGrad*.html
 *
 * Requirements: Node 18+ (native fetch), ANTHROPIC_API_KEY env var.
 */

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, "..");
const HTML_DIR  = join(ROOT, "html");
const PROMPT_PATH = join(ROOT, "src/netlify/functions/ExtractVisuals.md");
const MODEL     = "claude-sonnet-4-6";
const MAX_TOKENS = 40000;
const RATE_LIMIT_MS = 4000; // pause between API calls
const MASTHEAD_PLACEHOLDER_URL = "braid-masthead.png";

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("Error: ANTHROPIC_API_KEY is not set.");
  process.exit(1);
}

const dryRun    = process.argv.includes("--dry-run");
const args      = process.argv.slice(2).filter(a => !a.startsWith("--"));
// Accept either a plain substring or a /regex/ argument.
// Default pattern matches *Grad.html and *Grad_[A-Z].html exactly.
const DEFAULT_PATTERN = /Grad\.html$|Grad_[A-Za-z]\.html$/;
let fileFilter;
if (args.length > 0) {
  const arg = args[0];
  const rMatch = arg.match(/^\/(.+)\/([gimsuy]*)$/);
  fileFilter = rMatch ? new RegExp(rMatch[1], rMatch[2]) : f => f.includes(arg);
} else {
  fileFilter = f => DEFAULT_PATTERN.test(f);
}

const promptTemplate = readFileSync(PROMPT_PATH, "utf-8");

function stripCssComments(value = "") {
  return String(value || "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
}

function analyzeSampleMasthead(sampleHtml = "") {
  let sampleHasRasterHeroImage = false;
  let sampleRasterCssUrl = "";
  let sampleRasterCssSelector = "";
  let sampleRasterBackgroundDecl = "";
  let sampleHeaderContainsHero = false;

  const headerMatch = sampleHtml.match(/<header\b[^>]*>([\s\S]{0,8000})<\/header>/i);
  const heroMatch = sampleHtml.match(/<(?:section|header|div)[^>]*(?:id|class)=["'][^"']*hero[^"']*["'][^>]*>([\s\S]{0,5000})/i);
  const searchRegions = [headerMatch?.[1], heroMatch?.[1], sampleHtml.slice(0, 6000)]
    .filter(Boolean)
    .join("\n");
  const styleBlock = (sampleHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/i) || [])[1] || "";
  const rasterImgMatch = searchRegions.match(
    /<img\b[^>]*src=["'](?!data:)[^"']+\.(?:png|jpe?g)(?:\?[^"']*)?["'][^>]*>/i
  );
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

const files = readdirSync(HTML_DIR)
  .filter(f => f.endsWith(".html"))
  .filter(f => typeof fileFilter === "function" ? fileFilter(f) : fileFilter.test(f))
  .filter(f => !/_template\.html$/.test(f))
  .filter(f => !/_mustache\.html$/.test(f))
  .filter(f => !/_normalized\.html$/.test(f))
  .sort();

const filterDesc = args.length > 0 ? args[0] : DEFAULT_PATTERN.toString();
console.log(`Preprocessing ${files.length} file(s) matching ${filterDesc}${dryRun ? " [dry-run]" : ""}.\n`);

for (const file of files) {
  const srcPath = join(HTML_DIR, file);
  const outPath = join(HTML_DIR, file.replace(/\.html$/, "_normalized.html"));
  const outName = basename(outPath);

  if (dryRun) {
    console.log(`[dry-run] ${file} → ${outName}`);
    continue;
  }

  const html   = readFileSync(srcPath, "utf-8");
  const mastheadMeta = analyzeSampleMasthead(html);
  const capped = html.length > 80000 ? html.slice(0, 80000) + "\n<!-- truncated -->" : html;
  const prompt = promptTemplate.replace("{{EXAMPLE_HTML}}", capped);

  process.stdout.write(`Processing: ${file} … `);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key":         API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type":      "application/json"
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        system: "You are an HTML engineer. Rewrite the HTML to replace all color values with exactly 5 named CSS custom properties in :root, following the instructions in the prompt. Output only raw HTML starting with <!DOCTYPE html>. No markdown. No explanation.",
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.status);
      console.error(`API error ${res.status}: ${String(err).slice(0, 200)}`);
      continue;
    }

    const data = await res.json();
    const normalized = embedMastheadMetaComment((data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("")
      .replace(/^```[a-zA-Z]*\n?/m, "")
      .replace(/\n?```\s*$/m, "")
      .trim(), mastheadMeta);

    if (!normalized.startsWith("<!DOCTYPE") && !normalized.startsWith("<html")) {
      console.error("⚠ Output doesn't look like HTML — skipping.");
      continue;
    }

    writeFileSync(outPath, normalized, "utf-8");
    const kb = (normalized.length / 1024).toFixed(1);
    const inputTok  = data.usage?.input_tokens  ?? "?";
    const outputTok = data.usage?.output_tokens ?? "?";
    console.log(`✓ ${outName} (${kb} KB, ${inputTok}→${outputTok} tok)`);
  } catch (e) {
    console.error(`Error: ${e.message}`);
  }

  // Respect rate limits between requests
  await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
}

console.log("\nDone.");
