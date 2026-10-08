import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as asar from "@electron/asar";

export const MARKER_HTML = "<!-- OPENCODE RTL PATCH -->";
export const RTL_JS = "opencode-rtl.js";
export const RTL_CSS = "opencode-rtl.css";
export const CSS_TEMPLATE = "opencode-rtl.template.css";
export const FONT_FILE = "Vazirmatn-Variable.woff2";
export const FONT_PLACEHOLDER = "__VAZIRMATN_WOFF2_B64__";

const ANCHOR = '<script id="oc-theme-preload-script" src="./oc-theme-preload.js"></script>';

/**
 * All app.asar locations to search on the given platform.
 * `platform`/`env` are injectable so tests can assert win32/Linux
 * layouts from any host. Defaults preserve runtime behavior.
 *
 * Verified against the official OpenCode desktop build
 * (packages/desktop/electron-builder.config.ts on anomalyco/opencode):
 * - Windows: NSIS one-click, per-user (perMachine:false),
 *   productName "OpenCode" → %LOCALAPPDATA%\Programs\OpenCode.
 * - Linux .deb: Exec=/opt/OpenCode/ai.opencode.desktop → /opt/OpenCode.
 * Everything else below is a fallback for alternate install methods.
 */
export function candidateAsarPaths(platform = os.platform(), env = process.env) {
  const candidates = [];
  const home = os.homedir();
  // Explicit join flavors so injected-platform results (e.g. asserting
  // win32 layouts from a macOS test host) still use native separators.
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  if (platform === "darwin") {
    candidates.push("/Applications/OpenCode.app/Contents/Resources/app.asar");
    candidates.push(
      join(home, "Applications/OpenCode.app/Contents/Resources/app.asar"),
    );
  } else if (platform === "win32") {
    if (env.LOCALAPPDATA) {
      candidates.push(
        join(env.LOCALAPPDATA, "Programs", "OpenCode", "resources", "app.asar"),
      );
      // Folder layout seen on a machine installed from the official
      // OpenCode website (folder literally named "@opencodedesktop").
      candidates.push(
        join(
          env.LOCALAPPDATA,
          "Programs",
          "@opencodedesktop",
          "resources",
          "app.asar",
        ),
      );
      // Dev / Beta channels (productName "OpenCode Dev" / "OpenCode Beta"
      // in packages/desktop/electron-builder.config.ts on anomalyco/opencode).
      candidates.push(
        join(
          env.LOCALAPPDATA,
          "Programs",
          "OpenCode Dev",
          "resources",
          "app.asar",
        ),
      );
      candidates.push(
        join(
          env.LOCALAPPDATA,
          "Programs",
          "OpenCode Beta",
          "resources",
          "app.asar",
        ),
      );
    }
    // Not produced by the official per-user installer; kept for
    // per-machine / Chocolatey-style installs.
    if (env.PROGRAMFILES)
      candidates.push(join(env.PROGRAMFILES, "OpenCode", "resources", "app.asar"));
    if (env["PROGRAMFILES(X86)"])
      candidates.push(
        join(env["PROGRAMFILES(X86)"], "OpenCode", "resources", "app.asar"),
      );
    // Scoop (Extras bucket) extracts the NSIS payload into its app dir.
    candidates.push(
      join(
        env.USERPROFILE ?? home,
        "scoop",
        "apps",
        "opencode-desktop",
        "current",
        "resources",
        "app.asar",
      ),
    );
  } else {
    candidates.push("/opt/OpenCode/resources/app.asar");
    candidates.push("/usr/lib/OpenCode/resources/app.asar");
    candidates.push("/opt/opencode-desktop/resources/app.asar");
    candidates.push(join(home, ".local/share/opencode-desktop/resources/app.asar"));
  }
  return candidates;
}

export function detectAsarPath() {
  const existing = candidateAsarPaths().filter((c) => {
    try {
      return fs.existsSync(c);
    } catch {
      return false;
    }
  });
  if (!existing.length) return null;
  // Prefer an archive that actually looks like OpenCode desktop; fall back
  // to the first existing path (legacy behavior) so a future package.json
  // rename can never make detection worse — findIndexInAsar will then
  // produce the rich diagnostic error instead of a silent miss.
  const valid = existing.find((c) => {
    try {
      return inspectAsarIdentity(c).ok;
    } catch {
      return false;
    }
  });
  return valid ?? existing[0];
}

