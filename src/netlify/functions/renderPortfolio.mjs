/**
 * renderPortfolio.mjs
 *
 * Cheerio-based renderer: injects candidateData into an annotated HTML template
 * using the data-* attribute protocol defined in AnnotateTemplate.md.
 *
 * Usage:
 *   import { renderPortfolio } from "./renderPortfolio.mjs";
 *
 *   const html = renderPortfolio(annotatedHtml, candidateData, colorSpec);
 *
 * colorSpec (optional): { primary, secondary, accent, background, text } — hex strings.
 *   When provided, overrides the CSS custom properties from the extracted-theme block.
 */

import { load } from "cheerio";

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = (hex || "").replace("#", "").toLowerCase();
  if (h.length === 3)
    return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) };
  if (h.length === 6)
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  return null;
}

// ── Per-item fill ─────────────────────────────────────────────────────────────
// Fills all data-* attributes within $item (including $item itself) from entry.
// Removes the data-* attrs after fill so they are not re-processed by the top-level pass.

function fillItem($, $item, entry) {
  // data-if on descendants
  $item.find("[data-if]").each((_, el) => {
    const key = $(el).attr("data-if");
    if (!entry[key]) $(el).remove();
    else $(el).removeAttr("data-if");
  });

  // data-list sub-arrays (must come before data-field so we don't text-clobber the list container)
  $item.find("[data-list]").each((_, listEl) => {
    const listKey = $(listEl).attr("data-list");
    const values = entry[listKey];
    const $listEl = $(listEl);

    if (!values || !values.length) {
      $listEl.remove();
      return;
    }

    const $templateChild = $listEl.find("[data-item]").first();
    if (!$templateChild.length) {
      $listEl.removeAttr("data-list");
      return;
    }

    const clones = values.map(val => {
      const $li = $templateChild.clone().removeAttr("data-item");
      // If child itself has data-field, set that field; otherwise set text directly
      const selfField = $li.attr("data-field");
      if (selfField) {
        $li.text(String(val)).removeAttr("data-field");
      } else {
        const $inner = $li.find("[data-field]").first();
        if ($inner.length) $inner.text(String(val)).removeAttr("data-field");
        else $li.text(String(val));
      }
      return $li;
    });

    $templateChild.replaceWith(clones);
    $listEl.removeAttr("data-list");
  });

  // Scalar/html/attr fields on $item itself
  const selfField = $item.attr("data-field");
  if (selfField && entry[selfField] !== undefined) {
    $item.text(String(entry[selfField]));
    $item.removeAttr("data-field");
  }
  const selfHtmlField = $item.attr("data-html-field");
  if (selfHtmlField && entry[selfHtmlField] !== undefined) {
    $item.html(String(entry[selfHtmlField]));
    $item.removeAttr("data-html-field");
  }
  const selfHref = $item.attr("data-attr-href");
  if (selfHref) {
    if (entry[selfHref]) $item.attr("href", String(entry[selfHref]));
    $item.removeAttr("data-attr-href");
  }
  const selfSrc = $item.attr("data-attr-src");
  if (selfSrc) {
    if (entry[selfSrc]) $item.attr("src", String(entry[selfSrc]));
    $item.removeAttr("data-attr-src");
  }

  // Scalar/html/attr fields on descendants
  $item.find("[data-field]").each((_, el) => {
    const key = $(el).attr("data-field");
    if (entry[key] !== undefined) $(el).text(String(entry[key]));
    $(el).removeAttr("data-field");
  });

  $item.find("[data-html-field]").each((_, el) => {
    const key = $(el).attr("data-html-field");
    if (entry[key] !== undefined) $(el).html(String(entry[key]));
    $(el).removeAttr("data-html-field");
  });

  $item.find("[data-attr-href]").each((_, el) => {
    const key = $(el).attr("data-attr-href");
    if (entry[key]) $(el).attr("href", String(entry[key]));
    $(el).removeAttr("data-attr-href");
  });

  $item.find("[data-attr-src]").each((_, el) => {
    const key = $(el).attr("data-attr-src");
    if (entry[key]) $(el).attr("src", String(entry[key]));
    $(el).removeAttr("data-attr-src");
  });

  $item.removeAttr("data-item");
}

