/**
 * Environment lookup with a local .env fallback.
 *
 * In production Netlify injects everything into process.env and the fallback never runs.
 * Locally it depends how the function is being driven, and the difference used to be
 * per-function: createCheckoutSession carried its own .env loader while every other
 * function read process.env directly. So a variable could be configured correctly and
 * still be invisible to some endpoints, which reads as the feature being broken rather
 * than the environment being uneven.
 *
 * Values are cached after the first read — these files do not change mid-invocation.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

let cache = null;

function loadLocalEnv() {
  if (cache) return cache;
  cache = {};
  for (const candidate of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env")]) {
    try {
      const raw = readFileSync(candidate, "utf-8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!m) continue;
        let value = m[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!(m[1] in cache)) cache[m[1]] = value;
      }
      break;
    } catch {}
  }
  return cache;
}

/** process.env first, then a local .env, then "". */
export function getEnv(name) {
  return process.env[name] || loadLocalEnv()[name] || "";
}
