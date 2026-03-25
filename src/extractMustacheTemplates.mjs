#!/usr/bin/env node
/**
 * extractMustacheTemplates.mjs
 *
 * For each file in html/ matching .*Grad\.html or .*Grad_.\.html,
 * calls Claude with the instructions in ExtractMustacheTemplate.md
 * and saves the result as <basename>_mustache.html in the same directory.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node extractMustacheTemplates.mjs
 *
 * Options:
 *   --dry-run   Print matched files without calling the API
 *   --force     Re-process files whose _mustache.html already exists
 */

import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";

// ── Config ────────────────────────────────────────────────────────────────────

const HTML_DIR     = new URL("../html/", import.meta.url).pathname;
const PROMPT_FILE  = new URL(
  "netlify/functions/ExtractMustacheTemplate.md",
  import.meta.url
).pathname;
const MODEL        = "claude-sonnet-4-6";
const MAX_TOKENS   = 16000;

const PATTERNS = [
  /^.*Grad\.html$/,      // e.g. accountingGrad.html
  /^.*Grad_.\.html$/,    // e.g. biologyGrad_B.html  (single char after underscore)
];

// ── CLI flags ─────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const FORCE   = args.includes("--force");

// ── Helpers ───────────────────────────────────────────────────────────────────

function matchesPattern(filename) {
  return PATTERNS.some(re => re.test(filename));
}

function outputPath(inputPath) {
  const dir  = path.dirname(inputPath);
  const base = path.basename(inputPath, ".html");
  return path.join(dir, `${base}_mustache.html`);
}

async function processFile(client, promptTemplate, filePath) {
  const html    = fs.readFileSync(filePath, "utf8");
  const outPath = outputPath(filePath);

  if (!FORCE && fs.existsSync(outPath)) {
    console.log(`  ⏭  skipping (already exists): ${path.basename(outPath)}`);
    return;
  }

  console.log(`  🔄 processing ${path.basename(filePath)} …`);

  // Substitute {{EXAMPLE_HTML}} in the prompt, then send a short user message
  const systemPrompt = promptTemplate.replace("{{EXAMPLE_HTML}}", html);

  const message = await client.messages.create({
    model:      MODEL,
    max_tokens: MAX_TOKENS,
    system:     systemPrompt,
    messages: [
      {
        role:    "user",
        content: "Convert the example HTML into a Mustache template per the instructions. Return valid HTML only.",
      },
    ],
  });

  const outputHtml = message.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("")
    // Strip markdown fences if the model wraps output despite instructions
    .replace(/^```[a-zA-Z]*\n?/m, "")
    .replace(/\n?```\s*$/m, "")
    .trim();

  fs.writeFileSync(outPath, outputHtml, "utf8");
  console.log(`  ✅ saved → ${path.basename(outPath)}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const promptTemplate = fs.readFileSync(PROMPT_FILE, "utf8");

  // If a filename is provided as a positional argument, process only that file
  const fileArg = args.find(arg => !arg.startsWith("--"));
  let matched;
  if (fileArg) {
    const filePath = path.isAbsolute(fileArg) ? fileArg : path.join(HTML_DIR, fileArg);
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    if (!matchesPattern(path.basename(filePath))) {
      console.error(`File does not match required pattern: ${filePath}`);
      process.exit(1);
    }
    matched = [filePath];
  } else {
    const allFiles = fs.readdirSync(HTML_DIR);
    matched = allFiles
      .filter(matchesPattern)
      .map(f => path.join(HTML_DIR, f))
      .sort();
  }

  if (matched.length === 0) {
    console.log("No matching files found.");
    return;
  }

  console.log(`Found ${matched.length} file(s) to process:\n`);
  matched.forEach(f => console.log(`  • ${path.basename(f)}`));
  console.log();

  if (DRY_RUN) {
    console.log("Dry run — exiting without calling the API.");
    return;
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  for (const filePath of matched) {
    await processFile(client, promptTemplate, filePath);
  }

  console.log("\nDone.");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
