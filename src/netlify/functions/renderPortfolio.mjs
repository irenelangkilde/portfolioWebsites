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

const RESUME_DRIVEN_SECTIONS = new Set([
  "education",
  "experience",
  "skill_groups",
  "projects",
  "certifications",
  "publications",
  "leadership",
  "volunteer",
  "extracurricular",
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

function isAboutContext($el) {
  let $cur = $el;
  while ($cur?.length) {
    const id = String($cur.attr("id") || "").toLowerCase();
    const cls = String($cur.attr("class") || "").toLowerCase();
    const aria = `${$cur.attr("aria-label") || ""} ${$cur.attr("aria-labelledby") || ""}`.toLowerCase();
    if (
      id === "about" ||
      /\babout\b/.test(cls) ||
      /\babout\b/.test(aria)
    ) return true;
    const tag = String($cur[0]?.tagName || $cur[0]?.name || "").toLowerCase();
    if (tag === "body" || tag === "html") break;
    $cur = $cur.parent();
  }
  return false;
}

function resolveFieldValueForElement(entry, key, $el) {
  const cls = String($el.attr("class") || "").toLowerCase();
  const wordTarget = dataWordCount($el);
  const aboutSubtitleLike = key === "subheadline" ||
    (key === "value_proposition" && (
      (wordTarget > 0 && wordTarget <= 20) ||
      /\b(section-subtitle|subhead|subtitle|kicker)\b/.test(cls)
    ));

  if (aboutSubtitleLike && isAboutContext($el)) {
    const aboutSubheadline = resolveFieldValue(entry, "about_section_subheadline");
    if (aboutSubheadline !== undefined && aboutSubheadline !== null && String(aboutSubheadline).trim()) {
      return aboutSubheadline;
    }
  }
  return resolveFieldValue(entry, key);
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

function wordCount(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).length;
}

function dataWordCount($el) {
  const target = parseInt($el.attr("data-word-count") || "", 10);
  return Number.isFinite(target) && target > 0 ? target : 0;
}

function shouldEnforceShortWordCount($el, preferredKey = "") {
  const key = String(preferredKey || "").trim();
  if (key === "headline" || key === "subheadline" || key === "about") return true;
  return Boolean($el.closest(".hero, [data-section='hero_cards'], [data-item='hero_card']").length);
}

function splitSentences(value) {
  return String(value || "")
    .match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g)
    ?.map(sentence => sentence.trim())
    .filter(Boolean) || [];
}

function constrainTextToWordCount(value, targetWords, { enforceShort = false } = {}) {
  const text = String(value ?? "").trim();
  if (!text || !targetWords) return value;
  if (targetWords < 8 && !enforceShort) return value;
  const allowedWords = targetWords < 8 ? targetWords : targetWords * 1.35;
  if (wordCount(text) <= allowedWords) return value;

  const normalized = text.replace(/\s+/g, " ");
  const sentences = splitSentences(normalized);
  let result = "";
  let count = 0;

  for (const sentence of sentences.length ? sentences : [normalized]) {
    const sentenceWords = sentence.trim().split(/\s+/).filter(Boolean);
    if (!sentenceWords.length) continue;
    if (!result && sentenceWords.length > targetWords * 1.35) {
      return sentenceWords.slice(0, targetWords).join(" ") + "...";
    }
    if (result && count + sentenceWords.length > targetWords * 1.25) break;
    result += (result ? " " : "") + sentence.trim();
    count += sentenceWords.length;
    if (count >= targetWords * 0.85) break;
  }

  if (result) return result;
  return normalized.split(/\s+/).slice(0, targetWords).join(" ") + "...";
}

function constrainFieldText($el, value, preferredKey) {
  const text = valueToText(value, preferredKey);
  return constrainTextToWordCount(text, dataWordCount($el), {
    enforceShort: shouldEnforceShortWordCount($el, preferredKey)
  });
}

function constrainHtmlField($el, value) {
  const html = String(value ?? "");
  if (/<(?!br\s*\/?>)[a-z][\s\S]*>/i.test(html)) return html;
  return constrainTextToWordCount(html, dataWordCount($el));
}

function splitAboutParagraphs(value) {
  const text = String(value || "")
    .replace(/\r/g, "")
    .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .trim();
  if (!text) return [];

  const explicit = text.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
  if (explicit.length > 1) return explicit;

  const sentences = splitSentences(text);
  if (wordCount(text) < 70 || sentences.length < 4) return [text];

  const targetCount = sentences.length >= 6 ? 3 : 2;
  const perParagraph = Math.ceil(sentences.length / targetCount);
  const paragraphs = [];
  for (let i = 0; i < sentences.length; i += perParagraph) {
    paragraphs.push(sentences.slice(i, i + perParagraph).join(" "));
  }
  return paragraphs.filter(Boolean);
}

function copySafeAttrs($from, $to) {
  for (const attr of ["class", "style"]) {
    const value = $from.attr(attr);
    if (value !== undefined) $to.attr(attr, value);
  }
}

function renderAboutFullField($, $el, value) {
  const raw = String(value ?? "").trim();
  if (/<(?!br\s*\/?>)[a-z][\s\S]*>/i.test(raw)) {
    if ($el.is("p") && /<\/?(?:p|div|ul|ol|section|article)\b/i.test(raw)) $el.replaceWith(raw);
    else $el.html(raw);
    $el.removeAttr("data-html-field");
    return;
  }

  const paragraphs = splitAboutParagraphs(raw);
  if (!paragraphs.length) {
    $el.empty();
    $el.removeAttr("data-html-field");
    return;
  }

  if ($el.is("p")) {
    const nodes = paragraphs.map(paragraph => {
      const $p = $("<p></p>").text(paragraph);
      copySafeAttrs($el, $p);
      return $p;
    });
    $el.replaceWith(nodes);
    return;
  }

  $el.empty();
  paragraphs.forEach(paragraph => {
    $el.append($("<p></p>").text(paragraph));
  });
  $el.removeAttr("data-html-field");
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

function nearestSectionKey($, $el) {
  const self = $el.attr("data-section");
  if (self) return self;
  const parent = $el.parents("[data-section]").first();
  return parent.length ? parent.attr("data-section") : "";
}

function shouldMimicTemplateShape($, $el, sectionKeyOverride = "") {
  const sectionKey = sectionKeyOverride || nearestSectionKey($, $el);
  return !RESUME_DRIVEN_SECTIONS.has(sectionKey);
}

function renderList($, listEl, values, { missing = "remove", sectionKey = "" } = {}) {
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
  if (shouldMimicTemplateShape($, $listEl, sectionKey) && $templateChildren.length > 1) {
    values = values.slice(0, $templateChildren.length);
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
      $clone.text(constrainTextToWordCount(valueToText(val, preferredField), dataWordCount($clone)));
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

function labelValues(values) {
  return normalizeLabelArray(values).map(value => valueToText(value, "label")).filter(Boolean);
}

function copyPresentationAttrs($from, $to) {
  for (const attr of ["class", "style"]) {
    const value = $from.attr(attr);
    if (value !== undefined) $to.attr(attr, value);
  }
}

function normalizedContactHref(kind, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (kind === "email" && !/^mailto:/i.test(text)) return `mailto:${text}`;
  if (kind === "phone" && !/^tel:/i.test(text)) {
    const dial = text.replace(/[^\d+]/g, "");
    return dial ? `tel:${dial}` : text;
  }
  return text;
}

function renderHeroLinks($, $body, entry) {
  const existingResume = $body.find("a").filter((_, el) => {
    const href = String($(el).attr("href") || "");
    const label = $(el).text();
    return href === "#resume" || /resume/i.test(label);
  }).first();
  const resumeLink = existingResume.length
    ? { label: existingResume.text().trim() || "Resume", href: existingResume.attr("href") || "#resume" }
    : null;

  const links = [
    entry.linkedin ? { label: "LinkedIn", href: entry.linkedin } : null,
    entry.github ? { label: "GitHub", href: entry.github } : null,
    entry.website ? { label: "Website", href: entry.website } : null,
    entry.email ? { label: "Email", href: normalizedContactHref("email", entry.email) } : null,
    entry.phone ? { label: "Phone", href: normalizedContactHref("phone", entry.phone) } : null,
    resumeLink,
  ].filter(link => link?.href);

  $body.removeAttr("data-hero-body");
  if (!links.length) return false;

  const $existingP = $body.is("p") ? $body : $body.find("p").first();
  const $p = $("<p></p>");
  const style = $existingP.attr("style");
  if (style) $p.attr("style", style);

  links.forEach((link, index) => {
    if (index) $p.append(" · ");
    const $a = $("<a></a>").attr("href", link.href).text(link.label);
    if (/^https?:\/\//i.test(link.href)) {
      $a.attr("target", "_blank");
      $a.attr("rel", "noopener");
    }
    $p.append($a);
  });

  if ($body.is("p")) {
    $body.empty().append($p.contents());
  } else {
    $body.empty().append($p);
  }
  return true;
}

function renderHeroValues($, $body, values) {
  if (!values.length) {
    $body.removeAttr("data-hero-body");
    return false;
  }

  const $existingList = $body.is("ul,ol") ? $body : $body.find("ul,ol").first();
  if ($existingList.length) {
    $existingList.empty();
    values.forEach(value => {
      $existingList.append($("<li></li>").text(value));
    });
    if ($body[0] !== $existingList[0]) {
      $body.children().not($existingList).remove();
    }
    $body.removeAttr("data-hero-body");
    return true;
  }

  const $sampleChip = $body.find(".chip,.pill,.tag,[data-item='tag'],[data-item='tech']").first();
  const tagName = $sampleChip[0]?.tagName || $sampleChip[0]?.name || "div";
  const $template = $sampleChip.length ? $sampleChip : $("<div></div>").addClass("chip");

  $body.empty();
  values.forEach(value => {
    const $node = $(`<${tagName}></${tagName}>`).text(value);
    copyPresentationAttrs($template, $node);
    $node.removeAttr("data-item data-field data-html-field data-attr-href data-attr-src");
    $body.append($node);
  });
  $body.removeAttr("data-hero-body");
  return true;
}

function renderHeroBody($, bodyEl, entry) {
  const $body = $(bodyEl);
  if (
    $body.attr("data-list") !== undefined ||
    $body.attr("data-field") !== undefined ||
    $body.attr("data-html-field") !== undefined
  ) {
    $body.removeAttr("data-hero-body");
    return false;
  }

  if (entry.is_links) return renderHeroLinks($, $body, entry);

  const values = entry.is_highlights
    ? labelValues(entry.highlights)
    : entry.is_snapshot
      ? labelValues(entry.snapshot)
      : labelValues(entry.skills);

  return renderHeroValues($, $body, values);
}

function canUseIndexedSectionTemplates($, $sectionItems) {
  if ($sectionItems.length < 2) return false;
  return $sectionItems.toArray().every(el => fieldMarkerCount($, $(el)) > 0);
}

function constrainSectionItemsToTemplate($, container, items, $sectionItems) {
  if (!Array.isArray(items)) return items;
  if (!shouldMimicTemplateShape($, $(container))) return items;
  if ($sectionItems.length <= 1) return items;
  return items.slice(0, $sectionItems.length);
}

function renderIndexedSection($, container, items, $sectionItems) {
  const sectionKey = $(container).attr("data-section") || "";
  const templates = $sectionItems.toArray().map(el => $(el).clone());
  let $lastRendered = null;

  items.forEach((entry, index) => {
    let $target = $sectionItems.eq(index);
    if (!$target.length) {
      $target = templates[index % templates.length].clone();
      if ($lastRendered?.length) $lastRendered.after($target);
      else $(container).append($target);
    }

    fillItem($, $target, entryFromValue(entry), { sectionKey });
    $lastRendered = $target;
  });

  $sectionItems.each((index, el) => {
    if (index >= items.length) $(el).remove();
  });
  $(container).removeAttr("data-section");
}

function addResponsiveHeroLayoutGuard($) {
  const hasAccentBlockHero =
    $(".hero .hero-card .hero-text").length &&
    $(".hero .accent-block").length >= 3;
  if (!hasAccentBlockHero || $("#iw-responsive-hero-layout-guard").length) return;

  const css = `
.hero {
  height: clamp(620px, 100vh, 780px) !important;
}
.hero .hero-card {
  min-height: 0 !important;
  height: clamp(420px, 68vh, 560px);
  max-height: 560px;
}
.hero .hero-text {
  padding: clamp(26px, 4vh, 44px) 32px !important;
  gap: clamp(10px, 1.8vh, 16px) !important;
  max-width: 760px;
}
.hero .hero-photo {
  width: clamp(88px, 13vh, 130px) !important;
  height: clamp(88px, 13vh, 130px) !important;
  flex: 0 0 auto;
}
.hero .hero-text h1 {
  font-size: clamp(2.4rem, 6vw, 4rem) !important;
  line-height: 1.05;
  letter-spacing: 0 !important;
  margin-bottom: 0 !important;
  text-wrap: balance;
}
.hero .hero-text p {
  font-size: clamp(1rem, 1.7vw, 1.15rem) !important;
  line-height: 1.5 !important;
  margin-bottom: clamp(12px, 2vh, 20px) !important;
  max-width: 680px !important;
}
.hero .hero-cta {
  padding: 12px 30px !important;
}
@media (max-height: 680px) {
  .hero .hero-card { height: clamp(380px, 66vh, 470px); }
  .hero .hero-photo { width: 82px !important; height: 82px !important; }
  .hero .hero-text h1 { font-size: clamp(2rem, 5vw, 3.2rem) !important; }
}
@media (max-width: 640px) {
  .hero .hero-card { height: auto; min-height: 430px !important; max-height: none; border-radius: 28px; }
  .hero .hero-text { padding: 34px 22px !important; }
}`;
  const tag = `<style id="iw-responsive-hero-layout-guard">${css}</style>`;
  if ($("head").length) $("head").append(tag);
  else $.root().prepend(tag);
}

// ── Per-item fill ─────────────────────────────────────────────────────────────
// Fills all data-* attributes within $item (including $item itself) from entry.
// Removes the data-* attrs after fill so they are not re-processed by the top-level pass.

function fillItem($, $item, entry, { sectionKey = "" } = {}) {
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
    renderList($, listEl, resolveFieldValue(entry, listKey), { sectionKey });
  }

  const heroBodyEls = [];
  if ($item.attr("data-hero-body") !== undefined) heroBodyEls.push($item[0]);
  $item.find("[data-hero-body]").each((_, bodyEl) => heroBodyEls.push(bodyEl));
  for (const bodyEl of heroBodyEls) {
    renderHeroBody($, bodyEl, entry);
  }

  // Scalar/html/attr fields on $item itself
  const selfField = $item.attr("data-field");
  const selfValue = selfField ? resolveFieldValueForElement(entry, selfField, $item) : undefined;
  if (selfField && selfValue !== undefined) {
    $item.text(constrainFieldText($item, selfValue, selfField));
    $item.removeAttr("data-field");
  }
  const selfHtmlField = $item.attr("data-html-field");
  const selfHtmlValue = selfHtmlField ? resolveFieldValue(entry, selfHtmlField) : undefined;
  if (selfHtmlField && selfHtmlValue !== undefined) {
    const htmlValue = constrainHtmlField($item, selfHtmlValue);
    if (selfHtmlField === "about_full") renderAboutFullField($, $item, htmlValue);
    else {
      $item.html(htmlValue);
      $item.removeAttr("data-html-field");
    }
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
    const value = resolveFieldValueForElement(entry, key, $(el));
    if (value !== undefined) $(el).text(constrainFieldText($(el), value, key));
    $(el).removeAttr("data-field");
  });

  $item.find("[data-html-field]").each((_, el) => {
    const key = $(el).attr("data-html-field");
    const value = resolveFieldValue(entry, key);
    if (value !== undefined) {
      const htmlValue = constrainHtmlField($(el), value);
      if (key === "about_full") renderAboutFullField($, $(el), htmlValue);
      else $(el).html(htmlValue);
    }
    if ($(el).attr("data-html-field") !== undefined) $(el).removeAttr("data-html-field");
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

  if ($item.attr("data-hero-body") !== undefined) $item.removeAttr("data-hero-body");
  $item.find("[data-hero-body]").removeAttr("data-hero-body");
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

    const shapedItems = constrainSectionItemsToTemplate($, container, items, $sectionItems);

    if (canUseIndexedSectionTemplates($, $sectionItems)) {
      renderIndexedSection($, container, shapedItems, $sectionItems);
      return;
    }

    const clones = shapedItems.map(entry => {
      const $clone = $templateItem.clone();
      fillItem($, $clone, entryFromValue(entry), { sectionKey });
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
    const value = resolveFieldValueForElement(d, key, $(el));
    if (value !== undefined) $(el).text(constrainFieldText($(el), value, key));
    $(el).removeAttr("data-field");
  });

  // ── 4. Top-level HTML fields ─────────────────────────────────────────────────
  $("[data-html-field]").each((_, el) => {
    const key = $(el).attr("data-html-field");
    const value = resolveFieldValue(d, key);
    if (value !== undefined) {
      const htmlValue = constrainHtmlField($(el), value);
      if (key === "about_full") renderAboutFullField($, $(el), htmlValue);
      else $(el).html(htmlValue);
    }
    if ($(el).attr("data-html-field") !== undefined) $(el).removeAttr("data-html-field");
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

  // ── 6.5. Defensive layout guards ────────────────────────────────────────────
  addResponsiveHeroLayoutGuard($);

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
