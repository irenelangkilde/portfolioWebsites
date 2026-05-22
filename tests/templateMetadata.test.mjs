import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  inferAboutMetaFromTemplateHtml,
  inferHeroCardMapFromAnnotatedHtml,
} from "../src/netlify/functions/buildWebsite-background.mjs";

describe("inferHeroCardMapFromAnnotatedHtml", () => {
  it("preserves the electrical engineering hero card order from annotated templates", () => {
    const html = readFileSync("templates/electrical-engineering/annotated.html", "utf8");
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

  it("captures nested hero list counts from the BiologyB hero card", () => {
    const html = readFileSync("templates/biology-b/annotated.html", "utf8");
    const heroCardMap = inferHeroCardMapFromAnnotatedHtml(html);

    expect(heroCardMap).toHaveLength(1);
    expect(heroCardMap[0].type).toBe("highlights");
    expect(heroCardMap[0].lists.status_badges.count).toBe(3);
    expect(heroCardMap[0].lists.bullets.count).toBe(3);
    expect(heroCardMap[0].lists.bullets.word_counts).toEqual([12, 14, 10]);
  });
});

describe("inferAboutMetaFromTemplateHtml", () => {
  it("detects the Statistics About section without requiring id=about", () => {
    const html = readFileSync("templates/statistics/annotated.html", "utf8");
    const aboutMeta = inferAboutMetaFromTemplateHtml(html);

    expect(aboutMeta).toEqual({
      has_about: true,
      about_word_count: 120,
      hero_about_word_count: 0,
      about_full_word_count: 120,
      about_full_paragraph_count: 1,
    });
  });
});
