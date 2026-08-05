import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  inferAboutMetaFromTemplateHtml,
  inferHeroCardMapFromAnnotatedHtml,
} from "../src/netlify/functions/buildWebsite-background.mjs";

describe("inferHeroCardMapFromAnnotatedHtml", () => {
  it("preserves the electrical engineering hero card order from annotated templates", () => {
    const html = readFileSync("templates/caleb/annotated.html", "utf8");
    const heroCardMap = inferHeroCardMapFromAnnotatedHtml(html);

    expect(heroCardMap.map(card => card.original_label)).toEqual([
      "Core Focus",
      "Toolchain",
      "Highlights",
      "Links",
    ]);
    expect(heroCardMap.map(card => card.type)).toEqual([
      "skill_group",
      "skill_group",
      "highlights",
      "links",
    ]);
  });

  // naomi was templates/biology-b before the rename. annotated.html is AI-generated from
  // sample.html, and the annotator picks its own data-list names, so pinning a specific
  // label is not safe: this test used to require a "status_badges" list, which the earlier
  // annotation invented (sample.html has no status badges at all) and a later one dropped
  // in favour of different groupings. Assert the shape of the inference instead — one
  // hero card, correctly typed, with a bullets list whose metadata is self-consistent.
  it("captures nested hero list counts from the naomi hero card", () => {
    const html = readFileSync("templates/naomi/annotated.html", "utf8");
    const heroCardMap = inferHeroCardMapFromAnnotatedHtml(html);

    expect(heroCardMap).toHaveLength(1);
    expect(heroCardMap[0].type).toBe("highlights");

    const { bullets } = heroCardMap[0].lists;
    expect(bullets.count).toBe(3);
    expect(bullets.word_counts).toHaveLength(bullets.count);
    expect(bullets.word_counts.every(n => n > 0)).toBe(true);
    expect(bullets.sample_items).toHaveLength(bullets.count);

    // Deliberately not compared against a recount of sample_items: dataWordCountFromEl
    // takes the annotator's data-word-count attribute when present and only falls back to
    // counting text. The declared values here (10/13/9) exceed a plain whitespace split
    // (8/8/5), so asserting equality would be testing the wrong rule.
  });
});

describe("inferAboutMetaFromTemplateHtml", () => {
  // lucy was templates/statistics before the rename; the rename also edited the copy, so
  // the About section is 122 words now rather than the 120 this asserted. The point of the
  // test is that the section is found without an id="about" hook, so that is asserted
  // structurally; the word count is pinned to catch counting drift and needs updating
  // whenever lucy's About copy is edited.
  it("detects the lucy About section without requiring id=about", () => {
    const html = readFileSync("templates/lucy/annotated.html", "utf8");

    expect(html).not.toMatch(/id=["']about["']/i);

    const aboutMeta = inferAboutMetaFromTemplateHtml(html);

    expect(aboutMeta).toEqual({
      has_about: true,
      about_word_count: 122,
      hero_about_word_count: 0,
      about_full_word_count: 122,
      about_full_paragraph_count: 1,
    });
  });
});
