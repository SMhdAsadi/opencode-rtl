# opencode-rtl

UI-only RTL patcher for the **OpenCode desktop app** (macOS, Windows, Linux). Inspired by
[`antigravity-rtl`](https://github.com/mmnaderi/antigravity-rtl).

- Content-aware direction: each paragraph, list, table, and quote follows its
  own token-majority script, code excluded from the vote (so `[x] کار فارسی`
  and `روال ویرآوا (CloudMeeting)` flip RTL, pure-English stays LTR)
- Leading `>` / `<` markers are LTR-isolated so bidi never mirrors them;
  leading number runs (`۱۲. عنوان`) are pinned to the line start
- Code blocks, terminal, editor, diffs always stay LTR (real monospace stack)
- Offline Vazirmatn font, base64-embedded in the stylesheet (no extra request)
- Hover the `RTL` pill to see font status (`Vazirmatn OK` vs `MISSING`)
- Floating `RTL` pill (bottom corner) opens a settings popup: on/off and
  Force-RTL switches, font status, all shortcuts listed, debug snapshot copy
- Hover-free: no guessing — every shortcut is shown in the popup
- Settings persist in the app's localStorage → global across all repos
- **UI-only**: no model, prompt, instruction, or tool-output changes

## Usage

```sh
cd ~/tools/opencode-rtl
bun install          # once (@electron/asar)

bun bin/opencode-rtl.js            # patch (quit OpenCode first)
bun bin/opencode-rtl.js --status   # check state
bun bin/opencode-rtl.js --restore  # revert to original
```

Requires Node 22.12+.

## Install locations

Auto-detection searches these `app.asar` paths (override with
`--path <.../app.asar>`):

| OS      | Default path                                              | Source    |
| ------- | --------------------------------------------------------- | --------- |
| macOS   | `/Applications/OpenCode.app/Contents/Resources/app.asar`  | DMG / brew |
| Windows | `%LOCALAPPDATA%\Programs\OpenCode\resources\app.asar`     | official installer (NSIS per-user) |
| Windows | `%USERPROFILE%\scoop\apps\opencode-desktop\current\resources\app.asar` | Scoop |
| Windows | `%PROGRAMFILES%\OpenCode\resources\app.asar`              | fallback (per-machine installs) |
| Linux   | `/opt/OpenCode/resources/app.asar`                        | .deb |
| Linux   | `/usr/lib/OpenCode/resources/app.asar`                    | .rpm fallback |

AppImage (`~/Applications/OpenCode.AppImage`, incl. the Homebrew cask) and
snap (`/snap/opencode`) installs are read-only squashfs and **cannot** be
patched in place — the tool errors out clearly. Use the .deb/.rpm/tarball
install instead, or point `--path` at an extracted copy.

## Permissions

- **macOS:** on *Permission Denied*, enable **System Settings → Privacy &
  Security → App Management** for your terminal (sudo not required).
- **Windows:** quit OpenCode first — a running app (or antivirus) locks
  `app.asar` (`EBUSY`). If access is still denied, run the terminal as
  Administrator.
- **Linux:** `/opt` and `/usr` are root-owned — re-run with `sudo`.

On detection failure the tool prints every path it searched.

## Notes

- Quit OpenCode before patching; restart it afterwards.
- Re-run after every OpenCode update (updates overwrite `app.asar`).
- A clean backup is kept next to the asar (`app.asar.bak`) — e.g.
  `.../Resources/app.asar.bak` on macOS, `.../resources/app.asar.bak`
  on Windows/Linux. The backup is never overwritten once it exists, and
  restore refuses a backup that is itself patched.
- Never run this from inside a repo you care about — it only touches the
  installed OpenCode app, nothing project-local.
- Tool call groups already collapse natively in OpenCode, so this patch only
  collapses Thinking rows (hooked on the stable `data-timeline-row="Thinking"`
  attribute — no fragile text matching).
