# Ozobot-style Blockly Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled CODE-tab block editor with vendored Google Blockly, themed/laid out like Ozobot's editor, with a landscape gate, saved-plan migration, and PWA updates.

**Architecture:** Blockly (single vendored UMD file) is injected into a rebuilt CODE tab. Pure logic (block definitions, toolbox-per-level, workspace→steps flattening, Python preview, old-format migration) lives in a new dependency-free `blocks-data.js` that runs in both browser and Node (unit-testable). Browser-only glue (inject, theme, level switching, persistence, run/highlight, landscape gate) lives in new `editor.js`. `app.js` loses its old editor (~800 lines) and keeps FLY/status/radar/picker, talking to the editor only via `DroneEditor.setRunningStep()` / `DroneEditor.refreshLayout()` / `DroneEditor.init()`.

**Tech Stack:** Python stdlib server (unchanged), vanilla JS, vendored Blockly v12 (zelos renderer, JSON toolbox with `cssconfig`), `node --test` for unit tests, chrome-devtools MCP for browser QA.

**Spec:** `docs/superpowers/specs/2026-08-19-ozobot-blockly-editor-design.md`

## Global Constraints

- Server stays Python stdlib only; `/api/run` contract and `validate_step()` untouched.
- No build step, no npm packages at runtime, no CDN at runtime. Blockly is vendored into `drone_hub/static/`.
- Safety caps in block fields: moves 20–150 cm, turns 45–180°, hover 1–5 s, repeat 2–5×, ≤30 flattened steps. Server clamps stay authoritative.
- All copy shown to kids is plain English, no jargon.
- PWA: every new static file goes into `sw.js` APP_SHELL; bump `SHELL_CACHE` to `drone-pilot-shell-v6`.
- Landscape gate applies to CODE tab only.
- Commit after every task (git add specific files; message style matches repo: short imperative summary).
- Hook note: shell use is restricted — allowed here: `node --check`, `node --test`, `python drone_hub/server.py ...` (break-glass), `curl` GET, `git add/commit/push`, `node <abs path under %TEMP%>.mjs` scratchpad scripts. No `&&`, `;`, pipes or redirects in commands.

**Conscious simplifications vs the old editor (approved direction: identical Ozobot look/feel):**
1. One `drone_flip` block with a direction pill replaces four flip blocks.
2. One `drone_led` block with a named-colour dropdown replaces five preset colour blocks + the L3 colour picker (Blockly v12 has no core colour field; a plugin would break the no-dependency rule).
3. Value pills are visible/editable at every level (Ozobot behaviour). The old `sourceLevel`-gated editability is dropped; levels now only gate which blocks the toolbox offers.
4. Repeat is one C-shaped block (nesting allowed; the 30-step flatten cap still protects the drone) replacing `repeat_start`/`repeat_end` pairs.

---

### Task 1: Vendor Blockly and serve it

**Files:**
- Create: `drone_hub/static/blockly.min.js` (downloaded, ~1 MB)
- Create: `drone_hub/static/blocks-data.js` (stub)
- Create: `drone_hub/static/editor.js` (stub)
- Modify: `drone_hub/server.py:39-50` (STATIC_FILES map)
- Modify: `drone_hub/static/index.html:304` (script tags)
- Modify: `drone_hub/static/sw.js:3-12` (SHELL_CACHE + APP_SHELL)

**Interfaces:**
- Consumes: nothing.
- Produces: `Blockly` global available in the page; `DroneBlocksData` global (empty object for now); `/blockly.min.js`, `/blocks-data.js`, `/editor.js` served with `text/javascript`.

- [ ] **Step 1: Download Blockly via scratchpad script**

Write to `%TEMP%\claude\...\scratchpad\download-blockly.mjs` (absolute scratchpad path from the session):

```js
import { writeFile } from "node:fs/promises";
const base = "https://cdn.jsdelivr.net/npm/blockly@12";
const meta = await (await fetch(`${base}/package.json`)).json();
const js = await (await fetch(`${base}/blockly.min.js`)).text();
if (!js.includes("Blockly")) throw new Error("download looks wrong");
const target = "c:/Users/BennN/Wesley College/College Digital Learning & Practice - Documents/Apps/Codrone EDU/drone_hub/static/blockly.min.js";
await writeFile(target, js, "utf8");
console.log("vendored blockly", meta.version, js.length, "bytes");
```

Run: `node <scratchpad>\download-blockly.mjs`
Expected: prints version (12.x) and a byte count > 500000. Record the version for the commit message.

- [ ] **Step 2: Create stubs**

`drone_hub/static/blocks-data.js`:

```js
"use strict";
/* Pure data + logic for the Blockly editor. No DOM, no Blockly API here,
   so Node can unit-test it (node --test drone_hub/tests). */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.DroneBlocksData = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  return {};
});
```

`drone_hub/static/editor.js`:

```js
"use strict";
/* Blockly editor glue: inject, theme, levels, save, run, highlight.
   Loads after app.js; shares its top-level bindings (api, toast, token,
   droneId, showPicker) because both are classic scripts. */
const DroneEditor = {
  init() {},
  refreshLayout() {},
  setRunningStep() {},
};
window.DroneEditor = DroneEditor;
```

- [ ] **Step 3: Serve the files**

In `server.py` STATIC_FILES add (after the `/qrcode.js` line):

```python
    "/blockly.min.js": ("blockly.min.js", "text/javascript; charset=utf-8"),
    "/blocks-data.js": ("blocks-data.js", "text/javascript; charset=utf-8"),
    "/editor.js": ("editor.js", "text/javascript; charset=utf-8"),
```

In `index.html` replace `<script src="app.js"></script>` with:

```html
<script src="blockly.min.js"></script>
<script src="app.js"></script>
<script src="blocks-data.js"></script>
<script src="editor.js"></script>
```

In `sw.js`: `SHELL_CACHE = "drone-pilot-shell-v6"` and add `"/blockly.min.js"`, `"/blocks-data.js"`, `"/editor.js"` to APP_SHELL.

- [ ] **Step 4: Verify**

Run: `node --check drone_hub/static/blocks-data.js` then `node --check drone_hub/static/editor.js` — both exit clean.
Start: `python drone_hub/server.py --practice --no-browser --port 8600` (background).
Run: `curl http://127.0.0.1:8600/blockly.min.js` (expect JS, status 200), same for `/blocks-data.js`, `/editor.js`.
Browser (chrome-devtools MCP): open `http://127.0.0.1:8600/`, check console has no errors and `typeof Blockly` evaluates to `"object"`.

- [ ] **Step 5: Commit**

```bash
git add drone_hub/static/blockly.min.js drone_hub/static/blocks-data.js drone_hub/static/editor.js drone_hub/server.py drone_hub/static/index.html drone_hub/static/sw.js
git commit -m "Vendor Blockly v12.x and serve editor scaffolding"
```

---

### Task 2: Block library, toolbox-per-level, field→value mapping

**Files:**
- Modify: `drone_hub/static/blocks-data.js`
- Test: `drone_hub/tests/blocks-data.test.mjs` (create; folder is new)

