/**
 * Netlify Function: listTemplates
 * GET /.netlify/functions/listTemplates
 * Scans the templates/ directory and returns display labels for all template subdirectories.
 * Returns: { templates: string[] }  — sorted display labels, e.g. "Biology", "Biology B"
 */
import { readdirSync, statSync } from "fs";
import { resolve, join } from "path";

function dirToLabel(dirName) {
  // "biology"                 → "Biology"
  // "biology-b"               → "Biology B"
  // "electrical-engineering-b"→ "Electrical Engineering B"
  return dirName.split("-").map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
}

export async function handler() {
  let entries = [];
  try {
    const templatesDir = resolve(process.cwd(), "templates");
    entries = readdirSync(templatesDir).filter(name => {
      try { return statSync(join(templatesDir, name)).isDirectory(); } catch { return false; }
    });
  } catch {
    // templates/ dir not found — return empty list gracefully
  }

  const templates = entries
    .filter(name => !/^\./.test(name))
    .map(dirToLabel)
    .sort((a, b) => a.localeCompare(b));

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ templates }),
  };
}
