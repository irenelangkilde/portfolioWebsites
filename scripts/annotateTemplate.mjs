#!/usr/bin/env node
/**
 * Annotates templates/<major>/normalized.html with data-* attributes
 * so the cheerio renderer can inject candidate data at build time.
 *
 * Output: templates/<major>/annotated.html
 *
 * Works on any portfolio HTML file — no mustache.html required.
 * The prompt (AnnotateTemplate.md) identifies candidate-specific content
 * semantically from the HTML itself.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node scripts/annotateTemplate.mjs [major1 major2 ...]
 *
 * With no arguments, processes all templates/* that have a normalized.html.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname  = dirname(fileURLToPath(import.meta.url));
const ROOT       = join(__dirname, "..");
const TEMPLATES  = join(ROOT, "templates");
const PROMPT_PATH = join(ROOT, "src/netlify/functions/AnnotateTemplate.md");
const MODEL      = "claude-sonnet-4-6";
const MAX_TOKENS = 32000;
const RATE_LIMIT_MS = 5000;

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error("Error: ANTHROPIC_API_KEY is not set."); process.exit(1); }

const promptTemplate = readFileSync(PROMPT_PATH, "utf-8");
const dryRun    = process.argv.includes("--dry-run");
const requested = process.argv.slice(2).filter(a => !a.startsWith("--"));

const majors = requested.length > 0
  ? requested
  : readdirSync(TEMPLATES)
      .filter(f => statSync(join(TEMPLATES, f)).isDirectory())
      .filter(f => existsSync(join(TEMPLATES, f, "normalized.html")))
      .sort();

console.log(`Annotating ${majors.length} template(s): ${majors.join(", ")}${dryRun ? " [dry-run]" : ""}\n`);

for (const major of majors) {
  const srcPath = join(TEMPLATES, major, "normalized.html");
  const outPath = join(TEMPLATES, major, "annotated.html");

  if (dryRun) {
    console.log(`[dry-run] ${major}/normalized.html → annotated.html`);
    continue;
  }

  const html   = readFileSync(srcPath, "utf-8");
  const capped = html.length > 120000 ? html.slice(0, 120000) + "\n<!-- truncated -->" : html;
  const prompt = promptTemplate.replace("{{NORMALIZED_HTML}}", capped);

  process.stdout.write(`Annotating: ${major} … `);

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
        system:     "You are a web template engineer. Add data-* attributes to the HTML per the instructions. Output only the annotated HTML. No markdown fences. No explanation.",
        messages:   [{ role: "user", content: prompt }]
      })
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.status);
      console.error(`API error ${res.status}: ${String(err).slice(0, 200)}`);
      continue;
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
      console.error(`⚠ Output doesn't look like HTML — skipping.\nFirst 200 chars: ${annotated.slice(0, 200)}`);
      continue;
    }

    const fieldCount   = (annotated.match(/data-field=/g)   || []).length;
    const sectionCount = (annotated.match(/data-section=/g) || []).length;
    const listCount    = (annotated.match(/data-list=/g)     || []).length;

    writeFileSync(outPath, annotated, "utf-8");
    const kb = (annotated.length / 1024).toFixed(1);
    console.log(`✓ ${major}/annotated.html (${kb} KB, ${data.usage?.input_tokens}→${data.usage?.output_tokens} tok, ${fieldCount} fields, ${sectionCount} sections, ${listCount} lists)`);
  } catch (e) {
    console.error(`Error: ${e.message}`);
  }

  await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
}

console.log("\nDone.");
