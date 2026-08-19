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
