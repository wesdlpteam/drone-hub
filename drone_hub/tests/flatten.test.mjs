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
