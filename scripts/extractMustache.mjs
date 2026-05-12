#!/usr/bin/env node
/**
 * Converts templates/<major>/sample.html into templates/<major>/mustache.html
 * using Claude + ExtractMustacheTemplate.md as the system prompt.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node scripts/extractMustache.mjs [major1 major2 ...]
 *
 *   With no arguments, processes all templates/* directories.
 *   With arguments, processes only the named majors (e.g. "electrical-engineering anthropology").
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT         = join(__dirname, "..");
const TEMPLATES    = join(ROOT, "templates");
const PROMPT_PATH  = join(ROOT, "src/netlify/functions/ExtractMustacheTemplate.md");
const MODEL        = "claude-sonnet-4-6";
const MAX_TOKENS   = 16000;
const RATE_LIMIT_MS = 5000;

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error("Error: ANTHROPIC_API_KEY is not set."); process.exit(1); }

const promptTemplate = readFileSync(PROMPT_PATH, "utf-8");

// Determine which majors to process
const requested = process.argv.slice(2).filter(a => !a.startsWith("--"));
const dryRun = process.argv.includes("--dry-run");

let majors;
if (requested.length > 0) {
  majors = requested;
} else {
  majors = readdirSync(TEMPLATES)
    .filter(f => statSync(join(TEMPLATES, f)).isDirectory())
    .filter(f => f !== "templates.json")
    .sort();
}

console.log(`Extracting mustache templates for: ${majors.join(", ")}${dryRun ? " [dry-run]" : ""}\n`);

for (const major of majors) {
  const srcPath = join(TEMPLATES, major, "sample.html");
  const outPath = join(TEMPLATES, major, "mustache.html");

  if (!existsSync(srcPath)) {
    console.warn(`⚠ Skipping ${major}: no sample.html found`);
    continue;
  }

  if (dryRun) {
    console.log(`[dry-run] ${major}/sample.html → ${major}/mustache.html`);
    continue;
  }

  const html = readFileSync(srcPath, "utf-8");
  const capped = html.length > 120000 ? html.slice(0, 120000) + "\n<!-- truncated -->" : html;
  const systemPrompt = promptTemplate.replace("{{EXAMPLE_HTML}}", capped);

  process.stdout.write(`Processing: ${major} … `);

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
        system:     systemPrompt,
        messages: [{ role: "user", content: "Convert the example HTML into a Mustache template per the instructions. Return valid HTML only." }]
      })
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.status);
      console.error(`API error ${res.status}: ${String(err).slice(0, 300)}`);
      continue;
    }

    const data = await res.json();
    const raw = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("")
      .replace(/^```[a-zA-Z]*\n?/m, "")
      .replace(/\n?```\s*$/m, "")
      .trim();

    if (!raw.toLowerCase().startsWith("<!doctype") && !raw.startsWith("<html")) {
      console.error(`⚠ Output doesn't look like HTML — skipping. First 200 chars:\n${raw.slice(0, 200)}`);
      continue;
    }

    writeFileSync(outPath, raw, "utf-8");
    const kb = (raw.length / 1024).toFixed(1);
    const inputTok  = data.usage?.input_tokens  ?? "?";
    const outputTok = data.usage?.output_tokens ?? "?";
    console.log(`✓ ${major}/mustache.html (${kb} KB, ${inputTok}→${outputTok} tok)`);
  } catch (e) {
    console.error(`Error: ${e.message}`);
  }

  await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
}

console.log("\nDone.");
