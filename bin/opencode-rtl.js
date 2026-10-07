#!/usr/bin/env node
// opencode-rtl — UI-only RTL patcher for the OpenCode desktop app.
// Global: patches /Applications/OpenCode.app itself, no per-repo changes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectAsarPath, isPatched, hasBackup, patch, restore } from "../lib/patch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, "..", "assets");
const args = process.argv.slice(2);

function help() {
  console.log(`opencode-rtl — UI-only RTL patch for OpenCode desktop app

Usage:
  opencode-rtl                  Patch auto-detected OpenCode.app
  opencode-rtl --status         Show patch status
  opencode-rtl --restore        Restore original app.asar from backup
  opencode-rtl --path <asar>    Use a custom app.asar path
  opencode-rtl -h | --help      This help

Notes:
  • Quit OpenCode before patching.
  • Re-run after every OpenCode update (updates overwrite app.asar).
  • UI-only: no model, prompt, or tool-output changes.
  • Settings persist in the app's localStorage (global across repos).
`);
}

function resolveAsar() {
  const i = args.indexOf("--path");
  if (i !== -1 && args[i + 1]) return args[i + 1];
  const found = detectAsarPath();
  if (!found) {
    console.error("Could not locate OpenCode app.asar. Pass --path <.../app.asar>.");
    process.exit(1);
  }
  return found;
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
console.log(`Patching ${asar} ...`);
console.log("Make sure OpenCode is quit first.");
try {
  await patch(asar, ASSETS, { onStep: (s) => console.log(`… ${s}`) });
  console.log("\nPatched! Restart OpenCode to enjoy RTL.");
  console.log("Toggle: Alt+R (Option+R on macOS). Re-run after each OpenCode update.");
} catch (e) {
  if (/EACCES|EPERM|Permission denied/i.test(e.message)) {
    console.error("\nPermission denied.");
    console.error("macOS: give your terminal App Management permission:");
    console.error("  System Settings > Privacy & Security > App Management");
    console.error("Then run again (sudo not required for /Applications if you own it).");
  } else {
    console.error(`\nPatch failed: ${e.message}`);
  }
  if (fs.existsSync(path.join(path.dirname(asar), "app-extracted-oc-rtl-temp"))) {
    fs.rmSync(path.join(path.dirname(asar), "app-extracted-oc-rtl-temp"), {
      recursive: true,
      force: true,
    });
  }
  process.exit(1);
}
