
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
    let resumeAnalysisCache = null;   // parsed JSON from analyzeResume (debug mode only)
    let lastAnalysisData    = null;   // always set after analysis — used for palette rendering
    let resumeAnalysisPending = false; // true while request in flight

    // ----------------------------
    // Generation state
    // ----------------------------
    let generationResult    = null;  // data object when done
    let generationError     = null;  // error message on failure
    let generationInProgress = false;

    // Pre-computed job+resume strategy (triggered on Job Next, consumed by strategizeContent)
    let jobAnalysisResult     = null;   // {strategy_json, resume_json} when done
    let jobAnalysisInProgress = false;


    // Job Ad Extraction (triggered on page 2 Next, parallel with resume analysis wait)
    let jobAdResult      = null;   // {job_ad: {...}} when done
    let jobAdInProgress  = false;

    // Bridge Profile & Design (triggered on Colors Next)
    let bridgeResult      = null;   // {bridge_json, model} when done
    let bridgeInProgress  = false;

    // ----------------------------
    // Per-field validation
    // ----------------------------
    const FIELD_VALIDATORS = {
      major:          v => v.trim() ? null : "Major is required.",
      specialization: v => v.trim() ? null : "Specialization is required.",
      modelTemplate: v => {
        if (!v.trim()) return null;
        if (looksLikeUrl(v.trim())) return "Please enter a name or keyword, not a URL.";
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
      lastAnalysisData = null;
      document.getElementById("reanalyzeResume").style.display = hasFile ? "inline" : "none";
      if (hasFile) {
        analyzeResumeInBackground(input.files[0]);
      } else {
        setResumeAnalysisStatus("");
      }
    });

    document.getElementById("reanalyzeResume")?.addEventListener("click", () => {
      const input = document.getElementById("resumeUpload");
      if (!input?.files?.[0]) return;
      const file = input.files[0];
      try { localStorage.removeItem(resumeCacheKey(file)); } catch {}
      resumeAnalysisCache = null;
      lastAnalysisData = null;
      analyzeResumeInBackground(file);
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
      // Show/hide debug Submit buttons on all pages
      document.querySelectorAll(".dbg-submit-row").forEach(el => {
        el.style.display = debug ? "flex" : "none";
      });
      // Show/hide debug-only rows (display:block)
      const templateModeRow = document.getElementById("templateModeRow");
      if (templateModeRow) templateModeRow.style.display = debug ? "" : "none";
      // Show/hide consolidated stage debug section on page 5
      document.getElementById("stagesDebugSection")?.classList.toggle("hidden", !debug);
    }

    document.getElementById("major")?.addEventListener("input", () => {
      updateDebugBanner();
      updateProviderBadge();
    });

    // ----------------------------
    // Resume analysis (background)
    // ----------------------------
    function updateSubmitReadiness() {
      // Page 5 buttons are managed by setApplyBtnState(); just update the readiness message.
      const msg = document.getElementById("submitReadinessMsg");
      if (!msg) return;
      const resumePending  = !!resumeAnalysisPending;
      const extractPending = !!extractTemplatePending;
      const busy = resumePending || extractPending;
      if (busy) {
        const parts = [];
        if (resumePending)  parts.push("resume analysis");
        if (extractPending) parts.push("template extraction");
        msg.textContent = `Waiting for ${parts.join(" and ")} to complete…`;
        msg.style.display = "block";
      } else {
        msg.style.display = "none";
      }
    }

    function setApplyBtnState(enabled) {
      ["submit_top", "next2_bottom"].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.disabled = !enabled;
        btn.style.opacity = enabled ? "" : "0.45";
        btn.style.cursor  = enabled ? "" : "not-allowed";
      });
    }

    // ----------------------------
    function setResumeAnalysisStatus(text, color = "rgba(234,240,255,.6)") {
      ["resumeAnalysisStatus", "resumeAnalysisStatusInline"].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.textContent = text; el.style.color = color; }
      });
    }

    function setHeaderStatus(id, text, color = "rgba(234,240,255,.6)") {
      const el = document.getElementById(id);
      if (el) { el.textContent = text; el.style.color = color; }
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

      // Stage 1 buttons on page 5 debug section
      const dl1 = document.getElementById("dlStage1");
      const cp1 = document.getElementById("cpStage1");
      if (dl1) dl1.onclick = () => downloadText("resume-analysis.json", str, "application/json");
      if (cp1) cp1.onclick = e => copyToClipboard(str, e.currentTarget);

      if (isDebugMode()) panel.classList.remove("hidden");

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

    function resumeCacheKey(file) {
      return `resumeAnalysis_v3:${file.name}:${file.size}:${file.lastModified}`;
    }

    async function analyzeResumeInBackground(file) {
      // Only PDFs are supported for analysis
      if (file.type && !file.type.includes("pdf")) {
        setResumeAnalysisStatus("Analysis requires a PDF. Upload complete.", "rgba(234,240,255,.5)");
        return;
      }

      // Check localStorage cache before hitting the API
      let cachedData = null;
      try {
        const cached = localStorage.getItem(resumeCacheKey(file));
        if (cached) cachedData = JSON.parse(cached);
      } catch {}
      if (cachedData) {
        lastAnalysisData = cachedData;
        if (isDebugMode()) resumeAnalysisCache = cachedData;
        setResumeAnalysisStatus("✓ Resume analyzed (cached)", "rgba(118,176,34,.9)");
        populateResumeDebugPanel(cachedData);
        renderSuggestedPalettes(cachedData);
        return;
      }

      resumeAnalysisPending = true;
      updateSubmitReadiness();

      let base64;
      try {
        base64 = await readFileAsBase64(file);
      } catch (e) {
        resumeAnalysisPending = false;
        updateSubmitReadiness();
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
          updateSubmitReadiness();
          setResumeAnalysisStatus("Resume analysis failed (could not start).", "rgba(251,171,156,.8)");
          return;
        }
      } catch (e) {
        clearInterval(countdownTimer);
        resumeAnalysisPending = false;
        updateSubmitReadiness();
        setResumeAnalysisStatus("Resume analysis failed (network error).", "rgba(251,171,156,.8)");
        return;
      }

      // Poll getPreviewResult until done or timeout
      const POLL_INTERVAL_MS = 2500;
      const POLL_TIMEOUT_MS  = 300000; // 5 minutes // 3 minutes max
      const pollStart = Date.now();

      const poll = async () => {
        if (!resumeAnalysisPending) return; // cancelled externally (e.g. new file uploaded)
        if (Date.now() - pollStart > POLL_TIMEOUT_MS) {
          clearInterval(countdownTimer);
          resumeAnalysisPending = false;
          updateSubmitReadiness();
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
        updateSubmitReadiness();

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

        // Persist to localStorage for reuse after refresh
        try { localStorage.setItem(resumeCacheKey(file), JSON.stringify(data)); } catch {}

        lastAnalysisData = data;
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
      { id: "page5", label: "2 Job" },
      { id: "page3", label: "3 Design" },
      { id: "page4", label: "4 Colors" },
      { id: "page2",  label: "5 Visuals" },
      { id: "page2b", pageId: "page2", label: "6 Edit" },
      { id: "page2c", pageId: "page2", label: "7 Publish" },
    ];
    let currentStep = 0;

    const stepPills = document.getElementById("stepPills");
    const stepLabel = document.getElementById("stepLabel");
    const progressBar = document.getElementById("progressBar");

    function getPageId(entry){ return entry.pageId ?? entry.id; }

    let pillNavUnlocked = false;

    function renderStepUI(){
      const activePageId = getPageId(PAGES[currentStep]);
      stepPills.innerHTML = "";
      PAGES.forEach((p, idx) => {
        if (idx === 0) return; // skip Overview pill
        const pill = document.createElement("div");
        pill.className = "pill" + (getPageId(p) === activePageId ? " active" : "");
        pill.textContent = p.label;
        if (pillNavUnlocked) {
          pill.style.cursor = "pointer";
          pill.addEventListener("click", () => setStep(idx));
        }
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
      if (currentStep === 4) renderSuggestedPalettes();
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
    const resumeUpload = document.getElementById("resumeUpload");

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
    let extractedTemplateCache = null;   // { templateHtml, embeddedJson, templateMode }
    let extractTemplatePending = null;   // holds the in-flight extraction promise
    let lastExtractedTemplate = "";      // URL or file name to avoid redundant calls
    let extractTicker = null;            // active countdown interval — cleared on each new extraction

    function setTemplateExtractStatus(text, color = "rgba(234,240,255,.6)") {
      const el = document.getElementById("templateExtractStatus");
      if (el) { el.textContent = text; el.style.color = color; }
    }

    function populateTemplateExtractPanel(result) {
      const panel    = document.getElementById("templateExtractPanel");
      const jsonPre  = document.getElementById("templateExtractJsonPre");
      const htmlPre  = document.getElementById("templateExtractHtmlPre");
      const dlJson   = document.getElementById("dlTemplateJson");
      const cpJson   = document.getElementById("cpTemplateJson");
      const dlHtml   = document.getElementById("dlTemplateExtract");
      if (!panel) return;

      const jsonStr = JSON.stringify(result.embeddedJson ?? {}, null, 2);
      if (jsonPre) jsonPre.textContent = jsonStr;
      if (htmlPre) htmlPre.textContent = result.templateHtml || "(no HTML returned)";
      dlJson?.addEventListener("click", () => downloadText("spec.json", jsonStr, "application/json"));
      cpJson?.addEventListener("click", e => copyToClipboard(jsonStr, e.currentTarget));
      dlHtml?.addEventListener("click", () => downloadText("template.html", result.templateHtml || "", "text/html"));


      if (isDebugMode()) panel.classList.remove("hidden");

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
      extractTemplatePending = _doExtractTemplate().finally(() => {
        extractTemplatePending = null;
        updateSubmitReadiness();
      });
      updateSubmitReadiness();
      return extractTemplatePending;
    }

    async function _doExtractTemplate() {
      const source = document.querySelector('input[name="templateSource"]:checked')?.value;
      if (!source) return;

      const extractMode = document.getElementById("extractTemplateMode")?.value || "analysis";

      let key = "";
      let requestBody = { provider: getAnalysisProvider(), templateMode: extractMode };

      if (source === "none") {
        const styleVal = document.getElementById("designStyle")?.value || "";
        const jsonSpec = {
          source:             "design_options",
          composition:        document.getElementById("designComposition")?.value  || "",
          style:              styleVal === "other" ? (document.getElementById("designStyleOther")?.value?.trim() || "custom") : styleVal,
          render_mode:        document.getElementById("designRenderMode")?.value   || "",
          density:            document.getElementById("designDensity")?.value      || "medium",
          use_emoji_icons:    document.getElementById("useEmojiIcons")?.value      === "yes",
          alternate_sections: document.getElementById("alternateSections")?.value  !== "no"
        };
        key = "design_options_" + JSON.stringify(jsonSpec);
        if (key === lastExtractedTemplate) return;
        const p1 = getPage1();
        requestBody.templateJsonStr = JSON.stringify(jsonSpec, null, 2);
        requestBody.major           = p1.major;
        requestBody.specialization  = p1.specialization;
      } else if (source === "keyword") {
        const val = document.getElementById("modelTemplate")?.value?.trim() || "";
        if (!val || looksLikeUrl(val)) return;

        // Keyword — try pre-compiled file first, fall back to API
        const srcPath = templateLabelToPath(val);

        // Each mode has its own pre-compiled path:
        //   analysis → *Grad_template.html
        //   mustache → *Grad_mustache.html
        const modeSuffix  = extractMode === "mustache" ? "_mustache" : "_template";
        const compiledKey = srcPath.replace(/\.html$/, `${modeSuffix}.html`);

        if (compiledKey === lastExtractedTemplate) return;

        // Try pre-compiled version (fast path, no API call)
        try {
          const res = await fetch(compiledKey);
          if (res.ok) {
            const templateHtml = await res.text();
            const commentMatch = templateHtml.match(/<!--\s*(\{[\s\S]*?\})\s*-->/);
            let embeddedJson = null;
            if (commentMatch) { try { embeddedJson = JSON.parse(commentMatch[1]); } catch {} }
            lastExtractedTemplate = compiledKey;
            extractedTemplateCache = { templateHtml, embeddedJson, templateMode: extractMode };
            setTemplateExtractStatus("✓ Template loaded", "rgba(118,176,34,.9)");
            populateTemplateExtractPanel(extractedTemplateCache);
            renderSuggestedPalettes();
            return;
          }
        } catch {}

        // No pre-compiled file — fetch source HTML and send to AI
        const apiKey = srcPath + "#" + extractMode;
        if (apiKey === lastExtractedTemplate) return;
        try {
          const res = await fetch(srcPath);
          if (!res.ok) throw new Error(`"${srcPath}" not found (HTTP ${res.status})`);
          const html = await res.text();
          requestBody.templateHtmlBase64 = btoa(encodeURIComponent(html).replace(/%([0-9A-F]{2})/g, (_, p) => String.fromCharCode(parseInt(p, 16))));
          key = apiKey;
        } catch (e) {
          setTemplateExtractStatus(`Could not load template: ${e.message}`, "rgba(251,171,156,.8)");
          return;
        }
      } else if (source === "file") {
        const file = templateScreenshotInput?.files?.[0];
        if (!file) return;
        // Files have no pre-compiled version — include mode in key so switching re-extracts
        const fileKey = file.name + "_" + file.size + "#" + extractMode;
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

      clearInterval(extractTicker); // cancel any previous countdown
      let seconds = 300;
      setTemplateExtractStatus(`Building template… ${seconds}s`, "rgba(141,224,255,.75)");
      extractTicker = setInterval(() => {
        seconds = Math.max(1, seconds - 1);
        setTemplateExtractStatus(`Building template… ${seconds}s`, "rgba(141,224,255,.75)");
      }, 1000);

      // Submit to background function (returns 202 immediately)
      try {
        const submitRes = await fetch("/.netlify/functions/extractTemplate-background", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jobId, ...requestBody })
        });
        if (!submitRes.ok) {
          clearInterval(extractTicker);
          setTemplateExtractStatus("Template extraction failed (could not start).", "rgba(251,171,156,.8)");
          return;
        }
      } catch (e) {
        clearInterval(extractTicker);
        setTemplateExtractStatus(`Template extraction failed: ${e?.message || e}`, "rgba(251,171,156,.8)");
        return;
      }

      // Poll for result
      const POLL_INTERVAL_MS = 2500;
      const POLL_TIMEOUT_MS  = 300000; // 5 minutes
      const pollStart = Date.now();

      const pollExtract = async () => {
        if (lastExtractedTemplate !== key) { clearInterval(extractTicker); return; } // superseded
        if (Date.now() - pollStart > POLL_TIMEOUT_MS) {
          clearInterval(extractTicker);
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

        clearInterval(extractTicker);

        if (result.status === "error") {
          const isNetworkErr = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(result.error || "");
          const msg = isNetworkErr
            ? "Can't reach that URL from the server (DNS/network error). Save the page as HTML and use the \"Upload\" option instead."
            : "Template extraction failed: " + (result.error || "Unknown error");
          setTemplateExtractStatus(msg, "rgba(251,171,156,.8)");
          return;
        }

        const data = { templateHtml: result.templateHtml, embeddedJson: result.embeddedJson, templateMode: extractMode };
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
      }
      wrap.style.display = show ? "block" : "none";
      if (!show) document.querySelectorAll('input[name="templateCopyrightMode"]').forEach(r => r.checked = false);
    }

    function updateTemplateUI() {
      const source = document.querySelector('input[name="templateSource"]:checked')?.value;
      document.getElementById("tplUrlWrap")?.classList.toggle("hidden", source !== "keyword");
      document.getElementById("tplFileWrap")?.classList.toggle("hidden", source !== "file");
      const designWrap = document.getElementById("designOptionsWrap");
      if (designWrap) {
        if (source === "none") {
          designWrap.classList.remove("hidden");
        } else {
          designWrap.classList.add("hidden");
        }
      }
      updateTemplateCopyrightVisibility();

      // Show the spec panel in debug mode when cached result is available
      const extractPanel = document.getElementById("templateExtractPanel");
      if (isDebugMode()) {
        if (extractedTemplateCache) {
          populateTemplateExtractPanel(extractedTemplateCache);
        } else {
          extractPanel?.classList.add("hidden");
          const pre = document.getElementById("templateExtractJsonPre");
          if (pre && !pre.textContent) pre.textContent = "Click Next → to extract the template spec.";
        }
      } else {
        extractPanel?.classList.add("hidden");
      }
    }

    function updateDesignOptionsReadiness() { /* no-op: option 3 is human-only */ }

    function applyDesignDefaults() {
      const { major, specialization } = getPage1();
      const t = (major + " " + specialization).toLowerCase();

      // ── Composition — only if unset ───────────────────────────────────────────
      const comp = document.getElementById("designComposition");
      if (comp && !comp.value) {
        if      (/bio|chem|sci|ecolog|environ|nature|field|lab|pharma/i.test(t)) comp.value = "scene-based";
        else if (/art|graphic|design|architect|creat|media|illustrat|film/i.test(t)) comp.value = "abstract_layered";
        else if (/business|market|finance|account|econom|manage|admin|hr\b/i.test(t)) comp.value = "central";
        else                                                                      comp.value = "split-left";
      }

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

    document.querySelectorAll('input[name="templateSource"]').forEach(r =>
      r.addEventListener("change", () => {
        updateTemplateUI();
        extractTemplateInBackground();
      }));
    document.getElementById("modelTemplate")?.addEventListener("input", updateTemplateCopyrightVisibility);
    document.getElementById("modelTemplate")?.addEventListener("blur", extractTemplateInBackground);

    // Also trigger extraction when a file is selected while source=file
    templateScreenshotInput?.addEventListener("change", extractTemplateInBackground);

    // Re-extract when design option dropdowns change (option #3)
    ["designComposition", "designStyle", "designRenderMode", "designDensity", "useEmojiIcons", "alternateSections"].forEach(id => {
      document.getElementById(id)?.addEventListener("change", () => {
        extractTemplateInBackground();
      });
    });

    // Show/hide "Other" style text field
    document.getElementById("designStyle")?.addEventListener("change", () => {
      const other = document.getElementById("designStyleOther");
      if (other) other.style.display = document.getElementById("designStyle").value === "other" ? "block" : "none";
    });

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
      const rawMajor = document.getElementById("major").value.trim();
      const major = rawMajor.replace(/\b(DEBUG|CHATGPT|OPENAI|CLAUDE)\b/gi, "").replace(/\s{2,}/g, " ").trim();
      return {
        major,
        specialization: document.getElementById("specialization").value.trim()
      };
    }

    // ----------------------------
    // Artifact rows (Page 2)
    // ----------------------------
    const ARTIFACT_TYPES = [
      { value: "image",    label: "Image (png/jpg/svg)" },
      { value: "html",     label: "HTML" },
      { value: "youtube",  label: "YouTube video" },
      { value: "text",     label: "Text / Markdown" },
    ];
    let artifactRowCount = 0;

    function buildArtifactContentInput(wrap, type, existingContent = "") {
      wrap.innerHTML = "";
      if (type === "image") {
        const fi = document.createElement("input");
        fi.type = "file";
        fi.accept = "image/*";
        wrap.appendChild(fi);
      } else if (type === "youtube") {
        const inp = document.createElement("input");
        inp.type = "text";
        inp.placeholder = "https://www.youtube.com/watch?v=…";
        inp.value = existingContent;
        const warn = document.createElement("span");
        warn.style.cssText = "font-size:11px; color:rgba(251,100,100,.9); display:none;";
        warn.textContent = "Must be a YouTube URL (youtube.com or youtu.be)";
        inp.addEventListener("blur", () => {
          const val = inp.value.trim();
          const ok = !val || /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(val);
          warn.style.display = ok ? "none" : "block";
          inp.style.borderColor = ok ? "" : "rgba(251,100,100,.8)";
        });
        inp.addEventListener("focus", () => { warn.style.display = "none"; inp.style.borderColor = ""; });
        wrap.append(inp, warn);
      } else if (type === "text") {
        const ta = document.createElement("textarea");
        ta.placeholder = "Paste your text or Markdown here…";
        ta.value = existingContent;
        ta.style.cssText = "width:100%; min-height:80px; resize:vertical;";
        wrap.appendChild(ta);
      } else {
        const inp = document.createElement("input");
        inp.type = "text";
        inp.placeholder = type === "html" ? "File name or HTML URL…" : "File name, URL, or content…";
        inp.value = existingContent;
        wrap.appendChild(inp);
      }
    }

    function addArtifactRow(type = "", content = "", placement = "") {
      const id = ++artifactRowCount;
      const row = document.createElement("div");
      row.id = `artifactRow_${id}`;
      row.className = "artifactRow";

      const sel = document.createElement("select");
      sel.innerHTML = `<option value="">— type —</option>` +
        ARTIFACT_TYPES.map(t =>
          `<option value="${t.value}"${type === t.value ? " selected" : ""}>${t.label}</option>`
        ).join("");

      const contentWrap = document.createElement("div");
      contentWrap.className = "artifactContentWrap";
      buildArtifactContentInput(contentWrap, type, content);
      sel.addEventListener("change", () => buildArtifactContentInput(contentWrap, sel.value, ""));

      const tag = document.createElement("input");
      tag.type = "text";
      tag.className = "artifactTagline";
      tag.placeholder = "Placement position (e.g. hero, projects, about)…";
      tag.value = placement;

      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "×";
      del.className = "btn ghost mini";
      del.style.cssText = "padding:4px 9px; font-size:15px; line-height:1;";
      del.addEventListener("click", () => row.remove());

      row.append(sel, contentWrap, tag, del);
      document.getElementById("artifactRows").appendChild(row);
    }

    async function getPage5Artifacts(){
      const rows = [];
      for (const row of document.querySelectorAll("#artifactRows .artifactRow")) {
        const type      = row.querySelector("select")?.value || "";
        const wrap      = row.querySelector(".artifactContentWrap");
        const placement = row.querySelector(".artifactTagline")?.value?.trim() || "";

        let content = "";
        if (type === "image") {
          const file = wrap?.querySelector("input[type='file']")?.files?.[0];
          if (file) { try { content = await readFileAsBase64(file); } catch {} }
        } else if (type === "text") {
          content = wrap?.querySelector("textarea")?.value?.trim() || "";
        } else {
          content = wrap?.querySelector("input[type='text']")?.value?.trim() || "";
        }

        rows.push({ type, content, placement });
      }
      return { artifacts: rows };
    }

    function getPage2Template(){
      const templateSource = document.querySelector('input[name="templateSource"]:checked')?.value || "";
      const styleVal = document.getElementById("designStyle")?.value || "";
      return {
        template_source: templateSource,
        model_template: templateSource === "keyword" ? (document.getElementById("modelTemplate")?.value?.trim() || "") : "",
        template_copyright_mode: document.querySelector('input[name="templateCopyrightMode"]:checked')?.value || "",
        design_composition:  document.getElementById("designComposition")?.value  || "",
        design_style:        styleVal === "other" ? (document.getElementById("designStyleOther")?.value?.trim() || "other") : styleVal,
        design_render_mode:  document.getElementById("designRenderMode")?.value   || "",
        design_density:        document.getElementById("designDensity")?.value        || "medium",
        use_emoji_icons:       document.getElementById("useEmojiIcons")?.value       === "yes",
        alternate_sections:    document.getElementById("alternateSections")?.value   !== "no"
      };
    }

    function getPage3Colors(){
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

    function getPage4Job(){
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
    // Artifact injection helpers
    // ----------------------------
    function injectArtifacts(htmlString, artifacts) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlString, "text/html");
      const userArtifacts = (artifacts || []).filter(a => a.type && a.content);

      for (const artifact of userArtifacts) {
        const sectionHint = artifact.placement || null;

        // Background image: override the --hero-bg-image CSS custom property
        if (artifact.type === "image" && sectionHint === "background") {
          const src = artifact.content.startsWith("data:") ? artifact.content : `data:image/jpeg;base64,${artifact.content}`;
          const style = doc.createElement("style");
          style.textContent = `:root { --hero-bg-image: url("${src}"); }`;
          doc.head.appendChild(style);
          continue;
        }

        // Find target container
        let targetEl = null;
        if (sectionHint) {
          const allEls = doc.querySelectorAll("section, article, div[id], div[class]");
          for (const el of allEls) {
            const heading = el.querySelector("h1, h2, h3");
            if (heading && heading.textContent.toLowerCase().includes(sectionHint.toLowerCase())) {
              targetEl = el; break;
            }
            if ((el.id || el.className || "").toLowerCase().includes(sectionHint.toLowerCase())) {
              targetEl = el; break;
            }
          }
        }
        if (!targetEl) targetEl = doc.body;

        let newEl = null;
        if (artifact.type === "image") {
          const img = doc.createElement("img");
          img.src = artifact.content.startsWith("data:") ? artifact.content : `data:image/jpeg;base64,${artifact.content}`;
          img.alt = artifact.placement || "";
          img.style.cssText = "max-width:100%; height:auto; display:block; border-radius:8px; margin:12px 0;";
          if (artifact.colorized) img.classList.add("colorized-artifact");
          newEl = img;
        } else if (artifact.type === "youtube") {
          const m = artifact.content.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
          const videoId = m ? m[1] : null;
          if (videoId) {
            const iframe = doc.createElement("iframe");
            iframe.src = `https://www.youtube.com/embed/${videoId}`;
            iframe.style.cssText = "width:100%; aspect-ratio:16/9; border:none; border-radius:8px; display:block; margin:12px 0;";
            iframe.setAttribute("allowfullscreen", "");
            iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture");
            newEl = iframe;
          }
        } else if (artifact.type === "text") {
          const p = doc.createElement("p");
          p.textContent = artifact.content;
          p.style.cssText = "margin:12px 0;";
          if (artifact.placement) p.setAttribute("title", artifact.placement);
          newEl = p;
        } else if (artifact.type === "html") {
          const div = doc.createElement("div");
          div.innerHTML = artifact.content;
          div.style.cssText = "margin:12px 0;";
          newEl = div;
        }

        if (newEl) targetEl.appendChild(newEl);
      }

      return doc.documentElement.outerHTML;
    }

    async function collectStructuredArtifacts() {
      const result = [];

      // Headshot — inject into hero section
      const headshotFile = headshotInput?.files?.[0];
      if (headshotFile) {
        try {
          const b64 = await readFileAsBase64(headshotFile);
          result.push({ type: "image", content: `data:${headshotFile.type};base64,${b64}`, placement: "hero" });
        } catch {}
      }

      // GitHub / Portfolio link — inject into contact section
      const githubUrl = document.getElementById("githubLink")?.value?.trim() || "";
      const githubDesc = document.getElementById("githubDesc")?.value?.trim() || "";
      if (githubUrl) {
        result.push({ type: "html", content: `<a href="${githubUrl}" target="_blank" rel="noopener">${githubDesc || githubUrl}</a>`, placement: "contact" });
      }

      // Uploaded images — inject into projects section
      const imagesInput = document.getElementById("artifactImages");
      if (imagesInput?.files?.length) {
        for (const file of imagesInput.files) {
          try {
            const b64 = await readFileAsBase64(file);
            result.push({ type: "image", content: `data:${file.type};base64,${b64}`, placement: "projects" });
          } catch {}
        }
      }

      // YouTube / Video links — inject into projects section
      const ytRaw = document.getElementById("youtubeLinks")?.value?.trim() || "";
      ytRaw.split(/\n+/).map(s => s.trim()).filter(Boolean).forEach(url => {
        result.push({ type: "youtube", content: url, placement: "projects" });
      });

      return result;
    }

    // ----------------------------
    // Job ad extraction — fires on page 2 Next, parallel with resume analysis wait
    // ----------------------------
    async function doExtractJobAd() {
      const p4 = getPage4Job();
      const rawText = [p4.desired_role, p4.job_ad].filter(Boolean).join("\n\n").trim();
      if (!rawText) return;

      jobAdResult     = null;
      jobAdInProgress = true;

      const jobId = "jobad_" + crypto.randomUUID();
      try {
        const res = await fetch("/.netlify/functions/buildWebsite-background", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "extractJobAd",
            jobId,
            jobAdText: rawText,
            provider: getAnalysisProvider()
          })
        });
        if (!res.ok && res.status !== 202) { jobAdInProgress = false; return; }

        const startTime = Date.now();
        while (Date.now() - startTime < 120000) {
          await new Promise(r => setTimeout(r, 2500));
          const pollRes = await fetch(`/.netlify/functions/getPreviewResult?jobId=${encodeURIComponent(jobId)}`);
          const data = await pollRes.json().catch(() => ({}));
          if (data.status === "done") { jobAdResult = data; break; }
          if (data.status === "error") { break; }
        }
      } catch { /* silent */ }

      jobAdInProgress = false;
    }

    // ----------------------------
    // Stage 2: Content strategy — triggered by doAnalyzeAndExtractJobAd after both
    // resume analysis (Stage 1) and job ad extraction are complete.
    // ----------------------------
    async function doUnifyResumeAndJobAnalyses() {
      const p4 = getPage4Job();
      if (!p4.desired_role && !p4.job_ad.trim()) return;
      if (!lastAnalysisData) return; // resume must be pre-computed by Stage 1

      jobAnalysisResult     = null;
      jobAnalysisInProgress = true;
      setHeaderStatus("jobAnalysisStatus", "Building content strategy…", "rgba(141,224,255,.75)");

      const jobId = "job_" + crypto.randomUUID();
      try {
        const res = await fetch("/.netlify/functions/buildWebsite-background", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "analyzeJob",
            jobId,
            resumeAnalysisJson: lastAnalysisData,
            jobAdJson: jobAdResult,
            page3: p4,
            provider: getAnalysisProvider()
          })
        });
        if (!res.ok && res.status !== 202) { jobAnalysisInProgress = false; return; }

        const startTime = Date.now();
        while (Date.now() - startTime < 300000) {
          await new Promise(r => setTimeout(r, 3000));
          const pollRes = await fetch(`/.netlify/functions/getPreviewResult?jobId=${encodeURIComponent(jobId)}`);
          const data = await pollRes.json().catch(() => ({}));
          if (data.status === "done")  { jobAnalysisResult = data; break; }
          if (data.status === "error") { break; }
        }
      } catch { /* silent — strategizeContent will recompute if needed */ }

      jobAnalysisInProgress = false;
      if (jobAnalysisResult) {
        setHeaderStatus("jobAnalysisStatus", "✓ Content strategy ready", "rgba(118,176,34,.9)");
      } else {
        setHeaderStatus("jobAnalysisStatus", "Content strategy unavailable — will retry on generate", "rgba(251,171,156,.8)");
      }
    }

    // ----------------------------
    // Orchestrator — triggered on page 2 (Job) Next
    // Fires job ad extraction in parallel, blocks until resume analysis is done, then unifies.
    // ----------------------------
    async function doAnalyzeAndExtractJobAd() {
      doExtractJobAd(); // fire-and-forget — runs in parallel

      // Block until Stage 1 (resume analysis) is finished
      while (resumeAnalysisPending) {
        await new Promise(r => setTimeout(r, 500));
      }

      // Block until job ad extraction is finished
      while (jobAdInProgress) {
        await new Promise(r => setTimeout(r, 500));
      }

      await doUnifyResumeAndJobAnalyses();
    }

    // ----------------------------
    // Bridge Content & Design — triggered on page 4 (Colors) Next
    // Waits for Stage 2 (content strategy) if still in flight, then runs bridgeContentAndDesign.md
    // ----------------------------
    async function doBridgeContentAndDesign() {
      bridgeResult     = null;
      bridgeInProgress = true;
      setHeaderStatus("bridgeStatus", "Planning design…", "rgba(141,224,255,.75)");

      // Block until Stage 2 (content strategy) is finished
      while (jobAnalysisInProgress) {
        await new Promise(r => setTimeout(r, 500));
      }

      const jobId = "bridge_" + crypto.randomUUID();

      try {
        const res = await fetch("/.netlify/functions/buildWebsite-background", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "bridgeContentAndDesign",
            jobId,
            templateHtml: extractedTemplateCache?.templateHtml || null,
            contentJson:  jobAnalysisResult?.strategy_json || null,
            colorSpec:    getPage3Colors().theme,
            provider:     getAnalysisProvider()
          })
        });
        if (!res.ok && res.status !== 202) { bridgeInProgress = false; return; }

        const startTime = Date.now();
        while (Date.now() - startTime < 300000) {
          await new Promise(r => setTimeout(r, 3000));
          const pollRes = await fetch(`/.netlify/functions/getPreviewResult?jobId=${encodeURIComponent(jobId)}`);
          const data = await pollRes.json().catch(() => ({}));
          if (data.status === "done") { bridgeResult = data; break; }
          if (data.status === "error") { break; }
        }
      } catch { /* silent */ }

      bridgeInProgress = false;
      if (bridgeResult) {
        setHeaderStatus("bridgeStatus", "✓ Design plan ready", "rgba(118,176,34,.9)");
        populateBridgeDebug(bridgeResult);
      } else {
        setHeaderStatus("bridgeStatus", "Design plan unavailable", "rgba(251,171,156,.8)");
      }
    }

    function populateBridgeDebug(data) {
      if (!data?.bridge_json) return;
      const str = JSON.stringify(data.bridge_json, null, 2);
      const dl = document.getElementById("dlStage4");
      const cp = document.getElementById("cpStage4");
      if (dl) dl.onclick = () => downloadText("bridge.json", str, "application/json");
      if (cp) cp.onclick = e => copyToClipboard(str, e.currentTarget);
    }

    // ----------------------------
    // Populate generation debug outputs — called as soon as strategizeContent() gets a result
    // ----------------------------
    function populateGenerationDebug(data) {
      if (!isDebugMode()) return;
      const stagesSection = document.getElementById("stagesDebugSection");
      if (stagesSection) stagesSection.classList.remove("hidden");

      if (data.model) {
        const modelEl = document.getElementById("debugModelName");
        if (modelEl) modelEl.textContent = `Model: ${data.model}`;
      }

      // Stage 2: Content Strategy
      if (data.strategy_json) {
        const str = JSON.stringify(data.strategy_json, null, 2);
        const dl = document.getElementById("dlStage2");
        const cp = document.getElementById("cpStage2");
        if (dl) dl.onclick = () => downloadText("strategy.json", str, "application/json");
        if (cp) cp.onclick = e => copyToClipboard(str, e.currentTarget);
      }

      // Stage 1: Resume Analysis
      const resumeJsonToShow = data.resume_json || resumeAnalysisCache;
      if (resumeJsonToShow) {
        const str = JSON.stringify(resumeJsonToShow, null, 2);
        const dl = document.getElementById("dlStage1");
        const cp = document.getElementById("cpStage1");
        if (dl) dl.onclick = () => downloadText("resume-analysis.json", str, "application/json");
        if (cp) cp.onclick = e => copyToClipboard(str, e.currentTarget);
      }
    }

    // ----------------------------
    // Generation — called from page 4 Next (fire-and-forget); visuals injected client-side after generation
    // ----------------------------
    async function strategizeContent() {
      generationResult    = null;
      generationError     = null;
      generationInProgress = true;
      setApplyBtnState(false);
      setHeaderStatus("generatingWebsiteStatus", "Generating portfolio…", "rgba(141,224,255,.75)");

      const resumeFile = resumeUpload.files[0];
      if (!resumeFile) {
        generationError = "Please upload your resume PDF before generating.";
        generationInProgress = false;
        setHeaderStatus("generatingWebsiteStatus", "");
        setApplyBtnState(true);
        return;
      }

      let resumePdfBase64 = "";
      try {
        resumePdfBase64 = await readFileAsBase64(resumeFile);
      } catch (e) {
        generationError = "Could not read resume PDF: " + e.message;
        generationInProgress = false;
        setHeaderStatus("generatingWebsiteStatus", "");
        setApplyBtnState(true);
        return;
      }

      const p1    = getPage1();
      const p2    = getPage2Template();
      const p3    = getPage3Colors();
      const p4    = getPage4Job();
      const page1 = { ...p1, ...p2 };
      const page2 = p3;
      const page3 = p4;
      const headshotName = headshotInput?.files?.[0]?.name || "";
      const jobId = crypto.randomUUID();

      try {
        const res = await fetch("/.netlify/functions/buildWebsite-background", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            page1, page2, page3, artifactsData: [],
            jobId, resumePdfBase64, headshotName,
            resumeAnalysisJson:   jobAnalysisResult?.resume_json || lastAnalysisData || null,
            templateAnalysisJson: extractedTemplateCache?.embeddedJson || null,
            templateHtml:         extractedTemplateCache?.templateHtml || null,
            strategyJson:         jobAnalysisResult?.strategy_json || null,
            bridgeJson:           bridgeResult?.bridge_json || null,
            provider:             getAnalysisProvider()
          })
        });
        if (!res.ok && res.status !== 202) {
          const rawText = await res.text();
          let errData = {};
          try { errData = JSON.parse(rawText); } catch {}
          throw new Error(errData?.error || `Server error ${res.status}: ${rawText.slice(0, 400)}`);
        }

        const startTime = Date.now();
        const maxWaitMs = 720000;
        const pollIntervalMs = 4000;

        while (Date.now() - startTime < maxWaitMs) {
          await new Promise(r => setTimeout(r, pollIntervalMs));
          const remaining = Math.max(0, Math.round((maxWaitMs - (Date.now() - startTime)) / 1000));
          const pollRes = await fetch(`/.netlify/functions/getPreviewResult?jobId=${jobId}`);
          const data = await pollRes.json().catch(() => ({}));
          const stageMsg = data.stage
            ? `${data.stage} (${remaining}s remaining)`
            : `Generating portfolio… ${remaining}s remaining`;
          setHeaderStatus("generatingWebsiteStatus", stageMsg, "rgba(141,224,255,.75)");
          if (data.status === "done") {
            generationResult    = data;
            generationInProgress = false;
            setHeaderStatus("generatingWebsiteStatus", "✓ Website generated", "rgba(118,176,34,.9)");
            setApplyBtnState(true);
            populateGenerationDebug(data);
            return;
          }
          if (data.status === "error") throw new Error(data.error || "Generation failed.");
        }
        throw new Error("Generation timed out after 12 minutes.");
      } catch (e) {
        generationError     = e.message;
        generationInProgress = false;
        setHeaderStatus("generatingWebsiteStatus", "Generation failed: " + e.message, "rgba(251,171,156,.9)");
        setApplyBtnState(true);
      }
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

    async function doPreview() {
      if (generationInProgress) {
        setHeaderStatus("generatingWebsiteStatus", "Still generating… please wait.", "rgba(141,224,255,.75)");
        return;
      }

      if (!generationResult) {
        if (generationError) {
          const finalBox = document.getElementById("finalBox");
          finalBox.classList.remove("hidden");
          finalBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
          document.getElementById("finalStatus").innerHTML = `<span class="error">Generation failed:</span> ${generationError}`;
          return;
        }
        // Fallback: generation wasn't triggered on Colors Next (e.g. direct navigation)
        await strategizeContent();
        if (!generationResult) return;
      }

      // Collect all visuals — all injected client-side
      const { artifacts: dynamicVisuals } = await getPage5Artifacts();
      const structuredVisuals = await collectStructuredArtifacts();
      const allVisuals = [...structuredVisuals, ...dynamicVisuals];

      const data = generationResult;

      let finalHtml = data.site_html;
      if (allVisuals.length > 0) {
        finalHtml = injectArtifacts(finalHtml, allVisuals);
      }

      localStorage.setItem("portfolio_preview_html", finalHtml);

      const finalBox = document.getElementById("finalBox");
      const finalStatus = document.getElementById("finalStatus");
      finalBox.classList.remove("hidden");
      finalBox.scrollIntoView({ behavior: "smooth", block: "nearest" });

      const resumeData = getPage1();
      const designData = getPage2Template();
      const colorsData = getPage3Colors();
      const jobData    = getPage4Job();

      const all = { resume: resumeData, job: jobData, design: designData, colors: colorsData, visuals: allVisuals };
      const summaryHtml = buildSummaryHtml(all);
      const dlFinalHtml = document.getElementById("dlFinalHtml");
      const dlSummary   = document.getElementById("dlSummaryHtml");
      if (dlFinalHtml) dlFinalHtml.onclick = () => downloadText("portfolio.html", finalHtml, "text/html");
      if (dlSummary)   dlSummary.onclick   = () => downloadText("MyPersonalPortfolioWebsiteSummary.html", summaryHtml, "text/html");

      // ── Debug panel — wire payload download buttons on page 5 ──
      if (isDebugMode()) {
        const payload    = { resume: resumeData, job: jobData, design: designData, colors: colorsData, visuals: allVisuals };
        const payloadStr = JSON.stringify(payload, null, 2);
        const dlPayload  = document.getElementById("dlDebugPayload");
        const cpPayload  = document.getElementById("cpDebugPayload");
        if (dlPayload) dlPayload.onclick = () => downloadText("payload.json", payloadStr, "application/json");
        if (cpPayload) cpPayload.onclick = e => copyToClipboard(payloadStr, e.currentTarget);
      }

      finalStatus.innerHTML = data.truncated
        ? `<span class="ok">Portfolio ready</span> <span class="hint">(output was cut short — some sections may be missing; try regenerating)</span>`
        : `<span class="ok">Portfolio ready.</span> Open the editor below.`;
      const editorBtn = document.getElementById("btnOpenEditor");
      if (editorBtn) { editorBtn.disabled = false; editorBtn.style.opacity = ""; editorBtn.style.cursor = ""; }
      window.location.href = "editor.html";
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
      resumeAnalysisCache = null;
      lastAnalysisData = null;
      setResumeAnalysisStatus("");
    });

    // ── Page action helpers (action = everything except setStep) ─────────────
    function page1Action() {
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
      return errs.length === 0; // returns true if valid
    }

    document.getElementById("next1")?.addEventListener("click", () => {
      if (!page1Action()) return;
      if (resumeUpload.files?.[0]) analyzeResumeInBackground(resumeUpload.files[0]);
      setStep(2);
    });
    document.getElementById("dbgSubmit1")?.addEventListener("click", () => { page1Action(); });

    // Page 3 (Design / Template)
    document.getElementById("back2")?.addEventListener("click", () => setStep(2));

    function onEnterPage2() {
      applyDesignDefaults();
      const source = document.querySelector('input[name="templateSource"]:checked')?.value;
      if (extractedTemplateCache) {
        populateTemplateExtractPanel(extractedTemplateCache);
      } else if (source) {
        extractTemplateInBackground();
      }
    }

    function page3Action() {
      const source = document.querySelector('input[name="templateSource"]:checked')?.value;

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

      if (!source) { showSourceMsg("Please select a template option."); return false; }
      document.getElementById("_msg_templateSource") && (document.getElementById("_msg_templateSource").textContent = "");

      if (source === "keyword") {
        const val = document.getElementById("modelTemplate")?.value?.trim() || "";
        if (!val) { showSourceMsg("Please enter a name or keyword (e.g. Biology, Psychology)."); return false; }
        if (looksLikeUrl(val)) { showSourceMsg("Please enter a name or keyword, not a URL."); return false; }
      }
      if (source === "file") {
        const file = templateScreenshotInput?.files?.[0];
        if (!file) { showSourceMsg("Please select a screenshot or HTML file."); return false; }
      }

      const copyrightWrap = document.getElementById("templateCopyrightWrap");
      if (copyrightWrap && copyrightWrap.style.display !== "none") {
        const copyrightAnswered = !!document.querySelector('input[name="templateCopyrightMode"]:checked');
        if (!copyrightAnswered) {
          showSourceMsg("Please answer the website spec question before continuing.");
          copyrightWrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
          return false;
        }
      }

      extractTemplateInBackground().then(() => {
        if (isDebugMode() && extractedTemplateCache) {
          populateTemplateExtractPanel(extractedTemplateCache);
          document.getElementById("templateExtractPanel")?.classList.remove("hidden");
          document.getElementById("templateExtractPanel")?.querySelector("details")?.setAttribute("open", "");
        }
      });
      return true;
    }

    document.getElementById("next2")?.addEventListener("click", () => {
      if (!page3Action()) return;
      setStep(4);
    });
    document.getElementById("dbgSubmit3")?.addEventListener("click", () => { page3Action(); });

    // back3 on Color scheme returns to Website spec (step 3), re-populating its panels
    document.getElementById("back3")?.addEventListener("click", () => { onEnterPage2(); setStep(3); });

    // Page 3 (Colors)
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
      const resolvedData = analysisData ?? lastAnalysisData;
      const aiPalettes = resolvedData?.compatible_color_schemes ?? [];
      const aiRows = aiPalettes
        .filter(p => p.primary || p.secondary || p.accent)
        .slice(0, 3)
        .map((p, i) => ({
          label: p.how_used || `AI palette ${i + 1}`,
          colors: { primary: p.primary, secondary: p.secondary, accent: p.accent, dark: p.dark, light: p.light }
        }));

      const visible = [...(tplPalette ? [tplPalette] : []), ...aiRows];

      const MAX = 4;
      const populated = visible.filter(Boolean).length;
      const dataLoaded = !!(resolvedData);
      if (msg) {
        if (populated >= MAX) {
          msg.style.display = "none";
        } else if (dataLoaded) {
          msg.textContent = populated === 0 ? "(No palettes found in analysis)" : `(${populated} of ${MAX} loaded)`;
          msg.style.display = "block";
        } else {
          msg.textContent = "(Thinking\u2026)";
          msg.style.display = "block";
        }
      }

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
    // next2 on Website spec → enters Color scheme → refresh palettes
    document.getElementById("next2")?.addEventListener("click", () => renderSuggestedPalettes());
    document.getElementById("back3")?.addEventListener("click", () => setStep(3));
    document.getElementById("next3")?.addEventListener("click", () => { setStep(5); });
    document.getElementById("continueTo4")?.addEventListener("click", () => setStep(5));

    // Page 2 (Job)
    function page2Action() { onEnterPage2(); doAnalyzeAndExtractJobAd(); }
    document.getElementById("back5")?.addEventListener("click", () => setStep(1));
    document.getElementById("submit_bottom")?.addEventListener("click", () => { page2Action(); setStep(3); });
    document.getElementById("dbgSubmit2")?.addEventListener("click", page2Action);

    // Page 3 (Design) — Back returns to Job; Next advances to Colors
    document.getElementById("back3_bottom")?.addEventListener("click", () => setStep(2));
    document.getElementById("next3_bottom")?.addEventListener("click", () => setStep(4));

    // Page 4 (Colors)
    function page4Action() {
      setHeaderStatus("colorsChosenStatus", "✓ Colors chosen", "rgba(118,176,34,.9)");
      doBridgeContentAndDesign(); // fire-and-forget
    }
    document.getElementById("back4")?.addEventListener("click", () => { onEnterPage2(); setStep(3); });
    document.getElementById("next4")?.addEventListener("click", () => { page4Action(); setStep(5); });
    document.getElementById("dbgSubmit4")?.addEventListener("click", page4Action);

    // Page 5 (Visuals)
    document.getElementById("back2_bottom")?.addEventListener("click", () => setStep(4));
    document.getElementById("next2_bottom")?.addEventListener("click", doPreview);
    document.getElementById("dbgSubmit5")?.addEventListener("click", doPreview);
    // Artifact rows — wire add button
    document.getElementById("addArtifact")?.addEventListener("click", () => addArtifactRow());

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

    document.getElementById("btnOpenEditor")?.addEventListener("click", () => {
      window.open("editor.html", "_blank");
    });
    document.getElementById("submit_top")?.addEventListener("click", doPreview);

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