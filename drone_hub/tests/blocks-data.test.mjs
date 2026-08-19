import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const data = require("../static/blocks-data.js");

test("all 26 block types exist with jsonInit defs", () => {
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
    assert.equal(b.json.previousStatement, null);
    assert.equal(b.json.nextStatement, null);
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
