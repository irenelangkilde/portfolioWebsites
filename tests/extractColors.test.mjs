import { describe, expect, it } from "vitest";
import {
  annotateComplementMembers,
  buildJson,
  extractRegex,
  toOk,
} from "../src/extractHtmlColors/extractColors.mjs";

describe("extractRegex", () => {
  it("does not treat rgb channel values as standalone colors", () => {
    const { counts } = extractRegex(`
      <style>
        .hero { background: rgb(112, 95, 190); }
      </style>
    `);

    expect(counts.has("#705fbe")).toBe(true);
    expect(counts.has("#119900")).toBe(false);
  });

  it("ignores color tokens inside CSS and HTML comments", () => {
    const { counts } = extractRegex(`
      <!-- #ff0000 should not count -->
      <style>
        /* #00ff00 and rgb(0, 255, 0) should not count */
        .link { color: #667eea; }
      </style>
    `);

    expect(counts.has("#667eea")).toBe(true);
    expect(counts.has("#00ff00")).toBe(false);
    expect(counts.has("#ff0000")).toBe(false);
  });

  it("serializes complement cluster metadata for palette reps", () => {
    const top = [{
      hex: "#3366cc",
      ok: toOk("#3366cc"),
      count: 4,
      members: [{ hex: "#3366cc", count: 4, ok: toOk("#3366cc") }],
      aggregateScore: 1.5,
    }];
    const candidates = [
      { hex: "#3366cc", count: 4, ok: toOk("#3366cc") },
      { hex: "#b88622", count: 2, ok: toOk("#b88622") },
    ];

    const annotated = annotateComplementMembers(top, candidates, { threshold: 0.25 });
    const json = JSON.parse(buildJson(annotated, { k: 1, threshold: 0.25 }));

    expect(json.scheme["--color-primary"].complement?.memberCount).toBe(1);
    expect(json.scheme["--color-primary"].complement?.hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});
