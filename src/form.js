
    // Returns true when a modelTemplate value should be treated as an external URL
    function looksLikeUrl(val) {
      return /^https?:\/\//i.test(val) || val.includes(".");
    }
    // Ensures a URL-like value has a protocol prefix
    function normalizeTemplateUrl(val) {
      return /^https?:\/\//i.test(val) ? val : "https://" + val;
    }

    // ----------------------------
    // Resume analysis cache
    // ----------------------------
    let resumeAnalysisCache = null;   // parsed JSON from analyzeResume
    let resumeAnalysisPending = false; // true while request in flight

    // ----------------------------
    // Per-field validation
    // ----------------------------
    const FIELD_VALIDATORS = {
      major:          v => v.trim() ? null : "Major is required.",
      specialization: v => v.trim() ? null : "Specialization is required.",
      modelTemplate: v => {
        if (!v.trim()) return null;
        // Only parse as URL when it looks like one; free-text names are also valid
        if (looksLikeUrl(v.trim())) {
          try { new URL(normalizeTemplateUrl(v.trim())); return null; }
          catch { return "Enter a valid URL or keyword."; }
        }
        return null;
      },
      linkedin: v => {
        if (!v.trim()) return null;
        try { new URL(v.trim()); return null; }
        catch { return "Enter a valid URL (e.g., https://linkedin.com/in/yourname)."; }
      },
      desiredRole: () => null,
      jobAd:       () => null,
    };

    // Lazily create (or retrieve) the inline error message element below a field
    function getFieldMsg(id) {
      let el = document.getElementById(`_msg_${id}`);
      if (!el) {
        const input = document.getElementById(id);
        if (!input) return null;
        el = document.createElement("div");
        el.id = `_msg_${id}`;
        el.style.cssText = "font-size:11.5px; margin-top:3px; min-height:14px;";
        input.parentNode.insertBefore(el, input.nextSibling);
      }
      return el;
    }

    // Lazily create (or retrieve) the ✓ overlay inside the field on the left
    function getFieldOkMark(id) {
      let el = document.getElementById(`_ok_${id}`);
      if (!el) {
        const input = document.getElementById(id);
        if (!input) return null;
        // Wrap just the input so top:50% is relative to the input height, not the whole field div
        const inputWrap = document.createElement("div");
        inputWrap.style.cssText = "position:relative; display:block;";
        input.parentNode.insertBefore(inputWrap, input);
        inputWrap.appendChild(input);
        input.style.paddingLeft = "26px";
        el = document.createElement("span");
        el.id = `_ok_${id}`;
        el.style.cssText = "position:absolute; left:9px; top:50%; transform:translateY(-50%); font-size:13px; pointer-events:none; color:rgba(118,176,34,.9);";
        inputWrap.appendChild(el);
      }
      return el;
    }

    function validateField(id, showOk = false) {
      const fn = FIELD_VALIDATORS[id];
      if (!fn) return true;
      const input = document.getElementById(id);
      if (!input) return true;
      const msg = getFieldMsg(id);
      const ok  = getFieldOkMark(id);
      const err = fn(input.value);
      if (err) {
        input.style.borderColor = "rgba(251,171,156,.75)";
        if (msg) { msg.textContent = err; msg.style.color = "rgba(251,171,156,.9)"; }
        if (ok)  ok.textContent = "";
        return false;
      }
      input.style.borderColor = "";
      if (msg) msg.textContent = "";
      if (ok)  ok.textContent = (showOk && input.value.trim()) ? "✓" : "";
      return true;
    }

    // Wire each field: validate on blur; re-check on input once an error is showing
    Object.keys(FIELD_VALIDATORS).forEach(id => {
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener("blur",  () => validateField(id, true));
      input.addEventListener("input", () => {
        if (getFieldMsg(id)?.textContent) validateField(id, false);
      });
    });

    // Resume upload: show filename, then kick off background analysis
    document.getElementById("resumeUpload")?.addEventListener("change", () => {
      const input  = document.getElementById("resumeUpload");
      const hasFile = !!input?.files?.length;
      let msg = document.getElementById("_msg_resumeUpload");
      if (!msg) {
        msg = document.createElement("div");
        msg.id = "_msg_resumeUpload";
        msg.style.cssText = "font-size:11.5px; margin-top:3px; min-height:14px;";
        input.closest(".dropzone")?.after(msg);
      }
      msg.textContent = hasFile ? "✓ " + input.files[0].name : "";
      msg.style.color = "rgba(118,176,34,.9)";

      // Reset cache and kick off analysis
      resumeAnalysisCache = null;
      if (hasFile) {
        analyzeResumeInBackground(input.files[0]);
      } else {
        setResumeAnalysisStatus("");
      }
    });

    // ----------------------------
    // Debug mode + provider selection
    // ----------------------------
    function isDebugMode() {
      return (document.getElementById("major")?.value || "").toUpperCase().includes("DEBUG");
    }

    // Returns "openai" when major contains CHATGPT or OPENAI, else "claude"
    function getAnalysisProvider() {
      const v = (document.getElementById("major")?.value || "").toUpperCase();
      if (v.includes("CHATGPT") || v.includes("OPENAI")) return "openai";
      return "claude";
    }

    function updateProviderBadge() {
      const badge = document.getElementById("providerBadge");
      if (!badge) return;
      const v = (document.getElementById("major")?.value || "").toUpperCase();
      const hasKeyword = v.includes("CHATGPT") || v.includes("OPENAI") || v.includes("CLAUDE");
      if (!hasKeyword) { badge.classList.add("hidden"); return; }
      badge.classList.remove("hidden");
      if (getAnalysisProvider() === "openai") {
        badge.innerHTML = `<span style="background:rgba(16,163,127,.18);border:1px solid rgba(16,163,127,.45);border-radius:6px;padding:2px 7px;color:rgba(16,163,127,.95);">⚡ ChatGPT / GPT-4o</span>`;
      } else {
        badge.innerHTML = `<span style="background:rgba(251,171,156,.12);border:1px solid rgba(251,171,156,.4);border-radius:6px;padding:2px 7px;color:rgba(251,171,156,.9);">✦ Claude (Anthropic)</span>`;
      }
    }

    function updateDebugBanner() {
      const debug = isDebugMode();
      const banner = document.getElementById("debugBanner");
      if (banner) {
        banner.classList.toggle("hidden", !debug);
        if (debug) {
          const label = getAnalysisProvider() === "openai" ? "ChatGPT/GPT-4o" : "Claude";
          banner.textContent = `🐛 DEBUG MODE [${label}] — intermediate results and raw outputs will be available after generation`;
        }
      }
      if (debug && resumeAnalysisCache) {
        document.getElementById("resumeAnalysisPanel")?.classList.remove("hidden");
      } else if (!debug) {
        document.getElementById("resumeAnalysisPanel")?.classList.add("hidden");
      }
      if (debug && extractedTemplateCache) {
        document.getElementById("templateExtractPanel")?.classList.remove("hidden");
      } else if (!debug) {
        document.getElementById("templateExtractPanel")?.classList.add("hidden");
      }
    }

    document.getElementById("major")?.addEventListener("input", () => {
      updateDebugBanner();
      updateProviderBadge();
    });

    // ----------------------------
    // Resume analysis (background)
    // ----------------------------
    function setResumeAnalysisStatus(text, color = "rgba(234,240,255,.6)") {
      ["resumeAnalysisStatus", "resumeAnalysisStatusInline"].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.textContent = text; el.style.color = color; }
      });
    }

    function populateResumeDebugPanel(json) {
      const panel  = document.getElementById("resumeAnalysisPanel");
      const pre    = document.getElementById("resumeAnalysisPre");
      const dlBtn  = document.getElementById("dlResumeAnalysis");
      const cpBtn  = document.getElementById("cpResumeAnalysis");
      if (!panel || !pre) return;

      const str = JSON.stringify(json, null, 2);
      pre.textContent = str;

      dlBtn?.addEventListener("click", () => downloadText("resume-analysis.json", str, "application/json"));
      cpBtn?.addEventListener("click", e => copyToClipboard(str, e.currentTarget));

      if (isDebugMode()) panel.classList.remove("hidden");

      // Lift the "wait for analysis" block, then apply defaults
      updateDesignOptionsReadiness();
      const source = document.querySelector('input[name="templateSource"]:checked')?.value;
      if (source === "none" && !document.querySelector('input[name="designComposition"]:checked')) {
        applyDesignDefaults(json);
      }
      applyColorDefaults(json);
    }

    function startAnalysisCountdown(timeoutSec) {
      let remaining = timeoutSec;
      setResumeAnalysisStatus(`Analyzing resume… ${remaining}s`, "rgba(141,224,255,.75)");
      const timer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          clearInterval(timer);
        } else {
          setResumeAnalysisStatus(`Analyzing resume… ${remaining}s`, "rgba(141,224,255,.75)");
        }
      }, 1000);
      return timer;
    }

    async function analyzeResumeInBackground(file) {
      // Only PDFs are supported for analysis
      if (file.type && !file.type.includes("pdf")) {
        setResumeAnalysisStatus("Analysis requires a PDF. Upload complete.", "rgba(234,240,255,.5)");
        return;
      }
      resumeAnalysisPending = true;

      let base64;
      try {
        base64 = await readFileAsBase64(file);
      } catch (e) {
        resumeAnalysisPending = false;
        setResumeAnalysisStatus("Could not read resume file.", "rgba(251,171,156,.8)");
        return;
      }

      const major          = document.getElementById("major")?.value?.trim() || "";
      const specialization = document.getElementById("specialization")?.value?.trim() || "";
      const provider       = getAnalysisProvider();

      // Generate a unique jobId for this analysis run
      const jobId = "resume_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);

      const countdownTimer = startAnalysisCountdown(120);

      // Submit to background function (returns 202 immediately)
      try {
        const submitRes = await fetch("/.netlify/functions/analyzeResume-background", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jobId, resumePdfBase64: base64, resumeMime: file.type || "application/pdf", major, specialization, provider })
        });
        if (!submitRes.ok) {
          clearInterval(countdownTimer);
          resumeAnalysisPending = false;
          setResumeAnalysisStatus("Resume analysis failed (could not start).", "rgba(251,171,156,.8)");
          return;
        }
      } catch (e) {
        clearInterval(countdownTimer);
        resumeAnalysisPending = false;
        setResumeAnalysisStatus("Resume analysis failed (network error).", "rgba(251,171,156,.8)");
        return;
      }

      // Poll getPreviewResult until done or timeout
      const POLL_INTERVAL_MS = 2500;
      const POLL_TIMEOUT_MS  = 180000; // 3 minutes max
      const pollStart = Date.now();

      const poll = async () => {
        if (!resumeAnalysisPending) return; // cancelled externally (e.g. new file uploaded)
        if (Date.now() - pollStart > POLL_TIMEOUT_MS) {
          clearInterval(countdownTimer);
          resumeAnalysisPending = false;
          setResumeAnalysisStatus("Resume analysis timed out — try again.", "rgba(251,171,156,.8)");
          return;
        }

        let result;
        try {
          const res = await fetch(`/.netlify/functions/getPreviewResult?jobId=${encodeURIComponent(jobId)}`);
          const text = await res.text();
          try { result = JSON.parse(text); } catch { result = null; }
        } catch {
          // Network blip — keep polling
          setTimeout(poll, POLL_INTERVAL_MS);
          return;
        }

        if (!result || result.status === "pending") {
          setTimeout(poll, POLL_INTERVAL_MS);
          return;
        }

        clearInterval(countdownTimer);
        resumeAnalysisPending = false;

        if (result.status === "error") {
          setResumeAnalysisStatus("Resume analysis failed: " + (result.error || "Unknown error"), "rgba(251,171,156,.8)");
          return;
        }

        // result.status === "done" — strip the status field to get the analysis data
        const data = Object.fromEntries(Object.entries(result).filter(([k]) => k !== "status"));

        if (!data || Object.keys(data).length === 0) {
          setResumeAnalysisStatus("Resume analysis returned empty data.", "rgba(251,171,156,.8)");
          return;
        }

        // Ensure form-supplied values win over AI inferences
        if (data.identity) {
          if (major)          data.identity.major          = major;
          if (specialization) data.identity.specialization = specialization;
        }

        // Cache only in debug mode; always pass data directly to consumers
        if (isDebugMode()) resumeAnalysisCache = data;
        else               resumeAnalysisCache = null;

        setResumeAnalysisStatus("✓ Resume analyzed", "rgba(118,176,34,.9)");
        populateResumeDebugPanel(data);
        renderSuggestedPalettes(data);
      };

      setTimeout(poll, POLL_INTERVAL_MS);
    }

    // Enter in Major field while containing "DEBUG" activates debug mode immediately
    document.getElementById("major")?.addEventListener("keydown", e => {
      if (e.key !== "Enter") return;
      if (!isDebugMode()) return;
      e.preventDefault();
      updateDebugBanner();
      const msg = getFieldMsg("major");
      if (msg) {
        msg.textContent = "🐛 Debug mode active";
        msg.style.color = "rgba(251,171,156,.9)";
        setTimeout(() => { if (msg.textContent.startsWith("🐛")) msg.textContent = ""; }, 2500);
      }
    });

    // ----------------------------
    // Step/page navigation (Page 0..4)
    // ----------------------------
    const PAGES = [
      { id: "page0", label: "0 Overview" },
      { id: "page1", label: "1 Resume" },
      { id: "page2", label: "2 Artifacts" },
      { id: "page3", label: "3 Website spec" },
      { id: "page4", label: "4 Color scheme" },
      { id: "page5a", pageId: "page5", label: "5 Job Ad" },
      { id: "page5b", pageId: "page5", label: "6 Edit" },
      { id: "page5c", pageId: "page5", label: "7 Publish" }
    ];
    let currentStep = 0;

    const stepPills = document.getElementById("stepPills");
    const stepLabel = document.getElementById("stepLabel");
    const progressBar = document.getElementById("progressBar");

    function getPageId(entry){ return entry.pageId ?? entry.id; }

    function renderStepUI(){
      const activePageId = getPageId(PAGES[currentStep]);
      stepPills.innerHTML = "";
      PAGES.forEach((p, idx) => {
        if (idx === 0) return; // skip Overview pill
        const pill = document.createElement("div");
        pill.className = "pill" + (getPageId(p) === activePageId ? " active" : "");
        pill.textContent = p.label;
        stepPills.appendChild(pill);
      });
      stepLabel.textContent = currentStep > 0 ? `Step ${currentStep} of ${PAGES.length - 1}` : "";
      const pct = currentStep > 0 ? (currentStep / (PAGES.length - 1)) * 100 : 0;
      progressBar.style.width = `${pct}%`;
    }

    function setStep(step){
      currentStep = Math.max(0, Math.min(PAGES.length - 1, step));
      const activePageId = getPageId(PAGES[currentStep]);
      const seen = new Set();
      PAGES.forEach(p => {
        const pageId = getPageId(p);
        if (seen.has(pageId)) return;
        seen.add(pageId);
        const el = document.getElementById(pageId);
        if (el) el.classList.toggle("hidden", pageId !== activePageId);
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
    // Template list — populate datalist dynamically, cached in localStorage for 24h
    // ----------------------------
    const TEMPLATE_CACHE_KEY = "templateKeywordsCache";
    const TEMPLATE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

    function applyTemplatesToDatalist(templates) {
      const dl = document.getElementById("templateKeywords");
      if (!dl || !Array.isArray(templates) || templates.length === 0) return;
      dl.innerHTML = templates.map(t => `<option value="${t}">`).join("");
    }

    async function loadTemplateSuggestions({ force = false } = {}) {
      const btn = document.getElementById("refreshTemplateList");
      // Try cache first (unless forced)
      if (!force) {
        try {
          const cached = JSON.parse(localStorage.getItem(TEMPLATE_CACHE_KEY) || "null");
          if (cached && Date.now() - cached.timestamp < TEMPLATE_CACHE_TTL) {
            applyTemplatesToDatalist(cached.templates);
            return;
          }
        } catch {}
      }

      if (btn) { btn.textContent = "…"; btn.disabled = true; }
      try {
        const res = await fetch("/.netlify/functions/listTemplates");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (Array.isArray(data.templates) && data.templates.length > 0) {
          applyTemplatesToDatalist(data.templates);
          localStorage.setItem(TEMPLATE_CACHE_KEY, JSON.stringify({ templates: data.templates, timestamp: Date.now() }));
        }
      } catch { /* silently skip if function is unavailable */ }
      finally {
        if (btn) { btn.textContent = "↻"; btn.disabled = false; }
      }
    }

    loadTemplateSuggestions();
    document.getElementById("refreshTemplateList")?.addEventListener("click", () => loadTemplateSuggestions({ force: true }));

    // Convert a user-entered label → local file path
    // Handles both "Biology" → html/biologyGrad.html
    //          and "Biology A" / "biology_A" → html/biologyGrad_A.html
    function templateLabelToPath(val) {
      const variantMatch = val.match(/^(.*?)[\s_]+([A-Za-z])$/);
      if (variantMatch) {
        const base = variantMatch[1].trim().toLowerCase().replace(/\s+/g, "-");
        const variant = variantMatch[2].toUpperCase();
        return `html/${base}Grad_${variant}.html`;
      }
      return `html/${val.trim().toLowerCase().replace(/\s+/g, "-")}Grad.html`;
    }

    // ----------------------------
    // Template extraction cache
    // ----------------------------
    let extractedTemplateCache = null;   // { templateHtml, embeddedJson }
    let extractTemplatePending = null;   // holds the in-flight extraction promise
    let lastExtractedTemplate = "";      // URL or file name to avoid redundant calls

    function setTemplateExtractStatus(text, color = "rgba(234,240,255,.6)") {
      const el = document.getElementById("templateExtractStatus");
      if (el) { el.textContent = text; el.style.color = color; }
    }

    function populateTemplateExtractPanel(result) {
      const panel   = document.getElementById("templateExtractPanel");
      const jsonPre = document.getElementById("templateExtractJsonPre");
      const dlJson  = document.getElementById("dlTemplateJson");
      const cpJson  = document.getElementById("cpTemplateJson");
      const dlHtml  = document.getElementById("dlTemplateExtract");
      if (!panel) return;

      const jsonStr = JSON.stringify(result.embeddedJson ?? {}, null, 2);
      if (jsonPre) jsonPre.textContent = jsonStr;
      dlJson?.addEventListener("click", () => downloadText("spec.json", jsonStr, "application/json"));
      cpJson?.addEventListener("click", e => copyToClipboard(jsonStr, e.currentTarget));
      dlHtml?.addEventListener("click", () => downloadText("template.html", result.templateHtml || "", "text/html"));

      if (isDebugMode()) panel.classList.remove("hidden");
      document.getElementById("designSpecPanel")?.classList.add("hidden");

      // Apply colors from the embedded JSON default_color_scheme (overrides resume colors)
      const colors = result.embeddedJson?.default_color_scheme;
      if (Array.isArray(colors) && colors.length >= 1) {
        const slots = ["primary", "secondary", "accent", "dark", "light"];
        const mapped = {};
        slots.forEach((role, i) => {
          const hex = normalizeToHex(colors[i]);
          if (hex) mapped[role] = hex;
        });
        if (Object.keys(mapped).length) {
          sampleColors = { ...sampleColors, ...mapped };
          applyColors(sampleColors);
        }
      }
    }

    function extractTemplateInBackground() {
      if (extractTemplatePending) return extractTemplatePending; // join in-flight call
      extractTemplatePending = _doExtractTemplate().finally(() => { extractTemplatePending = null; });
      return extractTemplatePending;
    }

    async function _doExtractTemplate() {
      const source = document.querySelector('input[name="templateSource"]:checked')?.value;
      if (!source || source === "none") return;

      let key = "";
      let requestBody = { provider: getAnalysisProvider() };

      if (source === "url") {
        const val = document.getElementById("modelTemplate")?.value?.trim() || "";
        if (!val) return;
        if (looksLikeUrl(val)) {
          const url = normalizeTemplateUrl(val);
          if (url === lastExtractedTemplate) return;
          key = url;

          // Try client-side fetch first — avoids server-side network/SSL issues in local dev.
          // Falls back to server-side fetch (templateUrl) if CORS blocks us.
          setTemplateExtractStatus("Fetching template…", "rgba(141,224,255,.75)");
          try {
            const clientRes = await fetch(url);
            if (clientRes.ok) {
              const ct = clientRes.headers.get("content-type") || "";
              if (ct.includes("html") || ct.includes("text")) {
                const html = await clientRes.text();
                requestBody.templateHtmlBase64 = btoa(new TextEncoder().encode(html).reduce((s, b) => s + String.fromCharCode(b), ""));
              } else {
                requestBody.templateUrl = url; // non-HTML — let server handle it
              }
            } else {
              requestBody.templateUrl = url; // non-200 — let server try
            }
          } catch {
            // CORS or network error from browser — let server fetch instead
            requestBody.templateUrl = url;
          }
        } else {
          // Keyword — try pre-compiled _template.html first, fall back to calling Claude
          const srcPath      = templateLabelToPath(val);
          const compiledPath = srcPath.replace(/\.html$/, "_template.html");
          if (compiledPath === lastExtractedTemplate) return;

          // Try pre-compiled version (no API call needed)
          try {
            const res = await fetch(compiledPath);
            if (res.ok) {
              const templateHtml = await res.text();
              const commentMatch = templateHtml.match(/<!--\s*(\{[\s\S]*?\})\s*-->/);
              let embeddedJson = null;
              if (commentMatch) { try { embeddedJson = JSON.parse(commentMatch[1]); } catch {} }
              lastExtractedTemplate = compiledPath;
              extractedTemplateCache = { templateHtml, embeddedJson };
              setTemplateExtractStatus("✓ Template loaded", "rgba(118,176,34,.9)");
              populateTemplateExtractPanel(extractedTemplateCache);
              renderSuggestedPalettes();
              return;
            }
          } catch {}

          // No pre-compiled file — fetch source HTML and send to Claude
          if (srcPath === lastExtractedTemplate) return;
          try {
            const res = await fetch(srcPath);
            if (!res.ok) throw new Error(`"${srcPath}" not found (HTTP ${res.status})`);
            const html = await res.text();
            requestBody.templateHtmlBase64 = btoa(encodeURIComponent(html).replace(/%([0-9A-F]{2})/g, (_, p) => String.fromCharCode(parseInt(p, 16))));
            key = srcPath;
          } catch (e) {
            setTemplateExtractStatus(`Could not load template: ${e.message}`, "rgba(251,171,156,.8)");
            return;
          }
        }
      } else if (source === "file") {
        const file = templateScreenshotInput?.files?.[0];
        if (!file) return;
        const fileKey = file.name + "_" + file.size;
        if (fileKey === lastExtractedTemplate) return;
        key = fileKey;
        try {
          const b64 = await readFileAsBase64(file);
          if (file.type.startsWith("image/")) {
            requestBody.templateImageBase64 = b64;
            requestBody.templateImageMime   = file.type;
          } else {
            // HTML file
            requestBody.templateHtmlBase64 = b64;
          }
        } catch {
          setTemplateExtractStatus("Could not read template file.", "rgba(251,171,156,.8)");
          return;
        }
      }

      if (!key) return;
      lastExtractedTemplate = key;

      const jobId = "extract_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);

      let seconds = 120;
      setTemplateExtractStatus(`Extracting template… ${seconds}s`, "rgba(141,224,255,.75)");
      const ticker = setInterval(() => {
        seconds = Math.max(1, seconds - 1);
        setTemplateExtractStatus(`Extracting template… ${seconds}s`, "rgba(141,224,255,.75)");
      }, 1000);

      // Submit to background function (returns 202 immediately)
      try {
        const submitRes = await fetch("/.netlify/functions/extractTemplate-background", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jobId, ...requestBody })
        });
        if (!submitRes.ok) {
          clearInterval(ticker);
          setTemplateExtractStatus("Template extraction failed (could not start).", "rgba(251,171,156,.8)");
          return;
        }
      } catch (e) {
        clearInterval(ticker);
        setTemplateExtractStatus(`Template extraction failed: ${e?.message || e}`, "rgba(251,171,156,.8)");
        return;
      }

      // Poll for result
      const POLL_INTERVAL_MS = 2500;
      const POLL_TIMEOUT_MS  = 180000;
      const pollStart = Date.now();

      const pollExtract = async () => {
        if (lastExtractedTemplate !== key) { clearInterval(ticker); return; } // superseded
        if (Date.now() - pollStart > POLL_TIMEOUT_MS) {
          clearInterval(ticker);
          setTemplateExtractStatus("Template extraction timed out — try a smaller page or upload the HTML file instead.", "rgba(251,171,156,.8)");
          return;
        }

        let result;
        try {
          const res = await fetch(`/.netlify/functions/getPreviewResult?jobId=${encodeURIComponent(jobId)}`);
          const text = await res.text();
          try { result = JSON.parse(text); } catch { result = null; }
        } catch {
          setTimeout(pollExtract, POLL_INTERVAL_MS);
          return;
        }

        if (!result || result.status === "pending") {
          setTimeout(pollExtract, POLL_INTERVAL_MS);
          return;
        }

        clearInterval(ticker);

        if (result.status === "error") {
          const isNetworkErr = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(result.error || "");
          const msg = isNetworkErr
            ? "Can't reach that URL from the server (DNS/network error). Save the page as HTML and use the \"Upload\" option instead."
            : "Template extraction failed: " + (result.error || "Unknown error");
          setTemplateExtractStatus(msg, "rgba(251,171,156,.8)");
          return;
        }

        const data = { templateHtml: result.templateHtml, embeddedJson: result.embeddedJson };
        extractedTemplateCache = data;
        setTemplateExtractStatus("✓ Template extracted", "rgba(118,176,34,.9)");
        populateTemplateExtractPanel(data);
        renderSuggestedPalettes();
      };

      setTimeout(pollExtract, POLL_INTERVAL_MS);
    }

    // ----------------------------
    // Page 2: sample color extraction
    // ----------------------------
    let sampleColors = null;
    let lastExtractedUrl = "";

    function applyColors(colors) {
      if (!colors) return;
      const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
      set("primary",   colors.primary);
      set("secondary", colors.secondary);
      set("accent",    colors.accent);
      set("dark",      colors.dark);
      set("light",     colors.light);
    }

    function isOwnLibraryUrl(url) {
      if (!url) return true;
      try {
        const parsed = new URL(url, window.location.href);
        return parsed.origin === window.location.origin && parsed.pathname.startsWith("/html/");
      } catch { return false; }
    }

    function updateTemplateCopyrightVisibility() {
      const source = document.querySelector('input[name="templateSource"]:checked')?.value;
      const wrap   = document.getElementById("templateCopyrightWrap");
      if (!wrap) return;
      let show = false;
      if (source === "file") {
        show = true;
      } else if (source === "url") {
        const url = document.getElementById("modelTemplate")?.value?.trim() || "";
        show = looksLikeUrl(url) && !isOwnLibraryUrl(normalizeTemplateUrl(url));
      }
      wrap.style.display = show ? "block" : "none";
      if (!show) document.querySelectorAll('input[name="templateCopyrightMode"]').forEach(r => r.checked = false);
    }

    function updateTemplateUI() {
      const source = document.querySelector('input[name="templateSource"]:checked')?.value;
      document.getElementById("tplUrlWrap")?.classList.toggle("hidden", source !== "url");
      document.getElementById("tplFileWrap")?.classList.toggle("hidden", source !== "file");
      const designWrap = document.getElementById("designOptionsWrap");
      if (designWrap) {
        if (source === "none") {
          designWrap.classList.remove("hidden");
          updateDesignOptionsReadiness();
          if (resumeAnalysisCache && !document.querySelector('input[name="designComposition"]:checked')) {
            applyDesignDefaults(resumeAnalysisCache);
          }
        } else {
          designWrap.classList.add("hidden");
        }
      }
      updateTemplateCopyrightVisibility();

      // Show the appropriate spec panel immediately based on selection
      const extractPanel = document.getElementById("templateExtractPanel");
      const designPanel  = document.getElementById("designSpecPanel");
      if (source === "none") {
        extractPanel?.classList.add("hidden");
        if (designPanel && isDebugMode()) {
          designPanel.classList.remove("hidden");
          updateDesignSpecPanel();
        }
      } else if (source === "url" || source === "file") {
        designPanel?.classList.add("hidden");
        if (extractPanel && isDebugMode()) {
          extractPanel.classList.remove("hidden");
          if (extractedTemplateCache) {
            populateTemplateExtractPanel(extractedTemplateCache);
          } else {
            const pre = document.getElementById("templateExtractJsonPre");
            if (pre && !pre.textContent) pre.textContent = "Click Next → to extract the template spec.";
          }
        }
      } else {
        extractPanel?.classList.add("hidden");
        designPanel?.classList.add("hidden");
      }
    }

    function updateDesignOptionsReadiness() {
      const designWrap = document.getElementById("designOptionsWrap");
      if (!designWrap) return;
      const analysisReady = !!resumeAnalysisCache;
      const inputs = designWrap.querySelectorAll("input");

      // Ensure the wait-message element exists
      let waitMsg = document.getElementById("_designOptionsWaitMsg");
      if (!waitMsg) {
        waitMsg = document.createElement("div");
        waitMsg.id = "_designOptionsWaitMsg";
        waitMsg.style.cssText = "font-size:12px; padding:6px 8px; border-radius:8px; background:rgba(251,171,156,.12); color:rgba(251,171,156,.9); margin-bottom:4px;";
        waitMsg.textContent = "Please wait for resume analysis to finish.";
        designWrap.insertBefore(waitMsg, designWrap.firstChild);
      }

      if (analysisReady) {
        waitMsg.style.display = "none";
        inputs.forEach(inp => { inp.disabled = false; inp.style.opacity = ""; });
      } else {
        waitMsg.style.display = "block";
        inputs.forEach(inp => { inp.disabled = true; inp.style.opacity = "0.35"; });
      }
    }

    function applyDesignDefaults(resumeJson) {
      const renderingStyles = (resumeJson?.motifs?.rendering_style || []).join(" ").toLowerCase();
      const motifs          = (resumeJson?.motifs?.potential_visual_motifs || []).join(" ").toLowerCase();
      const editorialMotifs = (resumeJson?.editorial_direction?.suggested_visual_motifs || []).join(" ").toLowerCase();
      const domain          = (resumeJson?.motifs?.broad_primary_domain || "").toLowerCase();
      const allText         = renderingStyles + " " + motifs + " " + editorialMotifs + " " + domain;

      // ── Render mode ──────────────────────────────────────────────────────────
      let renderVal = "cinematic technical minimalism";
      if (/scientific|elegant|3d|soft/i.test(allText))                    renderVal = "3D scientific elegance";
      else if (/futuristic|bold|engineering|schematic/i.test(allText))    renderVal = "bold futuristic engineering";
      const renderRadio = document.querySelector(`input[name="designRenderMode"][value="${renderVal}"]`);
      if (renderRadio) renderRadio.checked = true;

      // ── Style ────────────────────────────────────────────────────────────────
      let styleVal = "clean-minimal";
      if (/dark|terminal|circuit|radar|cyber/i.test(allText))              styleVal = "dark terminal";
      else if (/neon|tech|laser|glow|electric/i.test(allText))            styleVal = "neon-tech";
      else if (/glass.*dark|dark.*glass/i.test(allText))                  styleVal = "glass-dark";
      else if (/glass/i.test(allText))                                    styleVal = "glassmorphism";
      else if (/pastel|soft|editorial|organic|bio/i.test(allText))        styleVal = "soft pastel editorial";
      else if (/swiss|grid|structured|finance|account/i.test(allText))    styleVal = "Swiss grid";
      else if (/brut/i.test(allText))                                     styleVal = "brutalist";
      const styleRadio = document.querySelector(`input[name="designStyle"][value="${styleVal}"]`);
      if (styleRadio) styleRadio.checked = true;

      // ── Composition ──────────────────────────────────────────────────────────
      let compVal = "split-left";
      if (/lab|workshop|field|scene|environment|desk/i.test(allText))           compVal = "scene-based";
      else if (/abstract|layered|gradient|ring|grid|constellation/i.test(allText)) compVal = "abstract_layered";
      else if (/central|symmetric|center/i.test(allText))                       compVal = "central";
      const compRadio = document.querySelector(`input[name="designComposition"][value="${compVal}"]`);
      if (compRadio) compRadio.checked = true;
    }

    // Normalize any CSS color string to a 6-digit hex value using canvas
    function normalizeToHex(color) {
      if (!color) return null;
      const s = String(color).trim();
      if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
      if (/^#[0-9a-f]{3}$/i.test(s)) {
        const [, r, g, b] = s;
        return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
      }
      try {
        const ctx = document.createElement("canvas").getContext("2d");
        ctx.fillStyle = s;
        const hex = ctx.fillStyle; // browser normalises to #rrggbb or rgba(...)
        if (/^#[0-9a-f]{6}$/i.test(hex)) return hex.toLowerCase();
      } catch {}
      return null;
    }

    function applyColorDefaults(resumeJson) {
      // Template colors take priority — skip if already extracted from a template
      if (sampleColors) return;
      const colors = resumeJson?.compatible_color_scheme?.five_key_colors;
      if (!Array.isArray(colors) || colors.length === 0) return;
      const slots = ["primary", "secondary", "accent", "dark", "light"];
      slots.forEach((id, i) => {
        const hex = normalizeToHex(colors[i]);
        if (!hex) return;
        const input = document.getElementById(id);
        if (input && input.type === "color") input.value = hex;
      });
    }

    function updateDesignSpecPanel() {
      const source = document.querySelector('input[name="templateSource"]:checked')?.value;
      const extractPanel = document.getElementById("templateExtractPanel");
      const designPanel  = document.getElementById("designSpecPanel");
      if (source === "none") {
        extractPanel?.classList.add("hidden");
        if (designPanel) {
          const spec    = getPage3Template();
          const jsonStr = JSON.stringify(spec, null, 2);
          const pre     = document.getElementById("designSpecPre");
          if (pre) pre.textContent = jsonStr;
          const dlBtn = document.getElementById("dlDesignSpec");
          const cpBtn = document.getElementById("cpDesignSpec");
          dlBtn?.addEventListener("click", () => downloadText("design-spec.json", jsonStr, "application/json"));
          cpBtn?.addEventListener("click", e => copyToClipboard(jsonStr, e.currentTarget));
          if (isDebugMode()) designPanel.classList.remove("hidden");
        }
      } else {
        designPanel?.classList.add("hidden");
        // templateExtractPanel visibility is managed by populateTemplateExtractPanel after extraction
      }
    }

    document.querySelectorAll('input[name="templateSource"]').forEach(r =>
      r.addEventListener("change", () => {
        updateTemplateUI();
        updateDesignSpecPanel();
        // Fire extraction if switching to url (with existing value) or file (with existing file)
        extractTemplateInBackground();
      }));
    document.getElementById("modelTemplate")?.addEventListener("input", updateTemplateCopyrightVisibility);
    document.getElementById("modelTemplate")?.addEventListener("blur", extractTemplateInBackground);

    // Also trigger extraction when a file is selected while source=file
    templateScreenshotInput?.addEventListener("change", extractTemplateInBackground);

    // Refresh design spec JSON live as design options change
    document.querySelectorAll('input[name="designComposition"], input[name="designStyle"], input[name="designRenderMode"]')
      .forEach(r => r.addEventListener("change", updateDesignSpecPanel));

    async function fetchSampleColors(templateUrl) {
      if (!templateUrl || templateUrl === lastExtractedUrl) return;
      lastExtractedUrl = templateUrl;

      const bar    = document.getElementById("sampleColorsBar");
      const status = document.getElementById("sampleColorsStatus");
      if (bar)    bar.style.display = "flex";
      if (status) status.textContent = "Extracting colors from template…";

      try {
        const res  = await fetch(`/.netlify/functions/extractTemplateColors?url=${encodeURIComponent(templateUrl)}`);
        const data = await res.json();
        if (data.error) {
          if (status) status.textContent = "Could not extract colors from template.";
          return;
        }
        sampleColors = data;
        applyColors(sampleColors);
        if (status) status.textContent = "Colors pre-filled from template.";
      } catch {
        if (status) status.textContent = "Color extraction failed.";
      }
    }

    document.getElementById("resetToSampleColors")?.addEventListener("click", () => {
      applyColors(sampleColors);
    });

    document.getElementById("useSampleColors")?.addEventListener("change", function () {
      const overlay = document.getElementById("sampleColorsOverlay");
      if (overlay) overlay.style.display = this.checked ? "block" : "none";
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
        specialization: document.getElementById("specialization").value.trim()
      };
    }

    // ----------------------------
    // Artifact rows (Page 2)
    // ----------------------------
    const ARTIFACT_TYPES = [
      { value: "image",    label: "Image (png/jpg/svg)" },
      { value: "url",      label: "URL" },
      { value: "html",     label: "HTML" },
      { value: "youtube",  label: "YouTube video" },
      { value: "text",     label: "Text / Markdown" },
    ];
    let artifactRowCount = 0;

    function addArtifactRow(type = "", content = "", tagline = "") {
      const id = ++artifactRowCount;
      const row = document.createElement("div");
      row.id = `artifactRow_${id}`;
      row.className = "artifactRow";

      const sel = document.createElement("select");
      sel.innerHTML = `<option value="">— type —</option>` +
        ARTIFACT_TYPES.map(t =>
          `<option value="${t.value}"${type === t.value ? " selected" : ""}>${t.label}</option>`
        ).join("");

      const txt = document.createElement("input");
      txt.type = "text";
      txt.placeholder = "File name, URL, or content…";
      txt.value = content;

      const tag = document.createElement("input");
      tag.type = "text";
      tag.placeholder = "Tagline…";
      tag.value = tagline;

      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "×";
      del.className = "btn ghost mini";
      del.style.cssText = "padding:4px 9px; font-size:15px; line-height:1;";
      del.addEventListener("click", () => row.remove());

      row.append(sel, txt, tag, del);
      document.getElementById("artifactRows").appendChild(row);
    }

    function getPage2Artifacts(){
      const rows = [];
      document.querySelectorAll("#artifactRows .artifactRow").forEach(row => {
        const sel = row.querySelector("select");
        const inputs = row.querySelectorAll("input[type='text']");
        rows.push({
          type:    sel?.value || "",
          content: inputs[0]?.value?.trim() || "",
          tagline: inputs[1]?.value?.trim() || ""
        });
      });
      return { artifacts: rows };
    }

    function getPage3Template(){
      const templateSource = document.querySelector('input[name="templateSource"]:checked')?.value || "";
      const styleVal = document.querySelector('input[name="designStyle"]:checked')?.value || "";
      return {
        template_source: templateSource,
        model_template: templateSource === "url" ? (document.getElementById("modelTemplate")?.value?.trim() || "") : "",
        template_copyright_mode: document.querySelector('input[name="templateCopyrightMode"]:checked')?.value || "",
        design_composition: document.querySelector('input[name="designComposition"]:checked')?.value || "",
        design_style: styleVal === "other" ? (document.getElementById("designStyleOther")?.value?.trim() || "other") : styleVal,
        design_render_mode: document.querySelector('input[name="designRenderMode"]:checked')?.value || ""
      };
    }

    function getPage4Colors(){
      return {
        themeNumber: document.getElementById("themeNumber")?.value?.trim() || "",
        use_sample_colors: document.getElementById("useSampleColors")?.checked || false,
        theme: {
          primary: document.getElementById("primary").value.trim(),
          secondary: document.getElementById("secondary").value.trim(),
          accent: document.getElementById("accent").value.trim(),
          dark: document.getElementById("dark").value.trim(),
          light: document.getElementById("light").value.trim()
        }
      };
    }

    function getPage5Job(){
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

      if (!document.querySelector('input[name="templateSource"]:checked'))
        throw new Error("Please select a portfolio template option on page 3.");

      const copyrightWrap = document.getElementById("templateCopyrightWrap");
      if (copyrightWrap?.style.display !== "none") {
        if (!document.querySelector('input[name="templateCopyrightMode"]:checked'))
          throw new Error("Please indicate how the external template may be used before submitting.");
      }

      // Collect new page data and map to API-compatible structure
      const p1 = getPage1();
      const p2 = getPage2Artifacts();
      const p3 = getPage3Template();
      const p4 = getPage4Colors();
      const p5 = getPage5Job();
      // Backend expects: page1 = basic+template, page2 = colors, page3 = job
      const page1 = { ...p1, ...p3, artifacts: p2 };
      const page2 = p4;
      const page3 = p5;
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
        body: JSON.stringify({ page1, page2, page3, jobId, resumePdfBase64, headshotName, templateScreenshotBase64, templateScreenshotMime, use_three_prompt: document.getElementById("useThreePrompt")?.checked || false })
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

        const pollRes = await fetch(`/.netlify/functions/getPreviewResult?jobId=${jobId}`);
        const data = await pollRes.json().catch(() => ({}));

        // Show per-stage progress message if the three-prompt pipeline provides one
        const stageMsg = data.stage ? `${data.stage} (${remaining}s remaining)` : `Generating your portfolio website… ${remaining}s remaining`;
        finalStatus.textContent = stageMsg;

        if (data.status === "done") {
          localStorage.setItem("portfolio_preview_html", data.site_html);
          // Wire download buttons and reveal them for admin users
          const dlHtml = document.getElementById("dlFinalHtml");
          const dlSummary = document.getElementById("dlSummaryHtml");
          const dlJson = document.getElementById("dlResumeJson");
          dlHtml.onclick = () => downloadText("portfolio.html", data.site_html, "text/html");
          const all = { page1, page2, page3, artifacts: p2 };
          const summaryHtml = buildSummaryHtml(all);
          dlSummary.onclick = () => downloadText("MyPersonalPortfolioWebsiteSummary.html", summaryHtml, "text/html");
          if (data.resume_json) {
            dlJson.onclick = () => downloadText("resume-extracted.json", JSON.stringify(data.resume_json, null, 2), "application/json");
            dlJson.classList.remove("hidden");
          }
          if (page1.specialization === "Irene's Webworks" || isDebugMode()) {
            dlHtml.classList.remove("hidden");
            dlSummary.classList.remove("hidden");
          }

          // ── Debug panel ──────────────────────────────────────────────────
          if (isDebugMode()) {
            const debugSection = document.getElementById("debugSection");
            if (debugSection) debugSection.classList.remove("hidden");

            // Form payload
            const payload = { page1, page2, page3 };
            const payloadStr = JSON.stringify(payload, null, 2);
            const payloadPre = document.getElementById("debugPayloadPre");
            if (payloadPre) payloadPre.textContent = payloadStr;
            document.getElementById("dlDebugPayload")?.addEventListener("click", () =>
              downloadText("payload.json", payloadStr, "application/json"));
            document.getElementById("cpDebugPayload")?.addEventListener("click", e =>
              copyToClipboard(payloadStr, e.currentTarget));

            // Resume JSON — prefer three-prompt resume_json, fall back to analyzeResume cache
            const resumePre = document.getElementById("debugResumeJsonPre");
            const resumeJsonToShow = data.resume_json || resumeAnalysisCache;
            if (resumeJsonToShow) {
              const resumeStr = JSON.stringify(resumeJsonToShow, null, 2);
              if (resumePre) resumePre.textContent = resumeStr;
              const dlResume = document.getElementById("dlResumeJson");
              if (dlResume) {
                dlResume.onclick = () => downloadText("resume-extracted.json", resumeStr, "application/json");
                dlResume.classList.remove("hidden");
              }
            } else {
              if (resumePre) resumePre.textContent = "(not available — upload resume to trigger analysis)";
            }

            // API response metadata (omit large fields)
            const { site_html: _html, ...metaData } = data;
            const metaStr = JSON.stringify({ ...metaData, has_site_html: !!data.site_html }, null, 2);
            const apiResponsePre = document.getElementById("debugApiResponsePre");
            if (apiResponsePre) apiResponsePre.textContent = metaStr;
            document.getElementById("dlDebugApiResponse")?.addEventListener("click", () =>
              downloadText("api-response.json", metaStr, "application/json"));
          }
          finalStatus.innerHTML = data.truncated
            ? `<span class="ok">Portfolio ready</span> <span class="hint">(output was cut short — some sections may be missing; try regenerating)</span>`
            : `<span class="ok">Portfolio ready.</span> Open the editor below.`;
          const editorBtn = document.getElementById("btnOpenEditor");
          if (editorBtn) { editorBtn.disabled = false; editorBtn.style.opacity = ""; editorBtn.style.cursor = ""; }
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

    // Page 1 — reset resets only page 1 fields (major, specialization, resume)
    const reset1 = document.getElementById("reset1");
    if (reset1) makeDoubleClickReset(reset1, () => {
      ["major","specialization"].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = "";
      });
      if (resumeUpload) resumeUpload.value = "";
      if (resumeFileList) resumeFileList.innerHTML = "";
      resumeAnalysisCache = null;
      setResumeAnalysisStatus("");
    });

    document.getElementById("next1")?.addEventListener("click", () => {
      const errs = [];
      if (!validateField("major",          true)) errs.push("major");
      if (!validateField("specialization", true)) errs.push("specialization");
      if (!resumeUpload.files?.length) {
        const msg = document.getElementById("_msg_resumeUpload") || (() => {
          const m = document.createElement("div");
          m.id = "_msg_resumeUpload";
          m.style.cssText = "font-size:11.5px; margin-top:3px; min-height:14px;";
          resumeUpload.closest(".dropzone")?.after(m);
          return m;
        })();
        msg.textContent = "Please upload your resume.";
        msg.style.color = "rgba(251,171,156,.9)";
        errs.push("resume");
      }
      if (errs.length) return;
      setStep(2);
    });

    // Page 2 (Colors)
    document.getElementById("back2_bottom")?.addEventListener("click", () => setStep(1));
    document.getElementById("next2_bottom")?.addEventListener("click", () => {
      const el = document.getElementById("stepConfirmStatus");
      if (el) { el.textContent = "Artifacts noted"; el.style.color = "rgba(118,176,34,.9)"; }
      setStep(3);
    });

    // Artifact rows — wire add button
    document.getElementById("addArtifact")?.addEventListener("click", () => addArtifactRow());

    // Page 3 (Website Spec / Template)
    function onEnterPage3() {
      const source = document.querySelector('input[name="templateSource"]:checked')?.value;
      if (source === "none") {
        updateDesignSpecPanel();
      } else if (extractedTemplateCache) {
        populateTemplateExtractPanel(extractedTemplateCache);
      }
    }

    document.getElementById("back3_bottom")?.addEventListener("click", () => setStep(2));

    document.getElementById("next3_bottom")?.addEventListener("click", async () => {
      const source = document.querySelector('input[name="templateSource"]:checked')?.value;

      // Helper to show an inline error near the radio group
      function showSourceMsg(text) {
        let msg = document.getElementById("_msg_templateSource");
        if (!msg) {
          msg = document.createElement("div");
          msg.id = "_msg_templateSource";
          msg.style.cssText = "font-size:11.5px; margin-top:4px; min-height:14px; color:rgba(251,171,156,.9);";
          const anchor = document.querySelector('[name="templateSource"]')?.closest(".grid");
          if (anchor) anchor.after(msg);
        }
        msg.textContent = text;
      }

      if (!source) { showSourceMsg("Please select a template option."); return; }
      document.getElementById("_msg_templateSource") && (document.getElementById("_msg_templateSource").textContent = "");

      // Pre-validate inputs before touching the UI
      if (source === "url") {
        const val = document.getElementById("modelTemplate")?.value?.trim() || "";
        if (!val) { showSourceMsg("Please enter a URL or keyword (e.g. biology, psychology)."); return; }
      }
      if (source === "file") {
        const file = templateScreenshotInput?.files?.[0];
        if (!file) { showSourceMsg("Please select a screenshot or HTML file."); return; }
      }

      // c) Copyright question must be answered if the panel is visible
      const copyrightWrap = document.getElementById("templateCopyrightWrap");
      if (copyrightWrap && copyrightWrap.style.display !== "none") {
        const copyrightAnswered = !!document.querySelector('input[name="templateCopyrightMode"]:checked');
        if (!copyrightAnswered) {
          showSourceMsg("Please answer the website spec question before continuing.");
          copyrightWrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
          return;
        }
      }

      if (source === "none") {
        updateDesignSpecPanel();
        if (isDebugMode()) document.getElementById("designSpecPanel")?.classList.remove("hidden");
        setStep(4);
        return;
      }

      // b) Fire extraction (or join in-flight), then proceed to page 4 immediately
      extractTemplateInBackground().then(() => {
        if (isDebugMode() && extractedTemplateCache) {
          populateTemplateExtractPanel(extractedTemplateCache);
          document.getElementById("templateExtractPanel")?.classList.remove("hidden");
          document.getElementById("templateExtractPanel")?.querySelector("details")?.setAttribute("open", "");
          document.getElementById("designSpecPanel")?.querySelector("details")?.setAttribute("open", "");
        }
      });

      setStep(4);
    });

    document.getElementById("next2_bottom")?.addEventListener("click", onEnterPage3);
    document.getElementById("back4")?.addEventListener("click", onEnterPage3);

    // Page 4 (Colors)
    const PALETTE_SLOTS = ["primary", "secondary", "accent", "dark", "light"];

    function renderSuggestedPalettes(analysisData) {
      const msg = document.getElementById("suggestedPalettesMsg");
      const container = document.getElementById("suggestedPalettes");
      const rows      = document.getElementById("suggestedPalettesRows");
      if (!container || !rows) return;

      // Slot 0: template palette (null if unavailable)
      const tplColors = extractedTemplateCache?.embeddedJson?.default_color_scheme;
      let tplPalette = null;
      if (tplColors && !Array.isArray(tplColors) && typeof tplColors === "object") {
        const { primary, secondary, accent, dark, light } = tplColors;
        if (primary || secondary || accent) {
          tplPalette = { label: "Template palette", colors: { primary, secondary, accent, dark, light } };
        }
      }

      // Slots 1-3: up to 3 AI palettes from resume analysis
      const aiPalettes = (analysisData ?? resumeAnalysisCache)?.compatible_color_schemes ?? [];
      const aiRows = aiPalettes
        .filter(p => p.primary || p.secondary || p.accent)
        .slice(0, 3)
        .map((p, i) => ({
          label: p.how_used || `AI palette ${i + 1}`,
          colors: { primary: p.primary, secondary: p.secondary, accent: p.accent, dark: p.dark, light: p.light }
        }));

      // Fixed layout: [template, ai1, ai2, ai3] — null for empty slots
      const visible = [tplPalette, ...aiRows];
      while (visible.length < 4) visible.push(null);

      const MAX = 4;
      const populated = visible.filter(Boolean).length;
      if (msg) msg.style.display = populated >= MAX ? "none" : "block";

      rows.innerHTML = "";
      visible.slice(0, MAX).forEach(palette => {
        const empty = !palette;
        const row = document.createElement("label");
        row.style.cssText = `display:flex; flex-direction:column; gap:5px; padding:7px 10px; border-radius:8px; border:1px solid rgba(255,255,255,.1); background:rgba(0,0,0,.15); cursor:${empty ? "default" : "pointer"};`;

        const cb = document.createElement("input");
        cb.type = "radio";
        cb.name = "suggestedPalette";
        cb.disabled = empty;
        cb.style.cssText = "width:14px; height:14px; accent-color:var(--primary); flex-shrink:0; margin-top:1px;";
        if (!empty) cb.style.cursor = "pointer";
        cb.addEventListener("change", () => {
          if (cb.checked) applyColors(palette.colors);
        });

        const swatches = document.createElement("div");
        swatches.style.cssText = "display:flex; gap:3px; flex-shrink:0; margin-left:10px;";
        PALETTE_SLOTS.forEach(slot => {
          const s = document.createElement("span");
          const color = empty ? "rgba(255,255,255,.07)" : (palette.colors[slot] || "#888");
          s.style.cssText = `width:44px; height:23px; border-radius:4px; background:${color}; border:2px solid rgba(255,255,255,.85); display:inline-block; box-shadow:0 0 0 1px rgba(0,0,0,.25);${empty ? "" : " cursor:pointer;"}`;
          if (!empty) {
            // Click (single or double): apply this swatch's color to the last-focused (or first) color picker
            const applySwatchColor = e => {
              e.stopPropagation();
              e.preventDefault();
              const targetId = typeof focusedColorId !== "undefined" ? focusedColorId : "primary";
              const input = document.getElementById(targetId);
              if (input) input.value = palette.colors[slot] || "#000000";
            };
            s.addEventListener("click", applySwatchColor);
            s.addEventListener("dblclick", applySwatchColor);
          }
          swatches.appendChild(s);
        });

        const topRow = document.createElement("div");
        topRow.style.cssText = "display:flex; align-items:center; gap:10px;";
        topRow.append(cb, swatches);

        const lbl = document.createElement("span");
        lbl.style.cssText = "font-size:12px; font-weight:400; line-height:1.4; white-space:normal; width:100%;";
        lbl.style.color = empty ? "rgba(255,255,255,.18)" : "rgba(234,240,255,.7)";
        lbl.textContent = empty ? "" : palette.label;

        row.append(topRow, lbl);
        rows.appendChild(row);
      });
    }

    renderSuggestedPalettes(); // render blank rows immediately
    document.getElementById("next3_bottom")?.addEventListener("click", renderSuggestedPalettes);
    document.getElementById("back4")?.addEventListener("click", () => setStep(3));
    document.getElementById("next4")?.addEventListener("click", () => setStep(5));

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

    // Page 5 (Job / Submit)
    document.getElementById("back5_top")?.addEventListener("click", () => setStep(4));
    document.getElementById("back5")?.addEventListener("click",     () => setStep(4));
    document.getElementById("btnOpenEditor")?.addEventListener("click", () => {
      window.open("editor.html", "_blank");
    });
    async function doSubmit(){
      if (!document.querySelector('input[name="templateSource"]:checked')) {
        let msg = document.getElementById("_msg_templateSource");
        if (!msg) {
          msg = document.createElement("div");
          msg.id = "_msg_templateSource";
          msg.style.cssText = "font-size:11.5px; margin-top:4px; min-height:14px; color:rgba(251,171,156,.9);";
          const anchor = document.querySelector('[name="templateSource"]')?.closest(".grid");
          if (anchor) anchor.after(msg);
        }
        if (msg) { msg.textContent = "Please select a template option."; msg.style.color = "rgba(251,171,156,.9)"; }
        return;
      }
      const copyrightWrap = document.getElementById("templateCopyrightWrap");
      if (copyrightWrap?.style.display !== "none") {
        if (!document.querySelector('input[name="templateCopyrightMode"]:checked')) {
          let msg = document.getElementById("_msg_templateCopyright");
          if (!msg) {
            msg = document.createElement("div");
            msg.id = "_msg_templateCopyright";
            msg.style.cssText = "font-size:11.5px; margin-top:4px; color:rgba(251,171,156,.9);";
            copyrightWrap.appendChild(msg);
          }
          msg.textContent = "Please indicate how the template may be used.";
          return;
        }
      }
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
    document.getElementById("submit_top")?.addEventListener("click",    doSubmit);
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
    updateDebugBanner();
    updateProviderBadge();
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