/** Per-candidate status for --probe output and miss diagnostics. */
export function describeCandidates() {
  return candidateAsarPaths().map((c) => {
    let exists = false;
    try {
      exists = fs.existsSync(c);
    } catch {
      exists = false;
    }
    if (!exists) return { path: c, exists: false, ok: null, reason: "not found" };
    try {
      const id = inspectAsarIdentity(c);
      return { path: c, exists: true, ok: id.ok, reason: id.reason, pkg: id.pkg };
    } catch (e) {
      return { path: c, exists: true, ok: false, reason: e.message };
    }
  });
}

/**
 * Read the package.json identity out of an asar without extracting it.
 * Returns { ok, reason, pkg } — ok means the archive looks like the
 * OpenCode desktop app. Lenient on purpose: name must mention opencode
 * plus a desktop/out-main signal. Anything else is reported, not thrown.
 */
export function inspectAsarIdentity(asarPath) {
  let pkg;
  try {
    asar.uncache(asarPath);
    pkg = JSON.parse(asar.extractFile(asarPath, "package.json").toString("utf8"));
  } catch (e) {
    return { ok: false, reason: `no readable package.json in archive (${e.message})`, pkg: null };
  }
  const name = String(pkg.name ?? "");
  const main = String(pkg.main ?? "");
  const version = pkg.version != null ? String(pkg.version) : "";
  const identity = {
    name: name || "(unnamed)",
    version: version || "(no version)",
    main: main || "(no main)",
  };
  const mentionsOpencode = /opencode/i.test(name);
  const desktopSignal =
    /desktop/i.test(name) || /out\/main|dist[\\/].*main|out-main/i.test(main);
  if (mentionsOpencode && desktopSignal)
    return { ok: true, reason: "looks like OpenCode desktop", pkg: identity };
  const label = `${identity.name} ${identity.version} (main: ${identity.main})`;
  return { ok: false, reason: `package.json is ${label} — not OpenCode desktop`, pkg: identity };
}

/**
 * Summarize an asar's layout for diagnostics (never throws). Used when
 * the renderer entry cannot be found, and by the --probe flag.
 */
