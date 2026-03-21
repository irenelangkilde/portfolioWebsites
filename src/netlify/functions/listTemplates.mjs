/**
 * Netlify Function: listTemplates
 * GET /.netlify/functions/listTemplates
 * Scans the html/ directory and returns display labels for all *Grad.html
 * and *Grad_<letter>.html files.
 * Returns: { templates: string[] }  — sorted display labels, e.g. "Biology", "Biology A"
 */
import { readdirSync } from "fs";
import { resolve } from "path";

function toLabel(keyword, variant) {
  const words = keyword.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1));
  return variant ? words.join(" ") + " " + variant.toUpperCase() : words.join(" ");
}

export async function handler() {
  let files = [];
  try {
    files = readdirSync(resolve(process.cwd(), "html"));
  } catch {
    // html/ dir not found — return empty list gracefully
  }

  const templates = [];
  for (const f of files) {
    // Pattern 1: <keyword>Grad_<letter>.html  (e.g. biologyGrad_A.html)
    let m = f.match(/^(.+)Grad_([A-Za-z])\.html$/i);
    if (m) { templates.push(toLabel(m[1], m[2])); continue; }

    // Pattern 2: <keyword>Grad.html  (e.g. biologyGrad.html)
    m = f.match(/^(.+)Grad\.html$/i);
    if (m) { templates.push(toLabel(m[1], null)); }
  }

  templates.sort((a, b) => a.localeCompare(b));

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ templates }),
  };
}
