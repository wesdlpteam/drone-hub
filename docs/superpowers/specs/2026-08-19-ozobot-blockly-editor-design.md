# Ozobot-style Blockly editor for the CODE tab — design

Date: 2026-08-19
Status: approved in chat (Nathan, 2026-08-19). Implementation writer: Claude (Nathan's
explicit choice, break-glass flag set 2026-08-19, 96 h).

## Goal

Replace the hand-rolled CODE-tab block editor with Google Blockly, themed and laid out
to match Ozobot's Blockly editor (reference screenshot supplied by Nathan): left
sidebar with level picker and colour-coded categories, puzzle-piece blocks that snap
together vertically, inline dropdown/number pills, dark workspace, collapsible
sidebar. The CODE tab requires landscape on iPad (rotate cover in portrait).

Decisions made with Nathan:

1. Use the real Blockly engine (vendored, offline) — not a hand-built lookalike.
2. Keep the existing drone block set, 5 cumulative levels, and safety caps
   unchanged; only the presentation/interaction changes.
3. Landscape rule applies to the CODE tab only. FLY tab, drone picker and Teacher
   Screen are untouched.

## Constraints (unchanged project rules)

- Server stays Python stdlib only; no server-side changes beyond serving new static
  files. `/api/run` contract and `validate_step()` allowlist unchanged.
- Frontend stays no-build vanilla JS. Blockly is vendored as static files (same
  pattern as `qrcode.js`), MIT licence, pinned version, no CDN at runtime.
- Fully offline in class. PWA shell keeps working: new assets added to `sw.js`
  APP_SHELL and `SHELL_CACHE` bumped.
- Safety caps stay: 20–150 cm, 45–180°, hover 1–5 s, ≤30 flattened steps, queue
  cap. Block fields constrain input client-side; server clamps remain authoritative.

## Architecture

### New files

- `drone_hub/static/blockly.min.js` — vendored Blockly core+blocks+en messages
  (single UMD bundle, pinned version noted in a header comment).
- `drone_hub/static/editor.js` — all Blockly integration (block definitions, theme,
  toolbox, serialization, program extraction, run-highlight, landscape gate).
  `app.js` keeps FLY tab, status polling, radar, picker, PWA install; its old
  editor code (palette, program list, pointer drag, ~lines 296–1000) is removed.
- `server.py` STATIC_FILES gains the two new entries. `index.html` loads
  `editor.js` after `app.js`.

### Block definitions

One Blockly block type per existing `BLOCK_DEFS` entry, same categories
(Flight, Movement, Lights, Sound, Timing, Loops, Sensors, Logic, Tricks) and the
same `minLevel` gating. Parameters become inline fields on the block
(`field_dropdown` for choices like Ozobot's pills, `field_number`/dropdown steps for
distance/angle/seconds within the safety ranges). Level 1 keeps picture-first fixed
values (no editable fields). `repeat_start`/`repeat_end` are replaced by one proper
C-shaped `repeat N times` statement block (Blockly native); extraction flattens it.
Sensor blocks (`if_wall`, `if_height`) keep their single-reaction dropdown form —
no free nesting beyond what the server accepts today.

### Look (matching the screenshot)

- Custom Blockly theme: dark workspace, no grid dots, category colours reused from
  `CODE_CATEGORIES`. Zelos renderer with adjusted constants (rounded corners,
  medium block height, notch style) to sit as close to Ozobot's look as Blockly's
  renderer constants allow.
- Left sidebar (custom HTML, not Blockly's default toolbox chrome): level squares
  1–5 at top, then category rows (colour bar + icon + name) that open Blockly's
  flyout. Collapse/expand arrow like Ozobot's. Level hints stay, shown compactly.
- Header strip keeps: drone/pilot status, EXECUTE PLAN, block count `n/30`,
  saved-state tick. Big STOP bar unchanged.
- Level 5 Python panel stays, regenerated from the workspace on change.

### Program flow (unchanged contract)

Workspace stack (top-level blocks in vertical order) → flatten loops → array of
`{action, value}` steps → existing validation → `POST /api/run`. Step count shown
against the 30-step cap after flattening. While running, `/api/status` step index
maps to block ids (flat map rebuilt at run time) and the active block is
highlighted via `workspace.highlightBlock`.

### Saving and migration

- Workspace saved to localStorage via `Blockly.serialization` under a new key
  `dronePilotBlocklyV1`, debounced on change (same offline-guarantee behaviour:
  plan survives hub dropouts; controls lock while disconnected).
- One-time migration: if `dronePilotProgramV1` exists and the new key does not,
  convert the old step list into equivalent blocks (1:1 action mapping;
  repeat_start/end pairs become the new repeat block), then keep the old key as
  backup. No child loses a saved plan.

### Landscape gate (CODE tab only)

CSS `orientation: portrait` media query + JS check while the CODE tab is active
shows a full-screen friendly "Turn your iPad sideways" cover (icon + one line, big
text, no jargon). Cover hides on rotate; Blockly `svgResize` is called on
orientation/resize. FLY, picker and Teacher Screen unaffected. Desktop windows
narrower-than-tall get the same cover only in the CODE tab.

### Error handling

- Blockly script fails to load (corrupted cache, partial copy): CODE tab shows a
  plain-English "coding blocks couldn't load — refresh" message; FLY tab unaffected.
- Migration failure: fall back to an empty workspace, old key preserved, console
  warning; never block the tab.
- Hub offline: existing banner + control locking behaviour retained; editing and
  saving still work.

## Addendum (2026-08-19, during build)

Nathan asked mid-build to match the blocks to Robolink's official CoDrone EDU
Blockly (codrone.robolink.com/edu/blockly). Implemented: one `go [direction] N cm`
block and one `turn [left/right] N degrees` block with dropdowns (replacing eight
separate move/turn blocks), and official wording ("hover for N second(s)",
"play this note X for N ms", "avoid wall at N cm for N second(s)",
"set LED color to X", plain "take off"/"land", "[right] circle/triangle/square",
plain "sway"). All safety caps unchanged. Level 1 now includes all six go
directions via the dropdown (still clamped 20-150 cm). Official-only features
(coordinates, variables, functions, events, controller/console blocks) remain out
of scope — the Hub's validated step model doesn't support them.

## Out of scope

FLY tab, Teacher Screen, server API, bat launchers, packaging/download page. Any
new block types beyond the existing set.

## Verification

Playwright against `python drone_hub/server.py --practice --no-browser`:

1. Desktop 1440×900 and iPad 1024×768 landscape: sidebar, categories, flyout,
   drag-from-flyout, snap two blocks, edit a dropdown pill, screenshots reviewed.
2. iPad portrait 768×1024: rotate cover appears on CODE tab only; FLY tab usable.
3. Run a 4-step plan incl. a repeat block on a virtual drone; confirm queued steps,
   running-block highlight, `n/30` count of flattened steps.
4. Migration: seed `dronePilotProgramV1` in localStorage, reload, old plan appears
   as blocks.
5. Level switch 1→5: toolbox contents change, plan preserved, Python panel at 5.
6. Offline shell: service worker updated (`SHELL_CACHE` bumped), page reloads with
   hub stopped show the offline banner, not a broken editor.
7. Browser console clean of errors in all of the above.
