const EMOJI_DOMAIN_MAP = [
  { id: "space", keywords: ["space","aerospace","rocket","satellite","orbital"], emoji: ["🚀","🛸","🌌"] },
  { id: "game", keywords: ["game","simulation","unity","unreal","godot","pygame"], emoji: ["🎮","🕹️","🎲"] },
  { id: "biology", keywords: ["biology","genomics","bioinformatics","dna","rna","protein","cell","organism","ecology"], emoji: ["🧬","🌿","🦠"] },
  { id: "chemistry", keywords: ["chemistry","chemical","synthesis","reaction","molecule","polymer"], emoji: ["⚗️","🧪","🔬"] },
  { id: "physics", keywords: ["physics","optics","laser","photon","quantum","wave","acoustic"], emoji: ["🔬","💡","🌊","🔭"] },
  { id: "electrical", keywords: ["electrical","circuit","rf","antenna","pcb","embedded","fpga","microcontroller","arduino","esp32","firmware"], emoji: ["⚡","📡","🔌","🔋"] },
  { id: "mechanical", keywords: ["mechanical","manufacturing","cad","solidworks","autocad","3d print","cnc","robotics"], emoji: ["⚙️","🏗️","🔩"] },
  { id: "environment", keywords: ["environment","civil","geospatial","gis","hydrology","climate","geology","surveying"], emoji: ["🌍","🏔️","🌱"] },
  { id: "finance", keywords: ["finance","accounting","trading","portfolio","stock","investment","banking","audit","tax"], emoji: ["💰","📉","🏦"] },
  { id: "data", keywords: ["data","analytics","machine learning","ml","deep learning","nlp","ai","statistics","tableau","power bi","pandas","numpy"], emoji: ["📊","📈","🤖","🧠"] },
  { id: "design", keywords: ["art","illustration","animation","figma","photoshop","ux","ui","media","film","video"], emoji: ["🎨","🖼️","🎬"] },
  { id: "network", keywords: ["network","security","cybersecurity","firewall","penetration","siem","soc","cryptography"], emoji: ["🔐","🌐","🖧"] },
  { id: "education", keywords: ["education","research","teaching","curriculum","pedagogy","writing","linguistics","language"], emoji: ["📚","🎓","📝"] },
  { id: "software", keywords: ["web","app","frontend","backend","api","react","vue","angular","node","django","flask","software"], emoji: ["💻","🖥️","🛠️","🔧"] },
];

const FALLBACK_EMOJI = ["🔭","💡","🧩","📌","🗂️","🧮","📐","🔎"];

const DOMAIN_HINTS = [
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
  { id: "design", keywords: ["design", "art", "media", "visual"] },
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
    ...(analysisJson?.resume_strategy?.website_copy_seed?.project_framing_notes || []),
    ...(analysisJson?.resume_resolved?.website_copy_seed?.project_framing_notes || [])
  ].filter(note => note && typeof note === "object");

  if (!notes.length) return projects;

  const iconByProjectName = new Map();
  for (const note of notes) {
    const key = String(note.project_name || "").trim().toLowerCase();
    const icon = normalizeEmojiIcon(note.project_icon);
    if (key && icon && !iconByProjectName.has(key)) {
      iconByProjectName.set(key, icon);
    }
  }

  return (projects || []).map(project => {
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
    if (hint.keywords.some(keyword => hay.includes(keyword))) return hint.id;
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

  const scored = EMOJI_DOMAIN_MAP.map(domain => {
    let score = 0;
    for (const keyword of domain.keywords) {
      if (hay.includes(keyword)) score += keyword.length > 6 ? 4 : 2;
    }
    if (preferredDomain && domain.id === preferredDomain) score += 3;
    return { domain, score };
  }).filter(entry => entry.score > 0);

  if (scored.length) {
    scored.sort((a, b) => b.score - a.score);
    return scored.map(entry => entry.domain);
  }

  const preferred = EMOJI_DOMAIN_MAP.find(domain => domain.id === preferredDomain);
  return preferred ? [preferred] : [];
}

function pickUniqueEmoji(domains, used, idx) {
  const pool = domains.flatMap(domain => domain.emoji);
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

export function assignProjectIcons(projects = [], analysisJson = {}) {
  const preferredDomain = inferPrimaryDomain(analysisJson);
  const used = new Set();
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

export function attachProjectIconsToAnalysis(analysisJson = {}) {
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
