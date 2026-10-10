/* OPENCODE RTL PATCH v0.5.0 — UI-only runtime. No model/prompt/tool changes.
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
  // Inner selectors (no "#root " prefix) for el.matches() on incremental
  // paths; the "#root "-prefixed versions are for document-wide queries.
  const TEXT_TAGS_INNER = TEXT_TAGS.join(",");
  const CONTAINER_INNER =
    '[data-component="markdown"] ul, [data-component="markdown"] ol,' +
    ' [data-component="markdown"] table, [data-component="markdown"] blockquote';
  const INPUT_INNER = 'textarea,input,[contenteditable="true"]';
  const EXCLUDE_SEL = "pre, code, .xterm, [class*=monaco], [class*=terminal], kbd";
  // Tool/timeline chrome (divs/buttons — never prose). A text-tag ancestor
  // (e.g. a timeline <li>) can wrap BOTH Persian explanations AND English
  // tool cards; voting on its combined textContent flips the whole item RTL
  // (icon order, header layout) via inheritance, while the English rows
  // themselves carry no dir to override it. Such containers must stay
  // direction-neutral so each child block keeps its own verdict.
  const CHROME_INNER =
    'div[data-component="tool-trigger"],div[data-component="card"],' +
    'div[data-component="collapsible"],div[data-component="tool-part-wrapper"],' +
    'div[data-component="tool-output"],div[data-component="task-tool-card"],' +
    'div[data-component="attachment-card-v2"],div[data-component="tool-loaded-file"],' +
    'button[data-slot="collapsible-trigger"]';

  function hasToolChrome(el) {
    try {
      return !!el.querySelector(CHROME_INNER);
    } catch (_) {
      return false;
    }
  }

  function dropDir(el) {
    try {
      if (el.hasAttribute("dir")) el.removeAttribute("dir");
    } catch (_) {}
    try {
      delete el.dataset.ocDirSig;
    } catch (_) {}
  }

  // Stale-direction heal. The app natively uses dir="ltr"/"auto" attributes
  // on a few components but NEVER dir="rtl" on a div/button — so a rtl div
  // wrapping tool UI (or a rtl button) is always a stale write from the old
  // focus-fallback path below, and the English rows inside flip via
  // inheritance with no dir of their own to override it. Legit prose is
  // untouched: markdown leaf divs have no element children (no chrome
  // inside), and tab roots contain no tool chrome.
  function isStaleChromeDir(el) {
    try {
      if (!el || el.nodeType !== 1) return false;
      if (el.getAttribute("dir") !== "rtl") return false;
      if (el.closest && el.closest("#oc-rtl-pill,#oc-rtl-panel")) return false;
      const tag = el.tagName;
      if (tag === "BUTTON") return true;
      if (tag !== "DIV") return false;
      return hasToolChrome(el);
    } catch (_) {
      return false;
    }
  }

  function healStaleChromeDir(scope) {
    let found;
    try {
      found = (scope || document).querySelectorAll('div[dir="rtl"],button[dir="rtl"]');
    } catch (_) {
      return;
    }
    for (const el of found) {
      if (isStaleChromeDir(el)) dropDir(el);
    }
  }

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

  // Cheap full-text hash for the per-element signature guard: length +
  // prefix alone misses same-length tail edits, while this is O(n)
  // charCodes — the same order as the cleanText scan we already do.
  function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // Prose text for direction voting: <code>/<pre> content is LTR technical
  // tokens, not prose — counting it lets long function names/file paths
  // outvote the surrounding Persian and flips the whole block to LTR (list
  // markers jump sides, mixed table cells go LTR). Strip it before voting.
  // Falls back to the full text when nothing but code remains, so code-only
  // blocks keep their LTR verdict instead of losing their dir.
  function proseText(el) {
    try {
      // Fast path (the common case): no pre/code inside, so textContent
      // IS the prose — skip the cloneNode + remove + second textContent.
      // querySelector on one element is far cheaper than deep-cloning its
      // whole subtree on every pass.
      if (!el.querySelector("pre,code")) return el.textContent || "";
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
    // Chrome wrapper (timeline item wrapping tool cards + prose): never take
    // a direction vote on the combined text — it would inherit onto the
    // English rows. Drop any stale dir so the broken state heals on rescan.
    if (hasToolChrome(el)) {
      dropDir(el);
      clearPins(el);
      return;
    }
    const raw = proseText(el);
    const text = cleanText(raw);
    if (!text) {
      if (el.hasAttribute("dir")) el.removeAttribute("dir");
      delete el.dataset.ocDirSig;
      return;
    }
    // Signature guard: skip the vote + pin work when neither the text nor
    // the mode changed since the last pass over this element. Streaming
    // appends change the hash, so growing paragraphs still re-process;
    // static paragraphs cost one textContent read + one hash compare.
    // (Hashed over the FULL text: length + prefix alone would miss a
    // same-length tail edit that flips the majority.)
    const sig = (cfg.forceRTL ? "F" : "A") + text.length + ":" + hashStr(text);
    if (el.dataset.ocDirSig === sig) return;
    const dir = dirFor(text);
    setDir(el, dir);
    pinLeadingRun(el, dir);
    el.dataset.ocDirSig = sig;
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
    // NOTE: no `:has()` here — `:has(*)` forces the engine to test every
    // div's subtree on each query, which dominates the profile on large
    // tabs. Filter on firstElementChild instead (O(1) per div).
    let leafs;
    try {
      const divs = document.querySelectorAll('#root [data-component="markdown"] div');
      leafs = [];
      for (const el of divs) {
        if (!el.firstElementChild) leafs.push(el);
      }
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
    // Heal stale container/button dirs (see isStaleChromeDir): full scans are
    // where a pre-fix wrong verdict gets revisited and dropped.
    try {
      healStaleChromeDir(document);
    } catch (_) {}
  }

  function processInputEl(el) {
    if (!el || el.nodeType !== 1) return;
    // Fields only. Focus can land on buttons, links, or tabindex scroll
    // containers; voting on such an element's whole-subtree textContent (e.g.
    // a turn wrapper holding Persian prose) stamps dir on a shared container
    // and flips every tool row inside it via inheritance. Never do that.
    try {
      const tag = el.tagName;
      const editable =
        tag === "TEXTAREA" ||
        tag === "INPUT" ||
        el.isContentEditable ||
        (el.getAttribute && el.getAttribute("contenteditable") === "true");
      if (!editable) return;
    } catch (_) {
      return;
    }
    if (nearestExcluded(el)) return;
    const raw =
      el.tagName === "TEXTAREA" || el.tagName === "INPUT" ? el.value || "" : el.textContent || "";
    const text = cleanText(raw);
    if (!text) {
      if (el.hasAttribute("dir")) el.removeAttribute("dir");
      return;
    }
    setDir(el, dirFor(text));
  }

  function applyInputDirections() {
    if (!cfg.isRTL) return;
    document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]').forEach((el) => {
      processInputEl(el);
    });
  }

  // ---------- Incremental path: process only what changed ----------
  // Full-document applyTextDirections() is O(page). During streaming the
  // app appends a few nodes per token, so re-scanning the whole tab per
  // token is what melts large tabs. The observer below distills each
  // mutation batch into a small dirty set; this processes just that set
  // plus the container ancestors whose majority vote includes the new text.
  function processContainerEl(el) {
    if (nearestExcluded(el)) return;
    if (hasToolChrome(el)) {
      dropDir(el);
      return;
    }
    const text = cleanText(proseText(el));
    if (!text) return;
    setDir(el, dirFor(text));
  }

  function collectDirty(record, out) {
    const visit = (node) => {
      if (!node) return;
      if (node.nodeType === 3) {
        // Text node (characterData or freshly added text): its parent
        // element owns the direction vote.
        if (node.parentElement) visit(node.parentElement);
        return;
      }
      if (node.nodeType !== 1) return;
      const el = node;
      // Never touch our own UI, and never re-enter our own pin spans
      // (their insertion is OUR write, not new content).
      if (el.id === "oc-rtl-pill" || el.id === "oc-rtl-panel") return;
      if (el.closest && el.closest("#oc-rtl-pill,#oc-rtl-panel")) return;
      if (el.classList && (el.classList.contains("oc-rtl-num") || el.classList.contains("oc-rtl-ltr")))
        return;
      out.add(el);
    };
    if (record.type === "characterData" && record.target) {
      visit(record.target);
      return;
    }
    (record.addedNodes || []).forEach(visit);
    if (record.type === "childList" && (record.addedNodes || []).length === 0 && record.target) {
      // Pure removal (no additions): re-vote the parent — usually a
      // list/table/quote whose majority may have flipped with the deletion.
      visit(record.target);
    }
  }

  function applyIncremental(dirty) {
    if (!dirty || dirty.size === 0) return;
    // A huge batch (tab switch, history restore, large paste) means the
    // dirty set approaches the whole document anyway — one full scan is
    // cheaper than hundreds of scoped queries.
    if (dirty.size > 120) {
      applyTextDirections();
      return;
    }
    const containers = new Set();
    const texts = new Set();
    for (const root of dirty) {
      // A removal/insertion directly under #root (or body fallback) means
      // top-level structure changed — one full scan beats a scoped query
      // that would cover the whole document anyway.
      if (root === document.body || root.id === "root") {
        applyTextDirections();
        applyInputDirections();
        return;
      }
      // Mirror the full-scan scope: only content under #root (plus the
      // tab bar inside it). Overlays/portals outside #root are the app's
      // own business.
      try {
        if (!root.closest || !root.closest("#root")) continue;
      } catch (_) {
        continue;
      }
      let self = null;
      try {
        if (root.matches(TEXT_TAGS_INNER)) self = root;
        else if (root.matches(CONTAINER_INNER)) self = root;
        else if (root.matches('[data-titlebar-tab-title]')) self = root;
        else if (root.matches(INPUT_INNER)) self = root;
      } catch (_) {}
      if (self) {
        try {
          if (self.matches('[data-titlebar-tab-title]')) processTabTitle(self);
          else if (self.matches(INPUT_INNER)) processInputEl(self);
          else if (self.matches(CONTAINER_INNER)) processContainerEl(self);
          else processTextEl(self);
        } catch (_) {}
      }
      // Descendants of the added subtree (scoped, not document-wide).
      try {
        if (root.querySelectorAll) {
          const subs = root.querySelectorAll(
            TEXT_TAGS_INNER + "," + CONTAINER_INNER + ',[data-titlebar-tab-title],' + INPUT_INNER,
          );
          for (const el of subs) {
            if (el.matches('[data-titlebar-tab-title]')) processTabTitle(el);
            else if (el.matches(INPUT_INNER)) processInputEl(el);
            else if (el.matches(CONTAINER_INNER)) processContainerEl(el);
            else processTextEl(el);
          }
          // Leaf-div descendants of an added markdown subtree.
          const divs = root.querySelectorAll('[data-component="markdown"] div');
          for (const el of divs) {
            if (el.firstElementChild) continue;
            if (nearestExcluded(el)) continue;
            const text = cleanText(proseText(el));
            if (text.length < 2) continue;
            const dir = dirFor(text);
            setDir(el, dir);
            pinLeadingRun(el, dir);
          }
        }
      } catch (_) {}
      // Ancestors: a new paragraph changes its ul/table/blockquote's
      // majority vote, so re-vote containers up to #root. Also re-vote the
      // nearest text-tag ancestor: streamed formatters often append an
      // INLINE element (<span>/<em>/<strong>) to an existing paragraph,
      // which matches nothing itself but changes the paragraph's vote.
      try {
        let a = root.parentElement;
        let textTaken = false;
        while (a && a !== document.body) {
          if (a.id === "oc-rtl-pill" || a.id === "oc-rtl-panel") break;
          try {
            if (!textTaken && a.matches && a.matches(TEXT_TAGS_INNER)) {
              texts.add(a);
              textTaken = true;
            }
            if (a.matches && a.matches(CONTAINER_INNER)) containers.add(a);
            // Heal stale container/button dirs on the way up (pre-fix
            // focus-fallback writes): cheap, ancestors are few.
            if (isStaleChromeDir(a)) dropDir(a);
          } catch (_) {}
          if (a.id === "root") break;
          a = a.parentElement;
        }
      } catch (_) {}
    }
    for (const el of texts) processTextEl(el);
    for (const el of containers) processContainerEl(el);
  }

  function clearAll() {
    // NOTE: our header button lives INSIDE #root (session-title/titlebar)
    // and carries dir="ltr" — spare it (and the panel) here.
    document.querySelectorAll("#root [dir]:not(#oc-rtl-pill):not(#oc-rtl-panel)").forEach((el) => el.removeAttribute("dir"));
    // Unwrap leading-run pins too — they are visually inert while disabled
    // (CSS is scoped under body.oc-rtl-on) but stale spans trip the re-pin
    // signature guard on the next enable.
    document.querySelectorAll("#root [data-oc-pin-sig]").forEach((el) => clearPins(el));
    // Drop per-element direction signatures so re-enabling re-votes text
    // instead of trusting pre-disable verdicts.
    document.querySelectorAll("#root [data-oc-dir-sig]").forEach((el) => {
      try {
        delete el.dataset.ocDirSig;
      } catch (_) {}
    });
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

  // ---------- Header RTL button + popup panel ----------
  // Native-like placement: an icon-only button beside the session header
  // actions (usage pill + overflow menu, top-right of the session title
  // row), falling back to the global titlebar mount and finally to a fixed
  // top-right slot. Icon-only like its neighbours; a small badge dot shows
  // state (green = on, blue = force-RTL, hidden = off).
  const IS_MAC = /Mac/i.test(navigator.userAgent || navigator.platform || "");
  const KEY_RTL = IS_MAC ? "⌥R" : "Alt+R";
  const KEY_FORCE = IS_MAC ? "⇧⌥R" : "Alt+Shift+R";
  const VERSION = "0.5.0";
  const RTL_ICON_SVG =
    '<svg data-slot="icon-svg" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
    '<path d="M13.5 3.5H4.4M4.4 3.5 6.6 1.3M4.4 3.5l2.2 2.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/>' +
    '<path d="M13.5 8h-9M13.5 12.5h-9" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/>' +
    "</svg>";

  function rtlButtonHTML() {
    return RTL_ICON_SVG + '<span class="oc-rtl-badge" aria-hidden="true"></span>';
  }

  // Find the session header's right-side actions container:
  // [data-session-title] > div (h-12 flex row) > last div (actions wrapper
  // holding the usage pill + overflow menu trigger).
  function sessionActionsContainer() {
    try {
      const title = document.querySelector("[data-session-title]");
      if (!title) return null;
      const row = title.querySelector(":scope > div");
      if (!row) return null;
      const kids = Array.from(row.children).filter((n) => n && n.nodeType === 1);
      if (kids.length >= 2) return kids[kids.length - 1];
      return row;
    } catch (_) {
      return null;
    }
  }

  function createPill() {
    const pill = document.createElement("button");
    pill.id = "oc-rtl-pill";
    pill.type = "button";
    pill.setAttribute("dir", "ltr");
    pill.setAttribute("data-component", "icon-button-v2");
    pill.setAttribute("data-size", "large");
    pill.setAttribute("data-variant", "ghost-muted");
    pill.className = "!w-9 shrink-0";
    pill.setAttribute("aria-label", "RTL settings");
    pill.setAttribute("aria-expanded", "false");
    pill.innerHTML = rtlButtonHTML();
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePanel();
    });
    return pill;
  }

  function placePill() {
    // The header is Solid-rendered and may replace our container on
    // navigation — recreate the button if a re-render destroyed it.
    let pill = document.getElementById("oc-rtl-pill");
    if (!pill) {
      try {
        pill = createPill();
        document.body.appendChild(pill);
      } catch (_) {
        return;
      }
    }
    // 1. Session header actions (the correct place — top-right of the
    //    session title row, beside the other icon buttons).
    const actions = sessionActionsContainer();
    if (actions) {
      if (pill.parentElement !== actions) {
        // Slot it before the overflow-menu trigger (last native icon
        // button) so order reads: usage pill, RTL, overflow menu.
        let anchor = null;
        try {
          const natives = actions.querySelectorAll(
            ':scope button[data-component="icon-button-v2"], :scope button[data-component="icon-button"]',
          );
          if (natives.length) anchor = natives[natives.length - 1];
        } catch (_) {}
        try {
          if (anchor && anchor.parentElement === actions) actions.insertBefore(pill, anchor);
          else actions.appendChild(pill);
        } catch (_) {}
      }
      try {
        pill.removeAttribute("data-oc-rtl-fallback");
      } catch (_) {}
      return;
    }
    // 2. Global titlebar mount (home/empty states with no session header).
    try {
      const bar = document.getElementById("opencode-titlebar-right");
      if (bar) {
        if (pill.parentElement !== bar) {
          try {
            bar.appendChild(pill);
          } catch (_) {}
        }
        try {
          pill.removeAttribute("data-oc-rtl-fallback");
        } catch (_) {}
        return;
      }
    } catch (_) {}
    // 3. Last resort: fixed top-right slot so the toggle is never lost.
    if (pill.parentElement !== document.body) {
      try {
        document.body.appendChild(pill);
      } catch (_) {}
    }
    try {
      pill.setAttribute("data-oc-rtl-fallback", "true");
    } catch (_) {}
  }

  function ensurePill() {
    if (!document.getElementById("oc-rtl-pill")) {
      try {
        document.body.appendChild(createPill());
      } catch (_) {}
    }
    // Mount in the right place from the start (placePill falls back
    // gracefully when the header is not mounted yet).
    placePill();
    ensurePanel();
    checkFont();
  }

  function updatePill() {
    placePill();
    const pill = document.getElementById("oc-rtl-pill");
    if (!pill) return;
    const state = !cfg.isRTL ? "off" : cfg.forceRTL ? "force" : "on";
    try {
      pill.setAttribute("data-oc-rtl-state", state);
    } catch (_) {}
    const panel = document.getElementById("oc-rtl-panel");
    const open = panel ? !panel.hidden : false;
    try {
      pill.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) pill.setAttribute("data-state", "pressed");
      else pill.removeAttribute("data-state");
    } catch (_) {}
    pill.title =
      "OpenCode RTL (" + state + ", " + fontStatus + ") — click for settings";
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
    updatePill();
  }

  function closePanel() {
    const p = document.getElementById("oc-rtl-panel");
    if (p && !p.hidden) {
      p.hidden = true;
      updatePill();
    } else if (p) {
      p.hidden = true;
    }
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

  // ---------- Events (throttled + incremental) ----------
  // Was: every childList mutation → rAF → FULL document scan (clone every
  // paragraph, TreeWalker + Range surgery per pin candidate), PLUS the same
  // full scan on a 1.5s setInterval even when idle. On a tab with N blocks
  // each streamed token cost O(N) DOM reads/writes, and our own pin-span
  // insertions re-triggered the observer — a self-sustaining loop that
  // keeps the renderer busy long after streaming ends. That is the slowdown.
  //
  // Now: mutation batches are distilled to a dirty set and processed
  // incrementally, at most ~once per 250ms, on idle time, never while the
  // tab is hidden. Our own writes run with the observer disconnected so
  // they can't re-trigger it. characterData is observed so streamed text
  // edits are caught without any polling interval.
  let observer = null;
  let scheduled = false;
  let pendingRecords = [];

  function takePending() {
    const recs = pendingRecords;
    pendingRecords = [];
    return recs;
  }

  function runScheduled() {
    scheduled = false;
    if (document.hidden) {
      // Tab hidden: drop the batch; visibilitychange does one catch-up
      // full scan on return instead of burning CPU in the background.
      pendingRecords = [];
      return;
    }
    const recs = takePending();
    try {
      const dirty = new Set();
      for (const r of recs) {
        try {
          collectDirty(r, dirty);
        } catch (_) {}
        if (dirty.size > 150) break; // big enough — full scan wins
      }
      if (observer) observer.disconnect();
      try {
        if (cfg.isRTL) {
          if (recs.length === 0 || dirty.size > 120) {
            // Visibility catch-up (no records) or huge batch: one full scan
            // covering text AND inputs — the incremental path below handles
            // neither the empty set nor document-scale batches.
            applyTextDirections();
            applyInputDirections();
          } else applyIncremental(dirty);
        }
        // Header re-renders (navigation, layout switch) may have replaced
        // our button's container — re-seat it while disconnected so the
        // move itself never re-triggers the observer. Runs even while
        // disabled so the toggle is never lost.
        try {
          placePill();
        } catch (_) {}
      } finally {
        observe();
      }
    } catch (_) {
      try {
        observe();
      } catch (_) {}
    }
  }

  function schedule(records) {
    if (records && records.length) pendingRecords.push(...records);
    // Cap the backlog: a tab restore can queue thousands of records;
    // beyond this the incremental set is pointless, keep only the signal
    // that *something* changed and let the runner fall back to full scan.
    if (pendingRecords.length > 500) pendingRecords.splice(0, pendingRecords.length - 500);
    if (scheduled) return;
    scheduled = true;
    const fire = () => runScheduled();
    if (typeof requestIdleCallback === "function") {
      try {
        requestIdleCallback(fire, { timeout: 250 });
        return;
      } catch (_) {}
    }
    setTimeout(fire, 120);
  }

  function observe() {
    if (!observer) return;
    try {
      observer.disconnect();
    } catch (_) {}
    try {
      const target = document.getElementById("root") || document.body;
      observer.observe(target, { childList: true, subtree: true, characterData: true });
    } catch (_) {}
  }

  function startObserving() {
    try {
      observer = new MutationObserver((recs) => schedule(recs));
      observe();
    } catch (_) {}
    try {
      // Catch-up pass when the tab becomes visible again; skipped work
      // while hidden is reconciled here, once, instead of continuously.
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && cfg.isRTL) schedule(null);
      });
    } catch (_) {}
  }

  // Typing/focus: only the edited FIELD can have changed direction — never
  // the whole document. (Was: full querySelectorAll over every input per
  // keystroke.) Note there is deliberately NO fallback to e.target here: a
  // focusin/input on a button, link, or tabindex container must not
  // direction-vote that element's whole subtree.
  function closestField(node) {
    try {
      if (node && node.closest) return node.closest('textarea,input,[contenteditable="true"]');
    } catch (_) {}
    return null;
  }
  document.addEventListener(
    "input",
    (e) => {
      if (!cfg.isRTL) return;
      try {
        const t = closestField(e.target);
        if (!t) return;
        processInputEl(t);
      } catch (_) {}
    },
    { capture: true },
  );
  document.addEventListener(
    "focusin",
    (e) => {
      if (!cfg.isRTL) return;
      try {
        const t = closestField(e.target);
        if (!t) return;
        processInputEl(t);
      } catch (_) {}
    },
    { capture: true },
  );
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

  // NOTE: no setInterval poller. Streaming text edits arrive as
  // characterData mutations (observed above); a timer that re-scans the
  // whole tab every 1.5s — idle or not — was the single largest source of
  // sustained CPU on large tabs.

  // ---------- Boot ----------
  function boot() {
    ensurePill();
    applyAll();
    startObserving();
  }
  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot, { once: true });
})();