export function describeAsar(asarPath, { sampleLimit = 15 } = {}) {
  const desc = {
    path: asarPath,
    totalFiles: 0,
    rootDirs: [],
    htmlFiles: [],
    ocThemeFiles: [],
    rendererSamples: [],
    pkg: null,
    error: null,
  };
  try {
    asar.uncache(asarPath);
    const files = asar
      .listPackage(asarPath)
      .map((f) => f.replace(/^\/+/, "").replace(/\\/g, "/"));
    desc.totalFiles = files.length;
    desc.rootDirs = [...new Set(files.map((f) => f.split("/")[0]))].slice(0, 20);
    desc.htmlFiles = files.filter((f) => /\.html?$/i.test(f)).slice(0, sampleLimit);
    desc.ocThemeFiles = files.filter((f) => f.includes("oc-theme")).slice(0, sampleLimit);
    desc.rendererSamples = files
      .filter((f) => !f.startsWith("node_modules/"))
      .filter((f) => /renderer|(^|\/)dist\//.test(f))
      .slice(0, sampleLimit);
    try {
      asar.uncache(asarPath);
      const pkg = JSON.parse(asar.extractFile(asarPath, "package.json").toString("utf8"));
      desc.pkg = {
        name: String(pkg.name ?? "(unnamed)"),
        version: String(pkg.version ?? "(no version)"),
        main: String(pkg.main ?? "(no main)"),
      };
    } catch {
      desc.pkg = null;
    }
  } catch (e) {
    desc.error = e.message;
  }
  return desc;
}

/** One-block human rendering of describeAsar() for errors and --probe. */
export function formatAsarDescription(desc) {
  const lines = [];
  lines.push(`archive: ${desc.path}`);
  if (desc.error) {
    lines.push(`cannot list archive: ${desc.error}`);
    return lines.join("\n");
  }
  lines.push(`files: ${desc.totalFiles}`);
  if (desc.pkg) lines.push(`package.json: ${desc.pkg.name} ${desc.pkg.version} (main: ${desc.pkg.main})`);
  else lines.push(`package.json: (unreadable — probably not an Electron app.asar)`);
  lines.push(`top-level dirs: ${desc.rootDirs.join(", ") || "(none)"}`);
  lines.push(
    desc.htmlFiles.length
      ? `html files (${desc.htmlFiles.length} shown): ${desc.htmlFiles.join(", ")}`
      : `html files: none`,
  );
  lines.push(
    desc.ocThemeFiles.length
      ? `oc-theme files: ${desc.ocThemeFiles.join(", ")}`
      : `oc-theme files: none`,
  );
  if (desc.rendererSamples.length)
    lines.push(`renderer/dist samples: ${desc.rendererSamples.join(", ")}`);
  return lines.join("\n");
}

/**
 * Detect an OpenCode install that exists but cannot be patched in place
 * (read-only squashfs): an AppImage, or the snap package. Returns
 * { kind, path } or null. These need a clear error, not a silent miss.
 */
export function detectUnpatchableInstall(platform = os.platform()) {
  if (platform === "win32" || platform === "darwin") return null;
  const found = path.posix.join(os.homedir(), "Applications", "OpenCode.AppImage");
  if (fs.existsSync(found)) return { kind: "AppImage", path: found };
  if (fs.existsSync("/snap/opencode")) return { kind: "snap", path: "/snap/opencode" };
  return null;
}

export function backupPath(asarPath) {
  return `${asarPath}.bak`;
}

export function hasBackup(asarPath) {
  return fs.existsSync(backupPath(asarPath));
}

/**
 * Locate the renderer entry inside app.asar. Bundle layouts differ
 * between distributions, so the search is layered:
 *   1. index.html carrying our stable anchor (oc-theme-preload-script),
 *   2. any *.html carrying an oc-theme-preload signal (anchor renames),
 *   3. otherwise throw with a full archive description so the reporter
 *      can paste actionable diagnostics instead of "unsupported version".
 * Returns the posix path in the archive.
 */
export function findIndexInAsar(asarPath) {
  let files;
  try {
    asar.uncache(asarPath);
    files = asar.listPackage(asarPath);
  } catch (e) {
    throw new Error(`Cannot read archive ${asarPath}: ${e.message}`);
  }
  const norm = files.map((f) => f.replace(/^\/+/, "").replace(/\\/g, "/"));
  const isIndex = (f) => /(^|\/)index\.html?$/i.test(f);
  const isHtml = (f) => /\.html?$/i.test(f);
  const read = (entry) => {
    asar.uncache(asarPath);
    return asar.extractFile(asarPath, entry).toString("utf8");
  };
  const hasAnchor = (html) => html.includes("oc-theme-preload-script");
  const hasPreloadSignal = (html) => /oc-theme-preload/i.test(html);

  const indexes = norm.filter(isIndex);
  for (const idx of indexes) {
    try {
      if (hasAnchor(read(idx))) return idx;
    } catch {
      // unreadable entry — keep scanning
    }
  }
  // Anchor renamed or entry renamed: any html with the preload signal wins.
  for (const h of norm.filter(isHtml)) {
    if (isIndex(h)) continue; // already scanned above
    try {
      if (hasAnchor(read(h)) || hasPreloadSignal(read(h))) return h;
    } catch {
      // unreadable entry — keep scanning
    }
  }
  // Re-scan index.html files for the looser signal before giving up
  // (covers the case where the id was renamed but the file was not).
  for (const idx of indexes) {
    try {
      if (hasPreloadSignal(read(idx))) return idx;
    } catch {
      // unreadable entry — keep scanning
    }
  }
  const desc = describeAsar(asarPath);
  throw new Error(
    `No patchable renderer entry (oc-theme-preload anchor) found in ${asarPath}.\n` +
      `${formatAsarDescription(desc)}\n` +
      `Unsupported OpenCode version, or this app.asar is not the OpenCode desktop app. ` +
      `Re-run with --probe and paste the output in an issue, or point --path at the real OpenCode app.asar.`,
  );
}

function readIndex(asarPath, indexInAsar) {
  asar.uncache(asarPath);
  return asar.extractFile(asarPath, indexInAsar).toString("utf8");
}

export function isPatched(asarPath) {
  try {
    return readIndex(asarPath, findIndexInAsar(asarPath)).includes(MARKER_HTML);
  } catch {
    return false;
  }
}

/** Remove our tags from an index.html string. Returns { clean, removed }. */
export function stripPatch(html) {
  let removed = false;
  let clean = html;
  // Our injected block: marker comment + link + script lines
  const lines = clean.split("\n");
  const kept = lines.filter((line) => {
    if (
      line.includes(MARKER_HTML) ||
      line.includes(RTL_JS) ||
      line.includes(RTL_CSS) ||
      line.includes("OPENCODE_RTL")
    ) {
      removed = true;
      return false;
    }
    return true;
  });
  clean = kept.join("\n");
  return { clean, removed };
}

function rtlTags() {
  return [
    `    ${MARKER_HTML}`,
    `    <link rel="stylesheet" href="./${RTL_CSS}">`,
    `    <script src="./${RTL_JS}"></script>`,
  ].join("\n");
}

/** Insert our tags after the oc-theme-preload script line (stable anchor). */
export function injectTags(html) {
  const { clean } = stripPatch(html);
  if (clean.includes(ANCHOR)) {
    return clean.replace(ANCHOR, `${ANCHOR}\n${rtlTags()}`);
  }
  // Anchor renamed slightly (quotes/attr order): any script tag loading
  // oc-theme-preload.js still marks the same spot.
  const loose = clean.match(/<script[^>]*oc-theme-preload\.js[^>]*>\s*<\/script>/i);
  if (loose) {
    return clean.replace(loose[0], `${loose[0]}\n${rtlTags()}`);
  }
  throw new Error(
    "Injection anchor not found in renderer entry (oc-theme-preload). Unsupported OpenCode version.",
  );
}

export async function patch(asarPath, assetsDir, { onStep = () => {} } = {}) {
  const backup = backupPath(asarPath);
  const extractDir = path.join(path.dirname(asarPath), "app-extracted-oc-rtl-temp");

  fs.accessSync(path.dirname(asarPath), fs.constants.W_OK);

  // 0. Resolve the bundle layout first (fail fast, before touching anything)
  onStep("locating renderer index.html");
  const indexInAsar = findIndexInAsar(asarPath);
  const dirParts = path.posix.dirname(indexInAsar).split("/").filter(Boolean);
  const inExtract = (...parts) => path.join(extractDir, ...dirParts, ...parts);

  // 1. Ensure clean backup
  onStep("checking backup");
  const currentHtml = readIndex(asarPath, indexInAsar);
  const alreadyPatched = currentHtml.includes(MARKER_HTML);
  if (!alreadyPatched) {
    fs.copyFileSync(asarPath, backup);
    asar.uncache(backup);
  } else if (!fs.existsSync(backup)) {
    // Rebuild a clean backup from the stripped current html (best effort)
    onStep("rebuilding clean backup from stripped html");
  }

  // 2. Extract
  onStep("extracting app.asar (takes a few seconds)");
  fs.rmSync(extractDir, { recursive: true, force: true });
  asar.extractAll(asarPath, extractDir);

  // If backup was missing and current was patched, fix backup after extract
  const indexPath = inExtract("index.html");
  let html = fs.readFileSync(indexPath, "utf8");
  if (alreadyPatched && !fs.existsSync(backup)) {
    const { clean } = stripPatch(html);
    fs.writeFileSync(indexPath, clean);
    // remove our asset files from extract before backing up
    for (const f of [RTL_JS, RTL_CSS, FONT_FILE]) {
      fs.rmSync(inExtract(f), { force: true });
    }
    await asar.createPackage(extractDir, backup);
    asar.uncache(backup);
    html = clean;
  }

  // Drop legacy artifacts from older patch versions (font is embedded now).
  fs.rmSync(inExtract(FONT_FILE), { force: true });
  onStep("injecting RTL (font embedded offline)");
  html = fs.readFileSync(indexPath, "utf8");
  fs.writeFileSync(indexPath, injectTags(html));
  // JS payload as-is.
  fs.copyFileSync(path.join(assetsDir, RTL_JS), inExtract(RTL_JS));
  // CSS template + base64-embedded font (no extra file request at runtime,
  // immune to file-protocol quirks — same approach as antigravity-rtl).
  const cssTemplate = fs.readFileSync(path.join(assetsDir, CSS_TEMPLATE), "utf8");
  if (!cssTemplate.includes(FONT_PLACEHOLDER)) {
    throw new Error(`CSS template is missing the ${FONT_PLACEHOLDER} placeholder.`);
  }
  const fontB64 = fs.readFileSync(path.join(assetsDir, FONT_FILE)).toString("base64");
  if (fontB64.length < 10_000) {
    throw new Error("Vazirmatn font file looks corrupt (too small). Re-download it.");
  }
  fs.writeFileSync(
    inExtract(RTL_CSS),
    cssTemplate.replace(FONT_PLACEHOLDER, fontB64),
  );

  // 4. Repack
  onStep("repacking app.asar");
  await asar.createPackage(extractDir, asarPath);
  asar.uncache(asarPath);
  fs.rmSync(extractDir, { recursive: true, force: true });
}

export function restore(asarPath) {
  const backup = backupPath(asarPath);
  if (!fs.existsSync(backup)) {
    throw new Error("No backup found (app.asar.bak). Nothing to restore.");
  }
  let probe;
  try {
    probe = readIndex(backup, findIndexInAsar(backup));
  } catch {
    throw new Error("Backup is unreadable or unsupported. Reinstall OpenCode, then patch again.");
  }
  if (probe.includes(MARKER_HTML)) {
    throw new Error("Backup is itself patched. Reinstall OpenCode, then patch again.");
  }
  fs.copyFileSync(backup, asarPath);
  asar.uncache(asarPath);
  fs.unlinkSync(backup);
}
