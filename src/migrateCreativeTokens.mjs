/**
 * migrateCreativeTokens.mjs
 *
 * One-time migration: updates existing *_mustache.html files to include
 * the creative content tokens introduced by the slot-fill pipeline.
 *
 * Changes per file:
 *   1. Replace first <h2> text inside id="projects" section → {{projects_section_title}}
 *   2. Replace first <h2> text inside id="skills"   section → {{skills_section_title}}
 *   3. Replace first <h2> text inside id="experience" section → {{experience_section_title}}
 *   4. Replace first <h2> text inside id="contact"  section → {{contact_section_title}}
 *   5. Replace first <h2> text inside id="about"    section → {{about_section_title}}
 *   6. Insert {{#has_projects_intro}} bridge after h2 in projects section
 *   7. Insert {{#has_experience_intro}} bridge after h2 in experience section
 *   8. Replace {{about}} with {{about_full}} inside the about section
 *   9. Add {{#cta_tagline}} block after <footer> (if not already present)
 *  10. Add has_about field to the metadata comment
 *
 * Usage:
 *   node src/migrateCreativeTokens.mjs [--dry-run] [--file=<name>]
 */

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { resolve, join, basename } from "path";
import { fileURLToPath } from "url";

const __dir = fileURLToPath(new URL(".", import.meta.url));
const HTML_DIR = resolve(__dir, "../html");

const DRY_RUN = process.argv.includes("--dry-run");
const ONLY_FILE = process.argv.find(a => a.startsWith("--file="))?.slice(7);

const SECTION_TOKENS = {
  projects:   "{{projects_section_title}}",
  skills:     "{{skills_section_title}}",
  experience: "{{experience_section_title}}",
  contact:    "{{contact_section_title}}",
  about:      "{{about_section_title}}",
};

const BRIDGE_AFTER_H2 = {
  projects:
    '\n{{#has_projects_intro}}<p class="section-intro">{{projects_intro}}</p>{{/has_projects_intro}}',
  experience:
    '\n{{#has_experience_intro}}<p class="section-intro">{{experience_intro}}</p>{{/has_experience_intro}}',
};

const CTA_BLOCK =
  "\n{{#cta_tagline}}<p class=\"footer-tagline\">{{cta_tagline}}</p>{{/cta_tagline}}";

// ---------------------------------------------------------------------------
// DOM-lite section finder
// ---------------------------------------------------------------------------

/**
 * Returns { start, end } byte offsets of the outermost <section> with the
 * given id (or fallback class pattern), including its closing </section>.
 * Returns null if not found.
 */
function getSectionBounds(html, sectionId) {
  // Primary: id="SECTIONID"
  let re = new RegExp(`<section\\b[^>]*\\bid=["']${sectionId}["'][^>]*>`, "i");
  let m = re.exec(html);

  if (!m) {
    // Fallback: class="SECTIONID-section" (e.g. statisticsGrad)
    re = new RegExp(
      `<section\\b[^>]*\\bclass=["'][^"']*\\b${sectionId}-section\\b[^"']*["'][^>]*>`,
      "i"
    );
    m = re.exec(html);
  }

  if (!m) return null;

  const start = m.index;
  let pos = start + m[0].length;
  let depth = 1;

  while (pos < html.length && depth > 0) {
    const nextOpen  = html.indexOf("<section", pos);
    const nextClose = html.indexOf("</section>", pos);

    if (nextClose === -1) break;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + 8;
    } else {
      depth--;
      if (depth === 0) {
        return { start, end: nextClose + 10 };
      }
      pos = nextClose + 10;
    }
  }
  return null;
}

function withSection(html, sectionId, fn) {
  const bounds = getSectionBounds(html, sectionId);
  if (!bounds) return { html, changed: false };
  const sectionHtml = html.slice(bounds.start, bounds.end);
  const result = fn(sectionHtml);
  if (!result.changed) return { html, changed: false };
  return {
    html: html.slice(0, bounds.start) + result.sectionHtml + html.slice(bounds.end),
    changed: true,
  };
}

// ---------------------------------------------------------------------------
// Individual transforms
// ---------------------------------------------------------------------------

/** Replace the inner text of the first <h2> in a section chunk. */
function replaceH2Text(sectionHtml, token) {
  const re = /(<h2\b[^>]*>)([\s\S]*?)(<\/h2>)/i;
  const m = re.exec(sectionHtml);
  if (!m) return { sectionHtml, changed: false };
  // Skip if already tokenized
  if (m[2].trim().startsWith("{{")) return { sectionHtml, changed: false };
  const newHtml = sectionHtml.slice(0, m.index) + m[1] + token + m[3] +
    sectionHtml.slice(m.index + m[0].length);
  return { sectionHtml: newHtml, changed: true };
}

