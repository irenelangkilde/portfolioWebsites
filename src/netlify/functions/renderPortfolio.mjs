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

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

const FIELD_ALIASES = {
  card_label: ["label", "group_name", "title", "name", "role", "degree"],
  label: ["card_label", "group_name", "title", "name", "role", "degree"],
  group_name: ["card_label", "label", "title", "name"],
  name: ["title", "label", "card_label", "role"],
  title: ["name", "label", "card_label", "role"],
  description: ["summary", "body", "about", "label"],
};

const SCALAR_FALLBACK_FIELDS = new Set([
  "label",
  "card_label",
  "group_name",
  "name",
  "title",
  "description",
  "role",
]);

function resolveFieldValue(entry, key) {
  if (!isRecord(entry)) {
    return SCALAR_FALLBACK_FIELDS.has(key) ? entry : undefined;
  }

  if (hasOwn(entry, key) && entry[key] !== undefined && entry[key] !== null) {
    return entry[key];
  }

  for (const alias of FIELD_ALIASES[key] || []) {
    if (hasOwn(entry, alias) && entry[alias] !== undefined && entry[alias] !== null) {
      return entry[alias];
    }
  }

  return undefined;
}

function valueToText(value, preferredKey = "label") {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    return value.map(item => valueToText(item, preferredKey)).filter(Boolean).join(", ");
  }
  if (!isRecord(value)) return String(value);

  const direct = resolveFieldValue(value, preferredKey);
  if (direct !== undefined && direct !== value) return valueToText(direct, preferredKey);

  for (const key of ["label", "card_label", "name", "title", "group_name", "role", "description"]) {
    if (hasOwn(value, key) && value[key] !== undefined && value[key] !== null) {
      return valueToText(value[key], preferredKey);
    }
  }

  return "";
}

function entryFromValue(value, preferredKey = "label") {
  if (isRecord(value)) return value;
  const text = valueToText(value, preferredKey);
  return {
    [preferredKey]: text,
    label: text,
    card_label: text,
    name: text,
    title: text,
    description: text,
  };
}

function normalizeLabelArray(values) {
  if (typeof values === "string") {
    values = values.split(/[•|]/).map(s => s.trim()).filter(Boolean);
  }
  if (!Array.isArray(values)) return [];
  return values
    .map(value => {
      if (isRecord(value)) {
        const label = valueToText(value, "label");
        return label ? { ...value, label } : value;
      }
      const label = String(value || "").trim();
      return label ? { label } : null;
    })
    .filter(Boolean);
}

