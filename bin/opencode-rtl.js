#!/usr/bin/env node
// opencode-rtl — UI-only RTL patcher for the OpenCode desktop app.
// Cross-platform (macOS / Windows / Linux): patches the installed app's
// app.asar in place, no per-repo changes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectAsarPath,
  describeCandidates,
  describeAsar,
  formatAsarDescription,
  inspectAsarIdentity,
  detectUnpatchableInstall,
  isPatched,
  hasBackup,
  patch,
  restore,
} from "../lib/patch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, "..", "assets");
const args = process.argv.slice(2);

function help() {
  console.log(`opencode-rtl — UI-only RTL patch for the OpenCode desktop app

Usage:
  opencode-rtl                  Patch auto-detected OpenCode install
  opencode-rtl --status         Show patch status
  opencode-rtl --probe          Diagnose: list searched paths and describe
                               the detected app.asar (paste the output
                               when reporting a patch failure)
  opencode-rtl --restore        Restore original app.asar from backup
  opencode-rtl --path <asar>    Use a custom app.asar path
  opencode-rtl -h | --help      This help

Default app.asar locations:
  macOS:   /Applications/OpenCode.app/Contents/Resources/app.asar
  Windows: %LOCALAPPDATA%\\Programs\\OpenCode\\resources\\app.asar
            (%LOCALAPPDATA%\\Programs\\@opencodedesktop\\…,
             %PROGRAMFILES%\\OpenCode\\… and Scoop
             %USERPROFILE%\\scoop\\apps\\opencode-desktop\\current\\…
             are also searched)
  Linux:   /opt/OpenCode/resources/app.asar (.deb; .rpm under /usr/lib)

Notes:
  • Quit OpenCode before patching (a running app locks app.asar,
    especially on Windows) and restart it afterwards.
  • Re-run after every OpenCode update (updates overwrite app.asar).
  • AppImage and snap installs are read-only squashfs and cannot be
    patched in place — use the .deb/.rpm/tarball, or point --path at
    an extracted copy.
  • If permission is denied:
      macOS:   System Settings > Privacy & Security > App Management
               for your terminal (sudo not required).
      Windows: quit OpenCode, then re-run; if still denied, run the
               terminal as Administrator.
      Linux:   /opt and /usr are root-owned — re-run with sudo.
  • UI-only: no model, prompt, or tool-output changes.
  • Settings persist in the app's localStorage (global across repos).
`);
}

function resolveAsar() {
  const i = args.indexOf("--path");
  if (i !== -1 && args[i + 1]) return args[i + 1];
  const found = detectAsarPath();
  if (!found) {
    console.error("Could not locate OpenCode app.asar. Searched:");
    for (const c of describeCandidates())
      console.error(`  ${c.exists ? "[found] " : "  [missing] "}${c.path}${c.exists ? ` — ${c.reason}` : ""}`);
    const blocked = detectUnpatchableInstall();
    if (blocked?.kind === "AppImage") {
      console.error(`\nFound an AppImage at ${blocked.path}, but AppImages are`);
      console.error("read-only squashfs and cannot be patched in place.");
      console.error("Use the .deb/.rpm/tarball install instead, or --path <.../app.asar>.");
    } else if (blocked?.kind === "snap") {
      console.error(`\nFound a snap install at ${blocked.path}, but snaps are`);
      console.error("read-only squashfs and cannot be patched in place.");
      console.error("Use the .deb/.rpm/tarball install instead, or --path <.../app.asar>.");
    } else {
      console.error("Pass --path <.../app.asar> to point at your install.");
    }
    process.exit(1);
  }
  return found;
}

function warnIfSuspiciousAsar(asarPath) {
  let id;
  try {
    id = inspectAsarIdentity(asarPath);
  } catch {
    return;
  }
  if (!id.ok)
    console.log(
      `Note: ${asarPath}\n  does not look like the OpenCode desktop app (${id.reason}).\n` +
        `  Trying anyway — if the patch fails, run with --probe and use --path <.../app.asar>.`,
    );
}

if (args.includes("-h") || args.includes("--help")) {
  help();
  process.exit(0);
}

