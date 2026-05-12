/**
 * renameOpenToTokens.mjs
 * Renames open_to_items tokens in mustache files based on semantic classification.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const TEMPLATES_DIR = resolve(import.meta.dirname, "../../templates");

// Rename all Mustache uses of `fromToken` to `toToken` within a file
function renameToken(html, fromToken, toToken) {
  // Match {{#token}}, {{/token}}, {{^token}}, {{token}}
  const re = new RegExp("(\\{\\{[#/^]?)" + fromToken + "(\\}\\})", "g");
  return html.replace(re, (_, prefix, suffix) => prefix + toToken + suffix);
}

const RENAMES = [
  // accounting: open_to_items → status_badges (they're credential/qualification chips)
  {
    file: "accounting/mustache.html",
    renames: [
      ["has_open_to_items", "has_status_badges"],
      ["open_to_items",     "status_badges"],
    ],
  },
  // anthropology: open_to_items → work_domains (work settings: Museums/Archives, UX Research, Policy/NGO)
  {
    file: "anthropology/mustache.html",
    renames: [
      ["has_open_to_items", "has_work_domains"],
      ["open_to_items",     "work_domains"],
    ],
  },
  // biology-b: open_to_items → work_domains (work settings: Research, Lab, Field, Conservation)
  {
    file: "biology-b/mustache.html",
    renames: [
      ["has_open_to_items", "has_work_domains"],
      ["open_to_items",     "work_domains"],
    ],
  },
  // early-childhood-education: open_to_items → open_to_roles (role titles: "Student teaching", etc.)
  {
    file: "early-childhood-education/mustache.html",
    renames: [
      ["has_open_to_items", "has_open_to_roles"],
      ["open_to_items",     "open_to_roles"],
    ],
  },
  // electrical-engineering: open_to_items → open_to_roles ("Hardware/Embedded Internships", etc.)
  {
    file: "electrical-engineering/mustache.html",
    renames: [
      ["has_open_to_items", "has_open_to_roles"],
      ["open_to_items",     "open_to_roles"],
    ],
  },
];

for (const { file, renames } of RENAMES) {
  const path = resolve(TEMPLATES_DIR, file);
  let html = readFileSync(path, "utf-8");
  const original = html;
  for (const [from, to] of renames) {
    html = renameToken(html, from, to);
  }
  if (html === original) {
    console.log(`  - ${file} (no changes)`);
    continue;
  }
  writeFileSync(path, html, "utf-8");
  // Count distinct token occurrences changed
  const changed = renames.flatMap(([from]) =>
    [...original.matchAll(new RegExp("\\{\\{[#/^]?" + from + "\\}\\}", "g"))]
  ).length;
  console.log(`  ✓ ${file} (${changed} token instances renamed)`);
}