function firstNonEmpty(...values) {
  return values.find(value => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
}

function normalizeCandidateData(candidateData = {}) {
  const d = { ...candidateData };

  d.status_badges = normalizeLabelArray(firstNonEmpty(d.status_badges, d.status_badges_inline));
  d.open_to_roles = normalizeLabelArray(firstNonEmpty(d.open_to_roles, d.open_to_items));
  d.open_to_items = normalizeLabelArray(firstNonEmpty(d.open_to_items, d.open_to_roles));
  d.work_domains = normalizeLabelArray(d.work_domains);

  const deriveArrayFlag = (flag, key) => {
    if (Array.isArray(d[key])) d[flag] = d[key].length > 0;
    else d[flag] = Boolean(d[flag]);
  };

  deriveArrayFlag("has_status_badges", "status_badges");
  deriveArrayFlag("has_open_to_roles", "open_to_roles");
  deriveArrayFlag("has_open_to_items", "open_to_items");
  deriveArrayFlag("has_work_domains", "work_domains");
  deriveArrayFlag("has_certifications", "certifications");
  deriveArrayFlag("has_publications", "publications");
  deriveArrayFlag("has_leadership", "leadership");

  d.has_projects_intro = Boolean(d.projects_intro && String(d.projects_intro).trim());
  d.has_experience_intro = Boolean(d.experience_intro && String(d.experience_intro).trim());
  d.has_open_to = Boolean(d.open_to && String(d.open_to).trim());

  return d;
}

function fieldMarkerCount($, $el) {
  const attrs = ["data-field", "data-html-field", "data-attr-href", "data-attr-src", "data-list"];
  const selfCount = attrs.some(attr => $el.attr(attr) !== undefined) ? 1 : 0;
  const descendantCount = attrs.reduce((count, attr) => count + $el.find(`[${attr}]`).length, 0);
  return selfCount + descendantCount;
}

function stripListProtocolAttrs($, $listEl) {
  $listEl.removeAttr("data-list");
  $listEl.find("[data-item]").removeAttr("data-item");
}

function listTemplateChildren($, $listEl) {
  const container = $listEl[0];
  const $all = $listEl.find("[data-item]");
  const $shallow = $all.filter((_, el) => (
    $(el).parentsUntil(container, "[data-list], [data-section]").length === 0
  ));
  return $shallow.length ? $shallow : $all;
}

function renderList($, listEl, values, { missing = "remove" } = {}) {
  const $listEl = $(listEl);

  if (!Array.isArray(values)) {
    if (values === undefined || values === null) {
      if (missing === "preserve") {
        stripListProtocolAttrs($, $listEl);
        return;
      }
      $listEl.remove();
      return;
    }
    values = [values];
  }

  if (!values.length) {
    $listEl.remove();
    return;
  }

  const $templateChildren = listTemplateChildren($, $listEl);
  const $templateChild = $templateChildren.first();
  if (!$templateChild.length) {
    $listEl.removeAttr("data-list");
    return;
  }

  const preferredField =
    $templateChild.attr("data-field") ||
    $templateChild.find("[data-field]").first().attr("data-field") ||
    "label";

  const clones = values.map(val => {
    const $clone = $templateChild.clone();
    const markers = fieldMarkerCount($, $clone);
    const entry = entryFromValue(val, preferredField);

    if (markers === 0) {
      $clone.text(valueToText(val, preferredField));
      $clone.removeAttr("data-field data-html-field data-attr-href data-attr-src data-item");
      $clone.find("[data-field], [data-html-field], [data-attr-href], [data-attr-src], [data-item]").each((_, el) => {
        $(el).removeAttr("data-field data-html-field data-attr-href data-attr-src data-item");
      });
      return $clone;
    }

    fillItem($, $clone, entry);
    return $clone;
  });

  $templateChildren.slice(1).remove();
  $templateChild.replaceWith(clones);
  $listEl.removeAttr("data-list");
}

function sectionItemNames(sectionKey) {
  const singular = sectionKey.endsWith("ies")
    ? `${sectionKey.slice(0, -3)}y`
    : sectionKey.endsWith("s")
      ? sectionKey.slice(0, -1)
      : sectionKey;

  return new Set([
    sectionKey,
    singular,
    sectionKey.replace(/_/g, "-"),
    singular.replace(/_/g, "-"),
    sectionKey === "status_badges" ? "badge" : "",
    sectionKey === "hero_cards" ? "hero_card" : "",
    sectionKey === "skill_groups" ? "skill_group" : "",
  ].filter(Boolean));
}

function sectionItemCandidates($, container, sectionKey) {
  const $container = $(container);
  let $all = $container.find("[data-item]");
  if ($container.is("[data-item]")) $all = $container.add($all);

  const $shallow = $all.filter((_, el) => (
    $(el).parentsUntil(container, "[data-section], [data-list]").length === 0
  ));

  const names = sectionItemNames(sectionKey);
  const $preferred = $shallow.filter((_, el) => names.has($(el).attr("data-item")));
  if ($preferred.length) return $preferred;
  if ($shallow.length) return $shallow;
  return $all.first();
}

function flattenedSectionList($, container, items) {
  const listKey = $(container).attr("data-list");
  if (!listKey || !Array.isArray(items)) return null;

  const values = items.flatMap(item => {
    const value = resolveFieldValue(item, listKey);
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null) return [];
    return [value];
  });

  return values.length ? values : null;
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
  const listEls = [];
  if ($item.attr("data-list")) listEls.push($item[0]);
  $item.find("[data-list]").each((_, listEl) => listEls.push(listEl));
  for (const listEl of listEls) {
    const listKey = $(listEl).attr("data-list");
    renderList($, listEl, resolveFieldValue(entry, listKey));
  }

  // Scalar/html/attr fields on $item itself
  const selfField = $item.attr("data-field");
  const selfValue = selfField ? resolveFieldValue(entry, selfField) : undefined;
  if (selfField && selfValue !== undefined) {
    $item.text(valueToText(selfValue, selfField));
    $item.removeAttr("data-field");
  }
  const selfHtmlField = $item.attr("data-html-field");
  const selfHtmlValue = selfHtmlField ? resolveFieldValue(entry, selfHtmlField) : undefined;
  if (selfHtmlField && selfHtmlValue !== undefined) {
    $item.html(String(selfHtmlValue));
    $item.removeAttr("data-html-field");
  }
  const selfHref = $item.attr("data-attr-href");
  const selfHrefValue = selfHref ? resolveFieldValue(entry, selfHref) : undefined;
  if (selfHref) {
    if (selfHrefValue) $item.attr("href", String(selfHrefValue));
    $item.removeAttr("data-attr-href");
  }
  const selfSrc = $item.attr("data-attr-src");
  const selfSrcValue = selfSrc ? resolveFieldValue(entry, selfSrc) : undefined;
  if (selfSrc) {
    if (selfSrcValue) $item.attr("src", String(selfSrcValue));
    $item.removeAttr("data-attr-src");
  }

  // Scalar/html/attr fields on descendants
  $item.find("[data-field]").each((_, el) => {
    const key = $(el).attr("data-field");
    const value = resolveFieldValue(entry, key);
    if (value !== undefined) $(el).text(valueToText(value, key));
    $(el).removeAttr("data-field");
  });

  $item.find("[data-html-field]").each((_, el) => {
    const key = $(el).attr("data-html-field");
    const value = resolveFieldValue(entry, key);
    if (value !== undefined) $(el).html(String(value));
    $(el).removeAttr("data-html-field");
  });

  $item.find("[data-attr-href]").each((_, el) => {
    const key = $(el).attr("data-attr-href");
    const value = resolveFieldValue(entry, key);
    if (value) $(el).attr("href", String(value));
    $(el).removeAttr("data-attr-href");
  });

  $item.find("[data-attr-src]").each((_, el) => {
    const key = $(el).attr("data-attr-src");
    const value = resolveFieldValue(entry, key);
    if (value) $(el).attr("src", String(value));
    $(el).removeAttr("data-attr-src");
  });

  $item.removeAttr("data-item data-section");
}

