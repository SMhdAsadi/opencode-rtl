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

const INDEX_IN_ASAR = "out/renderer/index.html";

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
  return candidateAsarPaths().find((c) => fs.existsSync(c)) ?? null;
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

function readIndex(asarPath) {
  asar.uncache(asarPath);
  return asar.extractFile(asarPath, INDEX_IN_ASAR).toString("utf8");
}

export function isPatched(asarPath) {
  try {
    return readIndex(asarPath).includes(MARKER_HTML);
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
  const anchor = '<script id="oc-theme-preload-script" src="./oc-theme-preload.js"></script>';
  if (!clean.includes(anchor)) {
    throw new Error(
      "Injection anchor not found in index.html (oc-theme-preload-script). Unsupported OpenCode version.",
    );
  }
  return clean.replace(anchor, `${anchor}\n${rtlTags()}`);
}

export async function patch(asarPath, assetsDir, { onStep = () => {} } = {}) {
  const backup = backupPath(asarPath);
  const extractDir = path.join(path.dirname(asarPath), "app-extracted-oc-rtl-temp");

  fs.accessSync(path.dirname(asarPath), fs.constants.W_OK);

  // 1. Ensure clean backup
  onStep("checking backup");
  const currentHtml = readIndex(asarPath);
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
  let indexPath = path.join(extractDir, "out", "renderer", "index.html");
  let html = fs.readFileSync(indexPath, "utf8");
  if (alreadyPatched && !fs.existsSync(backup)) {
    const { clean } = stripPatch(html);
    fs.writeFileSync(indexPath, clean);
    // remove our asset files from extract before backing up
    for (const f of [RTL_JS, RTL_CSS, FONT_FILE]) {
      fs.rmSync(path.join(extractDir, "out", "renderer", f), { force: true });
    }
    await asar.createPackage(extractDir, backup);
    asar.uncache(backup);
    html = clean;
  }

  // Drop legacy artifacts from older patch versions (font is embedded now).
  fs.rmSync(path.join(extractDir, "out", "renderer", FONT_FILE), { force: true });
  onStep("injecting RTL (font embedded offline)");
  html = fs.readFileSync(indexPath, "utf8");
  fs.writeFileSync(indexPath, injectTags(html));
  // JS payload as-is.
  fs.copyFileSync(path.join(assetsDir, RTL_JS), path.join(extractDir, "out", "renderer", RTL_JS));
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
    path.join(extractDir, "out", "renderer", RTL_CSS),
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
  const probe = readIndex(backup);
  if (probe.includes(MARKER_HTML)) {
    throw new Error("Backup is itself patched. Reinstall OpenCode, then patch again.");
  }
  fs.copyFileSync(backup, asarPath);
  asar.uncache(asarPath);
  fs.unlinkSync(backup);
}
