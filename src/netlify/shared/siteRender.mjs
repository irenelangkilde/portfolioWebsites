function escapeHTML(str) {
  return String(str ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

function renderList(items) {
  const safe = (items || []).map(x => `<li>${escapeHTML(x)}</li>`).join("");
  return `<ul>${safe}</ul>`;
}

function renderCards(items, fields) {
  return (items || []).map(item => {
    const title = escapeHTML(item[fields.title] || "");
    const org = escapeHTML(item[fields.org] || "");
    const date = escapeHTML(item[fields.date] || "");
    const bullets = renderList(item[fields.bullets] || []);
    const link = fields.link ? (item[fields.link] || "") : "";

    const linkHtml = fields.link
      ? (link ? `<a href="${escapeHTML(link)}" target="_blank" rel="noopener">View</a>` : `<span class="muted">[Add link]</span>`)
      : "";

    return `
      <div class="card">
        <div class="card-top">
          <h3>${title}</h3>
          <div class="meta-line">
            <span><strong>${org}</strong></span>
            <span class="muted">${date}</span>
            ${linkHtml ? `<span class="link">${linkHtml}</span>` : ""}
          </div>
        </div>
        ${bullets}
      </div>
    `;
  }).join("");
}

function renderSkills(skillsArr) {
  return (skillsArr || []).map(({ category, items }) => `
    <div class="skill-col">
      <h3>${escapeHTML(category)}</h3>
      ${renderList(items)}
    </div>
  `).join("");
}

export function renderHTML(site) {
  const t = site.meta.theme;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHTML(site.meta.name)} — Portfolio</title>
  <style>
    :root{
      --primary:${t.primary}; --secondary:${t.secondary}; --tertiary:${t.tertiary};
      --accent2:${t.accent2}; --accent1:${t.accent1};
      --panel: rgba(255,255,255,0.06);
      --border: rgba(255,255,255,0.14);
      --shadow: 0 10px 30px rgba(0,0,0,0.35);
      --radius: 14px;
      --font: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
    }
    *{box-sizing:border-box}
    body{
      margin:0; font-family:var(--font); color:var(--accent1);
      background:
        radial-gradient(900px 520px at 15% 0%, color-mix(in oklab, var(--primary) 22%, transparent), transparent 60%),
        radial-gradient(900px 520px at 85% 0%, color-mix(in oklab, var(--secondary) 18%, transparent), transparent 60%),
        radial-gradient(900px 520px at 50% 100%, color-mix(in oklab, var(--tertiary) 14%, transparent), transparent 60%),
        var(--accent2);
      line-height:1.5;
    }
    a{ color:var(--tertiary); text-decoration:none }
    a:hover{ text-decoration:underline }
    .wrap{ max-width: 980px; margin: 0 auto; padding: 24px 16px 56px; }
    header{
      background: linear-gradient(180deg, rgba(255,255,255,.06), transparent 55%), var(--panel);
      border:1px solid var(--border); border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 18px;
      display:grid;
      gap:10px;
    }
    .name{ font-size: 30px; font-weight: 900; margin:0; letter-spacing:.2px }
    .headline{ font-size: 16px; font-weight: 800; margin:0; color: rgba(234,240,255,.95) }
    .subtitle{ margin:0; color: rgba(234,240,255,.75) }
    .contact{ display:flex; gap:12px; flex-wrap:wrap; font-size: 14px; color: rgba(234,240,255,.85) }
    nav{
      position: sticky; top: 0; z-index: 10;
      margin: 14px 0;
      background: rgba(11,18,32,.70);
      border:1px solid var(--border);
      border-radius: 999px;
      padding: 10px 12px;
      backdrop-filter: blur(6px);
      display:flex; gap: 12px; flex-wrap:wrap;
    }
    nav a{ font-weight: 800; font-size: 13px; color: rgba(234,240,255,.88) }
    section{
      margin-top: 14px;
      background: var(--panel);
      border:1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 16px;
    }
    h2{ margin:0 0 10px; font-size: 16px; letter-spacing:.2px }
    .muted{ color: rgba(234,240,255,.70) }
    .card{
      border:1px solid rgba(255,255,255,.12);
      background: rgba(0,0,0,.20);
      border-radius: 14px;
      padding: 12px;
    }
    .card-top h3{ margin:0 0 6px; font-size: 14.5px }
    .meta-line{
      display:flex; gap: 10px; flex-wrap:wrap;
      font-size: 12.5px;
    }
    ul{ margin:8px 0 0; padding-left: 18px; }
    li{ margin: 5px 0; }
    .skills{ display:grid; grid-template-columns: 1fr; gap: 10px; }
    @media (min-width: 860px){ .skills{ grid-template-columns: 1fr 1fr; } }
    .skill-col h3{ margin:0 0 6px; font-size: 13.5px }
    .cta{
      display:flex; align-items:center; justify-content:space-between; gap: 12px; flex-wrap:wrap;
      background: linear-gradient(90deg, color-mix(in oklab, var(--primary) 40%, transparent), color-mix(in oklab, var(--tertiary) 25%, transparent));
      border:1px solid rgba(255,255,255,.16);
    }
    .btn{
      display:inline-block;
      padding: 10px 12px;
      border-radius: 12px;
      background: rgba(255,255,255,.10);
      border: 1px solid rgba(255,255,255,.16);
      font-weight: 900;
    }
    footer{ margin-top: 16px; text-align:center; color: rgba(234,240,255,.70); font-size: 12.5px; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1 class="name">${escapeHTML(site.meta.name)}</h1>
      <p class="headline">${escapeHTML(site.meta.headline)}</p>
      <p class="subtitle">${escapeHTML(site.meta.subtitle)}</p>
      <div class="contact">
        <span>${escapeHTML(site.meta.email)}</span>
        <span>${escapeHTML(site.meta.phone)}</span>
        <span><a href="${escapeHTML(site.meta.linkedin)}" target="_blank" rel="noopener">${escapeHTML(site.meta.linkedin || "LinkedIn")}</a></span>
      </div>
    </header>

    <nav>
      <a href="#about">About</a>
      <a href="#education">Education</a>
      <a href="#experience">Experience</a>
      <a href="#projects">Projects</a>
      <a href="#skills">Skills</a>
      <a href="#certs">Certifications</a>
      <a href="#contact">Contact</a>
    </nav>

    <section id="about">
      <h2>About</h2>
      ${(site.sections.about || []).map(p => `<p>${escapeHTML(p)}</p>`).join("")}
    </section>

    <section id="education">
      <h2>Education</h2>
      ${renderCards(site.sections.education, { title:"degree", org:"institution", date:"date", bullets:"details" })}
    </section>

    <section id="experience">
      <h2>Experience</h2>
      ${renderCards(site.sections.experience, { title:"title", org:"org", date:"date", bullets:"bullets" })}
    </section>

    <section id="projects">
      <h2>Projects</h2>
      ${renderCards(site.sections.projects, { title:"name", org:"link", date:"date", bullets:"bullets", link:"link" })}
    </section>

    <section id="skills">
      <h2>Skills</h2>
      <div class="skills">${renderSkills(site.sections.skills)}</div>
    </section>

    <section id="certs">
      <h2>Certifications</h2>
      ${(site.sections.certifications || []).length
        ? renderList(site.sections.certifications)
        : `<p class="muted">[Add certifications if applicable]</p>`
      }
    </section>

    <section id="contact" class="cta">
      <div>
        <h2 style="margin:0 0 6px;">Let’s Connect</h2>
        <div class="muted">${escapeHTML(site.sections.cta.text)}</div>
      </div>
      <a class="btn" href="${escapeHTML(site.sections.cta.button_href)}">${escapeHTML(site.sections.cta.button_label)}</a>
    </section>

    <footer>© ${new Date().getFullYear()} ${escapeHTML(site.meta.name)} • Built from a template + AI-generated draft content</footer>
  </div>
</body>
</html>`;
}