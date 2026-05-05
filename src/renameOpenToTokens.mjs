/**
 * renameOpenToTokens.mjs
 * Renames open_to_items tokens in mustache files based on semantic classification.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const HTML_DIR = resolve(import.meta.dirname, "../html");

// Rename all Mustache uses of `fromToken` to `toToken` within a file
function renameToken(html, fromToken, toToken) {
  // Match {{#token}}, {{/token}}, {{^token}}, {{token}}
  const re = new RegExp("(\\{\\{[#/^]?)" + fromToken + "(\\}\\})", "g");
  return html.replace(re, (_, prefix, suffix) => prefix + toToken + suffix);
}

const RENAMES = [
  // accountingGrad: open_to_items → status_badges (they're credential/qualification chips)
  {
    file: "accountingGrad_mustache.html",
    renames: [
      ["has_open_to_items", "has_status_badges"],
      ["open_to_items",     "status_badges"],
    ],
  },
  // anthropologyGrad: open_to_items → work_domains (work settings: Museums/Archives, UX Research, Policy/NGO)
  {
    file: "anthropologyGrad_mustache.html",
    renames: [
      ["has_open_to_items", "has_work_domains"],
      ["open_to_items",     "work_domains"],
    ],
  },
  // biologyGrad_B: open_to_items → work_domains (work settings: Research, Lab, Field, Conservation)
  {
    file: "biologyGrad_B_mustache.html",
    renames: [
      ["has_open_to_items", "has_work_domains"],
      ["open_to_items",     "work_domains"],
    ],
  },
  // early-childhood-education: open_to_items → open_to_roles (role titles: "Student teaching", etc.)
  {
    file: "early-childhood-educationGrad_mustache.html",
    renames: [
      ["has_open_to_items", "has_open_to_roles"],
      ["open_to_items",     "open_to_roles"],
    ],
  },
  // electrical-engineering: open_to_items → open_to_roles ("Hardware/Embedded Internships", etc.)
  {
    file: "electrical-engineeringGrad_mustache.html",
    renames: [
      ["has_open_to_items", "has_open_to_roles"],
      ["open_to_items",     "open_to_roles"],
    ],
  },
];

for (const { file, renames } of RENAMES) {
  const path = resolve(HTML_DIR, file);
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
