var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// extractTemplateColors.mjs
var extractTemplateColors_exports = {};
__export(extractTemplateColors_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(extractTemplateColors_exports);
function hexToRgb(hex) {
  hex = hex.replace(/^#/, "");
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const n = parseInt(hex, 16);
  return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255 };
}
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}
function parseColorString(str) {
  str = str.trim();
  if (str.startsWith("#")) {
    const hex = str.slice(1);
    if (/^[0-9a-fA-F]{3}$/.test(hex)) return "#" + hex.split("").map((c) => c + c).join("").toLowerCase();
    if (/^[0-9a-fA-F]{6}$/.test(hex)) return str.toLowerCase();
    return null;
  }
  const rgb = str.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) return rgbToHex(+rgb[1], +rgb[2], +rgb[3]);
  return null;
}
var VAR_PATTERNS = {
  primary: [/--primary\b/, /--color-primary\b/, /--brand\b/, /--main-color\b/, /--theme-primary\b/],
  secondary: [/--secondary\b/, /--color-secondary\b/, /--theme-secondary\b/],
  accent: [/--accent\b/, /--highlight\b/, /--cta-color\b/, /--theme-accent\b/],
  dark: [/--dark\b/, /--bg-dark\b/, /--background-dark\b/, /--color-dark\b/, /--surface-dark\b/],
  light: [/--light\b/, /--bg-light\b/, /--background-light\b/, /--bg\b/, /--surface\b/, /--bg-color\b/]
};
function tryExtractVars(css) {
  const result = {};
  for (const [role, patterns] of Object.entries(VAR_PATTERNS)) {
    for (const pat of patterns) {
      const re = new RegExp(pat.source + "\\s*:\\s*([#a-zA-Z0-9(),%. ]+?)\\s*[;}\n]", "gi");
      const m = re.exec(css);
      if (m) {
        const color = parseColorString(m[1].trim());
        if (color) {
          result[role] = color;
          break;
        }
      }
    }
  }
  return result;
}
function colorFrequencyList(css) {
  const freq = {};
  const hexRe = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
  let m;
  while ((m = hexRe.exec(css)) !== null) {
    let h = m[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const hex = "#" + h.toLowerCase();
    freq[hex] = (freq[hex] || 0) + 1;
  }
  const rgbRe = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g;
  while ((m = rgbRe.exec(css)) !== null) {
    const hex = rgbToHex(+m[1], +m[2], +m[3]);
    freq[hex] = (freq[hex] || 0) + 1;
  }
  const noise = /* @__PURE__ */ new Set(["#000000", "#ffffff", "#000", "#fff"]);
  return Object.entries(freq).filter(([hex]) => !noise.has(hex)).sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
}
function categorizeByHsl(colors) {
  const result = {};
  const hsl = colors.map((hex) => ({ hex, ...rgbToHsl(...Object.values(hexToRgb(hex))) }));
  const darks = hsl.filter((c) => c.l < 22);
  const lights = hsl.filter((c) => c.l > 80);
  const vivid = hsl.filter((c) => c.s > 25 && c.l >= 22 && c.l <= 80).sort((a, b) => b.s - a.s);
  if (darks[0]) result.dark = darks[0].hex;
  if (lights[0]) result.light = lights[0].hex;
  if (vivid[0]) result.primary = vivid[0].hex;
  if (vivid[1]) result.secondary = vivid[1].hex;
  if (vivid[2]) result.accent = vivid[2].hex;
  return result;
}
function extractColors(html) {
  const styleBlocks = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = styleRe.exec(html)) !== null) styleBlocks.push(m[1]);
  const allCss = styleBlocks.join("\n");
  const fromVars = tryExtractVars(allCss);
  const missing = ["primary", "secondary", "accent", "dark", "light"].filter((r) => !fromVars[r]);
  let fromFreq = {};
  if (missing.length > 0) {
    fromFreq = categorizeByHsl(colorFrequencyList(allCss));
  }
  const defaults = { primary: "#4E70F1", secondary: "#FBAB9C", accent: "#8DE0FF", dark: "#0b1220", light: "#eaf0ff" };
  const result = {};
  for (const role of ["primary", "secondary", "accent", "dark", "light"]) {
    result[role] = fromVars[role] || fromFreq[role] || defaults[role];
  }
  return result;
}
async function handler(event) {
  const url = event.queryStringParameters?.url;
  if (!url) {
    return { statusCode: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "Missing url" }) };
  }
  let html;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8e3);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: `Could not fetch template: ${e.message}` })
    };
  }
  const colors = extractColors(html);
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(colors)
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=extractTemplateColors.js.map