if (args.includes("--status")) {
  const asar = resolveAsar();
  console.log(`asar:    ${asar}`);
  console.log(`patched: ${isPatched(asar) ? "yes" : "no"}`);
  console.log(`backup:  ${hasBackup(asar) ? "present" : "absent"}`);
  process.exit(0);
}

if (args.includes("--probe")) {
  console.log("Searched app.asar paths:");
  for (const c of describeCandidates())
    console.log(
      `  ${c.exists ? (c.ok ? "[found] " : "[found?]") : "[missing]"} ${c.path}${c.exists ? ` — ${c.reason}` : ""}`,
    );
  const i = args.indexOf("--path");
  const target = (i !== -1 && args[i + 1]) || detectAsarPath();
  if (!target) {
    console.log("\nNo existing app.asar to describe. Pass --path <.../app.asar>.");
    process.exit(0);
  }
  console.log(`\n${formatAsarDescription(describeAsar(target))}`);
  console.log(`\npatched: ${isPatched(target) ? "yes" : "no"}`);
  console.log(`backup:  ${hasBackup(target) ? "present" : "absent"}`);
  process.exit(0);
}

if (args.includes("--restore") || args.includes("-r")) {
  const asar = resolveAsar();
  try {
    restore(asar);
    console.log("Restored original OpenCode. Please restart the app.");
  } catch (e) {
    console.error(`Restore failed: ${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// default: patch
const asar = resolveAsar();
warnIfSuspiciousAsar(asar);
if (/\.appimage$/i.test(asar) || /(^|\/)snap\//.test(asar)) {
  console.error(`\n${asar} looks like an AppImage/snap install, which is read-only`);
  console.error("squashfs and cannot be patched in place.");
  console.error("Use the .deb/.rpm/tarball install instead, or --path <.../app.asar>.");
  process.exit(1);
}
console.log(`Patching ${asar} ...`);
console.log("Make sure OpenCode is quit first.");
try {
  await patch(asar, ASSETS, { onStep: (s) => console.log(`… ${s}`) });
  console.log("\nPatched! Restart OpenCode to enjoy RTL.");
  console.log("Toggle: Alt+R (Option+R on macOS). Re-run after each OpenCode update.");
} catch (e) {
  const msg = e.message ?? String(e);
  const locked = /EBUSY|resource busy/i.test(msg);
  const denied = /EACCES|EPERM|Permission denied|operation not permitted/i.test(msg);
  const readOnly = /EROFS|read-only file system/i.test(msg);
  if (readOnly) {
    console.error("\nRead-only filesystem — is this an AppImage or snap install?");
    console.error("Those are read-only squashfs and cannot be patched in place.");
    console.error("Use the .deb/.rpm/tarball install instead, or --path <.../app.asar>.");
  } else if (locked) {
    console.error("\napp.asar is locked — OpenCode (or an antivirus) is holding it.");
    console.error("Quit OpenCode completely and run again.");
    if (os.platform() === "win32")
      console.error("If it is already quit, re-run this terminal as Administrator.");
  } else if (denied) {
    if (os.platform() === "darwin") {
      console.error("\nPermission denied.");
      console.error("macOS: give your terminal App Management permission:");
      console.error("  System Settings > Privacy & Security > App Management");
      console.error("Then run again (sudo not required for /Applications if you own it).");
    } else if (os.platform() === "win32") {
      console.error("\nPermission denied.");
      console.error("Quit OpenCode, then re-run. If it still fails, run this");
      console.error("terminal as Administrator and try again.");
    } else {
      console.error("\nPermission denied.");
      if (asar.startsWith("/opt/") || asar.startsWith("/usr/"))
        console.error("That path is root-owned — re-run with sudo and try again.");
      else console.error("Check the file owner, or re-run with sudo, and try again.");
    }
  } else {
    console.error(`\nPatch failed: ${msg}`);
    console.error("Run with --probe and paste the output when reporting this,");
    console.error("or point --path at the real OpenCode app.asar.");
  }
  if (fs.existsSync(path.join(path.dirname(asar), "app-extracted-oc-rtl-temp"))) {
    fs.rmSync(path.join(path.dirname(asar), "app-extracted-oc-rtl-temp"), {
      recursive: true,
      force: true,
    });
  }
  process.exit(1);
}