**Interfaces:**
- Consumes: nothing.
- Produces (on `DroneBlocksData` and via CommonJS):
  - `CATEGORIES: [{id, name, icon, colour}]` — same 9 categories/colours as old `CODE_CATEGORIES` (flight #ffc86f, movement #ff9d2e, lights #c334ee, sound #586bdc, timing #ef4771, loops #9edced, sensors #9583f4, logic #48dbad, tricks #df7bea).
  - `BLOCKS: [{type, action, category, minLevel, json}]` — `json` is a Blockly `jsonInit` definition, `style: "cat_<category>"`.
  - `BLOCK_BY_TYPE: {type -> entry}`.
  - `toolboxForLevel(level) -> {kind:"categoryToolbox", contents:[...]}` — only categories with ≥1 unlocked block; each category gets `cssconfig: {row: "drone-cat-row drone-cat-<id>", icon: "drone-cat-icon", label: "drone-cat-label"}`.
  - `stepValue(type, fields) -> value` — server-shaped value for `/api/run`.
  - `LED_COLOURS: {name -> [r,g,b]}`.

- [ ] **Step 1: Write failing tests**

`drone_hub/tests/blocks-data.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const data = require("../static/blocks-data.js");

test("all 18 block types exist with jsonInit defs", () => {
  const types = data.BLOCKS.map((b) => b.type).sort();
  assert.deepEqual(types, [
    "drone_avoid_wall", "drone_back", "drone_buzzer", "drone_circle",
    "drone_down", "drone_flip", "drone_forward", "drone_go_power",
    "drone_hover", "drone_if_height", "drone_if_wall", "drone_land",
    "drone_led", "drone_led_off", "drone_left", "drone_ping",
    "drone_repeat", "drone_right", "drone_sound_sequence", "drone_square",
    "drone_sway", "drone_takeoff", "drone_triangle", "drone_turn_left",
    "drone_turn_right", "drone_up",
  ]);
  for (const b of data.BLOCKS) {
    assert.equal(b.json.type, b.type);
    assert.equal(b.json.style, `cat_${b.category}`);
    if (b.type !== "drone_repeat") {
      assert.equal(b.json.previousStatement, null);
      assert.equal(b.json.nextStatement, null);
    }
  }
});

test("level 1 toolbox only offers the starter blocks", () => {
  const kinds = (contents) => contents.flatMap((c) => c.contents.map((x) => x.type));
  const l1 = data.toolboxForLevel(1);
  assert.deepEqual(kinds(l1.contents).sort(), [
    "drone_back", "drone_forward", "drone_land", "drone_led",
    "drone_takeoff", "drone_turn_left", "drone_turn_right",
  ]);
  const l5 = data.toolboxForLevel(5);
  assert.equal(kinds(l5.contents).length, data.BLOCKS.length);
});

test("toolbox categories carry cssconfig for styling", () => {
  const cat = data.toolboxForLevel(5).contents[0];
  assert.match(cat.cssconfig.row, /drone-cat-row/);
});

test("stepValue clamps and shapes server values", () => {
  assert.equal(data.stepValue("drone_forward", { VALUE: 999 }), 150);
  assert.equal(data.stepValue("drone_turn_left", { VALUE: 10 }), 45);
  assert.equal(data.stepValue("drone_takeoff", {}), null);
  assert.deepEqual(data.stepValue("drone_led", { COLOUR: "green" }), [23, 210, 139]);
  assert.deepEqual(data.stepValue("drone_buzzer", { NOTE: "523", DUR: 500 }),
    { frequency: 523, duration: 500 });
  assert.deepEqual(data.stepValue("drone_square", { DIR: "left" }),
    { direction: "left", speed: 40, duration: 1 });
  assert.deepEqual(data.stepValue("drone_if_wall", { DIST: 40, REACT: "hover" }),
    { distance: 40, reaction: "hover", reaction_value: 2 });
  assert.deepEqual(data.stepValue("drone_if_height", { COMP: "below", HEIGHT: 60, REACT: "up" }),
    { comparison: "below", height: 60, reaction: "up", reaction_value: 40 });
  assert.deepEqual(data.stepValue("drone_go_power", { DIR: "up", POWER: 55, DUR: 2 }),
    { direction: "up", power: 55, duration: 2 });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `node --test drone_hub/tests`
Expected: FAIL (BLOCKS undefined).

- [ ] **Step 3: Implement**

Inside the factory in `blocks-data.js` (replacing `return {}`):

```js
  const CATEGORIES = [
    { id: "flight", name: "Flight", icon: "\u2197", colour: "#ffc86f" },
    { id: "movement", name: "Movement", icon: "\u2194", colour: "#ff9d2e" },
    { id: "lights", name: "Lights", icon: "\u263c", colour: "#c334ee" },
    { id: "sound", name: "Sound", icon: "\u25d6))", colour: "#586bdc" },
    { id: "timing", name: "Timing", icon: "\u25f7", colour: "#ef4771" },
    { id: "loops", name: "Loops", icon: "\u27f3", colour: "#9edced" },
    { id: "sensors", name: "Sensors", icon: "\u25c9", colour: "#9583f4" },
    { id: "logic", name: "Logic", icon: "\u25c7", colour: "#48dbad" },
    { id: "tricks", name: "Tricks", icon: "\u2726", colour: "#df7bea" },
  ];

  const LED_COLOURS = {
    red: [255, 70, 84], green: [23, 210, 139], blue: [67, 184, 255],
    yellow: [255, 205, 70], purple: [187, 103, 255], white: [255, 255, 255],
    pink: [255, 120, 190], orange: [255, 140, 50],
  };

  const clampNum = (value, lo, hi, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
  };

  const stmt = (json) => Object.assign({ previousStatement: null, nextStatement: null }, json);
  const num = (name, value, min, max, precision) => ({ type: "field_number", name, value, min, max, precision });
  const drop = (name, options) => ({ type: "field_dropdown", name, options });

  const DIST = (label) => stmt({ message0: `${label} %1 cm`, args0: [num("VALUE", 50, 20, 150, 1)] });
  const TURN = (label) => stmt({ message0: `${label} %1\u00b0`, args0: [num("VALUE", 90, 45, 180, 1)] });
  const PATTERN = (label) => stmt({ message0: `${label} %1`, args0: [drop("DIR", [["clockwise", "right"], ["counter-clockwise", "left"]])] });

  const BLOCKS = [
    { type: "drone_takeoff", action: "takeoff", category: "flight", minLevel: 1,
      json: stmt({ message0: "\u2191 take off" }) },
    { type: "drone_land", action: "land", category: "flight", minLevel: 1,
      json: stmt({ message0: "\u2193 land safely" }) },
    { type: "drone_forward", action: "forward", category: "movement", minLevel: 1, json: DIST("fly forward") },
    { type: "drone_back", action: "back", category: "movement", minLevel: 1, json: DIST("fly backward") },
    { type: "drone_turn_left", action: "turn_left", category: "movement", minLevel: 1, json: TURN("\u21b6 turn left") },
    { type: "drone_turn_right", action: "turn_right", category: "movement", minLevel: 1, json: TURN("turn right \u21b7") },
    { type: "drone_left", action: "left", category: "movement", minLevel: 2, json: DIST("slide left") },
    { type: "drone_right", action: "right", category: "movement", minLevel: 2, json: DIST("slide right") },
    { type: "drone_up", action: "up", category: "movement", minLevel: 2, json: DIST("fly up") },
    { type: "drone_down", action: "down", category: "movement", minLevel: 2, json: DIST("fly down") },
    { type: "drone_go_power", action: "go_power", category: "movement", minLevel: 5,
      json: stmt({ message0: "power move %1 at %2 %% for %3 s", args0: [
        drop("DIR", [["forward", "forward"], ["backward", "backward"], ["left", "left"], ["right", "right"], ["up", "up"], ["down", "down"]]),
        num("POWER", 40, 20, 70, 5), num("DUR", 1, 0.5, 3, 0.5)] }) },
    { type: "drone_led", action: "led", category: "lights", minLevel: 1,
      json: stmt({ message0: "light colour %1", args0: [drop("COLOUR",
        Object.keys(LED_COLOURS).map((name) => [name, name]))] }) },
    { type: "drone_led_off", action: "led_off", category: "lights", minLevel: 2,
      json: stmt({ message0: "light off" }) },
    { type: "drone_ping", action: "ping", category: "sound", minLevel: 2,
      json: stmt({ message0: "\u266a beep and blink" }) },
    { type: "drone_buzzer", action: "buzzer", category: "sound", minLevel: 3,
      json: stmt({ message0: "play note %1 for %2 ms", args0: [
        drop("NOTE", [["C4", "262"], ["E4", "330"], ["G4", "392"], ["C5", "523"], ["E5", "659"], ["G5", "784"]]),
        num("DUR", 500, 100, 2000, 100)] }) },
    { type: "drone_sound_sequence", action: "sound_sequence", category: "sound", minLevel: 3,
      json: stmt({ message0: "play sound %1", args0: [drop("KIND", [["success", "success"], ["warning", "warning"], ["error", "error"]])] }) },
    { type: "drone_hover", action: "hover", category: "timing", minLevel: 2,
      json: stmt({ message0: "wait and hover %1 s", args0: [num("VALUE", 2, 1, 5, 1)] }) },
    { type: "drone_repeat", action: "repeat", category: "loops", minLevel: 2,
      json: { message0: "repeat %1 times", args0: [num("TIMES", 2, 2, 5, 1)],
        message1: "%1", args1: [{ type: "input_statement", name: "DO" }],
        previousStatement: null, nextStatement: null } },
    { type: "drone_avoid_wall", action: "avoid_wall", category: "sensors", minLevel: 4,
      json: stmt({ message0: "fly until obstacle at %1 cm, give up after %2 s", args0: [
        num("DIST", 50, 20, 100, 10), num("TIMEOUT", 5, 2, 10, 1)] }) },
    { type: "drone_if_wall", action: "if_wall", category: "logic", minLevel: 4,
      json: stmt({ message0: "if obstacle closer than %1 cm then %2", args0: [
        num("DIST", 50, 20, 100, 10),
        drop("REACT", [["turn left", "turn_left"], ["turn right", "turn_right"], ["hover", "hover"], ["land", "land"]])] }) },
    { type: "drone_if_height", action: "if_height", category: "logic", minLevel: 4,
      json: stmt({ message0: "if height %1 %2 cm then %3", args0: [
        drop("COMP", [["above", "above"], ["below", "below"]]),
        num("HEIGHT", 120, 30, 150, 10),
        drop("REACT", [["land", "land"], ["hover", "hover"], ["fly up", "up"], ["fly down", "down"]])] }) },
    { type: "drone_flip", action: "flip", category: "tricks", minLevel: 2,
      json: stmt({ message0: "flip %1", args0: [drop("DIR", [["front", "front"], ["back", "back"], ["left", "left"], ["right", "right"]])] }) },
    { type: "drone_square", action: "square", category: "tricks", minLevel: 3, json: PATTERN("fly a square") },
    { type: "drone_triangle", action: "triangle", category: "tricks", minLevel: 3, json: PATTERN("fly a triangle") },
    { type: "drone_circle", action: "circle", category: "tricks", minLevel: 3, json: PATTERN("fly a circle") },
    { type: "drone_sway", action: "sway", category: "tricks", minLevel: 3, json: PATTERN("sway side to side") },
  ];
  BLOCKS.forEach((b) => { b.json.type = b.type; b.json.style = `cat_${b.category}`; b.json.tooltip = ""; });

  const BLOCK_BY_TYPE = Object.fromEntries(BLOCKS.map((b) => [b.type, b]));

  function toolboxForLevel(level) {
    const contents = [];
    for (const cat of CATEGORIES) {
      const unlocked = BLOCKS.filter((b) => b.category === cat.id && b.minLevel <= level);
      if (!unlocked.length) continue;
      contents.push({
        kind: "category", name: cat.name, categorystyle: `catstyle_${cat.id}`,
        cssconfig: { row: `drone-cat-row drone-cat-${cat.id}`, icon: "drone-cat-icon", label: "drone-cat-label" },
        contents: unlocked.map((b) => ({ kind: "block", type: b.type })),
      });
    }
    return { kind: "categoryToolbox", contents };
  }

  function stepValue(type, fields) {
    switch (type) {
      case "drone_takeoff": case "drone_land": case "drone_led_off": case "drone_ping":
        return null;
      case "drone_forward": case "drone_back": case "drone_left": case "drone_right":
      case "drone_up": case "drone_down":
        return clampNum(fields.VALUE, 20, 150, 50);
      case "drone_turn_left": case "drone_turn_right":
        return clampNum(fields.VALUE, 45, 180, 90);
      case "drone_hover":
        return clampNum(fields.VALUE, 1, 5, 2);
      case "drone_flip":
        return ["front", "back", "left", "right"].includes(fields.DIR) ? fields.DIR : "back";
      case "drone_led":
        return [...(LED_COLOURS[fields.COLOUR] || LED_COLOURS.red)];
      case "drone_buzzer":
        return { frequency: clampNum(fields.NOTE, 200, 1200, 523), duration: clampNum(fields.DUR, 100, 2000, 500) };
      case "drone_sound_sequence":
        return ["success", "warning", "error"].includes(fields.KIND) ? fields.KIND : "success";
      case "drone_square": case "drone_triangle": case "drone_circle": case "drone_sway":
        return { direction: fields.DIR === "left" ? "left" : "right", speed: 40, duration: 1 };
      case "drone_avoid_wall":
        return { distance: clampNum(fields.DIST, 20, 100, 50), timeout: clampNum(fields.TIMEOUT, 2, 10, 5) };
      case "drone_if_wall": {
        const react = ["turn_left", "turn_right", "hover", "land"].includes(fields.REACT) ? fields.REACT : "turn_right";
        return { distance: clampNum(fields.DIST, 20, 100, 50), reaction: react,
          reaction_value: react === "land" ? null : react === "hover" ? 2 : 90 };
      }
      case "drone_if_height": {
        const react = ["land", "hover", "up", "down"].includes(fields.REACT) ? fields.REACT : "land";
        return { comparison: fields.COMP === "below" ? "below" : "above",
          height: clampNum(fields.HEIGHT, 30, 150, 120), reaction: react,
          reaction_value: react === "land" ? null : react === "hover" ? 2 : 40 };
      }
      case "drone_go_power":
        return { direction: ["forward", "backward", "left", "right", "up", "down"].includes(fields.DIR) ? fields.DIR : "forward",
          power: clampNum(fields.POWER, 20, 70, 40), duration: clampNum(fields.DUR, 0.5, 3, 1) };
      default:
        return null;
    }
  }

  return { CATEGORIES, LED_COLOURS, BLOCKS, BLOCK_BY_TYPE, toolboxForLevel, stepValue, clampNum };
```

Note: the reaction shape for `if_wall`/`if_height` matches the OLD client payload (`reaction` + `reaction_value` keys), which `validate_step()` on the server reads via `validate_reaction(value.get("reaction"), value.get("reaction_value"))`.

- [ ] **Step 4: Run tests, verify pass**

Run: `node --test drone_hub/tests` — all pass. Also `node --check drone_hub/static/blocks-data.js`.

- [ ] **Step 5: Commit**

```bash
git add drone_hub/static/blocks-data.js drone_hub/tests/blocks-data.test.mjs
git commit -m "Block library, per-level toolbox and server value mapping"
```

---

### Task 3: Flatten script to steps + Python preview

**Files:**
- Modify: `drone_hub/static/blocks-data.js`
- Test: `drone_hub/tests/flatten.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - Script node model (built later by editor.js): plain `{id, action, value}` or repeat `{id, action:"repeat", times, body:[nodes]}`.
  - `stepsFromScript(script) -> {steps:[{action,value}], blockIds:[id]}` or `{error: string}`.
  - `pythonLines(script) -> [string]`.

- [ ] **Step 1: Write failing tests**

`drone_hub/tests/flatten.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const data = require("../static/blocks-data.js");

const step = (id, action, value = null) => ({ id, action, value });

test("flattens repeats and maps block ids", () => {
  const script = [
    step("a", "takeoff"),
    { id: "r", action: "repeat", times: 2, body: [step("b", "forward", 50), step("c", "turn_right", 90)] },
    step("d", "land"),
  ];
  const out = data.stepsFromScript(script);
  assert.deepEqual(out.steps.map((s) => s.action),
    ["takeoff", "forward", "turn_right", "forward", "turn_right", "land"]);
  assert.deepEqual(out.blockIds, ["a", "b", "c", "b", "c", "d"]);
});

test("empty and oversized programs error in kid language", () => {
  assert.match(data.stepsFromScript([]).error, /Add some blocks/);
  const body = Array.from({ length: 4 }, (_, i) => step(`s${i}`, "forward", 50));
  const script = [{ id: "r1", action: "repeat", times: 5,
    body: [{ id: "r2", action: "repeat", times: 5, body }] }];
  assert.match(data.stepsFromScript(script).error, /more than 30 steps/);
});

test("python preview indents repeats", () => {
  const lines = data.pythonLines([
    step("a", "takeoff"),
    { id: "r", action: "repeat", times: 3, body: [step("b", "forward", 40)] },
    step("d", "land"),
  ]);
  assert.equal(lines[0], "from codrone_edu.drone import Drone");
  assert.ok(lines.includes("for _ in range(3):"));
  assert.ok(lines.includes('    drone.move_forward(40, "cm")'));
  assert.equal(lines[lines.length - 1], "drone.close()");
});

test("python preview covers every action", () => {
  const samples = [
    step("1", "takeoff"), step("2", "land"), step("3", "forward", 50),
    step("4", "back", 50), step("5", "left", 50), step("6", "right", 50),
    step("7", "up", 50), step("8", "down", 50), step("9", "turn_left", 90),
    step("10", "turn_right", 90), step("11", "hover", 2), step("12", "flip", "back"),
    step("13", "led", [255, 70, 84]), step("14", "led_off"), step("15", "ping"),
    step("16", "buzzer", { frequency: 523, duration: 500 }),
    step("17", "sound_sequence", "success"),
    step("18", "square", { direction: "right", speed: 40, duration: 1 }),
    step("19", "circle", { direction: "left", speed: 40, duration: 1 }),
    step("20", "avoid_wall", { distance: 50, timeout: 5 }),
    step("21", "if_wall", { distance: 50, reaction: "hover", reaction_value: 2 }),
    step("22", "if_height", { comparison: "above", height: 120, reaction: "land", reaction_value: null }),
    step("23", "go_power", { direction: "forward", power: 40, duration: 1 }),
  ];
  const lines = data.pythonLines(samples);
  assert.ok(lines.length > samples.length);
  assert.ok(!lines.some((l) => l.includes("undefined")));
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `node --test drone_hub/tests` — flatten tests FAIL (stepsFromScript undefined).

- [ ] **Step 3: Implement in blocks-data.js**

Add inside the factory and to the returned object:

```js
  function stepsFromScript(script) {
    const steps = [], blockIds = [];
    const walk = (nodes) => {
      for (const node of nodes) {
        if (steps.length > 30) return;
        if (node.action === "repeat") {
          const times = clampNum(node.times, 2, 5, 2);
          for (let i = 0; i < times && steps.length <= 30; i++) walk(node.body);
        } else {
          steps.push({ action: node.action, value: node.value });
          blockIds.push(node.id);
        }
      }
    };
    walk(script);
    if (!steps.length) return { error: "Add some blocks first!" };
    if (steps.length > 30) return { error: "That becomes more than 30 steps after repeating." };
    return { steps, blockIds };
  }

  function reactionPython(reaction, value) {
    if (reaction === "land") return "drone.land()";
    if (reaction === "hover") return `drone.hover(${value || 2})`;
    if (reaction === "turn_left") return `drone.turn_left(${value || 90})`;
    if (reaction === "turn_right") return `drone.turn_right(${value || 90})`;
    if (reaction === "up" || reaction === "down") return `drone.go("${reaction}", 40, 1)`;
    return "pass";
  }

  function pythonFor(action, value) {
    switch (action) {
      case "takeoff": return ["drone.takeoff()"];
      case "land": return ["drone.land()"];
      case "forward": return [`drone.move_forward(${value}, "cm")`];
      case "back": return [`drone.move_backward(${value}, "cm")`];
      case "left": return [`drone.move_left(${value}, "cm")`];
      case "right": return [`drone.move_right(${value}, "cm")`];
      case "up": return [`drone.go("up", 40, ${Math.max(0.5, value / 50).toFixed(1)})`];
      case "down": return [`drone.go("down", 40, ${Math.max(0.5, value / 50).toFixed(1)})`];
      case "turn_left": return [`drone.turn_left(${value})`];
      case "turn_right": return [`drone.turn_right(${value})`];
      case "hover": return [`drone.hover(${value})`];
      case "flip": return [`drone.flip("${value}")`];
      case "led": return [`drone.set_drone_LED(${value.join(", ")}, 100)`];
      case "led_off": return ["drone.drone_LED_off()"];
      case "ping": return ["drone.ping()"];
      case "buzzer": return [`drone.drone_buzzer(${value.frequency}, ${value.duration})`];
      case "sound_sequence": return [`drone.drone_buzzer_sequence("${value}")`];
      case "circle": return [`drone.circle(${value.speed}, ${value.direction === "right" ? 1 : -1})`];
      case "square": case "triangle": case "sway":
        return [`drone.${action}(${value.speed}, ${value.duration}, ${value.direction === "right" ? 1 : -1})`];
      case "avoid_wall": return [`drone.avoid_wall(timeout=${value.timeout}, distance=${value.distance})`];
      case "go_power": return [`drone.go("${value.direction}", ${value.power}, ${value.duration})`];
      case "if_wall": return [`if drone.detect_wall(${value.distance}):`, `    ${reactionPython(value.reaction, value.reaction_value)}`];
      case "if_height": {
        const symbol = value.comparison === "above" ? ">" : "<";
        return [`if drone.get_height("cm") ${symbol} ${value.height}:`, `    ${reactionPython(value.reaction, value.reaction_value)}`];
      }
      default: return [];
    }
  }

  function pythonLines(script) {
    const lines = ["from codrone_edu.drone import Drone", "", "drone = Drone()", "drone.pair()"];
    const emit = (nodes, indent) => {
      for (const node of nodes) {
        if (node.action === "repeat") {
          lines.push(`${indent}for _ in range(${clampNum(node.times, 2, 5, 2)}):`);
          if (node.body.length) emit(node.body, indent + "    ");
          else lines.push(`${indent}    pass`);
        } else {
          pythonFor(node.action, node.value).forEach((line) => lines.push(indent + line));
        }
      }
    };
    emit(script, "");
    lines.push("drone.close()");
    return lines;
  }
```

Add `stepsFromScript, pythonLines` to the returned object.

- [ ] **Step 4: Run tests, verify pass**

Run: `node --test drone_hub/tests` — all pass.

- [ ] **Step 5: Commit**

```bash
git add drone_hub/static/blocks-data.js drone_hub/tests/flatten.test.mjs
git commit -m "Script flattening with repeat expansion and Python preview"
```

---

### Task 4: Migration of old saved plans

**Files:**
- Modify: `drone_hub/static/blocks-data.js`
- Test: `drone_hub/tests/migrate.test.mjs`

**Interfaces:**
- Consumes: old localStorage format `dronePilotProgramV1`: `{version:1, steps:[{defId, action, value, sourceLevel}]}` (or bare array). Old defIds: takeoff, land, forward, back, left, right, up, down, turn_left, turn_right, go_power, led_red, led_green, led_blue, led_yellow, led_purple, led_off, ping, buzzer, sound_sequence, hover, repeat_start, repeat_end, avoid_wall, if_wall, if_height, flip_front, flip_back, flip_left, flip_right, square, triangle, circle, sway.
- Produces: `migrateOldProgram(oldSteps) -> serializationState | null` where serializationState is `{blocks:{languageVersion:0, blocks:[root]}}` loadable by `Blockly.serialization.workspaces.load`. Returns null for empty/invalid input.

- [ ] **Step 1: Write failing tests**

`drone_hub/tests/migrate.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const data = require("../static/blocks-data.js");

const chain = (root) => {
  const out = [];
  let b = root;
  while (b) { out.push(b); b = b.next && b.next.block; }
  return out;
};

test("maps simple steps to a linked chain", () => {
  const state = data.migrateOldProgram([
    { defId: "takeoff", action: "takeoff", value: null },
    { defId: "forward", action: "forward", value: 80 },
    { defId: "flip_left", action: "flip", value: "left" },
    { defId: "led_green", action: "led", value: [23, 210, 139] },
    { defId: "land", action: "land", value: null },
  ]);
  const blocks = chain(state.blocks.blocks[0]);
  assert.deepEqual(blocks.map((b) => b.type),
    ["drone_takeoff", "drone_forward", "drone_flip", "drone_led", "drone_land"]);
  assert.equal(blocks[1].fields.VALUE, 80);
  assert.equal(blocks[2].fields.DIR, "left");
  assert.equal(blocks[3].fields.COLOUR, "green");
});

test("repeat pairs become one repeat block with a body", () => {
  const state = data.migrateOldProgram([
    { defId: "repeat_start", action: "repeat_start", value: 3 },
    { defId: "forward", action: "forward", value: 50 },
    { defId: "hover", action: "hover", value: 2 },
    { defId: "repeat_end", action: "repeat_end", value: null },
    { defId: "land", action: "land", value: null },
  ]);
  const blocks = chain(state.blocks.blocks[0]);
  assert.deepEqual(blocks.map((b) => b.type), ["drone_repeat", "drone_land"]);
  assert.equal(blocks[0].fields.TIMES, 3);
  const body = chain(blocks[0].inputs.DO.block);
  assert.deepEqual(body.map((b) => b.type), ["drone_forward", "drone_hover"]);
});

test("odd colours snap to the nearest named colour", () => {
  const state = data.migrateOldProgram([
    { defId: "led_red", action: "led", value: [250, 60, 90] },
  ]);
  assert.equal(state.blocks.blocks[0].fields.COLOUR, "red");
});

test("orphan repeat markers and junk are skipped, empty gives null", () => {
  assert.equal(data.migrateOldProgram([]), null);
  assert.equal(data.migrateOldProgram("junk"), null);
  const state = data.migrateOldProgram([
    { defId: "repeat_end", action: "repeat_end", value: null },
    { defId: "mystery", action: "hack", value: 1 },
    { defId: "takeoff", action: "takeoff", value: null },
  ]);
  const blocks = chain(state.blocks.blocks[0]);
  assert.deepEqual(blocks.map((b) => b.type), ["drone_takeoff"]);
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `node --test drone_hub/tests` — migrate tests FAIL.

- [ ] **Step 3: Implement in blocks-data.js**

```js
  const OLD_DEF_TO_TYPE = {
    takeoff: "drone_takeoff", land: "drone_land", forward: "drone_forward",
    back: "drone_back", left: "drone_left", right: "drone_right",
    up: "drone_up", down: "drone_down", turn_left: "drone_turn_left",
    turn_right: "drone_turn_right", go_power: "drone_go_power",
    led_red: "drone_led", led_green: "drone_led", led_blue: "drone_led",
    led_yellow: "drone_led", led_purple: "drone_led", led_off: "drone_led_off",
    ping: "drone_ping", buzzer: "drone_buzzer", sound_sequence: "drone_sound_sequence",
    hover: "drone_hover", avoid_wall: "drone_avoid_wall", if_wall: "drone_if_wall",
    if_height: "drone_if_height", flip_front: "drone_flip", flip_back: "drone_flip",
    flip_left: "drone_flip", flip_right: "drone_flip", square: "drone_square",
    triangle: "drone_triangle", circle: "drone_circle", sway: "drone_sway",
  };

  function nearestLedColour(rgb) {
    if (!Array.isArray(rgb) || rgb.length !== 3) return "red";
    let best = "red", bestDist = Infinity;
    for (const [name, ref] of Object.entries(LED_COLOURS)) {
      const d = (ref[0] - rgb[0]) ** 2 + (ref[1] - rgb[1]) ** 2 + (ref[2] - rgb[2]) ** 2;
      if (d < bestDist) { bestDist = d; best = name; }
    }
    return best;
  }

  function migratedFields(type, step) {
    const v = step.value;
    const obj = (x) => (x && typeof x === "object" ? x : {});
    switch (type) {
      case "drone_forward": case "drone_back": case "drone_left": case "drone_right":
      case "drone_up": case "drone_down": return { VALUE: clampNum(v, 20, 150, 50) };
      case "drone_turn_left": case "drone_turn_right": return { VALUE: clampNum(v, 45, 180, 90) };
      case "drone_hover": return { VALUE: clampNum(v, 1, 5, 2) };
      case "drone_flip": return { DIR: ["front", "back", "left", "right"].includes(v) ? v : "back" };
      case "drone_led": return { COLOUR: nearestLedColour(v) };
      case "drone_buzzer": return { NOTE: String(clampNum(obj(v).frequency, 200, 1200, 523)), DUR: clampNum(obj(v).duration, 100, 2000, 500) };
      case "drone_sound_sequence": return { KIND: ["success", "warning", "error"].includes(v) ? v : "success" };
      case "drone_square": case "drone_triangle": case "drone_circle": case "drone_sway":
        return { DIR: obj(v).direction === "left" ? "left" : "right" };
      case "drone_avoid_wall": return { DIST: clampNum(obj(v).distance, 20, 100, 50), TIMEOUT: clampNum(obj(v).timeout, 2, 10, 5) };
      case "drone_if_wall": return { DIST: clampNum(obj(v).distance, 20, 100, 50),
        REACT: ["turn_left", "turn_right", "hover", "land"].includes(obj(v).reaction) ? obj(v).reaction : "turn_right" };
      case "drone_if_height": return { COMP: obj(v).comparison === "below" ? "below" : "above",
        HEIGHT: clampNum(obj(v).height, 30, 150, 120),
        REACT: ["land", "hover", "up", "down"].includes(obj(v).reaction) ? obj(v).reaction : "land" };
      case "drone_go_power": return {
        DIR: ["forward", "backward", "left", "right", "up", "down"].includes(obj(v).direction) ? obj(v).direction : "forward",
        POWER: clampNum(obj(v).power, 20, 70, 40), DUR: clampNum(obj(v).duration, 0.5, 3, 1) };
      default: return {};
    }
  }

  function migrateOldProgram(oldSteps) {
    if (!Array.isArray(oldSteps) || !oldSteps.length) return null;
    // First pass: nested lists, repeat_start opens a body, repeat_end closes it.
    const rootList = [];
    const stack = [rootList];
    const repeatNodes = [];
    for (const step of oldSteps) {
      if (!step || typeof step !== "object") continue;
      if (step.defId === "repeat_start") {
        const node = { repeat: true, times: clampNum(step.value, 2, 5, 2), body: [] };
        stack[stack.length - 1].push(node);
        repeatNodes.push(node);
        stack.push(node.body);
        continue;
      }
      if (step.defId === "repeat_end") {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const type = OLD_DEF_TO_TYPE[step.defId];
      if (!type) continue;
      stack[stack.length - 1].push({ type, fields: migratedFields(type, step) });
    }
    const toChain = (list) => {
      let head = null, tail = null;
      for (const item of list) {
        const block = item.repeat
          ? { type: "drone_repeat", fields: { TIMES: item.times },
              ...(item.body.length ? { inputs: { DO: { block: toChain(item.body) } } } : {}) }
          : { type: item.type, fields: item.fields };
        if (!head) head = block;
        else tail.next = { block };
        tail = block;
      }
      return head;
    };
    const root = toChain(rootList);
    if (!root) return null;
    root.x = 24;
    root.y = 24;
    return { blocks: { languageVersion: 0, blocks: [root] } };
  }
```

Add `migrateOldProgram` to the returned object.

- [ ] **Step 4: Run tests, verify pass**

Run: `node --test drone_hub/tests` — all pass (Tasks 2–4 suites).

- [ ] **Step 5: Commit**

```bash
git add drone_hub/static/blocks-data.js drone_hub/tests/migrate.test.mjs
git commit -m "Migrate old saved flight plans into Blockly workspace state"
```

---

### Task 5: The editor — inject Blockly, rebuild CODE tab, gut app.js

**Files:**
- Modify: `drone_hub/static/editor.js` (full implementation)
- Modify: `drone_hub/static/index.html:226-291` (CODE main), `:304` already done
- Modify: `drone_hub/static/app.js` (remove old editor, wire DroneEditor)
- Modify: `drone_hub/static/style.css` (new `blockly` section; delete dead editor styles)

**Interfaces:**
- Consumes: `Blockly` global; `DroneBlocksData` (Tasks 2–4); from app.js scope: `api(path, body)`, `toast(msg, ms)`, `showPicker()`, `token`, `droneId` (top-level `let` in a classic script — shared with later classic scripts).
- Produces: `window.DroneEditor = { init(), refreshLayout(), setRunningStep(stepOrNull) }`. Element ids kept for app.js: `#runBtn` (in `HUB_CONTROL_SELECTOR`), `#pythonPanel`, `#pythonCode`, `#saveStatus`, `#blockCount`. New ids: `#blocklyDiv`, `#rotateCover`, `#railCollapseBtn`, `#editorFallback`.
- localStorage keys: reads `dronePilotProgramV1` (old), owns `dronePilotBlocklyV1`, `codeLevel`.

- [ ] **Step 1: Rebuild the CODE main in index.html**

Replace the whole `<main id="codePage">…</main>` block (lines 227–291) with:

```html
<main id="codePage" class="page code-page hidden">
  <div class="blockly-app">
    <header class="blockly-topbar">
      <div class="topbar-left">
        <span class="rail-levels-label">Levels</span>
        <div class="rail-level-squares" role="group" aria-label="Coding level">
          <button class="level-btn" data-level="1" aria-label="Level 1: Pictures">1</button>
          <button class="level-btn" data-level="2" aria-label="Level 2: Sequences">2</button>
          <button class="level-btn" data-level="3" aria-label="Level 3: Controls">3</button>
          <button class="level-btn" data-level="4" aria-label="Level 4: Sensors">4</button>
          <button class="level-btn" data-level="5" aria-label="Level 5: Python">5</button>
        </div>
        <button id="railCollapseBtn" type="button" aria-label="Hide or show the block menu">&#10094;</button>
      </div>
      <span id="levelHint" class="level-hint" aria-live="polite"></span>
      <div class="topbar-right">
        <span id="saveStatus" class="save-status" role="status" aria-live="polite">SAVED ON THIS DEVICE</span>
        <span id="blockCount" class="block-count">0 / 30 BLOCKS</span>
        <button id="clearBtn" class="btn-mid hardware-key" type="button">CLEAR</button>
        <button id="runBtn" class="btn-big btn-go hardware-key" type="button"><span class="key-label">EXECUTE PLAN</span><span class="key-value">&#9654; RUN FLIGHT</span></button>
      </div>
    </header>
    <div id="blocklyDiv" class="blockly-host" aria-label="Block coding workspace"></div>
    <div id="editorFallback" class="editor-fallback hidden">
      <strong>The coding blocks couldn't load.</strong>
      <span>Pull down to refresh the page. If that doesn't fix it, tell your teacher.</span>
    </div>
    <div id="pythonPanel" class="python-panel terminal-window hidden">
      <div class="terminal-titlebar">
        <span class="terminal-lights" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="terminal-filename">mission.py</span>
        <span class="terminal-language">LIVE PYTHON</span>
      </div>
      <pre id="pythonCode" aria-label="Python code for this flight plan"></pre>
    </div>
  </div>
  <div id="rotateCover" class="rotate-cover hidden" role="dialog" aria-modal="true" aria-labelledby="rotateTitle">
    <div class="rotate-device" aria-hidden="true"></div>
    <strong id="rotateTitle">Turn your iPad sideways</strong>
    <span>The block coding screen needs the wide view.</span>
  </div>
</main>
```

- [ ] **Step 2: Implement editor.js**

Full replacement of the stub (keep the header comment):

```js
"use strict";
/* Blockly editor glue: inject, theme, levels, save, run, highlight.
   Loads after app.js; shares its top-level bindings (api, toast, token,
   droneId, showPicker) because both are classic scripts. */

const EDITOR_STORAGE_KEY = "dronePilotBlocklyV1";
const OLD_PROGRAM_KEY = "dronePilotProgramV1";
const EDITOR_LEVEL_HINTS = {
  1: "Picture blocks use safe ready-made settings. Great for a first flight.",
  2: "Add slides, sound, timing, loops, flips and movement in every direction.",
  3: "Tune distances, angles, colours, notes and flight patterns.",
  4: "Use the front and bottom range sensors to react to the world.",
  5: "Add power-based flight controls and see the real Python your blocks create.",
};

let editorLevel = Math.max(1, Math.min(5, parseInt(localStorage.getItem("codeLevel") || "1", 10) || 1));
let workspace = null;
let runBlockIds = [];
let saveTimer = null;

function editorEl(id) { return document.getElementById(id); }

function defineTheme() {
  const styles = {}, catStyles = {};
  for (const c of DroneBlocksData.CATEGORIES) {
    styles[`cat_${c.id}`] = { colourPrimary: c.colour, colourSecondary: c.colour, colourTertiary: "#0b1020" };
    catStyles[`catstyle_${c.id}`] = { colour: c.colour };
  }
  return Blockly.Theme.defineTheme("droneHub", {
    base: Blockly.Themes.Classic,
    blockStyles: styles,
    categoryStyles: catStyles,
    componentStyles: {
      workspaceBackgroundColour: "#171d29",
      toolboxBackgroundColour: "#0d1420",
      toolboxForegroundColour: "#dbe6f5",
      flyoutBackgroundColour: "#1b2333",
      flyoutForegroundColour: "#dbe6f5",
      flyoutOpacity: 0.97,
      scrollbarColour: "#3a455c",
      insertionMarkerColour: "#8fd8ff",
      insertionMarkerOpacity: 0.4,
    },
    fontStyle: { family: "'Segoe UI', system-ui, sans-serif", weight: "600", size: 12 },
  });
}

function scriptFromWorkspace() {
  const script = [];
  const tops = workspace.getTopBlocks(true);
  for (const top of tops) walkChain(top, script);
  return script;
}

function walkChain(block, out) {
  let current = block;
  while (current) {
    const meta = DroneBlocksData.BLOCK_BY_TYPE[current.type];
    if (meta && !current.isInsertionMarker()) {
      if (current.type === "drone_repeat") {
        const body = [];
        const first = current.getInputTargetBlock("DO");
        if (first) walkChain(first, body);
        out.push({ id: current.id, action: "repeat",
          times: DroneBlocksData.clampNum(current.getFieldValue("TIMES"), 2, 5, 2), body });
      } else {
        const fields = {};
        for (const input of current.inputList) {
          for (const field of input.fieldRow) {
            if (field.name) fields[field.name] = field.getValue();
          }
        }
        out.push({ id: current.id, action: meta.action,
          value: DroneBlocksData.stepValue(current.type, fields) });
      }
    }
    current = current.getNextBlock();
  }
}

function refreshDerived() {
  const script = scriptFromWorkspace();
  const flat = DroneBlocksData.stepsFromScript(script);
  const count = flat.error ? 0 : flat.steps.length;
  editorEl("blockCount").textContent = `${count} / 30 ${count === 1 ? "STEP" : "STEPS"}`;
  editorEl("blockCount").classList.toggle("over-limit", !!flat.error && /30 steps/.test(flat.error));
  if (editorLevel >= 5) {
    editorEl("pythonCode").textContent = DroneBlocksData.pythonLines(script).join("\n");
  }
}

function persistWorkspace() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const status = editorEl("saveStatus");
    try {
      const state = Blockly.serialization.workspaces.save(workspace);
      localStorage.setItem(EDITOR_STORAGE_KEY, JSON.stringify(state));
      status.textContent = "SAVED ON THIS DEVICE";
      status.classList.remove("save-error");
    } catch (error) {
      status.textContent = "SAVING UNAVAILABLE";
      status.classList.add("save-error");
    }
  }, 400);
}

function restoreWorkspace() {
  try {
    const saved = localStorage.getItem(EDITOR_STORAGE_KEY);
    if (saved) {
      Blockly.serialization.workspaces.load(JSON.parse(saved), workspace);
      return;
    }
    const old = JSON.parse(localStorage.getItem(OLD_PROGRAM_KEY) || "null");
    const oldSteps = Array.isArray(old) ? old : old && Array.isArray(old.steps) ? old.steps : null;
    const migrated = oldSteps ? DroneBlocksData.migrateOldProgram(oldSteps) : null;
    if (migrated) {
      Blockly.serialization.workspaces.load(migrated, workspace);
      toast("Your saved flight plan moved into the new blocks!", 2600);
    }
  } catch (error) {
    console.warn("Could not restore saved plan", error);
  }
}

function applyEditorLevel() {
  localStorage.setItem("codeLevel", String(editorLevel));
  document.querySelectorAll(".level-btn").forEach((button) => {
    const buttonLevel = Number(button.dataset.level);
    button.classList.toggle("active", buttonLevel === editorLevel);
    button.classList.toggle("complete", buttonLevel < editorLevel);
  });
  editorEl("levelHint").textContent = EDITOR_LEVEL_HINTS[editorLevel];
  editorEl("pythonPanel").classList.toggle("hidden", editorLevel < 5);
  workspace.updateToolbox(DroneBlocksData.toolboxForLevel(editorLevel));
  refreshDerived();
}

function updateRotateCover() {
  const portrait = window.matchMedia("(orientation: portrait)").matches;
  const codeActive = !editorEl("codePage").classList.contains("hidden");
  editorEl("rotateCover").classList.toggle("hidden", !(portrait && codeActive));
}

const DroneEditor = {
  init() {
    if (typeof Blockly === "undefined" || !window.DroneBlocksData || !DroneBlocksData.BLOCKS) {
      editorEl("editorFallback").classList.remove("hidden");
      return;
    }
    Blockly.defineBlocksWithJsonArray(DroneBlocksData.BLOCKS.map((b) => b.json));
    workspace = Blockly.inject("blocklyDiv", {
      renderer: "zelos",
      theme: defineTheme(),
      toolbox: DroneBlocksData.toolboxForLevel(editorLevel),
      trashcan: true,
      sounds: false,
      zoom: { controls: false, wheel: true, pinch: true, startScale: 0.85 },
      move: { scrollbars: { horizontal: true, vertical: true }, drag: true, wheel: true },
    });
    restoreWorkspace();
    applyEditorLevel();
    workspace.addChangeListener((event) => {
      if (event.isUiEvent) return;
      refreshDerived();
      persistWorkspace();
    });

    document.querySelectorAll(".level-btn").forEach((button) =>
      button.addEventListener("click", () => {
        editorLevel = Number(button.dataset.level);
        applyEditorLevel();
      }));

    editorEl("clearBtn").addEventListener("click", () => {
      workspace.clear();
      toast("Plan cleared.");
    });

    editorEl("runBtn").addEventListener("click", async () => {
      if (!token || !droneId) return showPicker();
      const flat = DroneBlocksData.stepsFromScript(scriptFromWorkspace());
      if (flat.error) return toast(flat.error, 2800);
      runBlockIds = flat.blockIds;
      const { ok, data } = await api("/api/run", { steps: flat.steps, token, drone_id: droneId });
      if (ok) toast("Flight plan is running!");
      else if (data.error === "bad_program" || data.error === "bad_step") {
        toast("One of those blocks is not safe to run.", 2600);
      }
    });

    editorEl("railCollapseBtn").addEventListener("click", () => {
      const toolbox = workspace.getToolbox();
      const hidden = document.body.classList.toggle("rail-collapsed");
      if (toolbox) toolbox.setVisible(!hidden);
      Blockly.svgResize(workspace);
    });

    window.addEventListener("resize", () => {
      updateRotateCover();
      if (workspace) Blockly.svgResize(workspace);
    });
    window.matchMedia("(orientation: portrait)").addEventListener("change", updateRotateCover);
    updateRotateCover();
  },

  refreshLayout() {
    updateRotateCover();
    if (workspace) Blockly.svgResize(workspace);
  },

  setRunningStep(step) {
    if (!workspace) return;
    if (!step || !runBlockIds[step - 1]) workspace.highlightBlock(null);
    else workspace.highlightBlock(runBlockIds[step - 1]);
  },
};
window.DroneEditor = DroneEditor;
```

- [ ] **Step 3: Gut app.js**

Precise removals/replacements (line numbers from the current file):
1. Delete `let level = …` (line 11) and `let program = []`, `let runningStep = null`, `let flatMap = []` (lines 14–16), `let programStorageReady = false` (line 27), `const PROGRAM_STORAGE_KEY = …` (line 29).
2. `setHubConnection` lines 70–73: replace the `runningStep` block with `if (window.DroneEditor) DroneEditor.setRunningStep(null);`.
3. `showTab` (lines 227–238): after toggling pages add:
   ```js
   document.body.classList.toggle("code-tab-active", !fly);
   if (!fly && window.DroneEditor) DroneEditor.refreshLayout();
   ```
4. Delete everything from the `/* ---------------- coding levels ---------------- */` comment (line 294) through the end of `renderPython` (line 1164) — the whole old editor, drag system, flatten, runBtn/clearBtn/level handlers and Python view.
5. In `poll()`: replace the three `runningStep`/`renderProgram` usages:
   - paused branch → `DroneEditor.setRunningStep(null);`
   - current branch → `DroneEditor.setRunningStep(d.current.step || null);`
   - else branch → `DroneEditor.setRunningStep(null);`
6. Tail (old lines 1656–1659): replace `loadSavedProgram(); applyLevel();` with `DroneEditor.init();` (keep `initAltitudeGauge()` and the disabled-controls line).
7. Run `node --check drone_hub/static/app.js` after surgery.

- [ ] **Step 4: style.css — add editor styles, remove dead ones**

Delete rule groups that only served the old editor (search-and-remove selectors: `.level-deck`, `.category-rail`, `.category-button`, `.toolbox-pane`, `.toolbox-heading`, `.toolbox-help`, `.palette`, `.palette-block`, `.program `, `.program-step`, `.block-workspace`, `.workspace-pane`, `.workspace-heading`, `.workspace-tip`, `.workspace-empty`, `.inline-field`, `.drag-ghost`, `.drop-marker`, `.needs-drag`, `.blockly-shell`, `.program-actions` — verify each is unreferenced in the new index.html before deleting). Keep `.level-btn`, `.save-status`, `.block-count`, `.python-panel`, `.terminal-*`.

Add a new section:

```css
/* ---------------- Blockly editor (Ozobot-style) ---------------- */
.code-page { display: flex; flex-direction: column; padding: 0; }
.blockly-app { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.blockly-topbar {
  display: flex; align-items: center; gap: 14px; padding: 8px 14px;
  background: #0d1420; border-bottom: 1px solid #232d40;
}
.topbar-left { display: flex; align-items: center; gap: 10px; }
.rail-levels-label { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #8fa2c0; }
.rail-level-squares { display: flex; gap: 6px; }
.rail-level-squares .level-btn {
  width: 38px; height: 38px; border-radius: 9px; font-weight: 800; font-size: 17px;
  background: #1a2334; color: #9fb2d0; border: 1px solid #2c3a52;
}
.rail-level-squares .level-btn.active { background: #24d3ee; color: #06202a; border-color: #24d3ee; }
.level-hint { flex: 1; font-size: 12px; color: #8fa2c0; text-align: left; }
.topbar-right { display: flex; align-items: center; gap: 10px; }
.blockly-host { flex: 1; min-height: 0; }
.block-count.over-limit { color: #ff8f9d; }
.editor-fallback { padding: 40px 20px; text-align: center; display: grid; gap: 8px; }
.rotate-cover {
  position: fixed; inset: 0; z-index: 60; background: #0b1120;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px; text-align: center; padding: 30px;
}
.rotate-cover strong { font-size: 26px; }
.rotate-cover span { color: #9fb2d0; }
.rotate-device {
  width: 84px; height: 56px; border: 4px solid #4cc9f0; border-radius: 10px;
  animation: rotate-nudge 1.6s ease-in-out infinite;
}
@keyframes rotate-nudge {
  0%, 100% { transform: rotate(-90deg); }
  45%, 70% { transform: rotate(0deg); }
}
@media (prefers-reduced-motion: reduce) { .rotate-device { animation: none; transform: rotate(0deg); } }
/* Blockly toolbox restyle (classes attached via toolbox cssconfig) */
.drone-cat-row {
  display: flex; align-items: center; gap: 10px; padding: 12px 14px 12px 10px;
  border-left: 6px solid var(--cat-colour, #4cc9f0); margin: 2px 0; cursor: pointer;
}
.drone-cat-row .drone-cat-label { font-weight: 700; letter-spacing: 0.02em; }
```

(Per-category `--cat-colour` custom properties: add one rule per category, e.g. `.drone-cat-tricks { --cat-colour: #df7bea; }`, for all nine ids from `CATEGORIES`. Exact Blockly internal class tweaks — row height, selected state, flyout width — are finished in Task 6 against the rendered DOM.)

- [ ] **Step 5: Verify in the browser**

`node --check` on app.js, editor.js, blocks-data.js. `node --test drone_hub/tests` still green.
Start `python drone_hub/server.py --practice --no-browser` (background). With chrome-devtools MCP:
1. Open `http://127.0.0.1:8600/`, dismiss join overlay via evaluate (`document.getElementById("watchBtn").click()`), switch to CODE tab.
2. Console: zero errors.
3. Evaluate: `Blockly.getMainWorkspace().getToolbox().getToolboxItems().length` ≥ 3 at level 1.
4. Add blocks programmatically (evaluate `Blockly.serialization.workspaces.load(...)` with a takeoff→forward→land chain), screenshot desktop 1440×900 → `output/playwright/blockly-desktop-editor.png`; verify puzzle blocks visible, dark workspace, sidebar categories.
5. Click RUN via evaluate after picking a drone (`api` flow: pick drone card). Confirm `/api/run` returns ok and the practice radar animates. Screenshot.
6. iPad viewport 1024×768: screenshot `output/playwright/blockly-ipad-editor.png`.
Fix any visible defects before committing (this step iterates).

- [ ] **Step 6: Commit**

```bash
git add drone_hub/static/editor.js drone_hub/static/app.js drone_hub/static/index.html drone_hub/static/style.css
git commit -m "Blockly editor replaces hand-rolled CODE tab"
```

---

### Task 6: Ozobot-match polish, collapse, landscape gate proof

**Files:**
- Modify: `drone_hub/static/style.css` (toolbox/flyout/block polish against rendered DOM)
- Modify: `drone_hub/static/editor.js` (only if polish needs option tweaks, e.g. flyout width, startScale)

**Interfaces:**
- Consumes: rendered Blockly DOM class names (inspect live: `.blocklyToolboxDiv`, `.blocklyFlyout`, `.blocklyText`, zelos constants).
- Produces: final look. No API changes.

- [ ] **Step 1: Style pass against the live DOM**

With the server running and chrome-devtools MCP open on the CODE tab, inspect and style until it matches the Ozobot reference: toolbox row height ~52px, icon circle per category colour, white category labels, flyout dark with subtle divider, workspace flat dark (no grid), zelos blocks rounded with visible notch. Adjust `startScale` so a `move` block is ~44px tall on iPad (finger-sized). Keep every change in style.css where possible.

- [ ] **Step 2: Landscape gate proof**

Viewport 768×1024 (portrait): CODE tab shows the rotate cover; FLY tab does not. Screenshots: `output/playwright/blockly-portrait-cover.png`, `blockly-portrait-fly-ok.png`. Rotate to 1024×768: cover hides, workspace resizes (no clipped SVG).

- [ ] **Step 3: Collapse proof**

Click `#railCollapseBtn`: toolbox hides, workspace widens; click again restores. Screenshot collapsed state.

- [ ] **Step 4: Screenshots reviewed**

Read every screenshot taken in this task and Task 5; fix visible defects (overlap, unreadable text, wrong colours) and re-shoot until clean.

- [ ] **Step 5: Commit**

```bash
git add drone_hub/static/style.css drone_hub/static/editor.js
git commit -m "Ozobot-style polish, sidebar collapse and rotate cover"
```

---

### Task 7: Full verification sweep and ship

**Files:**
- Modify: none expected (fixes only if the sweep finds defects)

- [ ] **Step 1: Unit + syntax**

`node --test drone_hub/tests` green; `node --check` on all three JS files.

- [ ] **Step 2: Migration in the browser**

Fresh page with evaluate: `localStorage.clear()`, then seed
`localStorage.setItem("dronePilotProgramV1", JSON.stringify({version:1, steps:[{defId:"takeoff",action:"takeoff",value:null},{defId:"repeat_start",action:"repeat_start",value:3},{defId:"forward",action:"forward",value:60},{defId:"repeat_end",action:"repeat_end",value:null},{defId:"land",action:"land",value:null}]}))`,
reload, open CODE tab: a takeoff → repeat(3){forward 60} → land stack appears; toast mentions the plan moved. Screenshot.

- [ ] **Step 3: End-to-end flight**

Pick a drone, build takeoff → repeat 2 × (forward 50, turn right 90) → land (programmatic load is fine), RUN. Poll shows step labels; running block highlight follows; radar animates; steps count 6/30 shown as `6 / 30 STEPS`.

- [ ] **Step 4: Runtime behaviours**

- Level switch 1→5 with blocks present: plan survives, toolbox grows, Python panel appears at 5 and matches the blocks.
- Stop server, wait for the offline banner: RUN disabled (`#runBtn` in `HUB_CONTROL_SELECTOR`), editing still works, save status intact. Restart server, banner clears.
- Teacher screen `http://127.0.0.1:8600/teacher` unaffected (loads, QR shows).
- Service worker: evaluate `caches.keys()` → contains `drone-pilot-shell-v6` only (after reload); `/blockly.min.js` present in the cache.
- Console clean in every scenario above.

- [ ] **Step 5: Final review against the spec**

Re-read `docs/superpowers/specs/2026-08-19-ozobot-blockly-editor-design.md` §Verification (7 items) and confirm each has evidence (screenshot or command output). Note the four approved simplifications in the commit body.

- [ ] **Step 6: Commit any fixes, then push**

```bash
git add -A drone_hub/static
git commit -m "Verification fixes for the Blockly editor"
git push
```

(Skip the commit if the sweep found nothing; push regardless — pushing is pre-authorised.)

---

## Self-Review Notes

- Spec coverage: engine swap (T1, T5), Ozobot layout/theme (T5, T6), levels (T2, T5), migration (T4, T7), landscape gate (T5 markup, T6 proof), PWA (T1, T7), run/highlight/python (T3, T5, T7), error handling (fallback div T5; migration try/catch T5).
- Deviations from spec recorded in Global Constraints (flip/LED/pill-visibility/repeat) — surface to Nathan in the wrap-up.
- Type consistency: field names (VALUE/DIR/TIMES/NOTE/DUR/KIND/DIST/TIMEOUT/REACT/COMP/HEIGHT/POWER/COLOUR) match across Tasks 2, 4, 5; `stepsFromScript` output (`steps`, `blockIds`, `error`) consistent across 3, 5, 7.
