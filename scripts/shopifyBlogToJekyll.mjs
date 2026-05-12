#!/usr/bin/env node
/**
 * Converts a Shopify blog CSV export to Jekyll Markdown posts.
 *
 * Usage:
 *   node scripts/shopifyBlogToJekyll.mjs "path/to/Blog Posts.csv"
 *
 * Options:
 *   --out <dir>   Output directory (default: ../my-awesome-site/_posts)
 *   --dry-run     Print what would be created without writing files
 *
 * Notes:
 * - Shopify's export doesn't include publish dates. The script tries to
 *   infer the date from content (e.g. "January 29th, 2026"); otherwise
 *   falls back to today. Edit front-matter dates in generated files if needed.
 * - HTML content is included as-is — Jekyll renders inline HTML in .md files.
 * - Gemini/ChatGPT UI artefacts (data-* attrs, empty comment runs) are stripped.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = join(__dirname, "../blog/_posts");

const args     = process.argv.slice(2);
const dryRun   = args.includes("--dry-run");
const outIdx   = args.indexOf("--out");
const outDir   = outIdx !== -1 ? args[outIdx + 1] : DEFAULT_OUT;
const csvPath  = args.find(a => !a.startsWith("--") && (outIdx === -1 || a !== args[outIdx + 1]));

if (!csvPath) {
  console.error('Usage: node scripts/shopifyBlogToJekyll.mjs "path/to/Blog Posts.csv" [--out dir] [--dry-run]');
  process.exit(1);
}

// ─── RFC 4180 CSV parser ──────────────────────────────────────────────────────

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch   = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"')            { inQuotes = false; }
      else                            { field += ch; }
    } else {
      if      (ch === '"')  { inQuotes = true; }
      else if (ch === ',')  { row.push(field); field = ""; }
      else if (ch === '\n' || ch === '\r') {
        // Handle \r\n as a single terminator
        if (ch === '\r' && next === '\n') i++;
        row.push(field); field = "";
        if (row.some(f => f.trim())) rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
  }
  if (field || row.length) { row.push(field); if (row.some(f => f.trim())) rows.push(row); }
  return rows;
}

// ─── Date inference ───────────────────────────────────────────────────────────

const MONTHS = {
  january:1, february:2, march:3,    april:4,  may:5,     june:6,
  july:7,    august:8,   september:9, october:10, november:11, december:12,
};
const TODAY = new Date().toISOString().slice(0, 10);

function inferDate(html) {
  const m = html.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/i
  );
  if (!m) return null;
  const mm = String(MONTHS[m[1].toLowerCase()]).padStart(2, "0");
  const dd = String(parseInt(m[2])).padStart(2, "0");
  return `${m[3]}-${mm}-${dd}`;
}

// ─── HTML cleanup ─────────────────────────────────────────────────────────────

function cleanHtml(html) {
  return html
    // Strip data-* attributes (Gemini/AI UI artefacts)
    .replace(/\s+data-[a-z][a-z0-9-]*(?:="[^"]*")?/gi, "")
    // Strip class attributes on inline elements that are AI UI artefacts
    .replace(/\s+class="(?:citation[^"]*|superscript|source-inline-chip-container[^"]*|button[^"]*|attachment-container[^"]*|white-space-pre[^"]*|markdown[^"]*|ember-view[^"]*)"/g, "")
    // Strip empty HTML comment runs (Gemini skeleton comments)
    .replace(/(?:<!---->\s*){3,}/g, "")
    .replace(/<!---->/g, "")
    // Strip <meta charset...> that leaked into body
    .replace(/<meta\s+charset="[^"]*">/gi, "")
    // Strip source-inline-chip and button containers entirely
    .replace(/<div class="source-inline-chip-container[^"]*">[\s\S]*?<\/div>/gi, "")
    .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, "")
    // Collapse 3+ consecutive blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── YAML value escaping ──────────────────────────────────────────────────────

function yamlStr(s) {
  if (!s) return '""';
  // Use double-quoted YAML string; escape backslashes and double-quotes
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const raw  = readFileSync(csvPath, "utf-8");
const rows = parseCSV(raw);

if (rows.length < 2) { console.error("CSV appears empty or unparseable."); process.exit(1); }

// Build header→index map (case-insensitive)
const headers = rows[0].map(h => h.trim().toLowerCase());
const col = name => headers.indexOf(name.toLowerCase());

const COL = {
  title:       col("title"),
  handle:      col("handle"),
  content:     col("content"),
  author:      col("author"),
  tags:        col("tags"),
  seoTitle:    col("seo page title"),
  seoDesc:     col("seo meta description"),
};

if (COL.title === -1 || COL.handle === -1 || COL.content === -1) {
  console.error("Could not find Title, Handle, or Content columns. Check CSV format.");
  process.exit(1);
}

if (!dryRun) mkdirSync(outDir, { recursive: true });

console.log(`Converting ${rows.length - 1} post(s) → ${outDir}${dryRun ? " [dry-run]" : ""}\n`);

let created = 0;
for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  const get = c => (c !== -1 ? row[c] || "" : "").trim();

  const title   = get(COL.title);
  const handle  = get(COL.handle);
  const rawHtml = get(COL.content);
  const author  = get(COL.author);
  const tags    = get(COL.tags).split(",").map(t => t.trim()).filter(Boolean);
  const seoTitle = get(COL.seoTitle);
  const seoDesc  = get(COL.seoDesc);

  if (!handle || !title) { console.warn(`⚠ Row ${i + 1}: missing title or handle — skipped`); continue; }

  const date    = inferDate(rawHtml) || TODAY;
  const slug    = handle.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const outFile = join(outDir, `${date}-${slug}.md`);
  const content = cleanHtml(rawHtml);

  const tagsYaml  = tags.length ? `\ntags: [${tags.map(yamlStr).join(", ")}]` : "";
  const seoBlock  = (seoTitle || seoDesc)
    ? `\nseo_title: ${yamlStr(seoTitle || title)}\ndescription: ${yamlStr(seoDesc)}`
    : "";

  const frontMatter = [
    "---",
    `layout: post`,
    `title: ${yamlStr(title)}`,
    `date: ${date}`,
    `author: ${yamlStr(author || "Irene Langkilde")}`,
    tagsYaml,
    seoBlock,
    "---",
  ].join("\n").replace(/\n{2,}/g, "\n");

  const md = `${frontMatter}\n\n${content}\n`;

  if (dryRun) {
    console.log(`[dry-run] ${date}-${slug}.md  (${(md.length / 1024).toFixed(1)} KB, date inferred: ${inferDate(rawHtml) ? "yes" : "no — using today"})`);
  } else {
    writeFileSync(outFile, md, "utf-8");
    console.log(`✓ ${date}-${slug}.md  (${(md.length / 1024).toFixed(1)} KB${inferDate(rawHtml) ? "" : " — date: today, update if needed"})`);
    created++;
  }
}

console.log(`\n${dryRun ? "Would create" : "Created"} ${dryRun ? rows.length - 1 : created} file(s) in ${outDir}`);
