
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
    let _resumeAnalysisRunId  = 0;    // incremented on each new call; polling loop checks for staleness

    // ----------------------------
    // Generation state
    // ----------------------------
    let generationResult    = null;  // data object when done
    let generationError     = null;  // error message on failure
    let generationInProgress = false;

    // Job Ad Extraction (triggered on page 2 Next, parallel with resume analysis wait)
    let jobAdResult      = null;   // {job_ad: {...}} when done
    let jobAdInProgress  = false;
    let jobAdErrorDetail = null;
    let page2Submitted   = false;  // set true when user presses Next on page 2

    // Bridge Profile & Design (triggered on Colors Next)
    let bridgeResult      = null;   // {bridge_json, model} when done
    let bridgeInProgress  = false;

    // ----------------------------
    // Auth / tier helpers
    // ----------------------------
    function currentUserId() { return window.getSupabaseUser?.()?.id || null; }
    function isPaidUser() {
      const tier = window.getSupabaseMembership?.()?.tier;
      return tier === "basic" || tier === "premium";
    }
    const ANON_CREDIT_LIMIT = 5;
    const ANON_CREDITS_KEY  = "anon_credits_used";

    function getAnonCreditsUsed() {
      return parseInt(localStorage.getItem(ANON_CREDITS_KEY) || "0", 10);
    }
    function incrementAnonCredits() {
      localStorage.setItem(ANON_CREDITS_KEY, String(getAnonCreditsUsed() + 1));
    }

    function hasCreditsRemaining() {
      if (!currentUserId()) {
        return getAnonCreditsUsed() < ANON_CREDIT_LIMIT;
      }
      const m = window.getSupabaseMembership?.();
      if (!m) return true; // not loaded yet — don't block
      if (m.credits_limit === -1) return true; // unlimited
      return (m.credits_used ?? 0) < (m.credits_limit ?? 0);
    }

    // Called by the auth script in index.html whenever login state changes
    window.onAuthStateUpdated = function() {
      updateSubmitReadiness();
      applyTierGating();
    };

    // Maps the user's CURRENT tier → which Stripe tier to upgrade them to
    const UPGRADE_TIER_KEY = {
      free:    "basic",
      basic:   "premium_monthly_new",
    };

    // Graduated unit prices for premium_monthly_new: index 0 = unit 1, index 4 = unit 5, 6+ = $2.95
    const PREMIUM_UNIT_PRICES = [19, 11, 7, 5, 4];
    const PREMIUM_UNIT_PRICE_EXTRA = 2.95;

    function calcPremiumTotal(qty) {
      let total = 0;
      for (let i = 0; i < qty; i++) {
        total += i < PREMIUM_UNIT_PRICES.length ? PREMIUM_UNIT_PRICES[i] : PREMIUM_UNIT_PRICE_EXTRA;
      }
      return total;
    }

    window.updateUnitPrice = function() {
      const qty = Math.max(1, parseInt(document.getElementById("unitQty")?.value || "1", 10));
      const total = calcPremiumTotal(qty);
      const display = document.getElementById("unitPriceDisplay");
      if (display) display.textContent = `= $${total.toFixed(2)} total`;
    };

    function showUpgradePrompt(data) {
      clearInterval(typeof renderCountdown !== "undefined" ? renderCountdown : null);
      generationInProgress = false;
      setApplyBtnState(true);
      setHeaderStatus("generatingWebsiteStatus", "Credit limit reached.", "rgba(251,171,156,.9)");

      const tier = data.tier || window.getSupabaseMembership?.()?.tier || "free";
      const used  = data.used  ?? "?";
      const limit = data.limit ?? "?";

      const nextTier = tier === "free" ? "basic" : "premium_monthly_new";
      const tierLabels = { basic: "Basic ($7)", premium_monthly_new: "Premium (from $19/unit)" };

      const prompt      = document.getElementById("upgradePrompt");
      const msgEl       = document.getElementById("upgradePromptMsg");
      const linkEl      = document.getElementById("upgradeLink");
      const pickerWrap  = document.getElementById("unitPickerWrap");
      const qtyInput    = document.getElementById("unitQty");

      // Anonymous user: prompt sign-in rather than upgrade
      if (data.anon) {
        if (msgEl) msgEl.textContent =
          `You've used ${used} of ${limit} free previews. Sign in to keep going.`;
        if (pickerWrap) pickerWrap.classList.add("hidden");
        if (linkEl) {
          linkEl.textContent = "Sign in";
          linkEl.href = "#";
          linkEl.onclick = e => { e.preventDefault(); if (typeof openAuthModal === "function") openAuthModal(); };
        }
        if (prompt) prompt.classList.remove("hidden");
        return;
      }

      if (msgEl) msgEl.textContent =
        `You've used ${used} of ${limit} credits on the ${tier} plan. Upgrade to ${tierLabels[nextTier] || nextTier} for more.`;

      // Show unit picker only for premium (graduated pricing requires a quantity)
      const isPremiumUpgrade = nextTier === "premium_monthly_new";
      if (pickerWrap) pickerWrap.classList.toggle("hidden", !isPremiumUpgrade);
      if (isPremiumUpgrade) {
        if (qtyInput) qtyInput.value = "1";
        window.updateUnitPrice();
      }

      // Wire upgrade button to create a Stripe Checkout session
      if (linkEl) {
        linkEl.href = "#";
        linkEl.onclick = async (e) => {
          e.preventDefault();
          const user = window.getSupabaseUser?.();
          if (!user) { if (typeof openAuthModal === "function") openAuthModal(); return; }
          const quantity = isPremiumUpgrade
            ? Math.max(1, parseInt(qtyInput?.value || "1", 10))
            : 1;
          linkEl.textContent = "Redirecting…";
          linkEl.style.opacity = "0.6";
          try {
            const res = await fetch("/.netlify/functions/createCheckoutSession", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                tier:       UPGRADE_TIER_KEY[tier] || "basic",
                userId:     user.id,
                userEmail:  user.email,
                returnUrl:  location.origin + location.pathname,
                quantity
              })
            });
            const data = await res.json();
            if (data.url) { location.href = data.url; }
            else { linkEl.textContent = "Upgrade →"; linkEl.style.opacity = ""; alert(data.error || "Could not start checkout."); }
          } catch (err) {
            linkEl.textContent = "Upgrade →";
            linkEl.style.opacity = "";
            alert("Checkout error: " + err.message);
          }
        };
      }

      if (prompt) prompt.classList.remove("hidden");
    }

    function applyTierGating() {
      const paid = isPaidUser();
      // Gate dl/cp/vw buttons — only enable for paid when output exists
      const hasHtml = !!generationResult?.site_html;
      ["dlFinalHtml", "cpFinalHtml", "vwFinalHtml", "dlSummaryHtml", "cpSummaryHtml", "vwSummaryHtml"].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        const allow = paid && hasHtml;
        btn.disabled      = !allow;
        btn.style.opacity = allow ? "" : "0.35";
        btn.style.cursor  = allow ? "" : "not-allowed";
        btn.title         = !paid ? "Upgrade to access downloads" : (!hasHtml ? "Generate a site first" : "");
      });
    }

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

    // Wire each field: validate on blur; re-check on input once an error is showing.
    // Blur validation is deferred 200ms so browser autocomplete selections aren't
    // dismissed by DOM changes fired during the blur event.
    Object.keys(FIELD_VALIDATORS).forEach(id => {
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener("blur",  () => setTimeout(() => validateField(id, true), 200));
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
        if (!hasCreditsRemaining()) {
          setResumeAnalysisStatus("No credits remaining — upgrade to analyze your resume.", "rgba(251,171,156,.8)");
        } else {
          analyzeResumeInBackground(input.files[0]);
        }
      } else {
        setResumeAnalysisStatus("");
      }
    });

    document.getElementById("reanalyzeResume")?.addEventListener("click", () => {
      if (!hasCreditsRemaining()) {
        setResumeAnalysisStatus("No credits remaining — upgrade to re-analyze.", "rgba(251,171,156,.8)");
        return;
      }
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
      // Show/hide debug Submit buttons on all pages
      document.querySelectorAll(".dbg-submit-row").forEach(el => {
        el.style.display = debug ? "flex" : "none";
      });
      // templateModeRow requires both debug mode AND keyword source — re-evaluate now
      updateTemplateUI();
      // Show debug panel if debug enabled and we're on page 2+ (step 2+)
      document.getElementById("stagesDebugSection")?.classList.toggle("hidden", !debug || currentStep < 2);
      if (debug) populateJobAdDebug(jobAdResult);
      if (debug) wireStage2Debug();
      if (debug) populateBridgeDebug(bridgeResult);
      if (debug) populateTemplateExtractPanel(extractedTemplateCache ?? {});
      if (debug) greyRendererButtons(!generationResult);
      if (debug) wirePayloadDebug();
    }

    document.getElementById("major")?.addEventListener("input", () => {
      updateDebugBanner();
      updateProviderBadge();
    });

    // ----------------------------
    // Resume analysis (background)
    // ----------------------------
    function updateSubmitReadiness() {
      // Show/hide the resume-pending notice near the Colors Next button
      const notice = document.getElementById("resumePendingNotice");
      if (notice) notice.style.display = resumeAnalysisPending ? "block" : "none";

      // Update suggested palettes status message
      const palMsg = document.getElementById("suggestedPalettesMsg");
      if (palMsg && resumeAnalysisPending) {
        palMsg.textContent = "Analyzing resume…";
        palMsg.style.color = "rgba(141,224,255,.7)";
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

    function viewJson(str) {
      const blob = new Blob([str], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      window.open(url, "_blank");
    }

    function setOpenEditorReady(ready) {
      const btn = document.getElementById("next2_bottom");
      if (!btn) return;
      btn.disabled      = !ready;
      btn.style.opacity = ready ? "" : ".4";
      btn.style.cursor  = ready ? "" : "not-allowed";
    }

    function greyRendererButtons(grey) {
      // Preview/editor button is always available regardless of tier
      // Download/copy/view buttons additionally require a paid tier
      ["dlFinalHtml", "cpFinalHtml", "vwFinalHtml", "dlSummaryHtml", "cpSummaryHtml", "vwSummaryHtml"].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        const allow = !grey && isPaidUser();
        btn.disabled      = !allow;
        btn.style.opacity = allow ? "" : "0.35";
        btn.style.cursor  = allow ? "" : "not-allowed";
        btn.title         = !isPaidUser() ? "Upgrade to access downloads" : (grey ? "Generate a site first" : "");
      });
    }

    function wireDebugRow(prefix, str, filename) {
      const dl = document.getElementById(`dl${prefix}`);
      const cp = document.getElementById(`cp${prefix}`);
      const vw = document.getElementById(`vw${prefix}`);
      const hasData = str !== "null" && str !== null && str !== undefined;
      [dl, cp, vw].forEach(btn => {
        if (!btn) return;
        btn.disabled = !hasData;
        btn.style.opacity = hasData ? "" : "0.35";
        btn.style.cursor  = hasData ? "" : "not-allowed";
      });
      if (!hasData) {
        if (dl) dl.onclick = null;
        if (cp) cp.onclick = null;
        if (vw) vw.onclick = null;
        return;
      }
      if (dl) dl.onclick = () => downloadText(filename, str, "application/json");
      if (cp) cp.onclick = e => copyToClipboard(str, e.currentTarget);
      if (vw) vw.onclick = () => viewJson(str);
    }

    function toDebugText(value) {
      if (value == null) return null;
      if (typeof value === "string") return value;
      try { return JSON.stringify(value, null, 2); }
      catch { return String(value); }
    }

    function summarizeDebugText(value, maxLen = 140) {
      const text = (toDebugText(value) || "").replace(/\s+/g, " ").trim();
      if (!text) return "";
      return text.length > maxLen ? text.slice(0, maxLen - 1) + "…" : text;
    }

    function populateResumeDebugPanel(json) {
      const facts    = json?.resume_facts    ?? json;
      const strategy = json?.resume_strategy ?? null;
      const resolved = json?.resume_resolved ?? null;

      wireDebugRow("ResumeFacts",    JSON.stringify(facts,    null, 2), "resume-facts.json");
      wireDebugRow("ResumeStrategy", JSON.stringify(strategy, null, 2), "resume-strategy.json");
      wireDebugRow("ResumeResolved", JSON.stringify(resolved, null, 2), "resume-resolved.json");

      applyColorDefaults(json);
    }

    function startCountdown(statusId, label, timeoutSec, color = "rgba(141,224,255,.75)") {
      let remaining = timeoutSec;
      const setter = statusId === "resumeAnalysisStatus"
        ? t => setResumeAnalysisStatus(t, color)
        : t => setHeaderStatus(statusId, t, color);
      setter(`${label} ${remaining}s`);
      const timer = setInterval(() => {
        remaining--;
        if (remaining <= 0) { clearInterval(timer); setter(label); }
        else { setter(`${label} ${remaining}s`); }
      }, 1000);
      return timer;
    }

    function startAnalysisCountdown(timeoutSec) {
      return startCountdown("resumeAnalysisStatus", "Analyzing resume…", timeoutSec);
    }

    function resumeCacheKey(file) {
      return `resumeAnalysis_v4:${file.name}:${file.size}:${file.lastModified}`;
    }

    async function analyzeResumeInBackground(file) {
      // Only PDFs are supported for analysis
      if (file.type && !file.type.includes("pdf")) {
        setResumeAnalysisStatus("Analysis requires a PDF. Upload complete.", "rgba(234,240,255,.5)");
        return;
      }

      // Bump run ID — any in-flight poll loop will see its ID is stale and exit
      const myRunId = ++_resumeAnalysisRunId;

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
        const notice = document.getElementById("resumePendingNotice");
        if (notice) notice.style.display = "none";
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
        if (myRunId !== _resumeAnalysisRunId) { clearInterval(countdownTimer); return; } // superseded by newer call
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
        const identity = data.resume_facts?.identity ?? data.identity;
        if (identity) {
          if (major)          identity.major          = major;
          if (specialization) identity.specialization = specialization;
        }

        // Persist to localStorage for reuse after refresh
        try { localStorage.setItem(resumeCacheKey(file), JSON.stringify(data)); } catch {}

        lastAnalysisData = data;
        if (isDebugMode()) resumeAnalysisCache = data;
        else               resumeAnalysisCache = null;

        setResumeAnalysisStatus("✓ Resume analyzed", "rgba(118,176,34,.9)");
        populateResumeDebugPanel(data);
        renderSuggestedPalettes(data);
        // Clear the pending notices now that analysis is done
        const notice = document.getElementById("resumePendingNotice");
        if (notice) notice.style.display = "none";
        const palMsg = document.getElementById("suggestedPalettesMsg");
        if (palMsg && palMsg.textContent === "Analyzing resume…") palMsg.textContent = "";
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
      { id: "page2", label: "2 Job" },
      { id: "page3", label: "3 Design" },
      { id: "page4", label: "4 Colors" },
      { id: "page5",  label: "5 Visuals" },
      { id: "page5b", pageId: "page5", label: "6 Edit" },
      { id: "page5c", pageId: "page5", label: "7 Publish" },
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
      // Show debug panel on pages 2-5 (steps 2+), hide on overview/resume
      if (isDebugMode()) {
        document.getElementById("stagesDebugSection")?.classList.toggle("hidden", currentStep < 2);
      }
      renderStepUI();
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (currentStep === 3) updateTemplateUI();
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
        const res = await fetch("/html/templates.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (Array.isArray(data.templates) && data.templates.length > 0) {
          applyTemplatesToDatalist(data.templates);
          localStorage.setItem(TEMPLATE_CACHE_KEY, JSON.stringify({ templates: data.templates, timestamp: Date.now() }));
        }
      } catch { /* silently skip */ }
      finally {
        if (btn) { btn.textContent = "↻"; btn.disabled = false; }
      }
    }

    loadTemplateSuggestions();
    document.getElementById("refreshTemplateList")?.addEventListener("click", () => loadTemplateSuggestions({ force: true }));
    document.getElementById("resetTemplateKeyword")?.addEventListener("click", () => {
      const input = document.getElementById("modelTemplate");
      if (input) input.value = "";
      extractedTemplateCache  = null;
      lastExtractedTemplate   = "";
      templatePaletteRendered = false;
      userHasSelectedPalette  = false;
      setTemplateExtractStatus("");
      renderSuggestedPalettes();
      updateSubmitReadiness();
    });

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
    let templatePaletteRendered = false; // true once template palette has been auto-applied; resets on template clear
    let userHasSelectedPalette  = false; // true once user actively picks any palette/theme; resets on template clear
    let extractTemplatePending = null;   // holds the in-flight extraction promise
    let lastExtractedTemplate = "";      // URL or file name to avoid redundant calls
    let extractTicker = null;            // active countdown interval — cleared on each new extraction

    function setTemplateExtractStatus(text, color = "rgba(234,240,255,.6)") {
      const el = document.getElementById("templateExtractStatus");
      if (el) { el.textContent = text; el.style.color = color; }
    }

    function populateTemplateExtractPanel(result) {
      const jsonStr  = result?.embeddedJson ? JSON.stringify(result.embeddedJson, null, 2) : null;
      const htmlStr  = result?.templateHtml || null;

      // Activate spec.json buttons whenever the template has loaded (same caching as template.html).
      // If there's no embedded JSON (e.g. mustache templates), show a placeholder object.
      const specStr  = htmlStr ? (jsonStr ?? JSON.stringify({ note: "mustache template — no embedded spec" }, null, 2)) : null;
      wireDebugRow("TemplateJson", specStr, "spec.json");

      const dlHtml = document.getElementById("dlTemplateHtml");
      const vwHtml = document.getElementById("vwTemplateHtml");
      [dlHtml, vwHtml].forEach(btn => {
        if (!btn) return;
        btn.disabled = !htmlStr;
        btn.style.opacity = htmlStr ? "" : "0.35";
        btn.style.cursor  = htmlStr ? "" : "not-allowed";
      });
      if (htmlStr) {
        if (dlHtml) dlHtml.onclick = () => downloadText("template.html", htmlStr, "text/html");
        if (vwHtml) vwHtml.onclick = () => {
          const blob = new Blob([htmlStr], { type: "text/html" });
          window.open(URL.createObjectURL(blob), "_blank");
        };
      }

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
            extractedTemplateCache = { templateHtml, embeddedJson, colorRoles: parseColorRoles(templateHtml), templateMode: extractMode };
            setTemplateExtractStatus("✓ Template loaded (pre-compiled)", "rgba(118,176,34,.9)");
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

        const data = { templateHtml: result.templateHtml, embeddedJson: result.embeddedJson, colorRoles: parseColorRoles(result.templateHtml), templateMode: extractMode };
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

    // Parse --color-* CSS variable role comments from a template's :root block.
    // Returns [{index, label, hex}] sorted by index, e.g. [{index:1, label:"1. Canvas — deep slate…", hex:"#0f172a"}, …]
    function parseColorRoles(html) {
      if (!html) return [];
      const rootMatch = html.match(/:root\s*\{([\s\S]*?)\}/);
      if (!rootMatch) return [];
      const roles = [];
      const re = /--color-[\w-]+\s*:\s*(#[0-9a-fA-F]{3,8})[^;]*;\s*\/\*([^*]+)\*\//g;
      let m;
      while ((m = re.exec(rootMatch[1])) !== null) {
        const label = m[2].replace(/\s+/g, ' ').trim().split(/\s*[—–-]{1,2}\s*/)[0].trim();
        const numMatch = label.match(/^(\d+)\./);
        if (numMatch) roles.push({ index: parseInt(numMatch[1]), label, hex: m[1] });
      }
      return roles.sort((a, b) => a.index - b.index);
    }

    function applyColors(colors) {
      if (!colors) return;
      const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
      set("primary",   colors.primary);
      set("secondary", colors.secondary);
      set("accent",    colors.accent);
      set("dark",      colors.dark);
      set("light",     colors.light);
      // Update picker label text from --color-* role comments in the loaded template.
      // Labels are assigned positionally: role 1 → primary picker, role 2 → secondary, etc.
      // This matches the role-ordered colors built in renderSuggestedPalettes.
      const pickerIds = ["primary", "secondary", "accent", "dark", "light"];
      const roles = extractedTemplateCache?.colorRoles || parseColorRoles(extractedTemplateCache?.templateHtml);
      pickerIds.forEach((slot, i) => {
        const role = roles[i];
        const el = document.getElementById(slot + "-label");
        if (el) el.textContent = role ? role.label : (slot.charAt(0).toUpperCase() + slot.slice(1));
      });
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
      const modeRow = document.getElementById("templateModeRow");
      if (modeRow) modeRow.style.display = (isDebugMode() && source === "keyword") ? "" : "none";
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
      const slots = ["primary", "secondary", "accent", "dark", "light"];
      const firstScheme = resumeJson?.resume_strategy?.compatible_color_schemes?.[0];
      let colors = null;
      if (Array.isArray(firstScheme?.colors) && firstScheme.colors.length) {
        // New schema: ordered array [Canvas, Interactive, Vibrant, OnCanvas, Subtle]
        colors = Object.fromEntries(slots.map((s, i) => [s, normalizeToHex(firstScheme.colors[i]) || null]));
      } else if (firstScheme?.primary) {
        // Legacy named-slot schema
        colors = Object.fromEntries(slots.map(s => [s, normalizeToHex(firstScheme[s]) || null]));
      } else {
        // Oldest legacy: compatible_color_scheme.five_key_colors array
        const arr = resumeJson?.compatible_color_scheme?.five_key_colors;
        if (Array.isArray(arr) && arr.length)
          colors = Object.fromEntries(slots.map((s, i) => [s, normalizeToHex(arr[i]) || null]));
      }
      if (colors) applyColors(colors);
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
      if (!rawText) {
        setHeaderStatus("jobAnalysisStatus", "✓ Job skipped", "rgba(234,240,255,.4)");
        return;
      }

      jobAdResult     = null;
      jobAdInProgress = true;
      jobAdErrorDetail = null;
      const jobAdCountdown = startCountdown("jobAnalysisStatus", "Analyzing job info…", 120);

      const jobId = "jobad_" + crypto.randomUUID();
      try {
        const res = await fetch("/.netlify/functions/buildWebsite-background", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "extractJobAd",
            jobId,
            jobAdText: rawText,
            resumeStrategy: lastAnalysisData?.resume_strategy || null,
            resumeFacts:    lastAnalysisData?.resume_facts    || null,
            provider: getAnalysisProvider()
          })
        });
        if (!res.ok && res.status !== 202) {
          const errBody = await res.text().catch(() => "");
          jobAdErrorDetail = { stage: "request", status: res.status, body: errBody };
          clearInterval(jobAdCountdown);
          setHeaderStatus("jobAnalysisStatus", `Job extraction failed (HTTP ${res.status}): ${errBody.slice(0, 120)}`, "rgba(251,171,156,.8)");
          if (isDebugMode()) wireDebugRow("JobError", toDebugText(jobAdErrorDetail), "job-error.txt");
          jobAdInProgress = false;
          return;
        }

        const startTime = Date.now();
        let lastPollData = null;
        while (Date.now() - startTime < 120000) {
          await new Promise(r => setTimeout(r, 2500));
          const pollRes = await fetch(`/.netlify/functions/getPreviewResult?jobId=${encodeURIComponent(jobId)}`);
          lastPollData = await pollRes.json().catch(async () => ({
            status: pollRes.ok ? "pending" : "error",
            poll_status: pollRes.status,
            raw_body: await pollRes.text().catch(() => "")
          }));
          if (!pollRes.ok) {
            jobAdErrorDetail = lastPollData?.error
              ? lastPollData
              : { stage: "poll", status: pollRes.status, details: lastPollData };
            populateJobAdDebug({ error: jobAdErrorDetail, job_resolved: null });
            break;
          }
          if (lastPollData.status === "done") { jobAdResult = lastPollData; populateJobAdDebug(lastPollData); break; }
          if (lastPollData.status === "error") {
            jobAdErrorDetail = lastPollData?.error ?? lastPollData;
            populateJobAdDebug(lastPollData);
            break;
          }
        }
        if (!jobAdResult && isDebugMode()) {
          if (!jobAdErrorDetail) {
            jobAdErrorDetail = {
              stage: "poll-timeout",
              message: "Poll timed out waiting for job extraction result.",
              last_blob_response: lastPollData
            };
          }
          wireDebugRow("JobError", toDebugText(jobAdErrorDetail), "job-error.txt");
        }
      } catch (err) {
        jobAdErrorDetail = { stage: "client", message: err?.message || String(err) };
        if (isDebugMode()) wireDebugRow("JobError", toDebugText(jobAdErrorDetail), "job-error.txt");
      }

      clearInterval(jobAdCountdown);
      jobAdInProgress = false;
      if (jobAdResult) {
        setHeaderStatus("jobAnalysisStatus", "✓ Job info extracted", "rgba(118,176,34,.9)");
      } else {
        const detail = summarizeDebugText(jobAdErrorDetail || "see JobError in debug panel", 110);
        setHeaderStatus("jobAnalysisStatus", `Job extraction failed — ${detail || "see JobError in debug panel"}`, "rgba(251,171,156,.8)");
      }
    }

    // ----------------------------
    // Orchestrator — triggered on page 2 (Job) Next
    // Waits for resume analysis (extractJobAd needs resume_strategy + resume_facts), then fires
    // job ad extraction. job_resolved from extractJobAd IS the resolved strategy — no separate
    // unification step needed.
    // ----------------------------
    async function doAnalyzeAndExtractJobAd() {
      // Block until Stage 1 (resume analysis) is finished
      while (resumeAnalysisPending) {
        await new Promise(r => setTimeout(r, 500));
      }

      await doExtractJobAd();
      if (jobAdResult) wireStage2Debug();
    }

    // ----------------------------
    // Bridge Content & Design — triggered on page 4 (Colors) Next
    // Waits for Stage 2 (content strategy) if still in flight, then runs bridgeContentAndDesign.md
    // ----------------------------
    async function doBridgeContentAndDesign() {
      bridgeResult     = null;
      bridgeInProgress = true;
      // Clear token report here — this is the start of a new render cycle
      Object.keys(_tokenReportRows).forEach(k => delete _tokenReportRows[k]);
      const reportEl = document.getElementById("tokenReport");
      if (reportEl) reportEl.style.display = "none";

      // Block until job ad extraction is finished (bridge needs job_resolved)
      if (jobAdInProgress) {
        setHeaderStatus("bridgeStatus", "Waiting for job analysis…", "rgba(141,224,255,.6)");
        while (jobAdInProgress) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      const bridgeCountdown = startCountdown("bridgeStatus", "Planning design…", 300);
      const jobId = "bridge_" + crypto.randomUUID();

      try {
        const res = await fetch("/.netlify/functions/buildWebsite-background", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "bridgeContentAndDesign",
            jobId,
            templateHtml: extractedTemplateCache?.templateHtml || null,
            templateMode: extractedTemplateCache?.templateMode || "none",
            contentJson:  jobAdResult?.job_resolved || lastAnalysisData?.resume_resolved || null,
            colorSpec:    getPage3Colors().theme,
            provider:     getAnalysisProvider()
          })
        });
        if (!res.ok && res.status !== 202) {
          clearInterval(bridgeCountdown);
          bridgeInProgress = false;
          return;
        }

        const startTime = Date.now();
        while (Date.now() - startTime < 300000) {
          await new Promise(r => setTimeout(r, 3000));
          const pollRes = await fetch(`/.netlify/functions/getPreviewResult?jobId=${encodeURIComponent(jobId)}`);
          const data = await pollRes.json().catch(() => ({}));
          if (data.status === "done") { bridgeResult = data; break; }
          if (data.status === "error") { break; }
        }
      } catch { /* silent */ }

      clearInterval(bridgeCountdown);
      bridgeInProgress = false;
      if (bridgeResult?.bridge_json) {
        setHeaderStatus("bridgeStatus", "✓ Design plan ready", "rgba(118,176,34,.9)");
      } else {
        const detail = bridgeResult?.bridge_parse_error ? ` (${bridgeResult.bridge_parse_error})` : "";
        setHeaderStatus("bridgeStatus", `Design plan unavailable${detail}`, "rgba(251,171,156,.8)");
      }
      populateBridgeDebug(bridgeResult);

      // Auto-start renderer now that bridge is done (fire-and-forget)
      if (!generationResult && !generationInProgress) {
        doGenerateWebsite();
      }
    }

    function wirePayloadDebug() {
      const resumeFile = resumeUpload?.files?.[0];
      const payload = {
        page1:               getPage1(),
        page2:               getPage4Job(),
        page3:               getPage2Template(),
        page4:               getPage3Colors(),
        resumePdf:           resumeFile ? `${resumeFile.name} (${Math.round(resumeFile.size / 1024)} KB)` : null,
        resumeAnalysisJson:  lastAnalysisData || null,
        templateAnalysisJson: extractedTemplateCache?.embeddedJson || null,
        templateHtml:        extractedTemplateCache?.templateHtml ? `(${extractedTemplateCache.templateHtml.length} chars)` : null,
        resolvedStrategy:    jobAdResult?.job_resolved || lastAnalysisData?.resume_resolved || null,
        bridgeJson:          bridgeResult?.bridge_json || null,
      };
      wireDebugRow("DebugPayload", JSON.stringify(payload, null, 2), "payload.json");
    }

    // Accumulated token rows from all stages — keyed by stage name so later updates overwrite earlier ones
    const _tokenReportRows = {};

    function mergeTokenReport(rows) {
      if (!Array.isArray(rows)) return;
      rows.forEach(r => { if (r?.stage) _tokenReportRows[r.stage] = r; });
      renderTokenReport();
    }

    function renderTokenReport() {
      const reportEl = document.getElementById("tokenReport");
      if (!reportEl) return;
      const rows = Object.values(_tokenReportRows);
      if (!rows.length) { reportEl.style.display = "none"; return; }
      // Sort by stage name so they appear in pipeline order
      rows.sort((a, b) => a.stage.localeCompare(b.stage));
      const lines = rows.map(r => {
        const inp = r.input  != null ? String(r.input).padStart(6)  : "     ?";
        const out = r.output != null ? String(r.output).padStart(6) : "     ?";
        const tot = (r.input != null && r.output != null) ? String(r.input + r.output).padStart(7) : "      ?";
        return `${r.stage.padEnd(28)}  in ${inp}  out ${out}  total ${tot}`;
      });
      const totIn  = rows.reduce((s, r) => s + (r.input  ?? 0), 0);
      const totOut = rows.reduce((s, r) => s + (r.output ?? 0), 0);
      lines.push("─".repeat(68));
      lines.push(`${"TOTAL".padEnd(28)}  in ${String(totIn).padStart(6)}  out ${String(totOut).padStart(6)}  total ${String(totIn + totOut).padStart(7)}`);
      reportEl.textContent = lines.join("\n");
      reportEl.style.display = "block";
    }

    function populateBridgeDebug(data) {
      const content = data?.bridge_json
        ?? (data?.bridge_raw ? { _parse_error: data.bridge_parse_error, _raw_preview: data.bridge_raw } : null);
      wireDebugRow("Stage4", JSON.stringify(content, null, 2), "bridge.json");
      if (isDebugMode()) mergeTokenReport(data?.token_report);
    }

    function populateJobAdDebug(data) {
      wireDebugRow("JobError", toDebugText(data?.error ?? jobAdErrorDetail), "job-error.txt");
      wireDebugRow("JobResolved", JSON.stringify(data?.job_resolved ?? null, null, 2), "job-resolved.json");
      if (isDebugMode()) mergeTokenReport(data?.token_report);
    }

    // ----------------------------
    // Wire Stage 2 (Unified Strategy) debug buttons — called from doUnifyResumeAndJobAnalyses
    // AND from populateGenerationDebug so both paths keep buttons live.
    // ----------------------------
    function wireStage2Debug() {
      const resolved = jobAdResult?.job_resolved ?? lastAnalysisData?.resume_resolved ?? null;
      wireDebugRow("Stage2", JSON.stringify(resolved, null, 2), "resolved-strategy.json");
    }

    // ----------------------------
    // Populate generation debug outputs — called as soon as doGenerateWebsite() gets a result
    // ----------------------------
    function populateGenerationDebug(data) {
      if (data.model) {
        const modelEl = document.getElementById("debugModelName");
        if (modelEl) modelEl.textContent = `Model: ${data.model}`;
      }

      if (isDebugMode()) mergeTokenReport(data?.token_report);

      wireStage2Debug(data);

      // Stage 1: Resume Facts + Strategy (re-wire in case page 5 loaded before page 1)
      const resumeJsonToShow = data.resume_json || resumeAnalysisCache;
      if (resumeJsonToShow) populateResumeDebugPanel(resumeJsonToShow);

      // Enable download buttons and Open Editor once we have real HTML output
      const siteHtml = generationResult?.site_html;
      if (siteHtml) {
        const resumeData = getPage1();
        const designData = getPage2Template();
        const colorsData = getPage3Colors();
        const jobData    = getPage4Job();
        const summaryHtml = buildSummaryHtml({ resume: resumeData, job: jobData, design: designData, colors: colorsData, visuals: [] });
        const dlFinalHtml = document.getElementById("dlFinalHtml");
        const dlSummary   = document.getElementById("dlSummaryHtml");
        greyRendererButtons(false);
        if (dlFinalHtml) dlFinalHtml.onclick = () => downloadText("portfolio.html", siteHtml, "text/html");
        const cpFinalHtml = document.getElementById("cpFinalHtml");
        if (cpFinalHtml) cpFinalHtml.onclick = e => copyToClipboard(siteHtml, e.currentTarget);
        const vwFinalHtml = document.getElementById("vwFinalHtml");
        if (vwFinalHtml) vwFinalHtml.onclick = () => { const u = URL.createObjectURL(new Blob([siteHtml], {type:"text/html"})); window.open(u, "_blank"); };
        if (dlSummary)   dlSummary.onclick   = () => downloadText("MyPersonalPortfolioWebsiteSummary.html", summaryHtml, "text/html");
        const cpSummaryHtml = document.getElementById("cpSummaryHtml");
        if (cpSummaryHtml) cpSummaryHtml.onclick = e => copyToClipboard(summaryHtml, e.currentTarget);
        const vwSummaryHtml = document.getElementById("vwSummaryHtml");
        if (vwSummaryHtml) vwSummaryHtml.onclick = () => { const u = URL.createObjectURL(new Blob([summaryHtml], {type:"text/html"})); window.open(u, "_blank"); };
        setOpenEditorReady(true);
      }
    }

    // ----------------------------
    // Generation — called from page 4 Next (fire-and-forget); visuals injected client-side after generation
    // ----------------------------
    async function doGenerateWebsite() {
      generationResult    = null;
      generationError     = null;
      generationInProgress = true;
      // In mustache mode the bridge is skipped — don't clear accumulated job-ad tokens here;
      // mergeTokenReport overwrites by stage key so re-renders stay clean.
      setApplyBtnState(false);
      setOpenEditorReady(false);
      document.getElementById("upgradePrompt")?.classList.add("hidden");

      const resumeFile = resumeUpload.files[0];
      if (!resumeFile) {
        generationError = "Resume PDF not found — please re-upload your resume.";
        generationInProgress = false;
        setHeaderStatus("generatingWebsiteStatus", "⚠ " + generationError, "rgba(251,171,156,.9)");
        setApplyBtnState(true);
        return;
      }

      setHeaderStatus("generatingWebsiteStatus", "Generating portfolio…", "rgba(141,224,255,.75)");

      // If the job ad field has content but page 2 hasn't been submitted yet, wait silently
      const jobAdFieldText = [
        document.getElementById("desiredRole")?.value?.trim(),
        document.getElementById("jobAd")?.value?.trim()
      ].filter(Boolean).join("").trim();
      if (jobAdFieldText && !page2Submitted) {
        setHeaderStatus("generatingWebsiteStatus", "Waiting for job ad step…", "rgba(141,224,255,.6)");
        while (!page2Submitted) {
          await new Promise(r => setTimeout(r, 500));
        }
        setHeaderStatus("generatingWebsiteStatus", "Generating portfolio…", "rgba(141,224,255,.75)");
      }

      // If job extraction is still running, wait for it
      if (jobAdInProgress) {
        setHeaderStatus("generatingWebsiteStatus", "Waiting for job analysis…", "rgba(141,224,255,.6)");
        while (jobAdInProgress) {
          await new Promise(r => setTimeout(r, 500));
        }
        setHeaderStatus("generatingWebsiteStatus", "Generating portfolio…", "rgba(141,224,255,.75)");
      }
      const renderCountdown = null;

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
            resumeAnalysisJson:   lastAnalysisData || null,
            templateAnalysisJson: extractedTemplateCache?.embeddedJson || null,
            templateHtml:         extractedTemplateCache?.templateHtml || null,
            strategyJson:         jobAdResult?.job_resolved || lastAnalysisData?.resume_resolved || null,
            bridgeJson:           bridgeResult?.bridge_json || null,
            provider:             getAnalysisProvider(),
            userId:               currentUserId()
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
            ? `${data.stage} (${remaining}s)`
            : `Generating portfolio… ${remaining}s`;
          setHeaderStatus("generatingWebsiteStatus", stageMsg, "rgba(141,224,255,.75)");
          if (data.status === "done") {
            clearInterval(renderCountdown);
            generationResult    = data;
            generationInProgress = false;
            if (!currentUserId()) incrementAnonCredits();
            setHeaderStatus("generatingWebsiteStatus", "✓ Website generated", "rgba(118,176,34,.9)");
            setApplyBtnState(true);
            populateGenerationDebug(data);
            return;
          }
          if (data.status === "error") {
            if (data.quota) { showUpgradePrompt(data); return; }
            throw new Error(data.error || "Generation failed.");
          }
        }
        throw new Error("Generation timed out after 12 minutes.");
      } catch (e) {
        clearInterval(renderCountdown);
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
      if (!currentUserId() && !hasCreditsRemaining()) {
        showUpgradePrompt({ tier: "free", used: ANON_CREDIT_LIMIT, limit: ANON_CREDIT_LIMIT, anon: true });
        return;
      }
      if (generationInProgress) {
        setHeaderStatus("generatingWebsiteStatus", "Still generating… please wait.", "rgba(141,224,255,.75)");
        return;
      }

      if (!generationResult) {
        // Fallback: generation wasn't triggered automatically — run it now
        generationError = null;
        await doGenerateWebsite();
        if (!generationResult) return;
      }

      // Set localStorage with the base HTML *before* opening the window so the
      // editor never reads an empty slot. The popup-blocker rule only fires on
      // window.open(), not on localStorage writes.
      localStorage.setItem("portfolio_preview_html", generationResult.site_html);
      const editorWin = window.open("editor.html", "_blank");

      // Collect visuals and inject them (client-side, may be instant or async).
      const { artifacts: dynamicVisuals } = await getPage5Artifacts();
      const structuredVisuals = await collectStructuredArtifacts();
      const allVisuals = [...structuredVisuals, ...dynamicVisuals];

      const data = generationResult;

      let finalHtml = data.site_html;
      if (allVisuals.length > 0) {
        finalHtml = injectArtifacts(finalHtml, allVisuals);
        // Update localStorage with artifact-injected version and push it to the
        // already-open editor window via postMessage (no reload needed).
        localStorage.setItem("portfolio_preview_html", finalHtml);
        if (editorWin && !editorWin.closed) {
          try { editorWin.postMessage({ type: "portfolio_html", html: finalHtml }, location.origin); } catch {}
        }
      }

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
      greyRendererButtons(false);
      if (dlFinalHtml) dlFinalHtml.onclick = () => downloadText("portfolio.html", finalHtml, "text/html");
      if (dlSummary)   dlSummary.onclick   = () => downloadText("MyPersonalPortfolioWebsiteSummary.html", summaryHtml, "text/html");

      // ── Debug panel — re-wire payload with visuals included now that generation ran ──
      if (isDebugMode()) wirePayloadDebug();

      finalStatus.innerHTML = data.truncated
        ? `<span class="ok">Portfolio ready</span> <span class="hint">(output was cut short — some sections may be missing; try regenerating)</span>`
        : `<span class="ok">Portfolio ready.</span> Open the editor below.`;

      // If the popup was blocked, editorWin is null — open now that localStorage is set.
      if (!editorWin || editorWin.closed) {
        window.open("editor.html", "_blank");
      }
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
      if (resumeUpload.files?.[0] && hasCreditsRemaining()) analyzeResumeInBackground(resumeUpload.files[0]);
      setStep(2);
    });
    document.getElementById("dbgSubmit1")?.addEventListener("click", () => { page1Action(); });

    // Page 3 (Design / Template)
    document.getElementById("back2")?.addEventListener("click", () => setStep(2));

    function onEnterPage2() {
      applyDesignDefaults();
      updateTemplateUI();
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

      // Slot 0: template palette — prefer colorRoles order (1=most dominant) over slot names
      let tplPalette = null;
      const tplColorRoles = extractedTemplateCache?.colorRoles;
      if (tplColorRoles?.length) {
        const slots = ["primary", "secondary", "accent", "dark", "light"];
        const colors = {};
        tplColorRoles.forEach((r, i) => { if (i < slots.length) colors[slots[i]] = r.hex; });
        if (Object.values(colors).some(Boolean)) {
          tplPalette = { label: "Template palette", colors };
        }
      }
      if (!tplPalette) {
        // Fallback: embedded default_color_scheme (templates without --color-* role comments)
        const tplColors = extractedTemplateCache?.embeddedJson?.default_color_scheme;
        if (tplColors && !Array.isArray(tplColors) && typeof tplColors === "object") {
          const { primary, secondary, accent, dark, light } = tplColors;
          if (primary || secondary || accent) {
            tplPalette = { label: "Template palette", colors: { primary, secondary, accent, dark, light } };
          }
        }
      }
      if (!tplPalette && extractedTemplateCache?.templateHtml) {
        // Legacy fallback: old CSS var names (pre-color-role-comment templates)
        const rootMatch = extractedTemplateCache.templateHtml.match(/:root\s*\{([^}]+)\}/);
        if (rootMatch) {
          const css = rootMatch[1];
          const cssVar = name => css.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`))?.[ 1] || null;
          const primary   = cssVar("accent");
          const secondary = cssVar("accent-2");
          const dark      = cssVar("bg");
          const light     = cssVar("light") || cssVar("panel");
          if (primary || secondary) {
            tplPalette = { label: "Template palette", colors: { primary, secondary, dark, light, accent: null } };
          }
        }
      }

      // Slots 1-3: up to 3 AI palettes from resume analysis
      const resolvedData = analysisData ?? lastAnalysisData;
      const aiPalettes = resolvedData?.resume_strategy?.compatible_color_schemes
                      ?? resolvedData?.compatible_color_schemes
                      ?? [];
      const slots = ["primary", "secondary", "accent", "dark", "light"];
      const aiRows = aiPalettes
        .filter(p => (Array.isArray(p.colors) && p.colors.length) || p.primary || p.secondary || p.accent)
        .slice(0, 3)
        .map((p, i) => {
          // New format: ordered array matching role positions 1-5
          // Legacy format: named slots (primary/secondary/accent/dark/light)
          const colors = Array.isArray(p.colors)
            ? Object.fromEntries(slots.map((s, j) => [s, p.colors[j] || null]))
            : { primary: p.primary, secondary: p.secondary, accent: p.accent, dark: p.dark, light: p.light };
          return { label: p.how_used || `AI palette ${i + 1}`, colors };
        });

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
          if (cb.checked) { userHasSelectedPalette = true; applyColors(palette.colors); }
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

      // Auto-select Template Palette the first time it arrives, but only if the user
      // hasn't already made an active palette or theme choice.
      if (tplPalette && !templatePaletteRendered && !userHasSelectedPalette) {
        templatePaletteRendered = true;
        const firstRadio = rows.querySelector('input[name="suggestedPalette"]');
        if (firstRadio) { firstRadio.checked = true; applyColors(tplPalette.colors); }
      }
    }

    renderSuggestedPalettes(); // render blank rows immediately
    document.getElementById("continueTo4")?.addEventListener("click", () => setStep(5));

    // Page 2 (Job)
    function page2Action() { page2Submitted = true; onEnterPage2(); doAnalyzeAndExtractJobAd(); }
    document.getElementById("back5")?.addEventListener("click", () => setStep(1));
    document.getElementById("submit_bottom")?.addEventListener("click", () => { page2Action(); setStep(3); });
    document.getElementById("dbgSubmit2")?.addEventListener("click", page2Action);

    // Page 3 (Design) — Back returns to Job; Next validates then advances to Colors
    document.getElementById("back3_bottom")?.addEventListener("click", () => setStep(2));
    document.getElementById("next3_bottom")?.addEventListener("click", () => {
      if (!page3Action()) return;
      setStep(4);
    });

    // Page 4 (Colors)
    function isMustacheMode() { return extractedTemplateCache?.templateMode === "mustache"; }
    function page4Action() {
      setHeaderStatus("colorsChosenStatus", "✓ Colors chosen", "rgba(118,176,34,.9)");
      if (isMustacheMode()) {
        doGenerateWebsite(); // bridge unused for mustache — skip straight to renderer
      } else {
        doBridgeContentAndDesign(); // fire-and-forget, auto-chains into doGenerateWebsite
      }
    }
    document.getElementById("back4")?.addEventListener("click", () => { onEnterPage2(); setStep(3); });
    document.getElementById("next4")?.addEventListener("click", () => { page4Action(); setStep(5); });
    document.getElementById("dbgSubmit4")?.addEventListener("click", page4Action);

    // Page 5 (Visuals)
    document.getElementById("back2_bottom")?.addEventListener("click", () => setStep(4));
    document.getElementById("next2_bottom")?.addEventListener("click", doPreview);
    document.getElementById("dbgSubmit5")?.addEventListener("click", doPreview);

    // Debug recompute buttons
    document.getElementById("recomputeStage4")?.addEventListener("click", () => {
      if (bridgeInProgress || generationInProgress) return;
      bridgeResult     = null;
      generationResult = null;
      greyRendererButtons(true);
      setApplyBtnState(false);
      if (isMustacheMode()) {
        doGenerateWebsite();
      } else {
        doBridgeContentAndDesign(); // auto-chains into doGenerateWebsite() on completion
      }
    });
    document.getElementById("recomputeStage5")?.addEventListener("click", () => {
      if (generationInProgress) return;
      generationResult = null;
      greyRendererButtons(true);
      setApplyBtnState(false);
      doGenerateWebsite();
    });
    // Artifact rows — wire add button
    document.getElementById("addArtifact")?.addEventListener("click", () => addArtifactRow());

    // Track which color input last had focus
    const colorInputIds = ["primary", "secondary", "accent", "dark", "light"];
    let focusedColorId = "primary";
    colorInputIds.forEach(id => {
      document.getElementById(id)?.addEventListener("focus", () => { focusedColorId = id; });
    });

    // Resize color-themes iframe to its exact content height (posted by ResizeObserver inside)
    window.addEventListener("message", e => {
      if (!e.data || e.data.type !== "colorThemesHeight") return;
      const f = document.getElementById("colorThemesFrame");
      if (f) f.style.height = e.data.height + "px";
    });

    // Single color pick from iframe — fills whichever field is active
    window.addEventListener("message", e => {
      const msg = e.data;
      if (!msg || msg.type !== "colorPick") return;
      userHasSelectedPalette = true;
      const el = document.getElementById(focusedColorId);
      if (el) el.value = msg.color;
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

    updateDebugBanner();
    updateProviderBadge();
    renderStepUI();
    setStep(0);
    window.addEventListener("message", (event) => {
        const msg = event.data;
        if (!msg || msg.type !== "colorThemeSelected") return;

        userHasSelectedPalette = true;
        const t = msg.theme || {};
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ""; };

        set("themeNumber", msg.number ?? "");
        set("primary",   t.primary);
        set("secondary", t.secondary);
        set("accent",    t.accent);
        set("dark",      t.dark);
        set("light",     t.light);
      });
