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
