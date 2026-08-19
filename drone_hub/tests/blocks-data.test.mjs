import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const data = require("../static/blocks-data.js");

test("all 20 block types exist with jsonInit defs", () => {
  const types = data.BLOCKS.map((b) => b.type).sort();
  assert.deepEqual(types, [
    "drone_avoid_wall", "drone_buzzer", "drone_circle", "drone_flip",
    "drone_go", "drone_go_power", "drone_hover", "drone_if_height",
    "drone_if_wall", "drone_land", "drone_led", "drone_led_off",
    "drone_ping", "drone_repeat", "drone_sound_sequence", "drone_square",
    "drone_sway", "drone_takeoff", "drone_triangle", "drone_turn",
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
    "drone_go", "drone_land", "drone_led", "drone_takeoff", "drone_turn",
  ]);
  const l5 = data.toolboxForLevel(5);
  assert.equal(kinds(l5.contents).length, data.BLOCKS.length);
});

test("toolbox categories carry cssconfig for styling", () => {
  const cat = data.toolboxForLevel(5).contents[0];
  assert.match(cat.cssconfig.row, /drone-cat-row/);
});

test("stepFor maps merged blocks to server actions with clamping", () => {
  assert.deepEqual(data.stepFor("drone_go", { DIR: "forward", VALUE: 999 }),
    { action: "forward", value: 150 });
  assert.deepEqual(data.stepFor("drone_go", { DIR: "backward", VALUE: 60 }),
    { action: "back", value: 60 });
  assert.deepEqual(data.stepFor("drone_turn", { DIR: "left", VALUE: 10 }),
    { action: "turn_left", value: 45 });
  assert.deepEqual(data.stepFor("drone_turn", { DIR: "right", VALUE: 90 }),
    { action: "turn_right", value: 90 });
  assert.deepEqual(data.stepFor("drone_takeoff", {}), { action: "takeoff", value: null });
  assert.deepEqual(data.stepFor("drone_led", { COLOUR: "green" }),
    { action: "led", value: [23, 210, 139] });
  assert.deepEqual(data.stepFor("drone_buzzer", { NOTE: "523", DUR: 500 }),
    { action: "buzzer", value: { frequency: 523, duration: 500 } });
  assert.deepEqual(data.stepFor("drone_square", { DIR: "left" }),
    { action: "square", value: { direction: "left", speed: 40, duration: 1 } });
  assert.deepEqual(data.stepFor("drone_sway", {}),
    { action: "sway", value: { direction: "right", speed: 40, duration: 1 } });
  assert.deepEqual(data.stepFor("drone_if_wall", { DIST: 40, REACT: "hover" }),
    { action: "if_wall", value: { distance: 40, reaction: "hover", reaction_value: 2 } });
  assert.deepEqual(data.stepFor("drone_if_height", { COMP: "below", HEIGHT: 60, REACT: "up" }),
    { action: "if_height", value: { comparison: "below", height: 60, reaction: "up", reaction_value: 40 } });
  assert.deepEqual(data.stepFor("drone_go_power", { DIR: "up", POWER: 55, DUR: 2 }),
    { action: "go_power", value: { direction: "up", power: 55, duration: 2 } });
  assert.equal(data.stepFor("mystery", {}), null);
});
