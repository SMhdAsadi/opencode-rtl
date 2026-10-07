/* OPENCODE RTL PATCH v0.4.4 — UI-only runtime. No model/prompt/tool changes.
 * - Content-aware direction: each block AND each list/table/quote container
 *   follows its own majority script (RTL vs Latin). Diffs/code stay LTR.
 * - Settings in localStorage (global across repos).
 * - Toggle RTL: Alt+R / Option+R. Force-RTL: Shift+click pill or Alt+Shift+R.
 */
(() => {
  if (window.__OPENCODE_RTL_LOADED__) return;
  window.__OPENCODE_RTL_LOADED__ = true;

  const KEY = "opencode-rtl.v1";
  const defaults = { isRTL: true, forceRTL: false };
  let cfg = { ...defaults };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      // Whitelist known keys so stale keys from older versions can't linger.
      cfg = {
        isRTL: stored.isRTL !== undefined ? !!stored.isRTL : defaults.isRTL,
        forceRTL: !!stored.forceRTL,
      };
    }
  } catch (_) {}

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(cfg));
    } catch (_) {}
  }

  // Test/diagnostic hook (also handy from DevTools).
  try {
    window.__OPENCODE_RTL__ = {
      get cfg() {
        return { ...cfg };
      },
      buildSnapshot: () => buildSnapshot(),
      applyAll: () => applyAll(),
    };
  } catch (_) {}

  const RTL_SINGLE = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;
  const FIRST_STRONG_RE = /[A-Za-z\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;
  // Token separator for direction voting: whitespace, punctuation, brackets
  // and bidi marks. A token's first strong character casts its vote.
  const TOKEN_SEP_RE = /[\s\d\u0660-\u0669\u06F0-\u06F9\u200E\u200F.,:;()\[\]{}«»"'“”‘’\-–—+/\\|*#<>]+/;

  // Majority rule, one token = one vote: a long CamelCase identifier counts
  // once instead of outvoting short Persian words letter-by-letter (so
  // "روال ویرآوا (CloudMeeting)" flips RTL: 2 Persian tokens vs 1 Latin).
  // Ties fall back to the first strong character (so "[x] کار فارسی" flips,
  // while an English sentence quoting one Persian word stays LTR).
  function dirFor(text) {
    if (cfg.forceRTL) return "rtl";
    let rtl = 0,
      latin = 0;
    for (const tok of String(text || "").split(TOKEN_SEP_RE)) {
      if (!tok) continue;
      const m = tok.match(FIRST_STRONG_RE);
      if (!m) continue;
      if (RTL_SINGLE.test(m[0])) rtl++;
      else latin++;
    }
    if (rtl === 0 && latin === 0) return "auto";
    if (rtl === 0) return "ltr";
    if (latin === 0) return "rtl";
    if (rtl > latin) return "rtl";
    if (latin > rtl) return "ltr";
    const m = String(text || "").match(FIRST_STRONG_RE);
    if (!m) return "auto";
    return RTL_SINGLE.test(m[0]) ? "rtl" : "ltr";
  }

  // Block-level text elements. Plain <div> is deliberately NOT listed —
  // setting dir on layout containers can flip flex order. Containers we
  // explicitly manage (ul/ol/table/blockquote) are handled separately.
  // NOTE: blockquote is intentionally absent here — a quote's text lives in
  // its child paragraphs; directing/pinning the container itself risks
  // restructuring nested quotes.
  const TEXT_TAGS = [
    "p", "li", "h1", "h2", "h3", "h4", "h5", "h6",
    "td", "th", "dd", "dt", "figcaption",
  ];
  const TEXT_SEL = TEXT_TAGS.map((t) => "#root " + t).join(", ");
  const CONTAINER_SEL =
    '#root [data-component="markdown"] ul, #root [data-component="markdown"] ol,' +
    ' #root [data-component="markdown"] table, #root [data-component="markdown"] blockquote';
  // Titlebar tabs: <span data-titlebar-tab-title> holds the session title
  // (plain textContent, updated by the app on rename/navigation). The app's
  // own stylesheet is direction-aware here — overflow fade switches via
  // `[data-titlebar-tab]...:dir(rtl)` and the close button/separators use
  // logical properties — so the tab ROOT must carry the title's direction,
  // not just the span. Without this a Persian title stays LTR: left-aligned,
  // icon/text order unmirrored, fade mask on the wrong edge.
  const TAB_TITLE_SEL = '#root [data-titlebar-tab-title]';
  const EXCLUDE_SEL = "pre, code, .xterm, [class*=monaco], [class*=terminal], kbd";

  function nearestExcluded(el) {
    try {
      return el.closest(EXCLUDE_SEL);
    } catch (_) {
      return null;
    }
  }

  function cleanText(text) {
    return (text || "").replace(/[​-‏﻿]/g, "").trim();
  }

  // Prose text for direction voting: <code>/<pre> content is LTR technical
  // tokens, not prose — counting it lets long function names/file paths
  // outvote the surrounding Persian and flips the whole block to LTR (list
  // markers jump sides, mixed table cells go LTR). Strip it before voting.
  // Falls back to the full text when nothing but code remains, so code-only
  // blocks keep their LTR verdict instead of losing their dir.
  function proseText(el) {
    try {
      const clone = el.cloneNode(true);
      clone.querySelectorAll("pre,code").forEach((n) => n.remove());
      const t = clone.textContent || "";
      if (cleanText(t)) return t;
      return el.textContent || "";
    } catch (_) {
      return el.textContent || "";
    }
  }

  function setDir(el, dir) {
    if (el.getAttribute("dir") !== dir) el.setAttribute("dir", dir);
  }

  // Leading-run pinning (two phases).
  // Phase 1 — angle brackets: a leading ">" / "<" run is virtually always a
  // marker, never prose. U+003E/U+003C are *mirrored* characters, so in an
  // RTL paragraph the browser would display ">" as "<". Pin the run
  // LTR-isolated so markers never mirror, in either direction.
  // Phase 2 — digit runs: weak digits/punctuation before the first strong
  // letter can migrate to the far end of the line ("۱. heading" renders with
  // the number last), so pin the run with the block's own direction.
  const LEADING_RUN_RE =
    /^[\s\d\u0660-\u0669\u06F0-\u06F9\u200E\u200F.,:;()\[\]{}«»"'“”‘’\-–—+/\\|*#]+/;
  const HAS_DIGIT_RE = /[\d\u0660-\u0669\u06F0-\u06F9]/;
  const LEADING_MARK_RE = /^[><\s\u200E\u200F]+/;

  // Wrap text offsets [start, end) of el in a span. Offsets are plain-text
  // offsets over el.textContent; nested inline markup is split cleanly via
  // Range. Returns true when a span was inserted.
  function wrapOffsetRange(el, start, end, dir, cls) {
    if (!(end > start)) return false;
    try {
      const NF = (window.NodeFilter || {}).SHOW_TEXT || 4;
      // Offsets are over el.textContent, so locked (pre/code) text still
      // advances the cursor even though it is never split.
      const lift = (tn) => {
        // A boundary exactly at the edge of one of our own pin spans must
        // resolve *outside* the span — otherwise extractContents clones an
        // empty copy of the span into the fragment.
        let n = tn;
        while (
          n.parentElement &&
          n.parentElement !== el &&
          n.parentElement.matches &&
          n.parentElement.matches(".oc-rtl-num,.oc-rtl-ltr") &&
          n.parentElement.lastChild === n
        )
          n = n.parentElement;
        return n;
      };
      const point = (pos) => {
        const w = document.createTreeWalker(el, NF);
        let acc = 0,
          tn = null;
        while ((tn = w.nextNode())) {
          const len = tn.nodeValue.length;
          const locked = tn.parentElement && tn.parentElement.closest("pre,code");
          if (!locked) {
            if (acc + len > pos) return { node: tn, offset: pos - acc };
            if (acc + len === pos) return { after: lift(tn) };
          }
          acc += len;
        }
        return null;
      };
      const s = point(start);
      const e = point(end);
      if (!s || !e) return false;
      const range = document.createRange();
      if (s.node) range.setStart(s.node, s.offset);
      else range.setStartAfter(s.after);
      if (e.node) range.setEnd(e.node, e.offset);
      else range.setEndAfter(e.after);
      const frag = range.extractContents();
      if (!frag.textContent) {
        range.insertNode(frag);
        return false;
      }
      const span = document.createElement("span");
      span.className = cls;
      span.setAttribute("dir", dir);
      span.appendChild(frag);
      range.insertNode(span);
      return true;
    } catch (_) {
      return false;
    }
  }

  function pinLeadingRun(el, dir) {
    if (dir !== "rtl" && dir !== "ltr") return;
    try {
      // Inline-only operation: never restructure an element that contains
      // other blocks (nested quotes/lists/tables). A Range spanning such
      // nesting would rip content out of its container.
      if (el.querySelector("blockquote,ul,ol,table,pre,code,div,li,h1,h2,h3,h4,h5,h6,p")) return;
      const text = el.textContent || "";
      // Phase 1: angle-bracket marker run.
      let markLen = 0;
      const mMark = text.match(LEADING_MARK_RE);
      if (mMark && /[><]/.test(mMark[0]) && mMark[0].length < text.length) markLen = mMark[0].length;
      // Phase 2: digit run on the remainder.
      const rest = text.slice(markLen);
      const mRun = rest.match(LEADING_RUN_RE);
      let runLen = 0;
      if (mRun && mRun[0] && HAS_DIGIT_RE.test(mRun[0]) && mRun[0].length < rest.length)
        runLen = mRun[0].length;
      if (markLen === 0 && runLen === 0) {
        clearPins(el);
        return;
      }
      // Signature guard: skip DOM churn when the desired state is present.
      // (Includes a text prefix so same-length streaming edits still re-pin.)
      const sig = markLen + ":" + runLen + ":" + dir + ":" + text.length + ":" + text.slice(0, 12);
      if (el.dataset.ocPinSig === sig && el.querySelector(":scope > .oc-rtl-num,:scope > .oc-rtl-ltr"))
        return;
      clearPins(el);
      let wrapped = false;
      if (markLen > 0) wrapped = wrapOffsetRange(el, 0, markLen, "ltr", "oc-rtl-ltr") || wrapped;
      if (runLen > 0)
        wrapped = wrapOffsetRange(el, markLen, markLen + runLen, dir, "oc-rtl-num") || wrapped;
      if (wrapped) {
        try {
          // Tidy stray empty text nodes (some engines leave them behind
          // after Range extraction; harmless but keeps the DOM clean).
          el.normalize();
        } catch (_) {}
      }
      el.dataset.ocPinSig = sig;
    } catch (_) {}
  }

  function clearPins(el) {
    try {
      el.querySelectorAll(":scope > .oc-rtl-num,:scope > .oc-rtl-ltr").forEach((s) => {
        el.replaceChild(document.createTextNode(s.textContent), s);
      });
      el.normalize();
      delete el.dataset.ocPinSig;
    } catch (_) {}
  }

  function processTextEl(el) {
    if (el.tagName === "P" && el.closest('[contenteditable="true"]')) return; // input path
    if (nearestExcluded(el)) return;
    const text = cleanText(proseText(el));
    if (!text) {
      if (el.hasAttribute("dir")) el.removeAttribute("dir");
      return;
    }
    const dir = dirFor(text);
    setDir(el, dir);
    pinLeadingRun(el, dir);
  }

  // Titlebar tab titles: content-aware dir on the title span AND the tab
  // root (so the app's `:dir(rtl)` fade + logical flex mirroring engage).
  // No leading-run pinning here — single-line truncated titles; Range surgery
  // would churn the DOM the app measures for overflow (scrollWidth).
  // Skipped while renaming (ancestor [data-editing="true"]).
  function processTabTitle(el) {
    if (el.closest('[data-editing="true"]')) return;
    if (nearestExcluded(el)) return;
    const tab = el.closest("[data-titlebar-tab]");
    const text = cleanText(el.textContent || "");
    if (!text) {
      if (el.hasAttribute("dir")) el.removeAttribute("dir");
      if (tab && tab.hasAttribute("dir")) tab.removeAttribute("dir");
      return;
    }
    const dir = dirFor(text);
    if (dir === "auto") {
      if (el.hasAttribute("dir")) el.removeAttribute("dir");
      if (tab && tab.hasAttribute("dir")) tab.removeAttribute("dir");
      return;
    }
    setDir(el, dir);
    if (tab) setDir(tab, dir);
  }

  function applyTextDirections() {
    if (!cfg.isRTL) return;
    let nodes;
    try {
      nodes = document.querySelectorAll(TEXT_SEL);
    } catch (_) {
      return;
    }
    for (const el of nodes) processTextEl(el);
    // Leaf <div>s inside markdown (text with no element children). A div with
    // no child elements cannot have its flex order flipped, so dir is safe.
    let leafs;
    try {
      leafs = document.querySelectorAll('#root [data-component="markdown"] div:not(:has(*))');
    } catch (_) {
      leafs = [];
    }
    for (const el of leafs) {
      if (nearestExcluded(el)) continue;
      const text = cleanText(proseText(el));
      if (text.length < 2) continue;
      const dir = dirFor(text);
      setDir(el, dir);
      pinLeadingRun(el, dir);
    }
    // Containers: markers, quote borders and table column order follow the
    // container's own majority script. The app uses logical CSS properties,
    // so padding/borders flip automatically with dir.
    let boxes;
    try {
      boxes = document.querySelectorAll(CONTAINER_SEL);
    } catch (_) {
      return;
    }
    for (const el of boxes) {
      if (nearestExcluded(el)) continue;
      const text = cleanText(proseText(el));
      if (!text) continue;
      setDir(el, dirFor(text));
    }
    // Titlebar tabs (chrome, not markdown): direction per tab title so
    // Persian titles render RTL with the app's own :dir(rtl) fade.
    let tabTitles;
    try {
      tabTitles = document.querySelectorAll(TAB_TITLE_SEL);
    } catch (_) {
      tabTitles = [];
    }
    for (const el of tabTitles) processTabTitle(el);
  }

  function applyInputDirections() {
    if (!cfg.isRTL) return;
    document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]').forEach((el) => {
      const raw =
        el.tagName === "TEXTAREA" || el.tagName === "INPUT" ? el.value || "" : el.textContent || "";
      const text = cleanText(raw);
      if (!text) {
        if (el.hasAttribute("dir")) el.removeAttribute("dir");
        return;
      }
      setDir(el, dirFor(text));
    });
  }

  function clearAll() {
    document.querySelectorAll("#root [dir]").forEach((el) => el.removeAttribute("dir"));
    // Unwrap leading-run pins too — they are visually inert while disabled
    // (CSS is scoped under body.oc-rtl-on) but stale spans trip the re-pin
    // signature guard on the next enable.
    document.querySelectorAll("#root [data-oc-pin-sig]").forEach((el) => clearPins(el));
  }

  function applyAll() {
    document.body.classList.toggle("oc-rtl-on", cfg.isRTL);
    document.body.classList.toggle("oc-rtl-force", cfg.isRTL && cfg.forceRTL);
    if (!cfg.isRTL) clearAll();
    else {
      applyTextDirections();
      applyInputDirections();
    }
    updatePill();
  }

  // ---------- Floating pill + popup panel ----------
  const IS_MAC = /Mac/i.test(navigator.userAgent || navigator.platform || "");
  const KEY_RTL = IS_MAC ? "⌥R" : "Alt+R";
  const KEY_FORCE = IS_MAC ? "⇧⌥R" : "Alt+Shift+R";
  const VERSION = "0.4.4";

  function ensurePill() {
    if (document.getElementById("oc-rtl-pill")) return;
    const pill = document.createElement("button");
    pill.id = "oc-rtl-pill";
    pill.type = "button";
    pill.setAttribute("dir", "ltr");
    pill.innerHTML = '<span class="oc-rtl-dot"></span><span>RTL</span><span class="oc-rtl-state"></span>';
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePanel();
    });
    document.body.appendChild(pill);
    ensurePanel();
    checkFont();
  }

  function updatePill() {
    const pill = document.getElementById("oc-rtl-pill");
    if (!pill) return;
    const s = pill.querySelector(".oc-rtl-state");
    if (s) s.textContent = !cfg.isRTL ? "off" : cfg.forceRTL ? "⇉" : "";
    pill.title = "OpenCode RTL — click for settings";
    refreshPanel();
  }

  function ensurePanel() {
    if (document.getElementById("oc-rtl-panel")) return;
    const panel = document.createElement("div");
    panel.id = "oc-rtl-panel";
    panel.setAttribute("dir", "ltr");
    panel.hidden = true;
    panel.innerHTML =
      '<div class="oc-rtl-phead">' +
      '<span class="oc-rtl-pglobe" aria-hidden="true">🌐</span>' +
      '<span class="oc-rtl-ptitle">OpenCode RTL</span>' +
      '<span class="oc-rtl-pver">v' + VERSION + "</span>" +
      '<button type="button" class="oc-rtl-pclose" aria-label="Close">✕</button>' +
      "</div>" +
      '<div class="oc-rtl-prow">' +
      '<div class="oc-rtl-ptext"><div class="oc-rtl-pt">Right-to-left <span class="oc-rtl-pfa">· راست‌به‌چپ</span></div>' +
      '<div class="oc-rtl-ps">Auto direction per paragraph</div></div>' +
      '<button type="button" class="oc-rtl-switch" data-setting="isRTL" role="switch"><span class="oc-rtl-knob"></span></button>' +
      "</div>" +
      '<div class="oc-rtl-prow">' +
      '<div class="oc-rtl-ptext"><div class="oc-rtl-pt">Force RTL</div>' +
      '<div class="oc-rtl-ps">Right-align even majority-English text</div></div>' +
      '<button type="button" class="oc-rtl-switch" data-setting="forceRTL" role="switch"><span class="oc-rtl-knob"></span></button>' +
      "</div>" +
      '<div class="oc-rtl-prow oc-rtl-pstatic">' +
      '<div class="oc-rtl-ptext"><div class="oc-rtl-pt">Font</div>' +
      '<div class="oc-rtl-ps">Persian/Arabic typeface</div></div>' +
      '<span class="oc-rtl-pfont" id="oc-rtl-pfont">checking…</span>' +
      "</div>" +
      '<div class="oc-rtl-psec">Shortcuts</div>' +
      '<div class="oc-rtl-pkeys">' +
      '<div class="oc-rtl-pkey"><kbd class="oc-rtl-kbd">' + KEY_RTL + "</kbd><span>Toggle RTL</span></div>" +
      '<div class="oc-rtl-pkey"><kbd class="oc-rtl-kbd">' + KEY_FORCE + "</kbd><span>Force RTL</span></div>" +
      "</div>" +
      '<div class="oc-rtl-pbtns">' +
      '<button type="button" class="oc-rtl-pbtn" id="oc-rtl-snap">Copy debug snapshot</button>' +
      '<button type="button" class="oc-rtl-pbtn oc-rtl-pbtn-ghost" id="oc-rtl-reset">Reset</button>' +
      "</div>" +
      '<div class="oc-rtl-pmsg" id="oc-rtl-pmsg"></div>' +
      '<div class="oc-rtl-pfoot">UI-only patch · nothing leaves your machine</div>';
    document.body.appendChild(panel);

    panel.querySelector(".oc-rtl-pclose").addEventListener("click", (e) => {
      e.stopPropagation();
      closePanel();
    });
    panel.querySelectorAll(".oc-rtl-switch").forEach((sw) => {
      sw.addEventListener("click", (e) => {
        e.stopPropagation();
        const key = sw.getAttribute("data-setting");
        if (key === "forceRTL" && !cfg.isRTL) cfg.isRTL = true;
        cfg[key] = !cfg[key];
        save();
        applyAll();
      });
    });
    panel.querySelector("#oc-rtl-snap").addEventListener("click", (e) => {
      e.stopPropagation();
      copySnapshot();
    });
    panel.querySelector("#oc-rtl-reset").addEventListener("click", (e) => {
      e.stopPropagation();
      cfg = { ...defaults };
      save();
      applyAll();
      flashMsg("Settings reset to defaults");
    });
    document.addEventListener(
      "click",
      (e) => {
        const p = document.getElementById("oc-rtl-panel");
        const pill = document.getElementById("oc-rtl-pill");
        if (!p || p.hidden) return;
        if (p.contains(e.target) || (pill && pill.contains(e.target))) return;
        closePanel();
      },
      { capture: true },
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePanel();
    });
  }

  function togglePanel() {
    const p = document.getElementById("oc-rtl-panel");
    if (!p) return;
    p.hidden = !p.hidden;
    if (!p.hidden) refreshPanel();
  }

  function closePanel() {
    const p = document.getElementById("oc-rtl-panel");
    if (p) p.hidden = true;
  }

  function refreshPanel() {
    const p = document.getElementById("oc-rtl-panel");
    if (!p) return;
    p.querySelectorAll(".oc-rtl-switch").forEach((sw) => {
      const on = !!cfg[sw.getAttribute("data-setting")];
      sw.setAttribute("aria-checked", on ? "true" : "false");
      sw.classList.toggle("on", on);
    });
    const badge = p.querySelector("#oc-rtl-pfont");
    if (badge) {
      badge.textContent = fontStatus;
      badge.classList.toggle("ok", /OK/.test(fontStatus));
      badge.classList.toggle("bad", /MISSING/.test(fontStatus));
    }
  }

  function flashMsg(text) {
    const m = document.getElementById("oc-rtl-pmsg");
    if (!m) return;
    m.textContent = text;
    clearTimeout(flashMsg._t);
    flashMsg._t = setTimeout(() => {
      m.textContent = "";
    }, 3000);
  }

  // ---------- Debug snapshot ----------
  function sampleHTML(sel) {
    try {
      const el = document.querySelector(sel);
      if (!el) return null;
      const html = el.outerHTML || "";
      return html.length > 700 ? html.slice(0, 700) + "…[truncated]" : html;
    } catch (_) {
      return null;
    }
  }

  function buildSnapshot() {
    return JSON.stringify(
      {
        patch: "opencode-rtl v" + VERSION,
        settings: { ...cfg },
        font: fontStatus,
        counts: {
          dirRtl: document.querySelectorAll('#root [dir="rtl"]').length,
          dirLtr: document.querySelectorAll('#root [dir="ltr"]').length,
          numPins: document.querySelectorAll("#root .oc-rtl-num").length,
          ltrPins: document.querySelectorAll("#root .oc-rtl-ltr").length,
          quotes: document.querySelectorAll('#root [data-component="markdown"] blockquote').length,
          tabTitles: document.querySelectorAll("#root [data-titlebar-tab-title]").length,
          tabRtl: document.querySelectorAll('#root [data-titlebar-tab][dir="rtl"]').length,
        },
        samples: {
          firstQuote: sampleHTML('#root [data-component="markdown"] blockquote'),
          nestedQuote: sampleHTML('#root [data-component="markdown"] blockquote blockquote'),
          firstH2: sampleHTML('#root [data-component="markdown"] h2'),
          firstTable: sampleHTML('#root [data-component="markdown"] table'),
        },
      },
      null,
      2,
    );
  }

  function copySnapshot() {
    const text = buildSnapshot();
    const finish = (ok) => {
      if (!ok && window.console) window.console.log("[opencode-rtl snapshot]\n" + text);
      flashMsg(ok ? "Snapshot copied — paste it to your assistant" : "Copy failed — snapshot printed to console");
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          () => finish(true),
          () => fallbackCopy(text, finish),
        );
        return;
      }
      fallbackCopy(text, finish);
    } catch (_) {
      fallbackCopy(text, finish);
    }
  }

  function fallbackCopy(text, finish) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      finish(!!ok);
    } catch (_) {
      finish(false);
    }
  }

  let fontStatus = "checking…";

  function checkFont() {
    try {
      if (!document.fonts || !document.fonts.load) {
        fontStatus = "unknown (no Font API)";
        updatePill();
        return;
      }
      document.fonts
        .load('16px "Vazirmatn"', "فارسی")
        .then(() => {
          let ok = false;
          try {
            ok = document.fonts.check('16px "Vazirmatn"', "فارسی");
          } catch (_) {}
          fontStatus = ok ? "Vazirmatn OK" : "Vazirmatn MISSING";
          updatePill();
        })
        .catch(() => {
          fontStatus = "Vazirmatn MISSING";
          updatePill();
        });
    } catch (_) {
      fontStatus = "unknown";
      updatePill();
    }
  }

  // ---------- Events ----------
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      try {
        if (cfg.isRTL) applyTextDirections();
      } catch (_) {}
    });
  }

  function startObserving() {
    try {
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    } catch (_) {}
  }

  document.addEventListener("input", () => cfg.isRTL && applyInputDirections(), { capture: true });
  document.addEventListener("focusin", () => cfg.isRTL && applyInputDirections(), { capture: true });
  document.addEventListener("keydown", (e) => {
    if (e.altKey && (e.code === "KeyR" || e.key === "®")) {
      e.preventDefault();
      if (e.shiftKey) {
        cfg.isRTL = true;
        cfg.forceRTL = !cfg.forceRTL;
      } else {
        cfg.isRTL = !cfg.isRTL;
      }
      save();
      applyAll();
    }
  });

  setInterval(() => {
    try {
      if (cfg.isRTL) {
        applyInputDirections();
        applyTextDirections();
      }
    } catch (_) {}
  }, 1500);

  // ---------- Boot ----------
  function boot() {
    ensurePill();
    applyAll();
    startObserving();
  }
  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot, { once: true });
})();
