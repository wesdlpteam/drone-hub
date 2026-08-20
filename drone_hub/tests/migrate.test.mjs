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
    ["drone_takeoff", "drone_go", "drone_flip", "pic_led", "drone_land"]);
  assert.deepEqual(blocks[1].fields, { DIR: "forward", VALUE: 80, UNIT: "cm" });
  assert.equal(blocks[2].fields.DIR, "left");
  assert.equal(blocks[3].fields.COLOUR, "green");
});

test("old backward and turn steps keep their direction", () => {
  const state = data.migrateOldProgram([
    { defId: "back", action: "back", value: 40 },
    { defId: "turn_left", action: "turn_left", value: 120 },
  ]);
  const blocks = chain(state.blocks.blocks[0]);
  assert.deepEqual(blocks[0].fields, { DIR: "backward", VALUE: 40, UNIT: "cm" });
  assert.deepEqual(blocks[1].fields, { DIR: "left", VALUE: 120 });
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
  assert.deepEqual(blocks.map((b) => b.type), ["pic_repeat", "drone_land"]);
  assert.equal(blocks[0].fields.TIMES, 3);
  const body = chain(blocks[0].inputs.DO.block);
  assert.deepEqual(body.map((b) => b.type), ["drone_go", "drone_hover"]);
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
