#!/usr/bin/env node
/**
 * batchColorize.mjs
 *
 * Runs the color extractor on all *Grad.html, *Grad_B.html, *Grad_C.html
 * files in html/ and writes html/colorized/<name>_5colorized.html for each.
 *
 * Each output embeds two blocks inside <head>:
 *   <style id="extracted-theme">          CSS custom properties
 *   <script type="application/json" id="color-palette">  palette metadata
 *
 * Usage:
 *   node src/batchColorize.mjs [--min-separation=<float>] [--force]
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import { resolve, join } from "path";
import { fileURLToPath } from "url";

import {
  extractRegex, dedup, autoFit, assignRoles, invertRoles, buildCss, buildJson,
} from "./extractHtmlColors/extractColors.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT      = resolve(__dirname, "..");
const HTML_DIR  = join(ROOT, "html");
const OUT_DIR   = join(ROOT, "html", "colorized");

const args   = process.argv.slice(2);
const sepArg = args.find(a => a.startsWith("--min-separation="));
const minSep = sepArg ? parseFloat(sepArg.split("=")[1]) : 1.5;
const force  = args.includes("--force");

mkdirSync(OUT_DIR, { recursive: true });

const TARGET = /Grad\.html$|Grad_[BC]\.html$/;

const files = readdirSync(HTML_DIR)
  .filter(f => TARGET.test(f))
  .sort();

console.log(`Found ${files.length} target files  (min-separation=${minSep})\n`);

let passed = 0, skipped = 0, failed = 0;

for (const filename of files) {
  const srcPath = join(HTML_DIR, filename);
  const outName = filename.replace(/\.html$/, "_5colorized.html");
  const outPath = join(OUT_DIR, outName);

  process.stdout.write(`  ${filename.padEnd(48)}`);

  if (!force && existsSync(outPath)) {
    console.log(`— skipped (already exists)`);
    skipped++;
    continue;
  }

  try {
    const html           = readFileSync(srcPath, "utf-8");
    const { counts }          = extractRegex(html);
    const allCandidates       = dedup(counts);
    const fit                 = autoFit(allCandidates, minSep);
    const { clusters, achromatic, confidence } = fit;
    const k                   = fit.k;
    const roles               = assignRoles(clusters, achromatic);
    const inverted       = invertRoles(roles);
    const meta           = { k, confidence, threshold: minSep };

    const injection = [
      `<style id="extracted-theme">`,
      buildCss(roles, inverted),
      `</style>`,
      `<script type="application/json" id="color-palette">`,
      buildJson(clusters, roles, inverted, meta),
      `</script>`,
    ].join("\n");

    let out;
    if (html.includes("</head>")) {
      out = html.replace("</head>", `${injection}\n</head>`);
    } else if (/<body/i.test(html)) {
      out = html.replace(/<body[^>]*>/i, m => `${injection}\n${m}`);
    } else {
      out = injection + "\n" + html;
    }

    writeFileSync(outPath, out, "utf-8");

    const warn = confidence < minSep ? "  ⚠ low-confidence" : "";
    console.log(`✓  k=${k} conf=${confidence}${warn}`);
    passed++;
  } catch (err) {
    console.log(`✗  ${err.message}`);
    failed++;
  }
}

console.log(`\n${passed} written, ${skipped} skipped, ${failed} failed`);
console.log(`→ ${OUT_DIR}`);
