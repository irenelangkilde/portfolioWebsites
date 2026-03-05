
    // ----------------------------
    // Step/page navigation (Page 0..4)
    // ----------------------------
    const PAGES = [
      { id: "page0", label: "0 Overview" },
      { id: "page1", label: "1 Basic" },
      { id: "page2", label: "2 Colors + Preview" },
      { id: "page3", label: "3 Resources" },
      { id: "page4", label: "4 Target Job" }
    ];
    let currentStep = 0;

    const stepPills = document.getElementById("stepPills");
    const stepLabel = document.getElementById("stepLabel");
    const progressBar = document.getElementById("progressBar");

    function renderStepUI(){
      stepPills.innerHTML = "";
      PAGES.forEach((p, idx) => {
        const pill = document.createElement("div");
        pill.className = "pill" + (idx === currentStep ? " active" : "");
        pill.textContent = p.label;
        stepPills.appendChild(pill);
      });
      stepLabel.textContent = `Step ${currentStep} of ${PAGES.length - 1}`;
      const pct = (currentStep / (PAGES.length - 1)) * 100;
      progressBar.style.width = `${pct}%`;
    }

    function setStep(step){
      currentStep = Math.max(0, Math.min(PAGES.length - 1, step));
      PAGES.forEach((p, idx) => {
        const el = document.getElementById(p.id);
        el.classList.toggle("hidden", idx !== currentStep);
      });
      renderStepUI();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    // ----------------------------
    // Helpers: double-click reset
    // ----------------------------
    function makeDoubleClickReset(buttonEl, resetFn){
      let lastClick = 0;
      buttonEl.addEventListener("click", () => {
        const now = Date.now();
        if (now - lastClick < 1200) {
          lastClick = 0;
          resetFn();
          buttonEl.textContent = "Reset (done)";
          setTimeout(() => buttonEl.textContent = "Reset (double-click)", 900);
        } else {
          lastClick = now;
          buttonEl.textContent = "Click again to confirm reset";
          setTimeout(() => {
            if (Date.now() - lastClick >= 1200) buttonEl.textContent = "Reset (double-click)";
          }, 1200);
        }
      });
    }

    // ----------------------------
    // Helpers: downloads / clipboard
    // ----------------------------
    function downloadText(filename, text, mime="text/plain"){
      const blob = new Blob([text], { type: `${mime};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 600);
    }
    function copyToClipboard(text){
      navigator.clipboard?.writeText?.(text).catch(() => {});
    }

    // ----------------------------
    // Phone pretty format (US-style)
    // ----------------------------
    const phoneInput = document.getElementById("phone");
    function formatPhone(value){
      const digits = (value || "").replace(/\D/g,"").slice(0,10);
      const a = digits.slice(0,3);
      const b = digits.slice(3,6);
      const c = digits.slice(6,10);
      if (digits.length <= 3) return a;
      if (digits.length <= 6) return `(${a}) ${b}`;
      return `(${a}) ${b}-${c}`;
    }
    phoneInput.addEventListener("input", () => {
      const start = phoneInput.selectionStart;
      phoneInput.value = formatPhone(phoneInput.value);
      try { phoneInput.setSelectionRange(start, start); } catch {}
    });

    // ----------------------------
    // Page 1: resume drag-and-drop
    // ----------------------------
    const resumeDropzone = document.getElementById("resumeDropzone");
    const resumeUpload   = document.getElementById("resumeUpload");
    const resumeFileList = document.getElementById("resumeFileList");
    function showResumeFiles(files) {
      resumeFileList.innerHTML = "";
      Array.from(files).forEach(f => {
        const li = document.createElement("li");
        li.textContent = f.name;
        resumeFileList.appendChild(li);
      });
    }
    resumeUpload.addEventListener("change", () => showResumeFiles(resumeUpload.files));
    resumeDropzone.addEventListener("dragover", e => { e.preventDefault(); resumeDropzone.classList.add("dragover"); });
    resumeDropzone.addEventListener("dragleave", () => resumeDropzone.classList.remove("dragover"));
    resumeDropzone.addEventListener("drop", e => {
      e.preventDefault();
      resumeDropzone.classList.remove("dragover");
      const allowed = Array.from(e.dataTransfer.files).filter(f => /\.(pdf|doc|docx)$/i.test(f.name));
      if (!allowed.length) return;
      const dt = new DataTransfer();
      allowed.forEach(f => dt.items.add(f));
      resumeUpload.files = dt.files;
      showResumeFiles(allowed);
    });

    // ----------------------------
    // Page 2: theme embed (best-effort)
    // ----------------------------
  

    // ----------------------------
    // Page 3: dynamic text entries
    // ----------------------------
    const SECTION_TYPES = [
      { label: "Hero / Headline ★", value: "Hero/Headline", recommended: true },
      { label: "About ★", value: "About", recommended: true },
      { label: "Projects ★", value: "Projects", recommended: true },
      { label: "Experience ★", value: "Experience", recommended: true },
      { label: "Education ★", value: "Education", recommended: true },
      { label: "Skills ★", value: "Skills", recommended: true },
      { label: "Contact / CTA ★", value: "Contact/CTA", recommended: true },
      { label: "Certifications", value: "Certifications" },
      { label: "Awards", value: "Awards" },
      { label: "Publications", value: "Publications" },
      { label: "Volunteering", value: "Volunteering" },
      { label: "Leadership", value: "Leadership" },
      { label: "Testimonials", value: "Testimonials" },
      { label: "Other", value: "Other" },
      { label: "None", value: "None" }
    ];

    let textEntryCount = 0;
    const textEntriesHost = document.getElementById("textEntries");

    function addTextEntry(prefill = {}){
      textEntryCount++;
      const id = `textEntry_${textEntryCount}`;
      const wrap = document.createElement("div");
      wrap.className = "fileBox";
      wrap.style.marginTop = "10px";

      wrap.innerHTML = `
        <div class="sectionTitle" style="margin-bottom:6px;">
          <h2 style="font-size:13.5px; margin:0;">Text entry ${textEntryCount}</h2>
          <button class="btn mini ghost" type="button" data-remove="${id}">Remove</button>
        </div>
        <div class="inlineRow4">
          <div>
            <label>Type</label>
            <select data-type>
              <option value="HTML">HTML</option>
              <option value="Markdown">Markdown</option>
              <option value="Raw">Raw</option>
            </select>
          </div>
          <div>
            <label>Section type</label>
            <select data-section></select>
          </div>
          <div>
            <label>Content</label>
            <textarea data-content placeholder="Paste your content here…"></textarea>
          </div>
          <div>
            <label>How should we use it?</label>
            <textarea data-use placeholder="e.g., summarize, rewrite, use as inspiration, extract metrics…"></textarea>
          </div>
        </div>
      `;
      // populate dropdown
      const sectionSel = wrap.querySelector("[data-section]");
      SECTION_TYPES.forEach(st => {
        const opt = document.createElement("option");
        opt.value = st.value;
        opt.textContent = st.label;
        sectionSel.appendChild(opt);
      });

      // apply prefill
      const typeSel = wrap.querySelector("[data-type]");
      const contentTa = wrap.querySelector("[data-content]");
      const useTa = wrap.querySelector("[data-use]");
      if (prefill.type) typeSel.value = prefill.type;
      if (prefill.section) sectionSel.value = prefill.section;
      if (prefill.content) contentTa.value = prefill.content;
      if (prefill.use) useTa.value = prefill.use;

      wrap.dataset.entryId = id;
      textEntriesHost.appendChild(wrap);

      wrap.querySelector(`[data-remove="${id}"]`).addEventListener("click", () => wrap.remove());
    }

    document.getElementById("addTextEntry").addEventListener("click", () => addTextEntry());

    // ----------------------------
    // Page 3: file uploads list
    // ----------------------------
    const uploadFiles = document.getElementById("uploadFiles");
    const uploadedFileList = document.getElementById("uploadedFileList");
    uploadFiles.addEventListener("change", () => {
      uploadedFileList.innerHTML = "";
      [...(uploadFiles.files || [])].forEach(f => {
        const li = document.createElement("li");
        li.textContent = `${f.name} (${Math.round(f.size/1024)} KB)`;
        uploadedFileList.appendChild(li);
      });
    });

    // ----------------------------
    // Modal: LinkedIn PDF help
    // ----------------------------
    const modalBackdrop = document.getElementById("modalBackdrop");
    document.getElementById("openLinkedInPdfHelp").addEventListener("click", (e) => {
      e.preventDefault();
      modalBackdrop.style.display = "flex";
    });
    document.getElementById("closeModal").addEventListener("click", () => {
      modalBackdrop.style.display = "none";
    });
    modalBackdrop.addEventListener("click", (e) => {
      if (e.target === modalBackdrop) modalBackdrop.style.display = "none";
    });

    // ----------------------------
    // Collectors
    // ----------------------------
    function getPage1(){
      return {
        name: document.getElementById("name").value.trim(),
        email: document.getElementById("email").value.trim(),
        phone: document.getElementById("phone").value.trim(),
        major: document.getElementById("major").value.trim(),
        specialization: document.getElementById("specialization").value.trim(),
        linkedin: document.getElementById("linkedin").value.trim()
      };
    }

    function getPage2(){
      return {
        themeNumber: document.getElementById("themeNumber").value.trim(),
        theme: {
          primary: document.getElementById("primary").value.trim(),
          secondary: document.getElementById("secondary").value.trim(),
          accent: document.getElementById("accent").value.trim(),
          dark: document.getElementById("dark").value.trim(),
          light: document.getElementById("light").value.trim()
        }
      };
    }

    function getPage3(){
      const entries = [];
      [...textEntriesHost.querySelectorAll(".fileBox[data-entry-id]")].forEach(box => {
        entries.push({
          type: box.querySelector("[data-type]").value,
          section: box.querySelector("[data-section]").value,
          content: box.querySelector("[data-content]").value,
          use: box.querySelector("[data-use]").value
        });
      });

      return {
        uploaded_files: [...(uploadFiles.files || [])].map(f => ({ name: f.name, size: f.size, type: f.type })),
        upload_use: document.getElementById("uploadUse").value,
        public_url: document.getElementById("publicUrl").value.trim(),
        public_url_use: document.getElementById("publicUrlUse").value,
        text_entries: entries,
        copyright_ok: document.getElementById("copyrightOk").checked
      };
    }

    function getPage4(){
      return {
        desired_role: document.getElementById("desiredRole").value.trim(),
        job_ad: document.getElementById("jobAd").value
      };
    }

    function validatePage1Lenient(){
      const p1 = getPage1();
      if (!p1.name) return "Name is required on Page 1.";
      if (!p1.email) return "Email is required on Page 1.";
      return null;
    }

    // ----------------------------
    // Preview generation (Page 2 Next)
    // ----------------------------
    let previewDraft = null; // { site_json, site_html }

    async function generatePreview(){
      const err = validatePage1Lenient();
      if (err) throw new Error(err);

      const page1 = getPage1();
      const page2 = getPage2();

      // don't block unnecessarily: only disable during the fetch
      const box = document.getElementById("page2PreviewBox");
      const status = document.getElementById("page2Status");
      const jsonPre = document.getElementById("jsonPreview2");
      const htmlPre = document.getElementById("htmlPreview2");
      box.classList.remove("hidden");
      status.textContent = "Generating preview…";
      jsonPre.textContent = "";
      htmlPre.textContent = "";

      // Call your Netlify function (expected: /.netlify/functions/generatePreview)
      const res = await fetch("/.netlify/functions/generatePreview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ page1, page2 })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Preview generation failed. (Is your Netlify function deployed?)");
      }

      previewDraft = data;
      localStorage.setItem("portfolio_preview_json", JSON.stringify(previewDraft.site_json));
      localStorage.setItem("portfolio_preview_html", previewDraft.site_html);

      status.innerHTML = `<span class="ok">Preview ready.</span> Download JSON/HTML or continue to Page 3.`;
      jsonPre.textContent = JSON.stringify(previewDraft.site_json, null, 2);
      htmlPre.textContent = previewDraft.site_html;
    }

    // download/copy preview
    document.getElementById("dlJson2").addEventListener("click", () => {
      if (!previewDraft) return;
      downloadText("portfolio_preview.json", JSON.stringify(previewDraft.site_json, null, 2), "application/json");
    });
    document.getElementById("cpJson2").addEventListener("click", () => {
      if (!previewDraft) return;
      copyToClipboard(JSON.stringify(previewDraft.site_json, null, 2));
    });
    document.getElementById("dlHtml2").addEventListener("click", () => {
      if (!previewDraft) return;
      downloadText("portfolio_preview.html", previewDraft.site_html, "text/html");
    });
    document.getElementById("cpHtml2").addEventListener("click", () => {
      if (!previewDraft) return;
      copyToClipboard(previewDraft.site_html);
    });

    // ----------------------------
    // Submission (Page 4)
    // ----------------------------
    let finalResponseText = "";
    let finalSiteJson = null;
    let finalSiteHtml = null;

    function buildFinalPrompt(all){
      // Keep it compact and skimmable: this prompt is meant to be sent to your API.
      // It includes the preview JSON if present, to refine rather than regenerate from scratch.
      const previewJson = localStorage.getItem("portfolio_preview_json");

      return [
        "You are a portfolio website generator.",
        "Goal: Build an impactful one-page portfolio website as quickly, cheaply, and easily as possible using the user’s pre-existing materials where available, while staying true to the user’s real profile. Generate original content when needed and avoid copyright infringement.",
        "",
        "OUTPUT REQUIREMENTS:",
        "1) Return JSON (site_json) and HTML (site_html).",
        "2) Also return a short 'custom_advice' section (3–6 bullets) personalized to the user.",
        "3) Be skimmable: ~100 words per section max.",
        "4) Do NOT fabricate real employers/schools/projects. Use placeholders if missing.",
        "",
        "USER DATA:",
        JSON.stringify(all, null, 2),
        "",
        "PREVIEW (if available):",
        previewJson ? previewJson : "(none)",
      ].join("\\n");
    }

    function buildSummaryHtml(all){
      const esc = (s) => String(s ?? "")
        .replaceAll("&","&amp;")
        .replaceAll("<","&lt;")
        .replaceAll(">","&gt;")
        .replaceAll('"',"&quot;")
        .replaceAll("'","&#39;");

      return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>MyPersonalPortfolioWebsiteSummary</title>
  <style>
    body{ font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 20px; line-height:1.5; }
    h1{ margin:0 0 8px; }
    .muted{ color:#444; }
    pre{ background:#f6f6f6; border:1px solid #ddd; border-radius:10px; padding:12px; overflow:auto; }
  </style>
</head>
<body>
  <h1>My Personal Portfolio Website Summary</h1>
  <div class="muted">Generated from form submission.</div>
  <h2>Raw data</h2>
  <pre>${esc(JSON.stringify(all, null, 2))}</pre>
</body>
</html>`;
    }

    async function submitAll(){
      const p1Err = validatePage1Lenient();
      if (p1Err) throw new Error(p1Err);

      // If they used Page 3 uploads but didn't check copyright, enforce it (required checkbox)
      const p3 = getPage3();
      const hasAnyOptionalResource =
        (p3.uploaded_files?.length || 0) > 0 ||
        !!p3.public_url ||
        (p3.text_entries?.length || 0) > 0;

      if (hasAnyOptionalResource && !p3.copyright_ok){
        throw new Error("Please check the copyright/permission checkbox on Page 3 before submitting.");
      }

      const all = {
        page1: getPage1(),
        page2: getPage2(),
        page3: p3,
        page4: getPage4()
      };

      console.log("FORM_SUBMISSION_ALL_DATA", all);

      const finalBox = document.getElementById("finalBox");
      const finalStatus = document.getElementById("finalStatus");
      const promptPre = document.getElementById("promptPreview");
      const finalPre = document.getElementById("finalPreview");
      finalBox.classList.remove("hidden");
      finalStatus.textContent = "Building prompt…";
      finalPre.textContent = "";
      promptPre.textContent = "";

      const prompt = buildFinalPrompt(all);
      promptPre.textContent = prompt;

      // Prepare summary html download
      const summaryHtml = buildSummaryHtml(all);
      window.__summaryHtml = summaryHtml;

      finalStatus.textContent = "Submitting to generation endpoint…";

      // Try a final endpoint if you have one (recommended):
      // - /.netlify/functions/generateFinal  (you can implement later)
      // Fallback: try generateZip (if available), otherwise show prompt only.
      let responseData = null;

      async function tryPost(url, payload){
        const r = await fetch(url, {
          method:"POST",
          headers:{ "content-type":"application/json" },
          body: JSON.stringify(payload)
        });
        // some endpoints may return non-json; handle carefully
        const ct = r.headers.get("content-type") || "";
        let body = null;
        if (ct.includes("application/json")) body = await r.json().catch(() => null);
        else body = await r.text().catch(() => null);
        if (!r.ok) {
          const msg = (body && body.error) ? body.error : `Request failed: ${r.status}`;
          throw new Error(msg);
        }
        return { ct, body, rawResponse: r };
      }

      try{
        // If you implement it, this should return: { site_json, site_html, custom_advice } (JSON)
        const attempt = await tryPost("/.netlify/functions/generateFinal", { all, prompt });
        if (attempt.ct.includes("application/json")) responseData = attempt.body;
      } catch(e){
        // Fallback: no-op. We'll show prompt as the primary artifact.
        responseData = null;
      }

      if (responseData && responseData.site_json && responseData.site_html){
        finalSiteJson = responseData.site_json;
        finalSiteHtml = responseData.site_html;
        finalResponseText = JSON.stringify(responseData, null, 2);
        finalStatus.innerHTML = `<span class="ok">Success.</span> Model output is available below.`;
        finalPre.textContent = finalResponseText;
      } else {
        finalStatus.innerHTML = `<span class="ok">Success.</span> Prompt generated. (To auto-run generation, deploy a <code>generateFinal</code> Netlify function.)`;
        finalPre.textContent =
          "No final generation endpoint was detected.\\n\\n" +
          "You can copy/download the prompt above and run it in ChatGPT, OR create /.netlify/functions/generateFinal to return {site_json, site_html, custom_advice}.";
      }

      // Wire prompt downloads
      document.getElementById("dlPrompt").onclick = () => downloadText("portfolio_prompt.txt", prompt, "text/plain");
      document.getElementById("cpPrompt").onclick = () => copyToClipboard(prompt);

      // Wire final downloads (if present)
      document.getElementById("dlFinalJson").onclick = () => {
        if (!finalSiteJson) return;
        downloadText("portfolio_final.json", JSON.stringify(finalSiteJson, null, 2), "application/json");
      };
      document.getElementById("dlFinalHtml").onclick = () => {
        if (!finalSiteHtml) return;
        downloadText("portfolio_final.html", finalSiteHtml, "text/html");
      };
      document.getElementById("cpFinal").onclick = () => copyToClipboard(finalPre.textContent || "");

      // Summary download
      document.getElementById("dlSummaryHtml").onclick = () => {
        downloadText("MyPersonalPortfolioWebsiteSummary.html", window.__summaryHtml || summaryHtml, "text/html");
      };
    }

    // ----------------------------
    // Page button wiring
    // ----------------------------
    document.getElementById("toPage1").addEventListener("click", () => setStep(1));

    // Page 1
    makeDoubleClickReset(document.getElementById("reset1"), () => {
      ["name","email","phone","major","specialization","linkedin"].forEach(id => document.getElementById(id).value = "");
    });

    document.getElementById("next1").addEventListener("click", () => {
      const err = validatePage1Lenient();
      if (err) { alert(err); return; }
      setStep(2);
    });

    // Page 2 back
    ["back2_top","back2_bottom"].forEach(id => {
      document.getElementById(id)?.addEventListener("click", () => setStep(1));
    });

    // Page 2 next (top/bottom) -> generate preview (do not auto-advance)
    async function page2Next(){
      const btnTop = document.getElementById("next2_top");
      const btnBottom = document.getElementById("next2_bottom");
      if (btnTop) btnTop.disabled = true;
      if (btnBottom) btnBottom.disabled = true;
      try{
        await generatePreview();
      } catch(e){
        document.getElementById("page2PreviewBox").classList.remove("hidden");
        document.getElementById("page2Status").innerHTML = `<span class="error">Error:</span> ${e.message || "Preview failed"}`;
      } finally{
        if (btnTop) btnTop.disabled = false;
        if (btnBottom) btnBottom.disabled = false;
      }
    }
    document.getElementById("next2_top")?.addEventListener("click", page2Next);
    document.getElementById("next2_bottom")?.addEventListener("click", page2Next);

    // Palette pick mode — chip clicks
    const colorInputIds = ["primary", "secondary", "accent", "dark", "light"];
    const chips = document.querySelectorAll(".chip");
    chips.forEach(chip => {
      chip.addEventListener("click", e => {
        e.stopPropagation();
        chips.forEach(c => c.classList.remove("is-active"));
        chip.classList.add("is-active");
      });
    });

    // Single color pick from iframe
    window.addEventListener("message", e => {
      const msg = e.data;
      console.log("Message received:", msg);
      if (!msg || msg.type !== "colorPick") return;
      const activeChip = document.querySelector(".chip.is-active");
      if (!activeChip) return;
      const idx = parseInt(activeChip.dataset.colorIndex, 10);
      const el = document.getElementById(colorInputIds[idx]);
      if (el) el.value = msg.color;
    });

    document.getElementById("continueTo3").addEventListener("click", () => setStep(3));

    // Page 3
    document.getElementById("back3").addEventListener("click", () => setStep(2));
    document.getElementById("next3").addEventListener("click", () => setStep(4));

    // Page 4
    ["back4_top","back4_bottom"].forEach(id => {
      document.getElementById(id).addEventListener("click", () => setStep(3));
    });
    async function doSubmit(){
      const btnA = document.getElementById("submit_top");
      const btnB = document.getElementById("submit_bottom");
      btnA.disabled = true; btnB.disabled = true;
      try{
        await submitAll();
      } catch(e){
        document.getElementById("finalBox").classList.remove("hidden");
        document.getElementById("finalStatus").innerHTML = `<span class="error">Error:</span> ${e.message || "Submit failed"}`;
      } finally{
        btnA.disabled = false; btnB.disabled = false;
      }
    }
    document.getElementById("submit_top").addEventListener("click", doSubmit);
    document.getElementById("submit_bottom").addEventListener("click", doSubmit);

    // ----------------------------
    // Boot
    // ----------------------------
    function applyDefaults(){
      // Default theme values (nice starting point)
      document.getElementById("primary").value = "#4E70F1";
      document.getElementById("secondary").value = "#FBAB9C";
      document.getElementById("accent").value = "#8DE0FF";
      document.getElementById("dark").value = "#0b1220";
      document.getElementById("light").value = "#eaf0ff";
    }

    // add one blank text entry by default
    addTextEntry();

    applyDefaults();
    renderStepUI();
    setStep(0);
    window.addEventListener("message", (event) => {

      if (!event.data || event.data.type !== "colorThemeSelected") return;

      const theme = event.data.theme;

      document.getElementById("primary").value   = theme.primary || "";
      document.getElementById("secondary").value = theme.secondary || "";
      document.getElementById("accent").value    = theme.accent || "";
      document.getElementById("dark").value      = theme.dark || "";
      document.getElementById("light").value     = theme.light || "";

    });
    window.addEventListener("message", (event) => {
        // Optional safety: if you're always same-origin, you can enforce:
        // if (event.origin !== window.location.origin) return;

        const msg = event.data;
        if (!msg || msg.type !== "colorThemeSelected") return;

        const t = msg.theme || {};
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ""; };

        set("themeNumber", msg.number ?? "");
        set("primary",   t.primary);
        set("secondary", t.secondary);
        set("accent",    t.accent);
        set("dark",      t.dark);
        set("light",     t.light);

        console.log("Theme received:", msg);
    });