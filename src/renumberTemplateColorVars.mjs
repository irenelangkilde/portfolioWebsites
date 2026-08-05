/**
 * renumberTemplateColorVars.mjs
 *
 * One-time migration: renumber each template's --c-N variables so N reflects
 * DOMINANCE (count x chroma, descending) instead of dedup discovery order.
 *
 * Going forward normalizeHtml.mjs emits dominance order directly; this brings the
 * already-generated annotated.html files in line without re-running annotation.
 *
 * Purely mechanical and deterministic: no model calls, no colour VALUES change. Only
 * the numbers attached to them move, consistently across:
 *   - the #extracted-theme :root declarations  (--c-N: oklch(...))
 *   - every var(--c-N) reference, including oklch(from var(--c-N) ...) transforms
 *   - the #color-palette JSON scheme keys
 *
 * Renumbering goes through placeholder tokens so a swap (c1 -> c8, c8 -> c1) cannot
 * clobber itself mid-rewrite.
 *
 * Usage:
 *   node src/renumberTemplateColorVars.mjs            # dry run, prints the plan
 *   node src/renumberTemplateColorVars.mjs --write     # apply
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const TEMPLATES_DIR = "templates";
const TARGET_FILE = "annotated.html";
const CHROMA_FLOOR = 0.02; // keep in sync with normalizeHtml.mjs / renderPortfolio.mjs
const WRITE = process.argv.includes("--write");

function readScheme(html) {
  const m = html.match(/id=["']color-palette["'][^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]);
    return parsed?.scheme && Object.keys(parsed.scheme).length ? parsed : null;
  } catch {
    return null;
  }
}

function prominence(entry) {
  const count = Number(entry?.count) || 0;
  const chroma = Number(entry?.oklch?.c) || 0;
  return count * Math.max(chroma, CHROMA_FLOOR);
}

// old index -> new index, ranked by prominence descending. Ties keep their original
// relative order, so the result is stable across runs.
function buildIndexMap(scheme) {
  const rows = Object.entries(scheme)
    .map(([varName, entry]) => {
      const n = Number((varName.match(/^--c-(\d+)$/) || [])[1]);
      return Number.isFinite(n) ? { oldIndex: n, score: prominence(entry), hex: entry?.hex } : null;
    })
    .filter(Boolean);
  rows.sort((a, b) => (b.score - a.score) || (a.oldIndex - b.oldIndex));
  const map = new Map();
  rows.forEach((row, i) => map.set(row.oldIndex, { newIndex: i + 1, ...row }));
  return map;
}

function renumber(html, indexMap) {
  // Phase 1: every --c-N becomes a placeholder keyed by its NEW number.
  let out = html.replace(/--c-(\d+)\b/g, (match, n) => {
    const entry = indexMap.get(Number(n));
    return entry ? `--cTMP${entry.newIndex}TMP` : match;
  });
  // Phase 2: placeholders become real names.
  return out.replace(/--cTMP(\d+)TMP/g, (_, n) => `--c-${n}`);
}

// Keys should end up ascending so the JSON reads naturally and matches CSS order.
function reorderSchemeKeys(html) {
  const m = html.match(/(id=["']color-palette["'][^>]*>)([\s\S]*?)(<\/script>)/);
  if (!m) return html;
  let parsed;
  try { parsed = JSON.parse(m[2]); } catch { return html; }
  if (!parsed?.scheme) return html;
  const sorted = Object.fromEntries(
    Object.entries(parsed.scheme).sort((a, b) => {
      const na = Number((a[0].match(/^--c-(\d+)$/) || [])[1]) || 0;
      const nb = Number((b[0].match(/^--c-(\d+)$/) || [])[1]) || 0;
      return na - nb;
    })
  );
  const rebuilt = JSON.stringify({ ...parsed, scheme: sorted }, null, 2);
  return html.slice(0, m.index) + m[1] + "\n" + rebuilt + "\n" + m[3] + html.slice(m.index + m[0].length);
}

// Renumbering must preserve every (variable -> colour) pairing and the total number of
// var references. Only the numbers move.
function verify(before, after, indexMap) {
  const refCount = (s) => (s.match(/--c-\d+\b/g) || []).length;
  if (refCount(before) !== refCount(after)) {
    return `var-reference count changed: ${refCount(before)} -> ${refCount(after)}`;
  }
  const beforeScheme = readScheme(before)?.scheme || {};
  const afterScheme = readScheme(after)?.scheme || {};
  for (const [oldVar, entry] of Object.entries(beforeScheme)) {
    const n = Number((oldVar.match(/^--c-(\d+)$/) || [])[1]);
    const mapped = indexMap.get(n);
    if (!mapped) continue;
    const newVar = `--c-${mapped.newIndex}`;
    if (afterScheme[newVar]?.hex !== entry.hex) {
      return `${oldVar} (${entry.hex}) did not land on ${newVar} (got ${afterScheme[newVar]?.hex})`;
    }
  }
  return null;
}

let changed = 0;
let skipped = 0;
const failures = [];

for (const dir of readdirSync(TEMPLATES_DIR).sort()) {
  const path = join(TEMPLATES_DIR, dir, TARGET_FILE);
  if (!existsSync(path)) {
    console.log(`  ${dir.padEnd(11)} no ${TARGET_FILE} — skipped`);
    skipped++;
    continue;
  }
  const before = readFileSync(path, "utf8");
  const parsed = readScheme(before);
  if (!parsed) {
    console.log(`  ${dir.padEnd(11)} no #color-palette scheme — skipped`);
    skipped++;
    continue;
  }

  const indexMap = buildIndexMap(parsed.scheme);
  const alreadyOrdered = [...indexMap.entries()].every(([oldIndex, v]) => oldIndex === v.newIndex);
  const after = reorderSchemeKeys(renumber(before, indexMap));

  const problem = verify(before, after, indexMap);
  if (problem) {
    failures.push(`${dir}: ${problem}`);
    continue;
  }

  const moves = [...indexMap.entries()]
    .filter(([oldIndex, v]) => oldIndex !== v.newIndex)
    .map(([oldIndex, v]) => `${oldIndex}->${v.newIndex}`);
  console.log(`  ${dir.padEnd(11)} ${String(indexMap.size).padStart(2)} vars  ${alreadyOrdered ? "already dominance-ordered" : moves.join(" ")}`);

  if (!alreadyOrdered) {
    changed++;
    if (WRITE) writeFileSync(path, after);
  }
}

console.log(`\n${WRITE ? "WROTE" : "DRY RUN"} — ${changed} file(s) ${WRITE ? "rewritten" : "would change"}, ${skipped} skipped`);
if (failures.length) {
  console.log("\nVERIFICATION FAILURES (nothing written for these):");
  failures.forEach(f => console.log(`  ${f}`));
  process.exitCode = 1;
}
