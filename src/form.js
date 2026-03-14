
    // ----------------------------
    // Step/page navigation (Page 0..4)
    // ----------------------------
    const PAGES = [
      { id: "page0", label: "0 Overview" },
      { id: "page1", label: "1 Basic" },
      { id: "page2", label: "2 Colors" },
      { id: "page4", label: "3 Target Job" }
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
    function copyToClipboard(text, btn){
      const label = btn?.textContent;
      const done = () => {
        if (!btn) return;
        btn.textContent = "Copied!";
        btn.style.background = "#4CAF50";
        btn.style.color = "#fff";
        setTimeout(() => {
          btn.textContent = label;
          btn.style.background = "";
          btn.style.color = "";
        }, 1800);
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => fallback(text, done));
      } else {
        fallback(text, done);
      }
    }
    function fallback(text, done){
      const el = document.createElement("textarea");
      el.value = text;
      el.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(el);
      el.select();
      try { document.execCommand("copy"); done(); } catch {}
      document.body.removeChild(el);
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
    phoneInput?.addEventListener("input", () => {
      const start = phoneInput.selectionStart;
      phoneInput.value = formatPhone(phoneInput.value);
      try { phoneInput.setSelectionRange(start, start); } catch {}
    });

    // ----------------------------
    // Page 1: template screenshot preview
    // ----------------------------
    const templateScreenshotInput   = document.getElementById("templateScreenshot");
    const templateScreenshotPreview = document.getElementById("templateScreenshotPreview");
    const templateScreenshotImg     = document.getElementById("templateScreenshotImg");
    templateScreenshotInput?.addEventListener("change", () => {
      const file = templateScreenshotInput.files?.[0];
      if (file && file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = e => {
          templateScreenshotImg.src = e.target.result;
          templateScreenshotPreview.style.display = "block";
        };
        reader.readAsDataURL(file);
      } else {
        templateScreenshotPreview.style.display = "none";
        templateScreenshotImg.src = "";
      }
    });

    // ----------------------------
    // Page 1: headshot preview
    // ----------------------------
    const headshotInput   = document.getElementById("headshot");
    const headshotPreview = document.getElementById("headshotPreview");
    const headshotImg     = document.getElementById("headshotImg");
    headshotInput?.addEventListener("change", () => {
      const file = headshotInput.files?.[0];
      if (file && file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = e => {
          headshotImg.src = e.target.result;
          headshotPreview.style.display = "block";
        };
        reader.readAsDataURL(file);
      } else {
        headshotPreview.style.display = "none";
        headshotImg.src = "";
      }
    });

    // ----------------------------
    // Page 1: resume file input
    // ----------------------------
    const resumeUpload   = document.getElementById("resumeUpload");
    const resumeFileList = document.getElementById("resumeFileList");
    resumeUpload.addEventListener("change", () => {
      resumeFileList.innerHTML = "";
      Array.from(resumeUpload.files).forEach(f => {
        const li = document.createElement("li");
        li.textContent = f.name;
        resumeFileList.appendChild(li);
      });
    });

    // ----------------------------
    // Page 2: theme embed (best-effort)
    // ----------------------------
  



    // ----------------------------
    // Collectors
    // ----------------------------
    function getPage1(){
      return {
        major: document.getElementById("major").value.trim(),
        specialization: document.getElementById("specialization").value.trim(),
        model_template: document.getElementById("modelTemplate").value.trim()
      };
    }

    function getPage2(){
      return {
        themeNumber: document.getElementById("themeNumber")?.value?.trim() || "",
        theme: {
          primary: document.getElementById("primary").value.trim(),
          secondary: document.getElementById("secondary").value.trim(),
          accent: document.getElementById("accent").value.trim(),
          dark: document.getElementById("dark").value.trim(),
          light: document.getElementById("light").value.trim()
        }
      };
    }

function getPage4(){
      return {
        desired_role: document.getElementById("desiredRole").value.trim(),
        job_ad: document.getElementById("jobAd").value
      };
    }

    function validatePage1Lenient(){
      return null;
    }

    // ----------------------------
    // Helpers
    // ----------------------------
    async function readFileAsBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    // ----------------------------
    // Submission (Page 3)
    // ----------------------------

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

      const resumeFile = resumeUpload.files[0];
      if (!resumeFile) throw new Error("Please upload your resume PDF before submitting.");

      const page1 = getPage1();
      const page2 = getPage2();
      const page4 = getPage4();
      const jobId = crypto.randomUUID();

      const finalBox = document.getElementById("finalBox");
      const finalStatus = document.getElementById("finalStatus");
      finalBox.classList.remove("hidden");
      finalBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
      finalStatus.textContent = "Reading resume PDF…";

      let resumePdfBase64 = "";
      try {
        resumePdfBase64 = await readFileAsBase64(resumeFile);
      } catch (e) {
        throw new Error("Could not read resume PDF: " + e.message);
      }

      const headshotName = headshotInput.files?.[0]?.name || "";

      let templateScreenshotBase64 = "";
      let templateScreenshotMime = "";
      const screenshotFile = templateScreenshotInput?.files?.[0];
      if (screenshotFile && screenshotFile.type.startsWith("image/")) {
        try {
          templateScreenshotBase64 = await readFileAsBase64(screenshotFile);
          templateScreenshotMime = screenshotFile.type;
        } catch { /* non-fatal — proceed without screenshot */ }
      }

      finalStatus.textContent = "Submitting request…";

      const res = await fetch("/.netlify/functions/generatePreview-background", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ page1, page2, page4, jobId, resumePdfBase64, headshotName, templateScreenshotBase64, templateScreenshotMime })
      });

      if (!res.ok && res.status !== 202) {
        const rawText = await res.text();
        let data = {};
        try { data = JSON.parse(rawText); } catch {}
        throw new Error(data?.error || `Server error ${res.status}: ${rawText.slice(0, 400)}`);
      }

      // Poll for result (up to 12 minutes)
      const startTime = Date.now();
      const maxWaitMs = 720000;
      const pollIntervalMs = 4000;

      while (Date.now() - startTime < maxWaitMs) {
        await new Promise(r => setTimeout(r, pollIntervalMs));
        const remaining = Math.max(0, Math.round((maxWaitMs - (Date.now() - startTime)) / 1000));
        finalStatus.textContent = `Generating your portfolio… ${remaining}s remaining`;

        const pollRes = await fetch(`/.netlify/functions/getPreviewResult?jobId=${jobId}`);
        const data = await pollRes.json().catch(() => ({}));

        if (data.status === "done") {
          localStorage.setItem("portfolio_preview_html", data.site_html);
          // Wire download buttons and reveal them for admin users
          const dlHtml = document.getElementById("dlFinalHtml");
          const dlSummary = document.getElementById("dlSummaryHtml");
          dlHtml.onclick = () => downloadText("portfolio.html", data.site_html, "text/html");
          const all = { page1, page2, page4 };
          const summaryHtml = buildSummaryHtml(all);
          dlSummary.onclick = () => downloadText("MyPersonalPortfolioWebsiteSummary.html", summaryHtml, "text/html");
          if (page1.specialization === "Irene's Webworks") {
            dlHtml.classList.remove("hidden");
            dlSummary.classList.remove("hidden");
          }
          finalStatus.innerHTML = `<span class="ok">Portfolio ready.</span> Open the editor below.`;
          return;
        }
        if (data.status === "error") {
          throw new Error(data.error || "Generation failed.");
        }
        // still pending — keep polling
      }

      throw new Error("Generation timed out after 12 minutes.");
    }

    // ----------------------------
    // Page button wiring
    // ----------------------------
    document.getElementById("toPage1")?.addEventListener("click", () => setStep(1));

    // Page 1
    const reset1 = document.getElementById("reset1");
    if (reset1) makeDoubleClickReset(reset1, () => {
      ["name","email","phone","major","specialization","linkedin","github","modelTemplate"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
      if (headshotInput) headshotInput.value = "";
      if (headshotPreview) headshotPreview.style.display = "none";
      if (headshotImg) headshotImg.src = "";
      if (templateScreenshotInput) templateScreenshotInput.value = "";
      if (templateScreenshotPreview) templateScreenshotPreview.style.display = "none";
      if (templateScreenshotImg) templateScreenshotImg.src = "";
    });

    document.getElementById("next1")?.addEventListener("click", () => {
      const err = validatePage1Lenient();
      if (err) { alert(err); return; }
      setStep(2);
    });

    // Page 2 back
    ["back2_top","back2_bottom"].forEach(id => {
      document.getElementById(id)?.addEventListener("click", () => setStep(1));
    });

    // Page 2 next (top/bottom) -> generate preview (do not auto-advance)
    document.getElementById("next2_bottom")?.addEventListener("click", () => setStep(3));

    // Track which color input last had focus
    const colorInputIds = ["primary", "secondary", "accent", "dark", "light"];
    let focusedColorId = "primary";
    colorInputIds.forEach(id => {
      document.getElementById(id)?.addEventListener("focus", () => { focusedColorId = id; });
    });

    // Single color pick from iframe — fills whichever field is active
    window.addEventListener("message", e => {
      const msg = e.data;
      if (!msg || msg.type !== "colorPick") return;
      const el = document.getElementById(focusedColorId);
      if (el) el.value = msg.color;
    });

    // Page 3 (was page 4)
    document.getElementById("back4_bottom")?.addEventListener("click", () => setStep(2));
    document.getElementById("btnOpenEditor")?.addEventListener("click", () => {
      window.open("src/editor.html", "_blank");
    });
    async function doSubmit(){
      const btn = document.getElementById("submit_bottom");
      btn.disabled = true;
      try{
        await submitAll();
      } catch(e){
        document.getElementById("finalBox").classList.remove("hidden");
        document.getElementById("finalStatus").innerHTML = `<span class="error">Error:</span> ${e.message || "Submit failed"}`;
      } finally{
        btn.disabled = false;
      }
    }
    document.getElementById("submit_bottom")?.addEventListener("click", doSubmit);

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
      });