// ── Color override injection ──────────────────────────────────────────────────

// Map of colorSpec key → CSS variable name in extracted-theme (5 ordinal vars only)
const COLOR_VAR_MAP = {
  primary:    "--color-primary",
  secondary:  "--color-secondary",
  accent:     "--color-tertiary",
  tertiary:   "--color-tertiary",
  quaternary: "--color-quaternary",
  quinary:    "--color-quinary",
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
  const d = normalizeCandidateData(candidateData);

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

    if (!items || !items.length) {
      $(container).remove();
      return;
    }

    const flattenedValues = flattenedSectionList($, container, items);
    if (flattenedValues) {
      renderList($, container, flattenedValues);
      $(container).removeAttr("data-section");
      return;
    }

    const $sectionItems = sectionItemCandidates($, container, sectionKey);
    const $templateItem = $sectionItems.first();
    if (!$templateItem.length) {
      $(container).removeAttr("data-section");
      return;
    }

    const clones = items.map(entry => {
      const $clone = $templateItem.clone();
      fillItem($, $clone, entryFromValue(entry));
      return $clone;
    });

    $sectionItems.slice(1).remove();
    $templateItem.replaceWith(clones);
    $(container).removeAttr("data-section");
  });

  // ── 2.5. Top-level data-list ─────────────────────────────────────────────────
  $("[data-list]").each((_, listEl) => {
    const listKey = $(listEl).attr("data-list");
    renderList($, listEl, d[listKey], { missing: hasOwn(d, listKey) ? "remove" : "preserve" });
  });

  // ── 3. Top-level scalar fields ───────────────────────────────────────────────
  $("[data-field]").each((_, el) => {
    const key = $(el).attr("data-field");
    const value = resolveFieldValue(d, key);
    if (value !== undefined) $(el).text(valueToText(value, key));
    $(el).removeAttr("data-field");
  });

  // ── 4. Top-level HTML fields ─────────────────────────────────────────────────
  $("[data-html-field]").each((_, el) => {
    const key = $(el).attr("data-html-field");
    const value = resolveFieldValue(d, key);
    if (value !== undefined) $(el).html(String(value));
    $(el).removeAttr("data-html-field");
  });

  // ── 5. Top-level href overrides ──────────────────────────────────────────────
  $("[data-attr-href]").each((_, el) => {
    const key = $(el).attr("data-attr-href");
    const value = resolveFieldValue(d, key);
    if (value) $(el).attr("href", String(value));
    $(el).removeAttr("data-attr-href");
  });

  // ── 6. Top-level src overrides ───────────────────────────────────────────────
  $("[data-attr-src]").each((_, el) => {
    const key = $(el).attr("data-attr-src");
    const value = resolveFieldValue(d, key);
    if (value) $(el).attr("src", String(value));
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