/** Insert bridge copy immediately after the closing </h2> of the first h2. */
function insertBridgeAfterH2(sectionHtml, bridge) {
  if (sectionHtml.includes("has_projects_intro") || sectionHtml.includes("has_experience_intro")) {
    return { sectionHtml, changed: false };
  }
  const re = /(<h2\b[^>]*>[\s\S]*?<\/h2>)/i;
  const m = re.exec(sectionHtml);
  if (!m) return { sectionHtml, changed: false };
  const insertAt = m.index + m[0].length;
  const newHtml = sectionHtml.slice(0, insertAt) + bridge + sectionHtml.slice(insertAt);
  return { sectionHtml: newHtml, changed: true };
}

/** Within the about section, replace {{about}} → {{about_full}}. */
function replaceAboutFull(sectionHtml) {
  if (!sectionHtml.includes("{{about}}")) return { sectionHtml, changed: false };
  const newHtml = sectionHtml.replace(/\{\{about\}\}/g, "{{about_full}}");
  return { sectionHtml: newHtml, changed: newHtml !== sectionHtml };
}

/** Add {{#cta_tagline}} block after opening <footer> tag. */
function addCtaTagline(html) {
  if (html.includes("{{cta_tagline}}")) return { html, changed: false };
  const re = /(<footer\b[^>]*>)/i;
  const m = re.exec(html);
  if (!m) return { html, changed: false };
  const insertAt = m.index + m[0].length;
  const newHtml = html.slice(0, insertAt) + CTA_BLOCK + html.slice(insertAt);
  return { html: newHtml, changed: true };
}

/** Add or update `has_about` in the metadata JSON comment in <head>. */
function patchMetadataComment(html, hasAbout) {
  // Matches: <!-- { ... } --> as the first thing inside <head>
  const re = /(<meta\s[^>]*charset[^>]*>\s*)(<!--\s*(\{[\s\S]*?\})\s*-->)/i;
  const m = re.exec(html);
  if (!m) return { html, changed: false };

  let meta;
  try { meta = JSON.parse(m[3]); } catch { return { html, changed: false }; }

  if (meta.has_about === hasAbout) return { html, changed: false };

  meta.has_about = hasAbout;
  const newComment = `<!-- ${JSON.stringify(meta)} -->`;
  const newHtml = html.slice(0, m.index + m[1].length) + newComment + html.slice(m.index + m[1].length + m[2].length);
  return { html: newHtml, changed: true };
}

// ---------------------------------------------------------------------------
// Main per-file transform
// ---------------------------------------------------------------------------

function migrateFile(filePath) {
  let html = readFileSync(filePath, "utf-8");
  const name = basename(filePath);
  const changes = [];

  // 1–5: Replace section h2 texts
  for (const [sectionId, token] of Object.entries(SECTION_TOKENS)) {
    const r = withSection(html, sectionId, s => replaceH2Text(s, token));
    if (r.changed) { html = r.html; changes.push(`h2 → ${token} (${sectionId})`); }
  }

  // 6–7: Insert bridge copy
  for (const [sectionId, bridge] of Object.entries(BRIDGE_AFTER_H2)) {
    const r = withSection(html, sectionId, s => insertBridgeAfterH2(s, bridge));
    if (r.changed) { html = r.html; changes.push(`bridge added (${sectionId})`); }
  }

  // 8: {{about}} → {{about_full}} inside about section
  const aboutBounds = getSectionBounds(html, "about");
  const hasAbout = !!aboutBounds;
  if (hasAbout) {
    const r = withSection(html, "about", replaceAboutFull);
    if (r.changed) { html = r.html; changes.push("{{about}} → {{about_full}} (about section)"); }
  }

  // 9: {{cta_tagline}} in footer
  const ctaResult = addCtaTagline(html);
  if (ctaResult.changed) { html = ctaResult.html; changes.push("{{cta_tagline}} added to footer"); }

  // 10: has_about in metadata comment
  const metaResult = patchMetadataComment(html, hasAbout);
  if (metaResult.changed) { html = metaResult.html; changes.push(`has_about: ${hasAbout}`); }

  return { html, changes };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const files = readdirSync(HTML_DIR)
  .filter(f => f.endsWith("_mustache.html"))
  .filter(f => !ONLY_FILE || f === ONLY_FILE || f === `${ONLY_FILE}_mustache.html`)
  .map(f => join(HTML_DIR, f));

if (files.length === 0) {
  console.error("No matching mustache files found.");
  process.exit(1);
}

let totalChanged = 0;

for (const filePath of files) {
  const name = basename(filePath);
  const { html, changes } = migrateFile(filePath);

  if (changes.length === 0) {
    console.log(`  ✓ ${name} (no changes needed)`);
    continue;
  }

  if (!DRY_RUN) {
    writeFileSync(filePath, html, "utf-8");
  }

  totalChanged++;
  const prefix = DRY_RUN ? "[dry-run] " : "";
  console.log(`  ${prefix}${name}:`);
  for (const c of changes) console.log(`    • ${c}`);
}

console.log(`\n${DRY_RUN ? "[dry-run] " : ""}${totalChanged} file(s) updated.`);
