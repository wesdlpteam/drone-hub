# Official CoDrone Blockly parity + 2-level editor (2026-08-20)

Addendum to 2026-08-19-ozobot-blockly-editor-design.md. Nathan's brief (chat 2026-08-20):
scan https://codrone.robolink.com/edu/blockly/, match its full block set and its visual
layout (toolbox/workspace proportions, small Run/Land/Stop header buttons, bottom-left
drone-connected box), and collapse 5 levels to 2: Level 1 picture blocks, Level 2 all
official blocks.

## Source inventory

Live scan of the official app (13 toolbox categories, block types + wording) captured to
scratchpad robolink-blocks.json; cross-checked against
https://docs.robolink.com/docs/CoDroneEDU/Blockly/Block-Documentation.
Layout reference screenshot: output/playwright/robolink-layout-ipad.png.

## Levels

- Level 1 "Pictures": emoji-forward simple blocks (take off, land, go, turn, hover, LED,
  beep, play sound, flip, patterns, repeat). Runs through the existing flat /api/run path
  (validate_step allowlist, 30-step cap, per-step highlight). Old saved levels 2-5 map to 2.
- Level 2 "All blocks": the official catalogue. Standard Blockly categories (Control,
  Math, Variables, Functions, Data Structures, Console text blocks) are stock Blockly
  blocks. Drone categories (Events start hat, Flight Commands, Flight Sequences, Lights
  and Sounds, Sensors) are custom blocks with official wording.

## Level 2 execution (same model as the official app)

Blocks compile to JavaScript (bundled Blockly JS generator) and run in a sandboxed
JS-Interpreter (vendored js-interpreter.js, no DOM/network access). Bindings:

- droneAction(action, value): POST /api/command (existing pilot-token + allowlist +
  clamps), then poll /api/status until the drone is idle. Hard cap: 30 drone actions per
  run, mirroring MAX_PROGRAM_STEPS.
- sensor reads: GET-style POST /api/sensors -> safe dict from the backend; unit
  conversions client-side.
- wait n seconds: abortable client sleep, clamped 0-10 s.
- print: writes to an on-page console panel. No server involvement.
- Interpreter step budget (guards while(true)), teacher pause / STOP / hub-offline all
  abort the run. Blockly Python generator (vendored blockly-python.min.js) renders the
  live Python panel for every block.

## Safety (unchanged caps)

Moves 20-150 cm, turns 45-180 deg, hover 1-5 s, 30 steps, queue 10: untouched, still
enforced in validate_step and drone_backend. New actions get conservative new clamps:
goto x/y +/-150 cm z 50-150 cm; turn_power / set roll-pitch-yaw-throttle power capped
(RPYT +/-30), timed moves 0.2-3 s; keep_distance mirrors avoid_wall; LED/buzzer value
ranges validated. /api/sensors is read-only.

## Parity exclusions (reported to Nathan)

- Controller category (screen drawing, buttons, joystick): the controller is plugged
  into the hub laptop, not held by the student.
- Color Data (load dataset / predict color): needs Robolink's colour-training tool.
- Keyboard events (when key press / get key input): iPads have no keyboard; the start
  hat block ("when Run tapped") is the entry event instead.
- File tabs (main.xml), backpack: file management, not blocks.

## Visual match

Dark navy theme like the official app: left toolbox (~19% width) with coloured circle
icons per category, blue selected row; dark grid workspace with Blockly zoom controls +
trashcan; small pill Run / Land / Stop buttons in the CODE header; bottom-left box under
the toolbox showing "no drone connected" (red) or the picked drone + pilot (green) with
a Connect button opening the drone picker; collapsible Console / Python bottom panel.

## Files

blocks-data.js (full block set, 2-level toolboxes, note/unit tables, save migration),
program-runner.js (new: JS+Python generators for custom blocks, run engine, sensor
conversions), editor.js (theme, grid, 2 levels, run wiring, panels, connection box),
app.js (status hook), index.html, style.css, sw.js (SHELL_CACHE v8 + new vendored
assets), server.py (allowlist additions, /api/sensors, per-unit io lock), and
drone_backend.py (new methods on PracticeDrone and RealDrone). Old saved workspaces
keep loading: existing block type names and field values stay valid.
