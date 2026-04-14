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

// projectIcons.mjs
var projectIcons_exports = {};
__export(projectIcons_exports, {
  assignProjectIcons: () => assignProjectIcons,
  attachProjectIconsToAnalysis: () => attachProjectIconsToAnalysis
});
module.exports = __toCommonJS(projectIcons_exports);
var EMOJI_DOMAIN_MAP = [
  { id: "space", keywords: ["space", "aerospace", "rocket", "satellite", "orbital"], emoji: ["\u{1F680}", "\u{1F6F8}", "\u{1F30C}"] },
  { id: "game", keywords: ["game", "simulation", "unity", "unreal", "godot", "pygame"], emoji: ["\u{1F3AE}", "\u{1F579}\uFE0F", "\u{1F3B2}"] },
  { id: "biology", keywords: ["biology", "genomics", "bioinformatics", "dna", "rna", "protein", "cell", "organism", "ecology"], emoji: ["\u{1F9EC}", "\u{1F33F}", "\u{1F9A0}"] },
  { id: "chemistry", keywords: ["chemistry", "chemical", "synthesis", "reaction", "molecule", "polymer"], emoji: ["\u2697\uFE0F", "\u{1F9EA}", "\u{1F52C}"] },
  { id: "physics", keywords: ["physics", "optics", "laser", "photon", "quantum", "wave", "acoustic"], emoji: ["\u{1F52C}", "\u{1F4A1}", "\u{1F30A}", "\u{1F52D}"] },
  { id: "electrical", keywords: ["electrical", "circuit", "rf", "antenna", "pcb", "embedded", "fpga", "microcontroller", "arduino", "esp32", "firmware"], emoji: ["\u26A1", "\u{1F4E1}", "\u{1F50C}", "\u{1F50B}"] },
  { id: "mechanical", keywords: ["mechanical", "manufacturing", "cad", "solidworks", "autocad", "3d print", "cnc", "robotics"], emoji: ["\u2699\uFE0F", "\u{1F3D7}\uFE0F", "\u{1F529}"] },
  { id: "environment", keywords: ["environment", "civil", "geospatial", "gis", "hydrology", "climate", "geology", "surveying"], emoji: ["\u{1F30D}", "\u{1F3D4}\uFE0F", "\u{1F331}"] },
  { id: "finance", keywords: ["finance", "accounting", "trading", "portfolio", "stock", "investment", "banking", "audit", "tax"], emoji: ["\u{1F4B0}", "\u{1F4C9}", "\u{1F3E6}"] },
  { id: "data", keywords: ["data", "analytics", "machine learning", "ml", "deep learning", "nlp", "ai", "statistics", "tableau", "power bi", "pandas", "numpy"], emoji: ["\u{1F4CA}", "\u{1F4C8}", "\u{1F916}", "\u{1F9E0}"] },
  { id: "design", keywords: ["art", "illustration", "animation", "figma", "photoshop", "ux", "ui", "media", "film", "video"], emoji: ["\u{1F3A8}", "\u{1F5BC}\uFE0F", "\u{1F3AC}"] },
  { id: "network", keywords: ["network", "security", "cybersecurity", "firewall", "penetration", "siem", "soc", "cryptography"], emoji: ["\u{1F510}", "\u{1F310}", "\u{1F5A7}"] },
  { id: "education", keywords: ["education", "research", "teaching", "curriculum", "pedagogy", "writing", "linguistics", "language"], emoji: ["\u{1F4DA}", "\u{1F393}", "\u{1F4DD}"] },
  { id: "software", keywords: ["web", "app", "frontend", "backend", "api", "react", "vue", "angular", "node", "django", "flask", "software"], emoji: ["\u{1F4BB}", "\u{1F5A5}\uFE0F", "\u{1F6E0}\uFE0F", "\u{1F527}"] }
];
var FALLBACK_EMOJI = ["\u{1F52D}", "\u{1F4A1}", "\u{1F9E9}", "\u{1F4CC}", "\u{1F5C2}\uFE0F", "\u{1F9EE}", "\u{1F4D0}", "\u{1F50E}"];
var DOMAIN_HINTS = [
  { id: "electrical", keywords: ["electrical", "hardware", "embedded", "semiconductor", "circuits", "pcb", "signal", "firmware"] },
  { id: "physics", keywords: ["optics", "laser", "photon", "wave", "schematic"] },
  { id: "mechanical", keywords: ["robot", "mechanical", "manufacturing"] },
  { id: "data", keywords: ["data", "analytics", "ml", "ai"] },
  { id: "software", keywords: ["software", "web", "app", "frontend", "backend"] },
  { id: "biology", keywords: ["bio", "genomics", "clinical", "ecology"] },
  { id: "chemistry", keywords: ["chem", "molecule", "polymer"] },
  { id: "environment", keywords: ["civil", "geo", "climate", "survey"] },
  { id: "finance", keywords: ["finance", "accounting", "investment"] },
  { id: "network", keywords: ["network", "cyber", "security"] },
  { id: "education", keywords: ["teaching", "education", "writing", "research"] },
  { id: "game", keywords: ["game", "simulation"] },
  { id: "space", keywords: ["space", "aerospace", "orbital"] },
  { id: "design", keywords: ["design", "art", "media", "visual"] }
];
function textOf(value) {
  if (!value) return "";
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(" ");
  if (typeof value === "object") return Object.values(value).map(textOf).filter(Boolean).join(" ");
  return String(value);
}
function normalizeEmojiIcon(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return Array.from(text)[0] || "";
}
function mergeAiProjectIcons(projects = [], analysisJson = {}) {
  const notes = [
    ...analysisJson?.resume_strategy?.website_copy_seed?.project_framing_notes || [],
    ...analysisJson?.resume_resolved?.website_copy_seed?.project_framing_notes || []
  ].filter((note) => note && typeof note === "object");
  if (!notes.length) return projects;
  const iconByProjectName = /* @__PURE__ */ new Map();
  for (const note of notes) {
    const key = String(note.project_name || "").trim().toLowerCase();
    const icon = normalizeEmojiIcon(note.project_icon);
    if (key && icon && !iconByProjectName.has(key)) {
      iconByProjectName.set(key, icon);
    }
  }
  return (projects || []).map((project) => {
    if (!project || typeof project !== "object") return project;
    if (project.project_icon) return project;
    const key = String(project.name || "").trim().toLowerCase();
    const aiIcon = key ? iconByProjectName.get(key) : "";
    return aiIcon ? { ...project, project_icon: aiIcon } : project;
  });
}
function inferPrimaryDomain(analysisJson = {}) {
  const motifs = analysisJson?.resume_strategy?.motifs || {};
  const visual = analysisJson?.resume_resolved?.visual_language || {};
  const targetRole = analysisJson?.resume_resolved?.target_role || {};
  const hay = [
    motifs.broad_primary_domain,
    motifs.resume_keywords,
    motifs.potential_visual_motifs,
    motifs.symbolic_objects,
    visual.dominant_motifs,
    visual.symbolic_objects,
    targetRole.role_title,
    targetRole.industry
  ].map(textOf).join(" ").toLowerCase();
  for (const hint of DOMAIN_HINTS) {
    if (hint.keywords.some((keyword) => hay.includes(keyword))) return hint.id;
  }
  return "";
}
function scoreProjectDomains(project = {}, preferredDomain = "") {
  const hay = [
    project.name,
    project.description,
    project.role,
    project.technologies,
    project.bullets
  ].map(textOf).join(" ").toLowerCase();
  const scored = EMOJI_DOMAIN_MAP.map((domain) => {
    let score = 0;
    for (const keyword of domain.keywords) {
      if (hay.includes(keyword)) score += keyword.length > 6 ? 4 : 2;
    }
    if (preferredDomain && domain.id === preferredDomain) score += 3;
    return { domain, score };
  }).filter((entry) => entry.score > 0);
  if (scored.length) {
    scored.sort((a, b) => b.score - a.score);
    return scored.map((entry) => entry.domain);
  }
  const preferred = EMOJI_DOMAIN_MAP.find((domain) => domain.id === preferredDomain);
  return preferred ? [preferred] : [];
}
function pickUniqueEmoji(domains, used, idx) {
  const pool = domains.flatMap((domain) => domain.emoji);
  const uniquePool = pool.filter((emoji, i) => pool.indexOf(emoji) === i);
  for (const emoji of uniquePool) {
    if (!used.has(emoji)) {
      used.add(emoji);
      return emoji;
    }
  }
  const fallbackPool = uniquePool.length ? uniquePool : FALLBACK_EMOJI;
  const chosen = fallbackPool[idx % fallbackPool.length];
  used.add(chosen);
  return chosen;
}
function assignProjectIcons(projects = [], analysisJson = {}) {
  const preferredDomain = inferPrimaryDomain(analysisJson);
  const used = /* @__PURE__ */ new Set();
  const aiFirstProjects = mergeAiProjectIcons(projects, analysisJson);
  return (aiFirstProjects || []).map((project, idx) => {
    if (!project || typeof project !== "object") return project;
    if (project.project_icon) {
      used.add(project.project_icon);
      return project;
    }
    const domains = scoreProjectDomains(project, preferredDomain);
    return {
      ...project,
      project_icon: pickUniqueEmoji(domains, used, idx)
    };
  });
}
function attachProjectIconsToAnalysis(analysisJson = {}) {
  if (!analysisJson || typeof analysisJson !== "object") return analysisJson;
  const factualProfile = analysisJson.resume_facts?.factual_profile;
  if (Array.isArray(factualProfile?.projects)) {
    factualProfile.projects = assignProjectIcons(factualProfile.projects, analysisJson);
  }
  if (Array.isArray(analysisJson.projects)) {
    analysisJson.projects = assignProjectIcons(analysisJson.projects, analysisJson);
  }
  return analysisJson;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  assignProjectIcons,
  attachProjectIconsToAnalysis
});
//# sourceMappingURL=projectIcons.js.map
