
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

    // Bridge Profile & Design (triggered on Colors Next — legacy path)
    let bridgeResult      = null;   // {bridge_json, model} when done
    let bridgeInProgress  = false;

    // Braid (single-pass layout clone + content substitution — replaces bridge+render for options 1 & 2)
    let braidInProgress = false;
    let mastheadImageInProgress = false;
    let mastheadImageResult = null;
    let mastheadImageError = null;
    let autoMastheadImageTriggered = false;
    let mastheadImageTicker = null;   // interval handle for the generating countdown

    // Epoch counters — increment to abort any in-flight poll loop for that task
    let _jobAdRunId      = 0;
    let _braidRunId      = 0;
    let _mastheadImageRunId = 0;
    let _bridgeRunId     = 0;
    let _generationRunId = 0;

    // Set true when the braid/generate pipeline is first triggered; enables auto-restart
    // after upstream inputs change on pages 1–4.
    let page3Submitted = false;  // set when page 3 Next fires in braid mode
    let page4Submitted = false;  // set when page 4 Next fires in mustache/design-options mode

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

    function showAnonCreditPrompt() {
      showUpgradePrompt({ tier: "free", used: getAnonCreditsUsed(), limit: ANON_CREDIT_LIMIT, anon: true });
    }

    function cachePreviewHtml(html) {
      const value = String(html || "");
      window.__portfolioPreviewHtml = value;
      try {
        localStorage.setItem("portfolio_preview_html", value);
      } catch (err) {
        try { localStorage.removeItem("portfolio_preview_html"); } catch {}
        console.warn("Could not persist portfolio_preview_html to localStorage:", err?.message || err);
      }
    }

    function cachePage4Colors(colors) {
      const value = colors && typeof colors === "object" ? { ...colors } : null;
      window.__portfolioPage4Colors = value;
      try {
        localStorage.setItem("portfolio_page4_colors", JSON.stringify(value));
      } catch (err) {
        try { localStorage.removeItem("portfolio_page4_colors"); } catch {}
        console.warn("Could not persist portfolio_page4_colors to localStorage:", err?.message || err);
      }
    }

    function cacheImageGenerationContext(context) {
      const value = context && typeof context === "object" ? JSON.parse(JSON.stringify(context)) : null;
      window.__portfolioImageGenerationContext = value;
      try {
        localStorage.setItem("portfolio_image_generation_context", JSON.stringify(value));
      } catch (err) {
        try { localStorage.removeItem("portfolio_image_generation_context"); } catch {}
        console.warn("Could not persist portfolio_image_generation_context to localStorage:", err?.message || err);
      }
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
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15000);
            const res = await fetch("/.netlify/functions/createCheckoutSession", {
              method: "POST",
              headers: { "content-type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({
                tier:       UPGRADE_TIER_KEY[tier] || "basic",
                userId:     user.id,
                userEmail:  user.email,
                returnUrl:  location.origin + location.pathname,
                quantity
              })
            });
            clearTimeout(timer);
            const text = await res.text();
            let data = null;
            try { data = JSON.parse(text); } catch {}
            if (!res.ok || !data?.url) {
              throw new Error(data?.error || `Could not start checkout.${text ? ` ${text.slice(0, 200)}` : ""}`);
            }
            location.href = data.url;
          } catch (err) {
            linkEl.textContent = "Upgrade →";
            linkEl.style.opacity = "";
            const message = err?.name === "AbortError"
              ? "Checkout request timed out after 15 seconds. The checkout function may be hanging or Stripe may be unreachable."
              : `Checkout error: ${err.message}`;
            console.error("Checkout error:", err);
            alert(message);
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

    // Pre-create validation message/checkmark scaffolding so the first focus on an
    // input does not trigger DOM reparenting that can dismiss the browser's native
    // autofill/autocomplete popup.
    Object.keys(FIELD_VALIDATORS).forEach(id => {
      getFieldMsg(id);
      getFieldOkMark(id);
    });

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
      jobAdResult = null; // job_resolved depends on resume — clear so it reruns
      document.getElementById("reanalyzeResume").style.display = hasFile ? "inline" : "none";
      if (hasFile) {
        if (!hasCreditsRemaining()) {
          setResumeAnalysisStatus("No credits remaining — upgrade to analyze your resume.", "rgba(251,171,156,.8)");
          if (!currentUserId()) showAnonCreditPrompt();
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
        if (!currentUserId()) showAnonCreditPrompt();
        return;
      }
      const input = document.getElementById("resumeUpload");
      if (!input?.files?.[0]) return;
      const file = input.files[0];
      try { localStorage.removeItem(resumeCacheKey(file)); } catch {}
      resumeAnalysisCache = null;
      lastAnalysisData = null;
      jobAdResult = null; // job_resolved depends on resume — force re-extraction
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
      if (debug) wireMastheadImageDebug(mastheadImageResult?.image_data_uri || null);
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
      forwardEditorProcessStatus();
    }

    function setHeaderStatus(id, text, color = "rgba(234,240,255,.6)") {
      const el = document.getElementById(id);
      if (el) { el.textContent = text; el.style.color = color; }
      forwardEditorProcessStatus();
    }

    function currentEditorProcessStatus() {
      const candidates = [
        "generatingWebsiteStatus",
        "braidStatus",
        "colorsChosenStatus",
        "templateExtractStatus",
        "jobAnalysisStatus",
        "resumeAnalysisStatus",
        "editorAutoOpenStatus"
      ];
      for (const id of candidates) {
        const el = document.getElementById(id);
        const text = el?.textContent?.trim() || "";
        if (!text) continue;
        if (/^(✓|⚠)/.test(text)) continue;
        if (/not needed|credit limit reached/i.test(text)) continue;
        return { text, color: el?.style?.color || "rgba(234,240,255,.6)" };
      }
      return null;
    }

    function forwardEditorProcessStatus() {
      const editorWin = window.__portfolioEditorWindow;
      if (!editorWin || editorWin.closed) return;
      const status = currentEditorProcessStatus();
      try {
        editorWin.postMessage(
          status
            ? { type: "editor_process_status", text: status.text, color: status.color }
            : { type: "editor_process_status_clear" },
          location.origin
        );
      } catch {}
    }

    function restorePersistentHeaderStatuses() {
      const resumeEl = document.getElementById("resumeAnalysisStatus");
      if (resumeEl && !resumeEl.textContent.trim() && lastAnalysisData && !resumeAnalysisPending) {
        setResumeAnalysisStatus("✓ Resume analyzed", "rgba(118,176,34,.9)");
      }

      const jobEl = document.getElementById("jobAnalysisStatus");
      if (jobEl && !jobEl.textContent.trim() && jobAdResult && !jobAdInProgress) {
        setHeaderStatus("jobAnalysisStatus", "✓ Job info extracted", "rgba(118,176,34,.9)");
      }
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
      if (ready && !pillNavUnlocked) {
        pillNavUnlocked = true;
        renderStepUI();
      }
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

    async function readJsonResponseSafely(res) {
      const text = await res.text().catch(() => "");
      let data = null;
      if (text) {
        try { data = JSON.parse(text); } catch {}
      }
      return { ok: res.ok, status: res.status, text, data };
    }

    function escapeRegExp(value) {
      return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function stripCssComments(value = "") {
      return String(value || "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
    }

    function parseEmbeddedMastheadMeta(html = "") {
      const match = String(html || "").match(/<!--\s*IW_MASTHEAD_META:\s*(\{[\s\S]*?\})\s*-->/i);
      if (!match) return null;
      try { return JSON.parse(match[1]); } catch { return null; }
    }

    function analyzeSampleMastheadLocal(sampleHtml = "") {
      const MASTHEAD_PLACEHOLDER_URL = "braid-masthead.png";
      let sampleHasRasterHeroImage = false;
      let sampleRasterCssUrl = "";
      let sampleRasterCssSelector = "";
      let sampleRasterBackgroundDecl = "";
      let sampleHeaderContainsHero = false;

      const headerMatch = sampleHtml.match(/<header\b[^>]*>([\s\S]{0,8000})<\/header>/i);
      const heroMatch = sampleHtml.match(/<(?:section|header|div)[^>]*(?:id|class)=["'][^"']*hero[^"']*["'][^>]*>([\s\S]{0,5000})/i);
      const searchRegions = [headerMatch?.[1], heroMatch?.[1], sampleHtml.slice(0, 6000)]
        .filter(Boolean)
        .join("\n");
      const styleBlock = (sampleHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/i) || [])[1] || "";
      const rasterImgMatch = searchRegions.match(
        /<img\b[^>]*src=["'](?!data:)[^"']+\.(?:png|jpe?g)(?:\?[^"']*)?["'][^>]*>/i
      );
      const cssBlocks = [...styleBlock.matchAll(/([^{}]+)\{([\s\S]*?)\}/g)];
      const rasterBgBlock = cssBlocks.find(([, selector, body]) =>
        /(header|\bhero\b)/i.test(selector) &&
        /url\(\s*["']?[^"')]+\.(?:png|jpe?g)(?:\?[^"')]*)?["']?\s*\)/i.test(body)
      );
      sampleRasterCssSelector = stripCssComments(rasterBgBlock?.[1] || "");
      sampleRasterBackgroundDecl = rasterBgBlock?.[2]?.match(/background\s*:\s*[\s\S]*?;/i)?.[0]?.trim() || "";
      const rasterBgMatch = rasterBgBlock
        ? (rasterBgBlock[2].match(/url\(\s*["']?([^"')]+\.(?:png|jpe?g)(?:\?[^"')]*)?)["']?\s*\)/i) || [])[1] || true
        : null;
      sampleRasterCssUrl = typeof rasterBgMatch === "string" ? rasterBgMatch : "";
      sampleHeaderContainsHero = /class=["'][^"']*\bhero\b[^"']*["']/i.test(headerMatch?.[1] || "");
      sampleHasRasterHeroImage = !!(rasterImgMatch || rasterBgMatch);

      return {
        sampleHasRasterHeroImage,
        sampleRasterCssUrl,
        sampleRasterCssSelector,
        sampleRasterBackgroundDecl,
        sampleHeaderContainsHero,
        mastheadPlaceholderUrl: MASTHEAD_PLACEHOLDER_URL,
        domainContext: ""
      };
    }

    function findBalancedElementByClass(html, className, startIndex = 0) {
      const openRe = new RegExp(`<([a-z0-9:-]+)\\b[^>]*class=["'][^"']*\\b${escapeRegExp(className)}\\b[^"']*["'][^>]*>`, "ig");
      openRe.lastIndex = startIndex;
      const openMatch = openRe.exec(html);
      if (!openMatch) return null;
      const tagName = openMatch[1];
      const openIndex = openMatch.index;
      const tagRe = new RegExp(`<\\/?${escapeRegExp(tagName)}\\b[^>]*>`, "ig");
      tagRe.lastIndex = openIndex;
      let depth = 0;
      let tagMatch;
      while ((tagMatch = tagRe.exec(html)) !== null) {
        const token = tagMatch[0];
        const isClose = /^<\//.test(token);
        if (!isClose && !/\/>$/.test(token)) depth += 1;
        else if (isClose) depth -= 1;
        if (depth === 0) {
          return {
            start: openIndex,
            end: tagRe.lastIndex,
            html: html.slice(openIndex, tagRe.lastIndex),
            tagName
          };
        }
      }
      return null;
    }

    function findBalancedElementByTagContaining(html, tagNames, innerPattern, startIndex = 0) {
      const tagsAlt = tagNames.map(escapeRegExp).join("|");
      const openRe = new RegExp(`<(${tagsAlt})\\b[^>]*>`, "ig");
      openRe.lastIndex = startIndex;
      let openMatch;
      while ((openMatch = openRe.exec(html)) !== null) {
        const tagName = openMatch[1];
        const openIndex = openMatch.index;
        const tagRe = new RegExp(`<\\/?${escapeRegExp(tagName)}\\b[^>]*>`, "ig");
        tagRe.lastIndex = openIndex;
        let depth = 0;
        let tagMatch;
        while ((tagMatch = tagRe.exec(html)) !== null) {
          const token = tagMatch[0];
          const isClose = /^<\//.test(token);
          if (!isClose && !/\/>$/.test(token)) depth += 1;
          else if (isClose) depth -= 1;
          if (depth === 0) {
            const blockHtml = html.slice(openIndex, tagRe.lastIndex);
            if (innerPattern.test(blockHtml)) {
              return {
                start: openIndex,
                end: tagRe.lastIndex,
                html: blockHtml,
                tagName
              };
            }
            break;
          }
        }
      }
      return null;
    }

    function stripHeroBgImageLayer(html) {
      return String(html || "").replace(/var\(--hero-bg-image\)\s*,\s*/g, "");
    }

    function moveGeneratedHeroIntoHeader(html, mastheadMeta) {
      if (!mastheadMeta?.sampleHeaderContainsHero) return html;
      const headerCloseMatch = html.match(/<\/header>/i);
      if (!headerCloseMatch || headerCloseMatch.index == null) return html;
      const headerCloseIdx = headerCloseMatch.index;
      if (/<h1\b/i.test(html.slice(0, headerCloseIdx))) return html;
      let heroBlock = findBalancedElementByClass(html, "hero", headerCloseIdx);
      if (!heroBlock || heroBlock.start < headerCloseIdx) {
        heroBlock = findBalancedElementByTagContaining(
          html,
          ["section", "div"],
          /<h1\b[\s\S]*?(?:<a\b|<button\b|class=["'][^"']*(?:cta|pill|chip|card)[^"']*["'])/i,
          headerCloseIdx
        );
      }
      if (!heroBlock || heroBlock.start < headerCloseIdx) return html;
      const withoutHero = html.slice(0, heroBlock.start) + html.slice(heroBlock.end);
      const insertIdx = withoutHero.search(/<\/header>/i);
      if (insertIdx === -1) return html;
      return withoutHero.slice(0, insertIdx) + "\n" + heroBlock.html + "\n" + withoutHero.slice(insertIdx);
    }

    function injectHeroBackgroundCleanup(html, mastheadMeta) {
      if (!mastheadMeta?.sampleHeaderContainsHero) return html;
      const overrideCss = `
<style id="braid-masthead-fix">
header .hero,
header > section:has(h1),
header > div:has(h1){background:transparent !important;background-image:none !important;}
header .hero::before,header .hero::after,
header > section:has(h1)::before,header > section:has(h1)::after,
header > div:has(h1)::before,header > div:has(h1)::after{background:none !important;background-image:none !important;box-shadow:none !important;}
</style>`;
      if (html.includes('id="braid-masthead-fix"')) return html;
      if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${overrideCss}\n</head>`);
      return overrideCss + html;
    }

    function injectForcedMastheadSelectorCss(html, dataUri, mastheadMeta) {
      if (!mastheadMeta?.sampleRasterCssSelector || !mastheadMeta?.sampleRasterBackgroundDecl || !mastheadMeta?.sampleRasterCssUrl) {
        return html;
      }
      const forcedBackgroundDecl = mastheadMeta.sampleRasterBackgroundDecl
        .replace(mastheadMeta.sampleRasterCssUrl, dataUri)
        .replace(/;\s*$/, " !important;");
      const forcedCss = `
<style id="braid-masthead-force">
${mastheadMeta.sampleRasterCssSelector}{${forcedBackgroundDecl}}
${mastheadMeta.sampleRasterCssSelector}::before,
${mastheadMeta.sampleRasterCssSelector}::after{background:none !important;background-image:none !important;box-shadow:none !important;content:none !important;}
</style>`;
      if (html.includes('id="braid-masthead-force"')) return html;
      if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${forcedCss}\n</head>`);
      return forcedCss + html;
    }

    function enforceSampleMastheadBackground(html, dataUri, mastheadMeta) {
      if (!mastheadMeta?.sampleRasterCssSelector || !mastheadMeta?.sampleRasterBackgroundDecl || !mastheadMeta?.sampleRasterCssUrl) {
        return html;
      }
      const normalizedBackgroundDecl = mastheadMeta.sampleRasterBackgroundDecl.replace(
        mastheadMeta.sampleRasterCssUrl,
        dataUri
      );
      const selectorRe = new RegExp(`(${escapeRegExp(mastheadMeta.sampleRasterCssSelector)}\\s*\\{)([\\s\\S]*?)(\\})`, "i");
      let matched = false;
      const updated = html.replace(selectorRe, (match, open, body, close) => {
        matched = true;
        let nextBody = body;
        if (/background\s*:\s*[\s\S]*?;/i.test(nextBody)) {
          nextBody = nextBody.replace(/background\s*:\s*[\s\S]*?;/i, normalizedBackgroundDecl);
        } else if (/background-image\s*:\s*[\s\S]*?;/i.test(nextBody)) {
          nextBody = nextBody.replace(/background-image\s*:\s*[\s\S]*?;/i, normalizedBackgroundDecl);
        } else {
          nextBody = `\n  ${normalizedBackgroundDecl}\n${nextBody}`;
        }
        return `${open}${nextBody}${close}`;
      });
      let nextHtml = matched ? updated : stripHeroBgImageLayer(html);
      nextHtml = stripHeroBgImageLayer(nextHtml);
      nextHtml = moveGeneratedHeroIntoHeader(nextHtml, mastheadMeta);
      nextHtml = injectHeroBackgroundCleanup(nextHtml, mastheadMeta);
      nextHtml = injectForcedMastheadSelectorCss(nextHtml, dataUri, mastheadMeta);
      return nextHtml;
    }

    function applyGeneratedMastheadImageToHtml(html, dataUri, mastheadMeta) {
      if (!html || !dataUri) return html || "";
      let nextHtml = String(html);

      // Path 1: braid-img placeholder <img> tag
      if (nextHtml.includes('id="braid-img"')) {
        return nextHtml.replace(/(<img[^>]*id="braid-img"[^>]*)src=""/, `$1src="${dataUri}"`);
      }

      // Path 2: braid-masthead.png placeholder URL in CSS
      if (mastheadMeta?.mastheadPlaceholderUrl && nextHtml.includes(mastheadMeta.mastheadPlaceholderUrl)) {
        nextHtml = nextHtml.replaceAll(mastheadMeta.mastheadPlaceholderUrl, dataUri);
        return enforceSampleMastheadBackground(nextHtml, dataUri, mastheadMeta);
      }

      // Path 3: original sample raster URL survived into braid output
      if (mastheadMeta?.sampleRasterCssUrl && nextHtml.includes(mastheadMeta.sampleRasterCssUrl)) {
        nextHtml = nextHtml.replaceAll(mastheadMeta.sampleRasterCssUrl, dataUri);
        return enforceSampleMastheadBackground(nextHtml, dataUri, mastheadMeta);
      }

      // Path 4: --hero-bg-image CSS variable slot (LLM compliance)
      nextHtml = nextHtml.replace(
        /--hero-bg-image\s*:\s*[^;]+;/i,
        `--hero-bg-image: url("${dataUri}");`
      );
      // Also inject a :root override style block so it wins even if the variable
      // was declared with a different value or the in-place replace missed it.
      const heroVarOverride = `<style id="braid-masthead-image">:root { --hero-bg-image: url("${dataUri}"); }</style>`;
      if (!/id="braid-masthead-image"/i.test(nextHtml)) {
        nextHtml = nextHtml.replace(/<\/head>/i, `${heroVarOverride}\n</head>`);
      }

      // Final fallback: if the sample had a known CSS selector and background declaration,
      // force-inject it regardless of what the LLM put in the braid output.
      // This fires even when the LLM deviated from the placeholder instructions.
      nextHtml = injectForcedMastheadSelectorCss(nextHtml, dataUri, mastheadMeta);

      return nextHtml;
    }

    function applyBraidColorOverridesToHtml(html) {
      const theme = themeWithAliases(getPage3Colors().theme);
      if (!html || !theme) return html || "";
      const overridePairs = [
        // Canonical semantic names
        ["--background", theme.background],
        ["--foreground", theme.foreground],
        ["--primary", theme.primary],
        ["--secondary", theme.secondary],
        ["--accent", theme.accent],
        // Backward-compatible aliases for older generated HTML
        ["--dominant", theme.primary],
        ["--tertiary", theme.accent],
        ["--quaternary", theme.foreground],
        ["--quinary", theme.background],
        ["--bp-slot1", theme.primary],
        ["--bp-slot2", theme.secondary],
        ["--bp-slot3", theme.accent],
        ["--bp-slot4", theme.foreground],
        ["--bp-slot5", theme.background],
        ["--bp-slot-1", theme.primary],
        ["--bp-slot-2", theme.secondary],
        ["--bp-slot-3", theme.accent],
        ["--bp-slot-4", theme.foreground],
        ["--bp-slot-5", theme.background],
        ["--slot1", theme.primary],
        ["--slot2", theme.secondary],
        ["--slot3", theme.accent],
        ["--slot4", theme.foreground],
        ["--slot5", theme.background],
        ["--slot-1", theme.primary],
        ["--slot-2", theme.secondary],
        ["--slot-3", theme.accent],
        ["--slot-4", theme.foreground],
        ["--slot-5", theme.background],
        ["--bp-primary", theme.primary],
        ["--bp-secondary", theme.secondary],
        ["--bp-tertiary", theme.accent],
        ["--bp-accent2", theme.foreground],
        ["--bp-accent1", theme.background]
      ];
      const overrides = overridePairs
        .filter(([, v]) => !!v)
        .map(([k, v]) => `${k}: ${v};`)
        .join(" ");
      if (!overrides) return html;
      const overrideBlock = `<style id="braid-user-colors">:root { ${overrides} }</style>`;
      if (/id="braid-user-colors"/i.test(html)) {
        return html.replace(/<style id="braid-user-colors">[\s\S]*?<\/style>/i, overrideBlock);
      }
      return html.replace("</head>", `${overrideBlock}\n</head>`);
    }

    function composeBraidPreviewHtml(result = generationResult) {
      if (!result) return "";
      let html = String(result.base_site_html || result.site_html || "");
      if (mastheadImageResult?.image_data_uri) {
        html = applyGeneratedMastheadImageToHtml(
          html,
          mastheadImageResult.image_data_uri,
          result.masthead_meta || mastheadImageResult.masthead_meta || null
        );
      }
      html = applyBraidColorOverridesToHtml(html);
      return html;
    }

    function pushPreviewHtmlUpdate(html) {
      cachePreviewHtml(html || "");
      const editorWin = window.__portfolioEditorWindow;
      if (editorWin && !editorWin.closed) {
        try { editorWin.postMessage({ type: "portfolio_html", html }, location.origin); } catch {}
      }
    }

    function editorLoadingHtml() {
      return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Preparing Editor…</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #0f172a;
      color: #eaf0ff;
      font: 600 18px/1.4 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
    }
    .card {
      padding: 18px 22px;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.05);
      box-shadow: 0 20px 60px rgba(0,0,0,.35);
    }
  </style>
</head>
<body>
  <div class="card">Preparing editor…</div>
</body>
</html>`;
    }

    function ensureEditorWindow() {
      const existing = window.__portfolioEditorWindow;
      if (existing && !existing.closed) return existing;
      cachePreviewHtml(editorLoadingHtml());
      const win = window.open("editor.html", "_blank");
      window.__portfolioEditorWindow = win;
      return win;
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

    function getCompatibleColorSchemes(data) {
      const text = [
        data?.resume_facts?.identity?.major,
        data?.resume_facts?.identity?.specialization,
        data?.resume_resolved?.target_role?.industry,
        data?.resume_resolved?.target_role?.role_title,
        data?.resume_strategy?.motifs?.broad_primary_domain,
        data?.resume_strategy?.editorial_direction?.color_strategy
      ].filter(Boolean).join(" ").toLowerCase();

      const fallbackPalettes = (() => {
        if (!text) return [
          {
            how_used: "Fallback professional palette with navy structure and bright accent.",
            base_colors: {
              background: "#0f172a",
              foreground: "#f8fafc",
              primary: "#2563eb",
              secondary: "#94a3b8",
              accent: "#22c55e"
            }
          },
          {
            how_used: "Fallback editorial palette with charcoal foundation and warm coral emphasis.",
            base_colors: {
              background: "#1f2937",
              foreground: "#fff7ed",
              primary: "#ea580c",
              secondary: "#cbd5e1",
              accent: "#f59e0b"
            }
          }
        ];
        if (/bio|chem|health|medical|nurs|clinic|pharma|environment|ecolog|lab|science/.test(text)) return [
          {
            how_used: "Science-forward palette with deep slate, clinical blue, and laboratory green.",
            base_colors: {
              background: "#102a43",
              foreground: "#f8fbff",
              primary: "#2c7be5",
              secondary: "#9fb3c8",
              accent: "#2bb673"
            }
          },
          {
            how_used: "Natural research palette with evergreen depth and mineral teal accents.",
            base_colors: {
              background: "#163a34",
              foreground: "#f6fff8",
              primary: "#1f8a70",
              secondary: "#a7b8a5",
              accent: "#8fd694"
            }
          }
        ];
        if (/engineer|electrical|mechanical|computer|software|data|ai|robot|technical|hardware|systems|cyber/.test(text)) return [
          {
            how_used: "Technical palette with navy canvas, electric blue interaction, and mint accent.",
            base_colors: {
              background: "#0b132b",
              foreground: "#f5faff",
              primary: "#3a86ff",
              secondary: "#98a7c1",
              accent: "#2ec4b6"
            }
          },
          {
            how_used: "Hardware-inspired palette with graphite structure and signal-amber highlights.",
            base_colors: {
              background: "#1f2937",
              foreground: "#f9fafb",
              primary: "#2563eb",
              secondary: "#94a3b8",
              accent: "#f59e0b"
            }
          },
          {
            how_used: "Data-tech palette with deep indigo base and vivid cyan emphasis.",
            base_colors: {
              background: "#111827",
              foreground: "#eef2ff",
              primary: "#4f46e5",
              secondary: "#9ca3af",
              accent: "#06b6d4"
            }
          }
        ];
        if (/business|finance|account|econom|market|consult|admin|operations|sales/.test(text)) return [
          {
            how_used: "Corporate palette with navy credibility and gold confidence cues.",
            base_colors: {
              background: "#14213d",
              foreground: "#fffdf7",
              primary: "#1d4ed8",
              secondary: "#9ca3af",
              accent: "#d4a017"
            }
          },
          {
            how_used: "Finance palette with charcoal structure and emerald growth accents.",
            base_colors: {
              background: "#1f2933",
              foreground: "#f8fafc",
              primary: "#0f766e",
              secondary: "#a7b0bb",
              accent: "#22c55e"
            }
          }
        ];
        if (/design|art|media|film|architecture|creative|illustration|fashion/.test(text)) return [
          {
            how_used: "Creative palette with rich plum foundation and vivid coral energy.",
            base_colors: {
              background: "#2d1e2f",
              foreground: "#fff7fb",
              primary: "#c026d3",
              secondary: "#b8a3b9",
              accent: "#fb7185"
            }
          },
          {
            how_used: "Editorial palette with warm charcoal, sand neutrals, and citrus pop.",
            base_colors: {
              background: "#2f2a24",
              foreground: "#fffbeb",
              primary: "#d97706",
              secondary: "#b9afa1",
              accent: "#facc15"
            }
          }
        ];
        if (/education|teaching|psych|social|history|english|policy|community|public/.test(text)) return [
          {
            how_used: "Warm professional palette with indigo structure and approachable amber accents.",
            base_colors: {
              background: "#243b53",
              foreground: "#fffdf7",
              primary: "#4f46e5",
              secondary: "#a8b2c1",
              accent: "#f59e0b"
            }
          },
          {
            how_used: "Human-centered palette with deep teal grounding and soft coral highlights.",
            base_colors: {
              background: "#164e63",
              foreground: "#fffaf7",
              primary: "#0ea5e9",
              secondary: "#b6c2c9",
              accent: "#fb7185"
            }
          }
        ];
        return [
          {
            how_used: "Fallback professional palette with navy structure and bright accent.",
            base_colors: {
              background: "#0f172a",
              foreground: "#f8fafc",
              primary: "#2563eb",
              secondary: "#94a3b8",
              accent: "#22c55e"
            }
          },
          {
            how_used: "Fallback editorial palette with charcoal foundation and warm coral emphasis.",
            base_colors: {
              background: "#1f2937",
              foreground: "#fff7ed",
              primary: "#ea580c",
              secondary: "#cbd5e1",
              accent: "#f59e0b"
            }
          }
        ];
      })();

      const candidates = [
        data?.resume_strategy?.compatible_color_schemes,
        data?.compatible_color_schemes,
        data?.resume_resolved?.compatible_color_schemes,
        data?.resume_strategy?.website_copy_seed?.compatible_color_schemes,
        data?.color_strategy?.compatible_color_schemes
      ];
      const found = candidates.find(arr => Array.isArray(arr) && arr.length);
      return found || fallbackPalettes;
    }

    function hasUsablePaletteData(data) {
      return getCompatibleColorSchemes(data).some(scheme => {
        if (Array.isArray(scheme?.colors)) {
          return scheme.colors.some(color => !!normalizeToHex(color));
        }
        if (scheme?.base_colors) {
          return THEME_ROLE_KEYS.some(role => !!normalizeToHex(scheme.base_colors?.[role]));
        }
        return THEME_ROLE_KEYS.some(role => !!normalizeToHex(scheme?.[role])) ||
          ["primary", "secondary", "tertiary", "accent2", "accent1"].some(slot => !!normalizeToHex(scheme?.[slot]));
      });
    }

    function resumeCacheKey(file) {
      return `resumeAnalysis_v5:${file.name}:${file.size}:${file.lastModified}`;
    }

    function jobAdCacheKey(rawText) {
      // Include resume file identity so cache is invalidated when resume changes
      const file = resumeUpload?.files?.[0];
      const resumeId = file ? `${file.name}:${file.size}:${file.lastModified}` : "no-resume";
      // Include desired job position so different targets don't share a cache entry
      const desiredRole = document.getElementById("desiredRole")?.value?.trim() || "";
      // Use text length + first/last 40 chars as a lightweight fingerprint
      const snippet = rawText.slice(0, 40) + rawText.slice(-40);
      return `jobAdAnalysis_v1:${resumeId}:${desiredRole}:${rawText.length}:${snippet}`;
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
        if (cached) {
          const parsed = JSON.parse(cached);
          if (hasUsablePaletteData(parsed)) {
            cachedData = parsed;
          } else {
            localStorage.removeItem(resumeCacheKey(file));
          }
        }
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

      const countdownTimer = startAnalysisCountdown(180);

      // Submit to background function (returns 202 immediately)
      try {
        const submitRes = await fetch("/.netlify/functions/analyzeResume-background", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jobId, resumePdfBase64: base64, resumeMime: file.type || "application/pdf", major, specialization, provider, userId: currentUserId() })
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
          if (result.quota) {
            showUpgradePrompt(result);
            return;
          }
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
        if (!currentUserId()) incrementAnonCredits();

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
      { id: "page5b", pageId: "page4", label: "5 Edit" },
      { id: "page5c", pageId: "page4", label: "6 Publish" },
    ];
    let currentStep = 0;

    const stepPills = document.getElementById("stepPills");
    const stepLabel = document.getElementById("stepLabel");
    const progressBar = document.getElementById("progressBar");

    function getPageId(entry){ return entry.pageId ?? entry.id; }
    function activePageId(){ return getPageId(PAGES[currentStep]); }

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

    function moveSharedStatusPanel() {
      const panel = document.getElementById("headerStatusPanel");
      if (!panel) return;
      const slotIdByPage = {
        page1: "statusSlotPage1",
        page2: "statusSlotPage2",
        page3: "statusSlotPage3",
        page4: "statusSlotPage4",
      };
      const target = document.getElementById(slotIdByPage[activePageId()] || "");
      if (target && panel.parentElement !== target) target.appendChild(panel);
      panel.classList.toggle("hidden", !target);
    }

    function setStep(step){
      currentStep = Math.max(0, Math.min(PAGES.length - 1, step));
      if (currentStep >= 5) pillNavUnlocked = true;
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
      moveSharedStatusPanel();
      restorePersistentHeaderStatuses();
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (currentStep === 3) updateTemplateUI();
      if (currentStep === 4) renderSuggestedPalettes();
      if (currentStep === 4) setOpenEditorReady(true);
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
    templateScreenshotInput?.addEventListener("change", async () => {
      const file = templateScreenshotInput.files?.[0];
      if (file && file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = e => {
          templateScreenshotImg.src = e.target.result;
          templateScreenshotPreview.style.display = "block";
        };
        reader.readAsDataURL(file);
        uploadedImagePalette = await inferPaletteFromImageFile(file);
      } else {
        templateScreenshotPreview.style.display = "none";
        templateScreenshotImg.src = "";
        uploadedImagePalette = null;
      }
      renderSuggestedPalettes();
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
      sampleColors            = null;
      lastExtractedUrl        = "";
      extractedTemplateCache  = null;
      lastExtractedTemplate   = "";
      normalizedTemplateResult = null;
      normalizeTemplatePending = null;
      uploadedImagePalette = null;
      ++_normalizeRunId;
      templatePaletteRendered = false;
      userHasSelectedPalette  = false;
      paletteSuggestionsLocked = false;
      displayedSuggestedPalettes = [];
      selectedSuggestedPaletteKey = "";
      const sampleColorsBar = document.getElementById("sampleColorsBar");
      const sampleColorsStatus = document.getElementById("sampleColorsStatus");
      const useSampleColors = document.getElementById("useSampleColors");
      const sampleColorsOverlay = document.getElementById("sampleColorsOverlay");
      if (sampleColorsBar) sampleColorsBar.style.display = "none";
      if (sampleColorsStatus) sampleColorsStatus.textContent = "";
      if (useSampleColors) useSampleColors.checked = false;
      if (sampleColorsOverlay) sampleColorsOverlay.style.display = "none";
      updateTemplateCopyrightVisibility();
      updateTemplateUI();
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
    let extractedTemplateCache = null;   // { templateHtml, rawTemplateHtml, mastheadMeta, embeddedJson, templateMode, templateInputKind }
    let templatePaletteRendered = false; // true once template palette has been auto-applied; resets on template clear
    let userHasSelectedPalette  = false; // true once user actively picks any palette/theme; resets on template clear
    let paletteSuggestionsLocked = false; // true once visible suggestions should stop being replaced by later analysis
    let displayedSuggestedPalettes = []; // current visible palette rows, preserved when late arrivals appear
    let selectedSuggestedPaletteKey = ""; // selected suggested palette, preserved across rerenders
    let uploadedImagePalette = null;     // semantic palette inferred directly from an uploaded screenshot/template image
    let extractTemplatePending = null;   // holds the in-flight extraction promise
    let lastExtractedTemplate = "";      // URL or file name to avoid redundant calls
    let extractTicker = null;            // active countdown interval — cleared on each new extraction
    let normalizeTemplatePending = null; // in-flight color normalization promise (option 2 file upload)
    let normalizedTemplateResult = null; // { normalizedHtml, colorSlots, mastheadMeta } once normalization completes
    let _normalizeRunId = 0;             // epoch counter to abort stale normalization poll loops

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
      if (shouldUseInputPalette() && Array.isArray(colors) && colors.length >= 1) {
        const mapped = mapAiPaletteToUiSlots(colors);
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

    function templateExtractionRequired() {
      const source = document.querySelector('input[name="templateSource"]:checked')?.value;
      return !!source && source !== "none";
    }

    function hasUsableExtractedTemplate() {
      return !!extractedTemplateCache?.templateHtml;
    }

    // Converts parseColorRoles() output [{index, label, hex}] → semantic role object
    function colorRolesToSlots(colorRoles) {
      return themeWithAliases({
        background: (colorRoles || []).find(r => r.index === 1)?.hex || null,
        foreground: (colorRoles || []).find(r => r.index === 2)?.hex || null,
        primary: (colorRoles || []).find(r => r.index === 3)?.hex || null,
        secondary: (colorRoles || []).find(r => r.index === 4)?.hex || null,
        accent: (colorRoles || []).find(r => r.index === 5)?.hex || null
      });
    }

    // Submits the sample HTML to the backend for color normalization (option 2, file upload).
    // Polls until done, then stores result in normalizedTemplateResult.
    async function doNormalizeTemplate(sampleHtml) {
      const myRunId = ++_normalizeRunId;
      normalizedTemplateResult = null;
      const jobId = "normalize_" + crypto.randomUUID();
      try {
        const res = await fetch("/.netlify/functions/buildWebsite-background", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "normalizeTemplate",
            jobId,
            sampleHtml,
            provider: getAnalysisProvider(),
            userId: currentUserId()
          })
        });
        if (!res.ok && res.status !== 202) return null;
      } catch { return null; }

      const startTime = Date.now();
      while (Date.now() - startTime < 180000) {
        await new Promise(r => setTimeout(r, 3000));
        if (myRunId !== _normalizeRunId) return null; // superseded by newer call
        try {
          const pollRes = await fetch(`/.netlify/functions/getPreviewResult?jobId=${encodeURIComponent(jobId)}`);
          const data = pollRes.ok ? JSON.parse(await pollRes.text()) : null;
          if (data?.status === "done") {
            normalizedTemplateResult = { normalizedHtml: data.normalizedHtml, colorSlots: data.colorSlots || {}, mastheadMeta: data.mastheadMeta || null };
            return normalizedTemplateResult;
          }
          if (data?.status === "error") return null;
        } catch {}
      }
      return null;
    }

    async function waitForTemplateExtraction(statusId) {
      if (!extractTemplatePending || !templateExtractionRequired()) return;
      setHeaderStatus(statusId, "Website drafter waiting for design…", "rgba(141,224,255,.6)");
      try {
        await extractTemplatePending;
      } catch {
        // _doExtractTemplate already sets user-facing error state; downstream stages will proceed
        // with whatever template state is available.
      }
    }

    async function _doExtractTemplate() {
      const source = document.querySelector('input[name="templateSource"]:checked')?.value;
      if (!source) return;
      if (source === "none") {
        setTemplateExtractStatus("Design options selected", "rgba(234,240,255,.45)");
        return;
      }

      const extractMode = document.getElementById("extractTemplateMode")?.value || "analysis";

      let key = "";
      let templateInputKind = "template";
      let requestBody = { provider: getAnalysisProvider(), templateMode: extractMode };

      if (source === "keyword") {
        const val = document.getElementById("modelTemplate")?.value?.trim() || "";
        if (!val || looksLikeUrl(val)) return;

        // Keyword — try pre-compiled file first, fall back to API
        const srcPath = templateLabelToPath(val);

        // Each mode has its own pre-compiled path:
        //   analysis → *Grad_template.html
        //   mustache → *Grad_mustache.html
        const modeSuffix  = extractMode === "mustache" ? "_mustache" : "_template";
        const compiledKey = srcPath.replace(/\.html$/, `${modeSuffix}.html`);
        if (extractMode === "mustache") requestBody.targetOutputPath = compiledKey;

        // Braid mode: prefer _normalized.html (pre-processed offline) over raw HTML.
        // If normalized exists, color slots are already extracted — no in-flight AI call needed.
        if (isBraidMode()) {
          const normalizedKey = srcPath.replace(/\.html$/, "_normalized.html");
          const cacheKey = normalizedKey; // use normalized path as dedup key
          if (cacheKey === lastExtractedTemplate && hasUsableExtractedTemplate()) return;
          let html = null;
          let usedKey = srcPath;
          let rawTemplateHtml = "";
          let mastheadMeta = null;
          try {
            const normRes = await fetch(normalizedKey);
            if (normRes.ok) {
              html = await normRes.text();
              usedKey = normalizedKey;
              mastheadMeta = parseEmbeddedMastheadMeta(html);
              // Parse the pre-extracted color slots from the normalized HTML
              const colorRoles = parseColorRoles(html);
              normalizedTemplateResult = { normalizedHtml: html, colorSlots: colorRolesToSlots(colorRoles), mastheadMeta };
            }
          } catch {}
          if (!html) {
            try {
              const res = await fetch(srcPath);
              if (!res.ok) throw new Error(`"${srcPath}" not found (HTTP ${res.status})`);
              html = await res.text();
              rawTemplateHtml = html;
              mastheadMeta = analyzeSampleMastheadLocal(rawTemplateHtml);
            } catch (e) {
              setTemplateExtractStatus(`Could not load template: ${e.message}`, "rgba(251,171,156,.8)");
              return;
            }
          }
          lastExtractedTemplate = cacheKey;
          if (usedKey === normalizedKey && !mastheadMeta) {
            try {
              const rawRes = await fetch(srcPath);
              if (rawRes.ok) rawTemplateHtml = await rawRes.text();
            } catch {}
            mastheadMeta = analyzeSampleMastheadLocal(rawTemplateHtml);
            if (normalizedTemplateResult?.normalizedHtml === html) {
              normalizedTemplateResult = { ...normalizedTemplateResult, mastheadMeta };
            }
          }
          rawTemplateHtml = rawTemplateHtml || html;
          mastheadMeta = mastheadMeta || normalizedTemplateResult?.mastheadMeta || null;
          extractedTemplateCache = { templateHtml: html, rawTemplateHtml, mastheadMeta, embeddedJson: null, templateMode: "braid", templateInputKind: "template" };
          setTemplateExtractStatus(
            usedKey === normalizedKey ? "✓ Sample website loaded (pre-normalized)" : "✓ Sample website loaded",
            "rgba(118,176,34,.9)"
          );
          renderSuggestedPalettes();
          return;
        }

        if (compiledKey === lastExtractedTemplate && hasUsableExtractedTemplate()) return;

        // Try pre-compiled version (fast path, no API call).
        // If mustache file is missing, fall back to the _template.html variant.
        const candidateKeys = [compiledKey];
        if (extractMode === "mustache") {
          candidateKeys.push(srcPath.replace(/\.html$/, "_template.html"));
        }
        for (const candidateKey of candidateKeys) {
          try {
            const res = await fetch(candidateKey);
            if (!res.ok) continue;
            const templateHtml = await res.text();
            const commentMatch = templateHtml.match(/<!--\s*(\{[\s\S]*?\})\s*-->/);
            let embeddedJson = null;
            if (commentMatch) { try { embeddedJson = JSON.parse(commentMatch[1]); } catch {} }
            lastExtractedTemplate = candidateKey;
            extractedTemplateCache = { templateHtml, rawTemplateHtml: templateHtml, mastheadMeta: null, embeddedJson, colorRoles: parseColorRoles(templateHtml), templateMode: candidateKey === compiledKey ? extractMode : "analysis", templateInputKind: "template" };
            const label = candidateKey === compiledKey ? "✓ Template loaded (pre-compiled)" : "✓ Template loaded (analysis fallback — mustache not yet generated)";
            setTemplateExtractStatus(label, "rgba(118,176,34,.9)");
            populateTemplateExtractPanel(extractedTemplateCache);
            renderSuggestedPalettes();
            return;
          } catch {}
        }

        // No pre-compiled file — fetch source HTML and send to AI extraction
        const apiKey = srcPath + "#" + extractMode;
        if (apiKey === lastExtractedTemplate && hasUsableExtractedTemplate()) return;
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
        if (fileKey === lastExtractedTemplate && hasUsableExtractedTemplate()) return;
        key = fileKey;
        try {
          if (file.type.startsWith("image/")) {
            setTemplateExtractStatus("Optimizing screenshot…", "rgba(141,224,255,.75)");
            const optimized = await optimizeImageForAiUpload(file);
            templateInputKind = "image-upload";
            requestBody.templateImageBase64 = optimized.base64;
            requestBody.templateImageMime   = optimized.mime;
          } else {
            const b64 = await readFileAsBase64(file);
            templateInputKind = "html-upload";
            // HTML file — for braid mode, skip AI extraction and cache raw HTML directly,
            // then kick off color normalization in background.
            if (isBraidMode()) {
              const rawHtml = atob(b64);
              lastExtractedTemplate = fileKey;
              normalizedTemplateResult = null;
              extractedTemplateCache = {
                templateHtml: rawHtml,
                rawTemplateHtml: rawHtml,
                mastheadMeta: analyzeSampleMastheadLocal(rawHtml),
                embeddedJson: null,
                templateMode: "braid",
                templateInputKind
              };
              setTemplateExtractStatus("✓ Sample website loaded — normalizing colors…", "rgba(118,176,34,.9)");
              renderSuggestedPalettes();
              normalizeTemplatePending = doNormalizeTemplate(rawHtml).finally(() => {
                normalizeTemplatePending = null;
                if (normalizedTemplateResult) {
                  // Swap template cache to use normalized HTML
                  extractedTemplateCache = { ...extractedTemplateCache, templateHtml: normalizedTemplateResult.normalizedHtml, mastheadMeta: normalizedTemplateResult.mastheadMeta || extractedTemplateCache?.mastheadMeta || null };
                  setTemplateExtractStatus("✓ Sample website loaded (colors normalized)", "rgba(118,176,34,.9)");
                }
              });
              return;
            }
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
      setTemplateExtractStatus(`Drafting design… ${seconds}s`, "rgba(141,224,255,.75)");
      extractTicker = setInterval(() => {
        seconds = Math.max(1, seconds - 1);
        setTemplateExtractStatus(`Drafting design… ${seconds}s`, "rgba(141,224,255,.75)");
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

      // Poll for result. Keep this function pending until extraction actually
      // finishes so downstream bridge/render stages can await it correctly.
      const POLL_INTERVAL_MS = 2500;
      const POLL_TIMEOUT_MS  = 300000; // 5 minutes
      const pollStart = Date.now();

      while (true) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

        if (lastExtractedTemplate !== key) {
          clearInterval(extractTicker);
          return;
        }
        if (Date.now() - pollStart > POLL_TIMEOUT_MS) {
          clearInterval(extractTicker);
          if (lastExtractedTemplate === key && !hasUsableExtractedTemplate()) lastExtractedTemplate = "";
          setTemplateExtractStatus("Template extraction timed out — try a smaller page or upload the HTML file instead.", "rgba(251,171,156,.8)");
          return;
        }

        let result;
        try {
          const res = await fetch(`/.netlify/functions/getPreviewResult?jobId=${encodeURIComponent(jobId)}`);
          const text = await res.text();
          try { result = JSON.parse(text); } catch { result = null; }
        } catch {
          continue;
        }

        if (!result || result.status === "pending") {
          continue;
        }

        clearInterval(extractTicker);

        if (result.status === "error") {
          if (lastExtractedTemplate === key && !hasUsableExtractedTemplate()) lastExtractedTemplate = "";
          const isNetworkErr = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(result.error || "");
          const msg = isNetworkErr
            ? "Can't reach that URL from the server (DNS/network error). Save the page as HTML and use the \"Upload\" option instead."
            : "Template extraction failed: " + (result.error || "Unknown error");
          setTemplateExtractStatus(msg, "rgba(251,171,156,.8)");
          return;
        }

        const data = { templateHtml: result.templateHtml, rawTemplateHtml: result.templateHtml, mastheadMeta: null, embeddedJson: result.embeddedJson, colorRoles: parseColorRoles(result.templateHtml), templateMode: extractMode, templateInputKind };
        extractedTemplateCache = data;
        setTemplateExtractStatus("✓ Design ready", "rgba(118,176,34,.9)");
        populateTemplateExtractPanel(data);
        renderSuggestedPalettes();
        return;
      }
    }

    // ----------------------------
    // Page 2: sample color extraction
    // ----------------------------
    let sampleColors = null;
    let lastExtractedUrl = "";

    // Parse numbered --color-* role comments from a template's :root block.
    // Existing normalized templates may still annotate semantic roles with numbers 1–5.
    // Returns [{index, label, hex}] sorted by index.
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

    function parseRootHexVars(html) {
      if (!html) return [];
      const rootMatch = html.match(/:root\s*\{([\s\S]*?)\}/);
      if (!rootMatch) return [];
      const vars = [];
      const re = /--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g;
      let m;
      while ((m = re.exec(rootMatch[1])) !== null) {
        vars.push({ name: m[1], hex: m[2] });
      }
      return vars;
    }

    function normalizeHex(hex) {
      if (!hex) return null;
      const h = String(hex).trim().toLowerCase();
      if (!/^#[0-9a-f]{3,8}$/.test(h)) return h;
      if (h.length === 4) return "#" + h.slice(1).split("").map(ch => ch + ch).join("");
      return h.slice(0, 7);
    }

    function rgbToHex(r, g, b) {
      return "#" + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
    }

    function hexToRgb(hex) {
      const n = normalizeHex(hex);
      if (!n || n.length !== 7) return null;
      return {
        r: parseInt(n.slice(1, 3), 16),
        g: parseInt(n.slice(3, 5), 16),
        b: parseInt(n.slice(5, 7), 16)
      };
    }

    function colorDistance(a, b) {
      const ra = typeof a === "string" ? hexToRgb(a) : a;
      const rb = typeof b === "string" ? hexToRgb(b) : b;
      if (!ra || !rb) return 0;
      const dr = ra.r - rb.r;
      const dg = ra.g - rb.g;
      const db = ra.b - rb.b;
      return Math.sqrt(dr * dr + dg * dg + db * db);
    }

    function hexMetrics(hex) {
      const n = normalizeHex(hex);
      if (!n || n.length !== 7) return { chroma: 0, luminance: 0 };
      const r = parseInt(n.slice(1, 3), 16);
      const g = parseInt(n.slice(3, 5), 16);
      const b = parseInt(n.slice(5, 7), 16);
      return {
        chroma: Math.max(r, g, b) - Math.min(r, g, b),
        luminance: 0.2126 * r + 0.7152 * g + 0.0722 * b
      };
    }

    function isNeutralHex(hex) {
      return hexMetrics(hex).chroma < 22;
    }

    const THEME_ROLE_KEYS = ["background", "foreground", "primary", "secondary", "accent"];
    const THEME_INPUT_IDS = ["primary", "secondary", "tertiary", "accent2", "accent1"];
    const ROLE_TO_INPUT_ID = {
      background: "primary",
      foreground: "secondary",
      primary: "tertiary",
      secondary: "accent2",
      accent: "accent1"
    };
    const INPUT_ID_TO_ROLE = Object.fromEntries(Object.entries(ROLE_TO_INPUT_ID).map(([role, id]) => [id, role]));
    const THEME_ROLE_LABELS = {
      background: "Background",
      foreground: "Foreground",
      primary: "Primary",
      secondary: "Secondary",
      accent: "Accent"
    };

    function normalizeThemeColors(value = {}) {
      const theme = {
        background: normalizeHex(value.background || value.accent1 || value.slot5 || null),
        foreground: normalizeHex(value.foreground || value.accent2 || value.slot4 || null),
        primary: normalizeHex(value.primary || value.slot1 || null),
        secondary: normalizeHex(value.secondary || value.slot2 || null),
        accent: normalizeHex(value.accent || value.tertiary || value.slot3 || null)
      };
      return theme;
    }

    function themeWithAliases(value = {}) {
      const theme = normalizeThemeColors(value);
      return {
        ...theme,
        tertiary: theme.accent,
        accent1: theme.background,
        accent2: theme.foreground,
        slot1: theme.primary,
        slot2: theme.secondary,
        slot3: theme.accent,
        slot4: theme.foreground,
        slot5: theme.background
      };
    }

    function inferPaletteFromImageFile(file) {
      return new Promise(resolve => {
        if (!file || !file.type?.startsWith("image/")) return resolve(null);
        const reader = new FileReader();
        reader.onerror = () => resolve(null);
        reader.onload = () => {
          const img = new Image();
          img.onerror = () => resolve(null);
          img.onload = () => {
            try {
              const maxDim = 160;
              const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || img.width || 1, img.naturalHeight || img.height || 1));
              const width = Math.max(24, Math.round((img.naturalWidth || img.width) * scale));
              const height = Math.max(24, Math.round((img.naturalHeight || img.height) * scale));
              const canvas = document.createElement("canvas");
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext("2d", { willReadFrequently: true });
              if (!ctx) return resolve(null);
              ctx.drawImage(img, 0, 0, width, height);
              const { data } = ctx.getImageData(0, 0, width, height);
              const buckets = new Map();
              let totalLum = 0;
              let totalCount = 0;
              for (let i = 0; i < data.length; i += 16) {
                const a = data[i + 3];
                if (a < 180) continue;
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                const qr = Math.round(r / 24) * 24;
                const qg = Math.round(g / 24) * 24;
                const qb = Math.round(b / 24) * 24;
                const key = `${qr},${qg},${qb}`;
                const entry = buckets.get(key) || { r: 0, g: 0, b: 0, count: 0 };
                entry.r += r;
                entry.g += g;
                entry.b += b;
                entry.count += 1;
                buckets.set(key, entry);
                totalLum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
                totalCount += 1;
              }
              if (!buckets.size || !totalCount) return resolve(null);
              const avgLum = totalLum / totalCount;
              const candidates = Array.from(buckets.values()).map(entry => {
                const r = entry.r / entry.count;
                const g = entry.g / entry.count;
                const b = entry.b / entry.count;
                const hex = rgbToHex(r, g, b);
                const metrics = hexMetrics(hex);
                return { hex, count: entry.count, chroma: metrics.chroma, luminance: metrics.luminance, neutral: isNeutralHex(hex) };
              }).sort((a, b) => b.count - a.count);

              const background = candidates.slice().sort((a, b) => {
                const scoreA = a.count * (avgLum < 145 ? (a.luminance < 150 ? 1.25 : 0.55) : (a.luminance > 110 ? 1.25 : 0.65));
                const scoreB = b.count * (avgLum < 145 ? (b.luminance < 150 ? 1.25 : 0.55) : (b.luminance > 110 ? 1.25 : 0.65));
                return scoreB - scoreA;
              })[0];
              if (!background) return resolve(null);

              const foreground = candidates
                .filter(c => c.hex !== background.hex)
                .sort((a, b) => {
                  const scoreA = colorDistance(a.hex, background.hex) * (a.neutral ? 1.25 : 0.9) * (1 + a.count / 2500);
                  const scoreB = colorDistance(b.hex, background.hex) * (b.neutral ? 1.25 : 0.9) * (1 + b.count / 2500);
                  return scoreB - scoreA;
                })[0] || { hex: background.luminance < 140 ? "#f2f5fb" : "#111827" };

              const accents = candidates
                .filter(c => c.hex !== background.hex && c.hex !== foreground.hex && colorDistance(c.hex, background.hex) > 42 && colorDistance(c.hex, foreground.hex) > 36)
                .sort((a, b) => (b.count * (1 + b.chroma / 120)) - (a.count * (1 + a.chroma / 120)));

              const chosen = [];
              for (const candidate of accents) {
                if (chosen.every(existing => colorDistance(existing.hex, candidate.hex) > 38)) {
                  chosen.push(candidate);
                }
                if (chosen.length >= 3) break;
              }

              const primary = chosen[0]?.hex || candidates.find(c => ![background.hex, foreground.hex].includes(c.hex))?.hex || foreground.hex;
              const secondary = chosen[1]?.hex || candidates.find(c => ![background.hex, foreground.hex, primary].includes(c.hex))?.hex || background.hex;
              const accent = chosen[2]?.hex || candidates.find(c => ![background.hex, foreground.hex, primary, secondary].includes(c.hex))?.hex || primary;

              resolve(themeWithAliases({ background: background.hex, foreground: foreground.hex, primary, secondary, accent }));
            } catch {
              resolve(null);
            }
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
    }

    function updateColorRoleLabels() {
      Object.entries(THEME_ROLE_LABELS).forEach(([role, label]) => {
        const el = document.getElementById(`${ROLE_TO_INPUT_ID[role]}-label`);
        if (el) el.textContent = label;
      });
    }

    function mapRoleColorsToUiSlots(roleColors) {
      if (!Array.isArray(roleColors) || !roleColors.length) return null;
      const ordered = roleColors.map(item => normalizeHex(item?.hex) || null);
      return themeWithAliases({
        background: ordered[0],
        foreground: ordered[1],
        primary: ordered[2],
        secondary: ordered[3],
        accent: ordered[4]
      });
    }

    function mapAiPaletteToUiSlots(colorsArray) {
      if (!Array.isArray(colorsArray) || !colorsArray.length) return null;
      return themeWithAliases({
        background: normalizeToHex(colorsArray[0]) || null,
        foreground: normalizeToHex(colorsArray[1]) || null,
        primary: normalizeToHex(colorsArray[2]) || null,
        secondary: normalizeToHex(colorsArray[3]) || null,
        accent: normalizeToHex(colorsArray[4]) || null
      });
    }

    function getPaletteKey(palette) {
      if (!palette?.colors) return "";
      return THEME_ROLE_KEYS.map(slot => normalizeHex(themeWithAliases(palette.colors)[slot]) || "").join("|");
    }

    function hasNormalizedTemplatePalette(cache) {
      if (!cache) return false;
      if (cache.templateInputKind !== "html-upload") return false;
      if (normalizedTemplateResult?.colorSlots && Object.values(normalizedTemplateResult.colorSlots).some(Boolean)) return true;
      const roleColors = cache.colorRoles || parseColorRoles(cache.templateHtml);
      return Array.isArray(roleColors) && roleColors.length > 0;
    }

    function buildTemplatePalette(cache) {
      if (!cache) return null;
      const roleColors = cache.colorRoles || parseColorRoles(cache.templateHtml);
      const rootVars = parseRootHexVars(cache.templateHtml);
      const embedded = cache.embeddedJson?.default_color_scheme || {};

      // Numbered --color-* comments define slot order 1–5 directly.
      if (roleColors.length) {
        const colors = mapRoleColorsToUiSlots(roleColors);
        if (Object.values(colors).some(Boolean)) {
          return { label: "Template palette", colors };
        }
      }

      const palette = themeWithAliases({
        primary: embedded.primary || null,
        secondary: embedded.secondary || null,
        accent: embedded.accent || embedded.tertiary || null,
        foreground: embedded.foreground || embedded.accent2 || null,
        background: embedded.background || embedded.accent1 || null
      });

      const seen = new Set();
      const candidates = [];
      const pushCandidate = (hex, score = 0, tag = "") => {
        const norm = normalizeHex(hex);
        if (!norm || seen.has(norm)) return;
        seen.add(norm);
        candidates.push({ hex, norm, score, tag, neutral: isNeutralHex(norm), ...hexMetrics(norm) });
      };

      Object.entries(embedded).forEach(([slot, hex]) => {
        const bonus = ({ primary: 90, secondary: 80, accent: 85, tertiary: 85, foreground: 60, accent2: 60, background: 65, accent1: 65 })[slot] || 0;
        pushCandidate(hex, bonus, slot);
      });
      roleColors.forEach((r, i) => pushCandidate(r.hex, 70 - i * 3, r.label));
      rootVars.forEach(v => {
        const name = v.name.toLowerCase();
        let score = 20;
        if (/accent|brand|hero|signature|highlight|pop|vibrant/.test(name)) score += 40;
        if (/accent2|accent3|secondary|tertiary/.test(name)) score += 25;
        if (/bg|canvas|paper|surface|panel|ink|text|muted/.test(name)) score += 10;
        if (/white|black|success|warning|danger|error|info/.test(name)) score -= 25;
        pushCandidate(v.hex, score, name);
      });

      const pickUnused = list => list.find(c => !Object.values(palette).some(v => normalizeHex(v) === c.norm));
      const chromatic = candidates
        .filter(c => !c.neutral)
        .sort((a, b) => b.score - a.score || b.chroma - a.chroma);
      const neutrals = candidates
        .filter(c => c.neutral)
        .sort((a, b) => b.score - a.score || a.luminance - b.luminance);

      ["primary", "secondary", "accent"].forEach(slot => {
        const current = palette[slot];
        const currentNorm = normalizeHex(current);
        const duplicate = currentNorm && Object.entries(palette).some(([k, v]) => k !== slot && normalizeHex(v) === currentNorm);
        if (!current || isNeutralHex(current) || duplicate) {
          const next = pickUnused(chromatic);
          if (next) palette[slot] = next.hex;
        }
      });

      const darkCandidate = !palette.foreground || Object.entries(palette).some(([k, v]) => k !== "foreground" && normalizeHex(v) === normalizeHex(palette.foreground))
        ? neutrals.slice().sort((a, b) => a.luminance - b.luminance)[0] || pickUnused(candidates)
        : null;
      if (darkCandidate) palette.foreground = darkCandidate.hex;

      const lightCandidate = !palette.background || Object.entries(palette).some(([k, v]) => k !== "background" && normalizeHex(v) === normalizeHex(palette.background))
        ? neutrals.slice().sort((a, b) => b.luminance - a.luminance)[0] || pickUnused(candidates)
        : null;
      if (lightCandidate) palette.background = lightCandidate.hex;

      THEME_ROLE_KEYS.forEach(slot => {
        const current = palette[slot];
        const currentNorm = normalizeHex(current);
        const duplicate = currentNorm && THEME_ROLE_KEYS.some(other => other !== slot && normalizeHex(palette[other]) === currentNorm);
        if (!current || duplicate) {
          const next = pickUnused(slot === "foreground" || slot === "background" ? neutrals : chromatic) || pickUnused(candidates);
          if (next) palette[slot] = next.hex;
        }
      });

      if (!Object.values(palette).some(Boolean)) return null;
      return { label: "Template palette", colors: themeWithAliases(palette) };
    }

    function buildUploadedImagePalette(cache) {
      const source = document.querySelector('input[name="templateSource"]:checked')?.value;
      if (source !== "file") return null;
      const isImageUpload = uploadedImagePalette || cache?.templateInputKind === "image-upload";
      if (!isImageUpload) return null;
      const palette = themeWithAliases(uploadedImagePalette || cache?.embeddedJson?.default_color_scheme || {});
      if (!THEME_ROLE_KEYS.some(role => palette[role])) return null;
      return { label: "Uploaded image palette", colors: palette };
    }

    function getInputPaletteSuggestion() {
      const source = document.querySelector('input[name="templateSource"]:checked')?.value;
      if (source !== "keyword" && source !== "file") return null;

      if (source === "file") {
        const uploadedPalette = buildUploadedImagePalette(extractedTemplateCache);
        if (uploadedPalette) {
          return { ...uploadedPalette, label: "Input palette", sourceKind: "input" };
        }

        const htmlUploadPalette = buildTemplatePalette(extractedTemplateCache);
        if (htmlUploadPalette) {
          const label = extractedTemplateCache?.templateInputKind === "html-upload" && !hasNormalizedTemplatePalette(extractedTemplateCache)
            ? "Preliminary Input Palette"
            : "Input palette";
          return { ...htmlUploadPalette, label, sourceKind: "input" };
        }

        if (extractedTemplateCache?.templateInputKind === "html-upload" && !hasNormalizedTemplatePalette(extractedTemplateCache)) {
          return { label: "Input palette", colors: null, sourceKind: "input-pending", pending: true };
        }

        return null;
      }

      let tplPalette = buildTemplatePalette(extractedTemplateCache);
      if (!tplPalette && extractedTemplateCache?.templateHtml) {
        const rootMatch = extractedTemplateCache.templateHtml.match(/:root\s*\{([^}]+)\}/);
        if (rootMatch) {
          const css = rootMatch[1];
          const cssVar = name => css.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`))?.[1] || null;
          const primary = cssVar("accent");
          const secondary = cssVar("accent-2");
          const dark = cssVar("bg");
          const light = cssVar("light") || cssVar("panel");
          if (primary || secondary) {
            tplPalette = {
              label: "Template palette",
              colors: themeWithAliases({ background: light, foreground: dark, primary, secondary, accent: null })
            };
          }
        }
      }

      return tplPalette ? { ...tplPalette, label: "Template palette", sourceKind: "input" } : null;
    }

    function applyColors(colors) {
      if (!colors) return;
      const theme = themeWithAliases(colors);
      const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
      Object.entries(ROLE_TO_INPUT_ID).forEach(([role, id]) => set(id, theme[role]));
      updateColorRoleLabels();
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

    function shouldUseInputPalette() {
      const source = document.querySelector('input[name="templateSource"]:checked')?.value;
      if (!source || source === "none") return false;
      const inputPalette = getInputPaletteSuggestion();
      if (!inputPalette) return false;
      const inputKey = getPaletteKey(inputPalette);
      if (!inputKey) return false;
      if (selectedSuggestedPaletteKey) return selectedSuggestedPaletteKey === inputKey;
      return !userHasSelectedPalette;
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
      const firstScheme = getCompatibleColorSchemes(resumeJson)[0];
      let colors = null;
      if (Array.isArray(firstScheme?.colors) && firstScheme.colors.length) {
        // Legacy ordered slot schema: [slot1, slot2, slot3, slot4, slot5]
        colors = mapAiPaletteToUiSlots(firstScheme.colors);
      } else if (firstScheme?.base_colors) {
        colors = themeWithAliases(firstScheme.base_colors);
      } else if (firstScheme?.background || firstScheme?.foreground || firstScheme?.accent) {
        colors = themeWithAliases(firstScheme);
      } else if (firstScheme?.primary) {
        // Legacy named-slot schema
        colors = themeWithAliases(firstScheme);
      } else {
        // Oldest legacy: compatible_color_scheme.five_key_colors array
        const arr = resumeJson?.compatible_color_scheme?.five_key_colors;
        if (Array.isArray(arr) && arr.length)
          colors = mapAiPaletteToUiSlots(arr);
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
        use_input_palette: shouldUseInputPalette(),
        design_composition:  document.getElementById("designComposition")?.value  || "",
        design_style:        styleVal === "other" ? (document.getElementById("designStyleOther")?.value?.trim() || "other") : styleVal,
        design_render_mode:  document.getElementById("designRenderMode")?.value   || "",
        design_density:        document.getElementById("designDensity")?.value        || "medium",
        use_emoji_icons:       document.getElementById("useEmojiIcons")?.value       === "yes",
        alternate_sections:    document.getElementById("alternateSections")?.value   !== "no"
      };
    }

    function getPage3Colors(){
      const background = document.getElementById("primary").value.trim();
      const foreground = document.getElementById("secondary").value.trim();
      const primary = document.getElementById("tertiary").value.trim();
      const secondary = document.getElementById("accent2").value.trim();
      const accent = document.getElementById("accent1").value.trim();
      const theme = themeWithAliases({ background, foreground, primary, secondary, accent });
      return {
        themeNumber: document.getElementById("themeNumber")?.value?.trim() || "",
        use_sample_colors: document.getElementById("useSampleColors")?.checked || false,
        theme
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
    const MAX_AI_IMAGE_BYTES = 5 * 1024 * 1024;
    const TARGET_AI_IMAGE_BYTES = Math.floor(MAX_AI_IMAGE_BYTES * 0.92);

    function estimateBase64Bytes(base64) {
      return String(base64 || "").replace(/\s+/g, "").length;
    }

    async function readFileAsBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    async function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    async function optimizeImageForAiUpload(file, maxBytes = TARGET_AI_IMAGE_BYTES) {
      const originalBase64 = await readFileAsBase64(file);
      const originalBytes = estimateBase64Bytes(originalBase64);
      const originalMime = file.type || "image/png";
      if (originalBytes <= maxBytes) {
        return { base64: originalBase64, mime: originalMime, bytes: originalBytes, optimized: false };
      }

      const dataUrl = await readFileAsDataUrl(file);
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Could not decode uploaded image."));
        image.src = dataUrl;
      });

      const naturalWidth = img.naturalWidth || img.width || 1;
      const naturalHeight = img.naturalHeight || img.height || 1;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not optimize uploaded image.");

      const attempts = [
        { scale: 1.00, quality: 0.88 },
        { scale: 0.92, quality: 0.82 },
        { scale: 0.84, quality: 0.76 },
        { scale: 0.76, quality: 0.70 },
        { scale: 0.68, quality: 0.64 },
        { scale: 0.60, quality: 0.58 },
        { scale: 0.52, quality: 0.52 },
        { scale: 0.44, quality: 0.46 }
      ];

      let best = null;
      for (const attempt of attempts) {
        const width = Math.max(320, Math.round(naturalWidth * attempt.scale));
        const height = Math.max(180, Math.round(naturalHeight * attempt.scale));
        canvas.width = width;
        canvas.height = height;
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const attemptDataUrl = canvas.toDataURL("image/jpeg", attempt.quality);
        const attemptBase64 = attemptDataUrl.split(",")[1] || "";
        const attemptBytes = estimateBase64Bytes(attemptBase64);
        if (!best || attemptBytes < best.bytes) {
          best = { base64: attemptBase64, mime: "image/jpeg", bytes: attemptBytes, optimized: true };
        }
        if (attemptBytes <= maxBytes) return best;
      }

      if (best && best.bytes <= MAX_AI_IMAGE_BYTES) return best;
      throw new Error("Image is still too large after optimization. Please upload a smaller screenshot.");
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
      if (!currentUserId() && !hasCreditsRemaining()) {
        setHeaderStatus("jobAnalysisStatus", "Credit limit reached.", "rgba(251,171,156,.8)");
        showAnonCreditPrompt();
        return;
      }

      // Check localStorage cache before hitting the API
      try {
        const cached = localStorage.getItem(jobAdCacheKey(rawText));
        if (cached) {
          const cachedData = JSON.parse(cached);
          jobAdResult = cachedData;
          setHeaderStatus("jobAnalysisStatus", "✓ Job info extracted (cached)", "rgba(118,176,34,.9)");
          populateJobAdDebug(cachedData);
          if (isDebugMode()) wireStage2Debug();
          return;
        }
      } catch {}

      const myRunId = ++_jobAdRunId;
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
            provider: getAnalysisProvider(),
            userId: currentUserId()
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
          if (myRunId !== _jobAdRunId) { clearInterval(jobAdCountdown); jobAdInProgress = false; return; }
          const pollRes = await fetch(`/.netlify/functions/getPreviewResult?jobId=${encodeURIComponent(jobId)}`);
          const parsed = await readJsonResponseSafely(pollRes);
          lastPollData = parsed.data ?? {
            status: pollRes.ok ? "pending" : "error",
            poll_status: pollRes.status,
            raw_body: parsed.text
          };
          if (!pollRes.ok) {
            jobAdErrorDetail = lastPollData?.error
              ? lastPollData
              : { stage: "poll", status: pollRes.status, details: lastPollData };
            populateJobAdDebug({ error: jobAdErrorDetail, job_resolved: null });
            break;
          }
          if (lastPollData.status === "done") {
            jobAdResult = lastPollData;
            populateJobAdDebug(lastPollData);
            try { localStorage.setItem(jobAdCacheKey(rawText), JSON.stringify(lastPollData)); } catch {}
            if (!currentUserId()) incrementAnonCredits();
            break;
          }
          if (lastPollData.status === "error") {
            jobAdErrorDetail = lastPollData?.quota ? lastPollData : (lastPollData?.error ?? lastPollData);
            populateJobAdDebug(lastPollData);
            if (lastPollData?.quota) {
              setHeaderStatus("jobAnalysisStatus", "Credit limit reached.", "rgba(251,171,156,.8)");
              showUpgradePrompt(lastPollData);
            }
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
      if (jobAdErrorDetail?.quota) return;
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
      if (resumeAnalysisPending) {
        setHeaderStatus("jobAnalysisStatus", "Job analysis waiting for resume analysis…", "rgba(141,224,255,.75)");
      }
      while (resumeAnalysisPending) {
        await new Promise(r => setTimeout(r, 500));
      }

      await doExtractJobAd();
      if (jobAdResult) wireStage2Debug();
      // If the pipeline was already triggered and job just re-completed, restart it
      if (!braidInProgress && !bridgeInProgress && !generationInProgress) {
        if (page3Submitted && isBraidMode()) doBraidWebsite();
        else if (page4Submitted) page4OpenEditorAction();
      }
    }

    // ----------------------------
    // Bridge Content & Design — triggered on page 4 (Colors) Next
    // Waits for Stage 2 (content strategy) if still in flight, then runs bridgeContentAndDesign.md
    // ----------------------------
    // Braid — single-pass layout clone + content substitution
    // ----------------------------
    async function doBraidWebsite() {
      const myRunId = ++_braidRunId;
      braidInProgress  = true;
      autoMastheadImageTriggered = false;
      mastheadImageInProgress = false;
      mastheadImageResult = null;
      mastheadImageError = null;
      _mastheadImageRunId += 1;
      generationResult = null;
      generationError  = null;
      setOpenEditorReady(false);
      setApplyBtnState(false);
      setHeaderStatus("generatingWebsiteStatus", "");
      greyRendererButtons(true);

      await waitForTemplateExtraction("braidStatus");

      // Wait for resume analysis
      if (resumeAnalysisPending || !lastAnalysisData) {
        setHeaderStatus("braidStatus", "Waiting for resume analysis…", "rgba(141,224,255,.6)");
        const t0 = Date.now();
        while ((resumeAnalysisPending || !lastAnalysisData) && Date.now() - t0 < 300000) {
          await new Promise(r => setTimeout(r, 500));
        }
        if (!lastAnalysisData) {
          setHeaderStatus("braidStatus", "⚠ Resume analysis did not complete.", "rgba(251,171,156,.9)");
          braidInProgress = false;
          setApplyBtnState(true);
          return;
        }
      }

      // Wait for job ad if in flight
      if (jobAdInProgress) {
        setHeaderStatus("braidStatus", "Waiting for job analysis…", "rgba(141,224,255,.6)");
        while (jobAdInProgress) await new Promise(r => setTimeout(r, 500));
      }

      // Wait for template color normalization if in flight (option 2 — file upload)
      if (normalizeTemplatePending) {
        setHeaderStatus("braidStatus", "Analyzing template colors…", "rgba(141,224,255,.6)");
        await normalizeTemplatePending;
      }

      const sampleHtml = extractedTemplateCache?.templateHtml || null;
      const mastheadMeta = normalizedTemplateResult?.mastheadMeta || extractedTemplateCache?.mastheadMeta || null;
      if (!sampleHtml) {
        setHeaderStatus("braidStatus", "⚠ No sample website loaded — please select a template.", "rgba(251,171,156,.9)");
        braidInProgress = false;
        setApplyBtnState(true);
        return;
      }

      const braidCountdown = startCountdown("braidStatus", "Generating portfolio…", 420);
      const jobId = crypto.randomUUID();

      const resumeFacts      = lastAnalysisData?.resume_facts      ?? lastAnalysisData ?? null;
      const resolvedStrategy = jobAdResult?.job_resolved || lastAnalysisData?.resume_resolved || null;

      // Prefer the user's chosen semantic palette so the braid generates color-mix()
      // expressions calibrated to those colors. Fall back to the sample's own palette
      // only when the user hasn't picked anything yet.
      const samplePalette = shouldUseInputPalette() ? buildTemplatePalette(extractedTemplateCache) : null;
      const userColors    = getPage3Colors().theme;
      const colorSpec     = (userColors?.primary ? userColors : null) ?? samplePalette?.colors;

      try {
        const res = await fetch("/.netlify/functions/buildWebsite-background", {
          method: "POST",
          headers: { "content-type": "application/json" },
	          body: JSON.stringify({
	            mode: "braid",
	            jobId,
	            page1: getPage1(),
	            resumeFacts,
	            resolvedStrategy,
	            sampleHtml,
              mastheadMeta,
	            colorSpec,
            templateColorSlots: shouldUseInputPalette() ? (normalizedTemplateResult?.colorSlots || null) : null,
            headshotName: headshotInput?.files?.[0]?.name || "",
            provider:     getAnalysisProvider(),
            userId:       currentUserId()
          })
        });
        if (!res.ok && res.status !== 202) {
          const t = await res.text();
          throw new Error(JSON.parse(t)?.error || `Server error ${res.status}`);
        }

        const maxWaitMs = 420000;
        const startTime = Date.now();
        while (Date.now() - startTime < maxWaitMs) {
          await new Promise(r => setTimeout(r, 4000));
          if (myRunId !== _braidRunId) { clearInterval(braidCountdown); braidInProgress = false; return; }
          const pollRes = await fetch(`/.netlify/functions/getPreviewResult?jobId=${jobId}`);
          const parsed  = await readJsonResponseSafely(pollRes);
          const data    = parsed.data ?? { poll_status: pollRes.status, raw_body: parsed.text };
          if (data.status === "done") {
            clearInterval(braidCountdown);
            generationResult    = { ...data, base_site_html: data.site_html || "" };
            braidInProgress     = false;
            generationInProgress = false;
            if (!currentUserId()) incrementAnonCredits();
            generationResult.site_html = page4Submitted ? composeBraidPreviewHtml(generationResult) : generationResult.base_site_html;
            setHeaderStatus("braidStatus", "✓ Portfolio generated", "rgba(118,176,34,.9)");
            setApplyBtnState(true);
            if (isDebugMode()) mergeTokenReport(data?.token_report);
            pushPreviewHtmlUpdate(generationResult.site_html || "");
            setHeaderStatus("braidStatus", "✓ Alpha version ready", "rgba(118,176,34,.9)");
            setHeaderStatus("bridgeStatus", "");
            greyRendererButtons(false);
            return;
          }
          if (!pollRes.ok || data.status === "error") {
            clearInterval(braidCountdown);
            const errMsg = data.error || "Braid failed.";
            generationError  = errMsg;
            braidInProgress  = false;
            setHeaderStatus("braidStatus", "⚠ " + errMsg, "rgba(251,171,156,.9)");
            setApplyBtnState(true);
            return;
          }
        }
        clearInterval(braidCountdown);
        setHeaderStatus("braidStatus", "⚠ Braid timed out. Please try again.", "rgba(251,171,156,.9)");
      } catch (err) {
        clearInterval(braidCountdown);
        setHeaderStatus("braidStatus", "⚠ " + (err?.message || "Braid failed."), "rgba(251,171,156,.9)");
      } finally {
        braidInProgress = false;
        setApplyBtnState(true);
      }
    }

    async function startMastheadImageGeneration() {
      const sampleHtml = extractedTemplateCache?.templateHtml || "";
      const mastheadMeta = normalizedTemplateResult?.mastheadMeta || extractedTemplateCache?.mastheadMeta || null;
      if (!sampleHtml) return;
      if (!currentUserId() && !hasCreditsRemaining()) {
        showUpgradePrompt({ tier: "free", used: ANON_CREDIT_LIMIT, limit: ANON_CREDIT_LIMIT, anon: true });
        return;
      }

      const myRunId = ++_mastheadImageRunId;
      mastheadImageInProgress = true;
      mastheadImageResult = null;
      mastheadImageError = null;
      const jobId = crypto.randomUUID();
      const colors = getPage3Colors().theme;
      const page1 = getPage1();

      clearInterval(mastheadImageTicker);
      mastheadImageTicker = startCountdown("colorsChosenStatus", "Generating masthead image…", 90);

      try {
        const res = await fetch("/.netlify/functions/buildWebsite-background", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "generateImage",
            imageKind: "masthead",
            jobId,
            page1,
            sampleHtml,
            mastheadMeta,
            colorSpec: colors,
            provider: "openai",
            userId: currentUserId()
          })
        });
        if (!res.ok && res.status !== 202) {
          const t = await res.text();
          throw new Error(JSON.parse(t)?.error || `Server error ${res.status}`);
        }

        const maxWaitMs = 720000;
        const startTime = Date.now();
        while (Date.now() - startTime < maxWaitMs) {
          await new Promise(r => setTimeout(r, 2500));
          if (myRunId !== _mastheadImageRunId) {
            clearInterval(mastheadImageTicker);
            mastheadImageInProgress = false;
            return;
          }
          const pollRes = await fetch(`/.netlify/functions/getPreviewResult?jobId=${jobId}`);
          const parsed = await readJsonResponseSafely(pollRes);
          const data = parsed.data ?? { poll_status: pollRes.status, raw_body: parsed.text };
          if (data.status === "done") {
            clearInterval(mastheadImageTicker);
            mastheadImageInProgress = false;
            mastheadImageResult = data;
            if (!currentUserId() && !data.skipped) incrementAnonCredits();
            if (generationResult?.base_site_html && data.image_data_uri) {
              generationResult.site_html = composeBraidPreviewHtml(generationResult);
              pushPreviewHtmlUpdate(generationResult.site_html || "");
            }
            setHeaderStatus(
              "colorsChosenStatus",
              data.skipped ? "✓ Colors chosen" : "✓ Colors chosen • Masthead image ready",
              "rgba(118,176,34,.9)"
            );
            if (isDebugMode()) {
              mergeTokenReport(data?.token_report);
              wireMastheadImageDebug(data.image_data_uri || null);
            }
            return;
          }
          if (!pollRes.ok || data.status === "error") {
            if (data.quota) { showUpgradePrompt(data); return; }
            throw new Error(data.error || "Image generation failed.");
          }
        }
        throw new Error("Image generation timed out after 12 minutes.");
      } catch (err) {
        clearInterval(mastheadImageTicker);
        mastheadImageInProgress = false;
        mastheadImageError = err?.message || String(err);
        setHeaderStatus("colorsChosenStatus", `✓ Colors chosen • ${mastheadImageError}`, "rgba(251,171,156,.9)");
      }
    }

    // ----------------------------
    async function doBridgeContentAndDesign() {
      const myRunId = ++_bridgeRunId;
      bridgeResult     = null;
      bridgeInProgress = true;
      // Clear token report here — this is the start of a new render cycle
      Object.keys(_tokenReportRows).forEach(k => delete _tokenReportRows[k]);
      const reportEl = document.getElementById("tokenReport");
      if (reportEl) reportEl.style.display = "none";

      await waitForTemplateExtraction("bridgeStatus");

      // Block until resume analysis is finished (bridge needs resume_facts + resume_strategy)
      if (resumeAnalysisPending || !lastAnalysisData) {
        setHeaderStatus("bridgeStatus", "Waiting for resume analysis…", "rgba(141,224,255,.6)");
        const resumeWaitStart = Date.now();
        while ((resumeAnalysisPending || !lastAnalysisData) && Date.now() - resumeWaitStart < 300000) {
          await new Promise(r => setTimeout(r, 500));
        }
        if (!lastAnalysisData) {
          setHeaderStatus("bridgeStatus", "⚠ Resume analysis did not complete — cannot proceed.", "rgba(251,171,156,.9)");
          bridgeInProgress = false;
          return;
        }
      }

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
          if (myRunId !== _bridgeRunId) { clearInterval(bridgeCountdown); bridgeInProgress = false; return; }
          const pollRes = await fetch(`/.netlify/functions/getPreviewResult?jobId=${encodeURIComponent(jobId)}`);
          const parsed = await readJsonResponseSafely(pollRes);
          const data = parsed.data ?? { poll_status: pollRes.status, raw_body: parsed.text };
          if (data.status === "done") { bridgeResult = data; break; }
          if (!pollRes.ok || data.status === "error") { bridgeResult = data; break; }
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

    function wireMastheadImageDebug(dataUri) {
      const dl = document.getElementById("dlMastheadImage");
      const vw = document.getElementById("vwMastheadImage");
      const hasData = !!dataUri;
      [dl, vw].forEach(btn => {
        if (!btn) return;
        btn.disabled = !hasData;
        btn.style.opacity = hasData ? "" : "0.35";
        btn.style.cursor  = hasData ? "" : "not-allowed";
      });
      if (!hasData) {
        if (dl) dl.onclick = null;
        if (vw) vw.onclick = null;
        return;
      }
      if (dl) dl.onclick = () => {
        const a = document.createElement("a");
        a.href = dataUri;
        a.download = "masthead-image.png";
        a.click();
      };
      if (vw) vw.onclick = () => {
        const html = `<!doctype html><html><body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="${dataUri}" style="max-width:100%;max-height:100vh;display:block"></body></html>`;
        const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
        window.open(url, "_blank");
      };
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
      const myRunId = ++_generationRunId;
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

      await waitForTemplateExtraction("generatingWebsiteStatus");

      // Block until resume analysis is finished — resume_facts and resume_strategy are required
      if (resumeAnalysisPending || !lastAnalysisData) {
        setHeaderStatus("generatingWebsiteStatus", "Waiting for resume analysis…", "rgba(141,224,255,.6)");
        const resumeWaitStart = Date.now();
        while ((resumeAnalysisPending || !lastAnalysisData) && Date.now() - resumeWaitStart < 300000) {
          await new Promise(r => setTimeout(r, 500));
        }
        if (!lastAnalysisData) {
          generationError = "Resume analysis did not complete. Please try re-uploading your resume.";
          generationInProgress = false;
          setHeaderStatus("generatingWebsiteStatus", "⚠ " + generationError, "rgba(251,171,156,.9)");
          setApplyBtnState(true);
          return;
        }
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
            bridgeJson:           isDebugMode() ? (bridgeResult?.bridge_json || null) : null,
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
          if (myRunId !== _generationRunId) { generationInProgress = false; return; }
          const remaining = Math.max(0, Math.round((maxWaitMs - (Date.now() - startTime)) / 1000));
          const pollRes = await fetch(`/.netlify/functions/getPreviewResult?jobId=${jobId}`);
          const parsed = await readJsonResponseSafely(pollRes);
          const data = parsed.data ?? { poll_status: pollRes.status, raw_body: parsed.text };
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
          if (!pollRes.ok) {
            throw new Error(data.error || `Poll failed with HTTP ${pollRes.status}${parsed.text ? `: ${parsed.text.slice(0, 160)}` : ""}`);
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
      cachePreviewHtml(generationResult.site_html);
      // Pass page 4 colors so the editor can offer a "Reset to default" option
      const p4Colors = getPage3Colors().theme;
      cachePage4Colors(p4Colors);
      cacheImageGenerationContext({ page1: getPage1(), colorSpec: p4Colors });
      const existingEditorWin = window.__portfolioEditorWindow;
      const editorWin = existingEditorWin && !existingEditorWin.closed
        ? existingEditorWin
        : window.open("editor.html", "_blank");
      window.__portfolioEditorWindow = editorWin;

      // Collect visuals and inject them (client-side, may be instant or async).
      const { artifacts: dynamicVisuals } = await getPage5Artifacts();
      const structuredVisuals = await collectStructuredArtifacts();
      const allVisuals = [...structuredVisuals, ...dynamicVisuals];

      const data = generationResult;

      let finalHtml = data.site_html;
      if (allVisuals.length > 0) {
        finalHtml = injectArtifacts(finalHtml, allVisuals);
      }
      // Push the final HTML to the already-open editor window via postMessage
      // even when there were no artifact edits; otherwise the editor can stay
      // stuck on the pre-opened "Preparing editor…" placeholder.
      pushPreviewHtmlUpdate(finalHtml);

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

      setHeaderStatus("bridgeStatus", "");
      if (data.truncated) {
        setHeaderStatus("generatingWebsiteStatus", "✓ Portfolio ready — output cut short, try regenerating", "rgba(251,171,156,.8)");
      } else {
        setHeaderStatus("generatingWebsiteStatus", "✓ Portfolio ready", "rgba(118,176,34,.9)");
      }

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
      userHasSelectedPalette = false;
      paletteSuggestionsLocked = false;
      displayedSuggestedPalettes = [];
      selectedSuggestedPaletteKey = "";
      setResumeAnalysisStatus("");
    });

    // ── Downstream invalidation ───────────────────────────────────────────────
    // When the user goes back to a page and changes an input, invalidate everything
    // downstream that depended on that input. Attach listeners once at init time;
    // they only invalidate if the user is currently on that page (currentStep check).

    // Clear a status only if the corresponding background task is not currently running.
    // If it IS running, its own countdown/update messages are still accurate — leave them.
    function clearIfIdle(statusId, inProgressFlag) {
      if (!inProgressFlag) setHeaderStatus(statusId, "");
    }

    function invalidateFromPage1() {
      if (activePageId() !== "page1") return;
      // Resume/major/specialization changed — everything downstream is stale
      lastAnalysisData     = null;
      resumeAnalysisCache  = null;
      userHasSelectedPalette = false;
      paletteSuggestionsLocked = false;
      displayedSuggestedPalettes = [];
      selectedSuggestedPaletteKey = "";
      jobAdResult          = null;
      page2Submitted       = false;
      page3Submitted       = false;
      page4Submitted       = false;
      extractedTemplateCache = null;
      bridgeResult         = null;
      generationResult     = null;
      autoMastheadImageTriggered = false;
      // Abort any in-flight downstream tasks
      ++_jobAdRunId; ++_braidRunId; ++_bridgeRunId; ++_generationRunId;
      // Resume analysis may have already auto-started on file change — don't stomp it
      if (!resumeAnalysisPending) setResumeAnalysisStatus("");
      setHeaderStatus("jobAnalysisStatus", "");
      setHeaderStatus("templateExtractStatus", "");
      setHeaderStatus("braidStatus", "");
      setHeaderStatus("bridgeStatus", "");
      setHeaderStatus("editorAutoOpenStatus", "");
      setHeaderStatus("generatingWebsiteStatus", "");
      setApplyBtnState(false);
      setOpenEditorReady(false);
    }

    function invalidateFromPage2() {
      if (activePageId() !== "page2") return;
      // Job ad changed — job result and everything downstream is stale
      jobAdResult      = null;
      page2Submitted   = false;
      bridgeResult     = null;
      generationResult = null;
      autoMastheadImageTriggered = false;
      // Abort any in-flight downstream tasks
      ++_jobAdRunId; ++_braidRunId; ++_bridgeRunId; ++_generationRunId;
      setHeaderStatus("jobAnalysisStatus", "");
      setHeaderStatus("braidStatus", "");
      setHeaderStatus("bridgeStatus", "");
      setHeaderStatus("editorAutoOpenStatus", "");
      setHeaderStatus("generatingWebsiteStatus", "");
      setApplyBtnState(false);
      setOpenEditorReady(false);
      // Auto-restart job analysis (page2Submitted was just cleared, re-trigger via flag check below)
      if (page4Submitted) doAnalyzeAndExtractJobAd();
    }

    function invalidateFromPage3() {
      if (activePageId() !== "page3") return;
      // Design/template changed — template cache and everything downstream is stale
      extractedTemplateCache = null;
      lastExtractedTemplate  = "";   // force re-extraction even if same file/keyword
      normalizedTemplateResult = null;
      normalizeTemplatePending = null;
      ++_normalizeRunId;
      templatePaletteRendered = false;
      userHasSelectedPalette = false;
      paletteSuggestionsLocked = false;
      displayedSuggestedPalettes = [];
      selectedSuggestedPaletteKey = "";
      bridgeResult           = null;
      generationResult       = null;
      autoMastheadImageTriggered = false;
      // Abort any in-flight downstream tasks
      ++_braidRunId; ++_bridgeRunId; ++_generationRunId;
      page3Submitted = false;
      setHeaderStatus("templateExtractStatus", "");
      setHeaderStatus("braidStatus", "");
      setHeaderStatus("bridgeStatus", "");
      setHeaderStatus("editorAutoOpenStatus", "");
      setHeaderStatus("generatingWebsiteStatus", "");
      setApplyBtnState(false);
      setOpenEditorReady(false);
      // Re-run extraction if a template source is already selected (restores the status message)
      extractTemplateInBackground();
      // Auto-restart: braid triggers from page 3, mustache/design-options from page 4
      if (page4Submitted) page4OpenEditorAction();
    }

    function invalidateFromPage4() {
      if (activePageId() !== "page4") return;

      if (isBraidMode()) {
        // Live-apply new colors to already-generated result without re-triggering generation
        if (generationResult?.base_site_html) {
          generationResult.site_html = composeBraidPreviewHtml(generationResult);
          pushPreviewHtmlUpdate(generationResult.site_html);
        }
        return;
      }

      // Mustache / design-options: colors changed — generation is stale
      page4Submitted = false;
      clearColorRelatedStatusMessages();
      setApplyBtnState(false);
      setOpenEditorReady(false);
      bridgeResult     = null;
      generationResult = null;
      ++_bridgeRunId; ++_generationRunId;
    }

    function clearColorRelatedStatusMessages() {
      setHeaderStatus("colorsChosenStatus", "");
      setHeaderStatus("braidStatus", "");
      setHeaderStatus("bridgeStatus", "");
      setHeaderStatus("editorAutoOpenStatus", "");
      setHeaderStatus("generatingWebsiteStatus", "");
    }

    // Page 1 inputs
    ["major", "specialization"].forEach(id => {
      document.getElementById(id)?.addEventListener("input", invalidateFromPage1);
    });
    resumeUpload?.addEventListener("change", invalidateFromPage1);

    // Page 2 inputs
    ["desiredRole", "jobAd"].forEach(id => {
      document.getElementById(id)?.addEventListener("input", invalidateFromPage2);
    });

    // Page 3 inputs — template source radios, design selects, template keyword/file
    ["designStyle", "designComposition", "designRenderMode", "designDensity",
     "useEmojiIcons", "alternateSections", "modelTemplate"].forEach(id => {
      const el = document.getElementById(id);
      el?.addEventListener("change", invalidateFromPage3);
      el?.addEventListener("input",  invalidateFromPage3);
    });
    document.querySelectorAll('input[name="templateSource"], input[name="templateCopyrightMode"]')
      .forEach(el => el.addEventListener("change", invalidateFromPage3));
    document.getElementById("templateScreenshotInput")
      ?.addEventListener("change", invalidateFromPage3);

    // Page 4 inputs — color pickers
    THEME_INPUT_IDS.forEach(id => {
      const el = document.getElementById(id);
      el?.addEventListener("input", invalidateFromPage4);
      el?.addEventListener("change", invalidateFromPage4);
    });
    document.getElementById("useSampleColors")?.addEventListener("change", invalidateFromPage4);

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
      } else if (source && source !== "none") {
        extractTemplateInBackground();
      } else if (source === "none") {
        setTemplateExtractStatus("Design options selected", "rgba(234,240,255,.45)");
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

      if (source !== "none") {
        extractTemplateInBackground().then(() => {
          if (isDebugMode() && extractedTemplateCache) {
            populateTemplateExtractPanel(extractedTemplateCache);
            document.getElementById("templateExtractPanel")?.classList.remove("hidden");
            document.getElementById("templateExtractPanel")?.querySelector("details")?.setAttribute("open", "");
          }
        });
      } else {
        setTemplateExtractStatus("Design options selected", "rgba(234,240,255,.45)");
      }
      return true;
    }

    document.getElementById("dbgSubmit3")?.addEventListener("click", () => { page3Action(); });

    // back3 on Color scheme returns to Website spec (step 3), re-populating its panels
    document.getElementById("back3")?.addEventListener("click", () => { onEnterPage2(); setStep(3); });

    // Page 3 (Colors)
    const PALETTE_SLOTS = THEME_ROLE_KEYS;

    function renderSuggestedPalettes(analysisData) {
      const msg = document.getElementById("suggestedPalettesMsg");
      const container = document.getElementById("suggestedPalettes");
      const rows      = document.getElementById("suggestedPalettesRows");
      if (!container || !rows) return;
      const inputPalette = getInputPaletteSuggestion();

      // Following slots: up to 3 AI palettes from resume analysis
      const resolvedData = analysisData ?? lastAnalysisData;
      const aiPalettes = getCompatibleColorSchemes(resolvedData);
      const aiRows = aiPalettes
        .filter(p => (Array.isArray(p.colors) && p.colors.length) || p.base_colors || p.background || p.foreground || p.primary || p.secondary || p.accent || p.tertiary)
        .slice(0, 3)
        .map((p, i) => {
          // New format: semantic base colors
          // Legacy format: ordered slot array or named slot aliases
          const colors = Array.isArray(p.colors)
            ? mapAiPaletteToUiSlots(p.colors)
            : themeWithAliases(p.base_colors || p);
          return { label: p.how_used || `AI palette ${i + 1}`, colors };
        });

      const dedupePalettes = list => {
        const seen = new Set();
        return list.filter(palette => {
          if (palette?.pending) return true;
          const key = getPaletteKey(palette);
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      };

      const MAX = inputPalette ? 5 : 4;
      const incoming = dedupePalettes([...(inputPalette ? [inputPalette] : []), ...aiRows]);
      let visible;
      if (paletteSuggestionsLocked && displayedSuggestedPalettes.length) {
        const merged = [...displayedSuggestedPalettes];
        const seen = new Set(merged.map(getPaletteKey).filter(Boolean));
        incoming.forEach(palette => {
          const key = getPaletteKey(palette);
          if (!key || seen.has(key) || merged.length >= MAX) return;
          seen.add(key);
          merged.push(palette);
        });
        displayedSuggestedPalettes = merged.slice(0, MAX);
        visible = displayedSuggestedPalettes;
      } else {
        visible = incoming.slice(0, MAX);
        displayedSuggestedPalettes = visible.slice();
      }

      const populated = visible.filter(Boolean).length;
      const totalAvailable = Math.max(populated, Math.min(MAX, incoming.length));
      const dataLoaded = !!(resolvedData);
      if (msg) {
        if (populated >= MAX) {
          msg.style.display = "none";
        } else if (dataLoaded) {
          msg.textContent = populated === 0
            ? "(No palettes found in analysis)"
            : paletteSuggestionsLocked
              ? `(${populated} visible; late arrivals append only)`
              : `(${populated} of ${totalAvailable} loaded)`;
          msg.style.display = "block";
        } else {
          msg.textContent = "(Thinking\u2026)";
          msg.style.display = "block";
        }
      }

      rows.innerHTML = "";
      visible.slice(0, MAX).forEach(palette => {
        const empty = !palette;
        const pending = !!palette?.pending;
        const row = document.createElement("label");
        row.style.cssText = `display:flex; flex-direction:column; gap:5px; padding:7px 10px; border-radius:8px; border:1px solid rgba(255,255,255,.1); background:rgba(0,0,0,.15); cursor:${empty ? "default" : "pointer"};`;

        const cb = document.createElement("input");
        cb.type = "radio";
        cb.name = "suggestedPalette";
        cb.disabled = empty;
        cb.style.cssText = "width:14px; height:14px; accent-color:var(--primary); flex-shrink:0; margin-top:1px;";
        if (!empty) cb.style.cursor = "pointer";
        if (!empty && !pending && selectedSuggestedPaletteKey && getPaletteKey(palette) === selectedSuggestedPaletteKey) cb.checked = true;
        cb.addEventListener("change", () => {
          if (cb.checked) {
            if (pending) return;
            userHasSelectedPalette = true;
            paletteSuggestionsLocked = true;
            selectedSuggestedPaletteKey = getPaletteKey(palette);
            applyColors(palette.colors);
          }
        });

        const swatches = document.createElement("div");
        swatches.style.cssText = "display:flex; gap:3px; flex-shrink:0; margin-left:10px;";
        if (!pending) {
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
        }

        const topRow = document.createElement("div");
        topRow.style.cssText = "display:flex; align-items:center; gap:10px;";
        topRow.append(cb);
        if (!pending) topRow.append(swatches);

        const lbl = document.createElement("span");
        lbl.style.cssText = "font-size:12px; font-weight:400; line-height:1.4; white-space:normal; width:100%;";
        lbl.style.color = empty ? "rgba(255,255,255,.18)" : "rgba(234,240,255,.7)";
        lbl.textContent = empty ? "" : palette.label;

        row.append(topRow, lbl);
        rows.appendChild(row);
      });

      const selectedVisiblePalette = selectedSuggestedPaletteKey
        ? visible.find(palette => palette && getPaletteKey(palette) === selectedSuggestedPaletteKey)
        : null;

      // If a palette is already selected and the list rerendered (for example when an
      // uploaded-image palette arrives late), re-apply that palette to the actual
      // picker inputs so the radio state and left-side swatches stay in sync.
      if (selectedVisiblePalette) {
        applyColors(selectedVisiblePalette.colors);
        return;
      }

      // Auto-select the first available suggested palette the first time it arrives,
      // but only if the user hasn't already made an active palette or theme choice.
      if (!userHasSelectedPalette && visible.length > 0) {
        const firstRadio = rows.querySelector('input[name="suggestedPalette"]');
        if (firstRadio) {
          firstRadio.checked = true;
          applyColors(visible[0].colors);
          selectedSuggestedPaletteKey = getPaletteKey(visible[0]);
          if (inputPalette && getPaletteKey(visible[0]) === getPaletteKey(inputPalette)) templatePaletteRendered = true;
        }
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
      if (isBraidMode()) {
        page3Submitted = true;
        doBraidWebsite();
      }
      setStep(4);
    });

    // Page 4 (Colors)
    function isMustacheMode() { return extractedTemplateCache?.templateMode === "mustache"; }
    function isDirectDesignMode() {
      return document.querySelector('input[name="templateSource"]:checked')?.value === "none";
    }
    function isBraidMode() {
      const source = document.querySelector('input[name="templateSource"]:checked')?.value;
      return (source === "keyword" || source === "file") && !isMustacheMode() && !isDirectDesignMode();
    }
    function applyBraidColorOverrides(result) {
      if (!result?.site_html) return;
      result.site_html = composeBraidPreviewHtml(result);
    }

    async function page4OpenEditorAction() {
      // Grey the button immediately — re-enabled when the editor opens.
      const openBtn = document.getElementById("next2_bottom");
      if (openBtn) { openBtn.disabled = true; openBtn.style.opacity = ".4"; openBtn.style.cursor = "not-allowed"; }

      // Resubmit colors every time.
      cachePage4Colors(getPage3Colors().theme);
      cacheImageGenerationContext({ page1: getPage1(), colorSpec: getPage3Colors().theme });
      ensureEditorWindow();
      if (isDirectDesignMode() || isMustacheMode()) {
        page4Submitted = true;
        setHeaderStatus("braidStatus", "Generating portfolio…", "rgba(141,224,255,.75)");
        if (!autoMastheadImageTriggered) {
          autoMastheadImageTriggered = true;
          startMastheadImageGeneration();
        }
        await doGenerateWebsite();
        while (mastheadImageInProgress) { await new Promise(r => setTimeout(r, 500)); }
        doPreview();
        setOpenEditorReady(true);
        return;
      }

      // Braid mode.
      page4Submitted = true;
      if (generationResult) applyBraidColorOverrides(generationResult);

      // Start masthead image generation on the first click only.
      if (!autoMastheadImageTriggered) {
        autoMastheadImageTriggered = true;
        startMastheadImageGeneration();
      }

      // Wait for braid HTML (may still be in progress if user clicked quickly).
      while (braidInProgress) {
        await new Promise(r => setTimeout(r, 500));
      }

      // Wait for masthead image.
      while (mastheadImageInProgress) {
        await new Promise(r => setTimeout(r, 500));
      }

      doPreview();
      setOpenEditorReady(true);
    }
    document.getElementById("back4")?.addEventListener("click", () => { onEnterPage2(); setStep(3); });
    document.getElementById("next4")?.addEventListener("click", page4OpenEditorAction);
    document.getElementById("dbgSubmit4")?.addEventListener("click", page4OpenEditorAction);

    // Open Editor / visuals (now on page 4)
    document.getElementById("next2_bottom")?.addEventListener("click", page4OpenEditorAction);
    document.getElementById("dbgSubmit5")?.addEventListener("click", doPreview);

    // Debug recompute buttons
    document.getElementById("recomputeStage5")?.addEventListener("click", () => {
      if (generationInProgress) return;
      generationResult = null;
      greyRendererButtons(true);
      setApplyBtnState(false);
      doGenerateWebsite();
    });
    // Track which color input last had focus
    const colorInputIds = THEME_INPUT_IDS;
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

    window.addEventListener("message", e => {
      if (!e.data || e.data.type !== "editor_process_status_request") return;
      forwardEditorProcessStatus();
    });

    // Single color pick from iframe — fills whichever field is active
    window.addEventListener("message", e => {
      const msg = e.data;
      if (!msg || msg.type !== "colorPick") return;
      userHasSelectedPalette = true;
      paletteSuggestionsLocked = true;
      selectedSuggestedPaletteKey = "";
      const el = document.getElementById(focusedColorId);
      if (el) el.value = msg.color;
    });

    document.getElementById("submit_top")?.addEventListener("click", doPreview);

    // ----------------------------
    // Boot
    // ----------------------------
    function applyDefaults(){
      // Semantic starter palette
      applyColors({
        background: "#eaf0ff",
        foreground: "#0b1220",
        primary: "#4E70F1",
        secondary: "#FBAB9C",
        accent: "#8DE0FF"
      });
    }

    updateDebugBanner();
    updateProviderBadge();
    renderStepUI();
    setStep(0);
    window.addEventListener("message", (event) => {
        const msg = event.data;
        if (!msg || msg.type !== "colorThemeSelected") return;

        userHasSelectedPalette = true;
        paletteSuggestionsLocked = true;
        selectedSuggestedPaletteKey = "";
        const t = msg.theme || {};
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ""; };
        const theme = themeWithAliases(t.base_colors || t);

        set("themeNumber", msg.number ?? "");
        set("primary",   theme.background);
        set("secondary", theme.foreground);
        set("tertiary",  theme.primary);
        set("accent2",   theme.secondary);
        set("accent1",   theme.accent);
      });
