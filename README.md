# opencode-rtl

UI-only RTL patcher for the **OpenCode desktop app** (macOS). Inspired by
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

Requires Node 22.12+. On macOS, if you get *Permission Denied*, enable
**System Settings → Privacy & Security → App Management** for your terminal.

## Notes

- Re-run after every OpenCode update (updates overwrite `app.asar`).
- A clean backup is kept at `.../Resources/app.asar.bak`.
- Never run this from inside a repo you care about — it only touches
  `/Applications/OpenCode.app`, nothing project-local.
- Tool call groups already collapse natively in OpenCode, so this patch only
  collapses Thinking rows (hooked on the stable `data-timeline-row="Thinking"`
  attribute — no fragile text matching).