// ── Color override injection ──────────────────────────────────────────────────

// Map of colorSpec key → CSS variable name(s) in extracted-theme
const COLOR_VAR_MAP = {
  primary:    "--color-primary",
  secondary:  "--color-secondary",
  accent:     "--color-accent",
  background: "--color-bg",
  foreground: "--color-text",
  text:       "--color-text",  // alternate alias
};

function buildColorOverrideBlock(colorSpec) {
  const lines = [":root {"];
  const emitted = new Set();
  for (const [key, cssVar] of Object.entries(COLOR_VAR_MAP)) {
    const hex = colorSpec[key];
    if (!hex || emitted.has(cssVar)) continue;
    emitted.add(cssVar);
    const rgb = hexToRgb(hex);
    lines.push(`  ${cssVar}: ${hex};`);
    if (rgb) lines.push(`  ${cssVar}-rgb: ${rgb.r}, ${rgb.g}, ${rgb.b};`);
  }
  lines.push("}");
  return lines.join("\n");
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * @param {string}  annotatedHtml  Output of annotateTemplate pipeline.
 * @param {object}  candidateData  Output of generateCandidateContent.
 * @param {object}  [colorSpec]    Optional: { primary, secondary, accent, background, text } as hex strings.
 * @returns {string} Rendered HTML.
 */
export function renderPortfolio(annotatedHtml, candidateData, colorSpec = null) {
  const $ = load(annotatedHtml, { decodeEntities: false });
  const d = candidateData;

  // ── 1. data-if — remove conditionally absent elements ──────────────────────
  $("[data-if]").each((_, el) => {
    const key = $(el).attr("data-if");
    if (!d[key]) $(el).remove();
    else $(el).removeAttr("data-if");
  });

  // ── 2. data-section — repeating sections ────────────────────────────────────
  $("[data-section]").each((_, container) => {
    const sectionKey = $(container).attr("data-section");
    const items = d[sectionKey];

    // Find the representative child (first [data-item] that is a direct or
    // shallow child, not nested inside another [data-section])
    const $templateItem = $(container).find("[data-item]").first();
    if (!$templateItem.length) return;

    if (!items || !items.length) {
      $(container).remove();
      return;
    }

    const clones = items.map(entry => {
      const $clone = $templateItem.clone();
      fillItem($, $clone, typeof entry === "object" && entry !== null ? entry : { label: String(entry) });
      return $clone;
    });

    $templateItem.replaceWith(clones);
    $(container).removeAttr("data-section");
  });

  // ── 3. Top-level scalar fields ───────────────────────────────────────────────
  $("[data-field]").each((_, el) => {
    const key = $(el).attr("data-field");
    if (d[key] !== undefined) $(el).text(String(d[key]));
    $(el).removeAttr("data-field");
  });

  // ── 4. Top-level HTML fields ─────────────────────────────────────────────────
  $("[data-html-field]").each((_, el) => {
    const key = $(el).attr("data-html-field");
    if (d[key] !== undefined) $(el).html(String(d[key]));
    $(el).removeAttr("data-html-field");
  });

  // ── 5. Top-level href overrides ──────────────────────────────────────────────
  $("[data-attr-href]").each((_, el) => {
    const key = $(el).attr("data-attr-href");
    if (d[key]) $(el).attr("href", String(d[key]));
    $(el).removeAttr("data-attr-href");
  });

  // ── 6. Top-level src overrides ───────────────────────────────────────────────
  $("[data-attr-src]").each((_, el) => {
    const key = $(el).attr("data-attr-src");
    if (d[key]) $(el).attr("src", String(d[key]));
    $(el).removeAttr("data-attr-src");
  });

  // ── 7. Color override ────────────────────────────────────────────────────────
  if (colorSpec && Object.values(colorSpec).some(Boolean)) {
    const overrideCss = buildColorOverrideBlock(colorSpec);
    const overrideTag = `<style id="color-override">\n${overrideCss}\n</style>`;
    if ($("head").length) {
      $("head").append(overrideTag);
    } else {
      $.root().prepend(overrideTag);
    }
  }

  return $.html();
}
