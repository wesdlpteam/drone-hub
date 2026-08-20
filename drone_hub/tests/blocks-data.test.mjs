import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const data = require("../static/blocks-data.js");

test("official Level 2 drone blocks all exist", () => {
  const types = new Set(data.BLOCKS.map((b) => b.type));
  const official = [
    "drone_start", "drone_takeoff", "drone_land", "drone_hover",
    "drone_go_power", "drone_go", "drone_goto", "drone_turn",
    "drone_turn_power", "drone_turn_to", "drone_set_rpyt", "drone_move_sec",
    "drone_move_bare", "drone_flip", "drone_circle", "drone_triangle",
    "drone_square", "drone_sway", "drone_avoid_wall", "drone_keep_distance",
    "drone_led", "drone_led_rgb", "drone_led_sequence", "drone_led_off",
    "drone_buzzer", "drone_frequency", "drone_sound_sequence",
    "drone_get_angle", "drone_get_angular_speed", "drone_get_accel",
    "drone_reset_gyro", "drone_get_range", "drone_get_height_val",
    "drone_get_position", "drone_get_color", "drone_get_color_component",
    "drone_get_pressure", "drone_get_elevation", "drone_get_temperature",
    "drone_get_battery", "drone_get_state", "drone_wait", "drone_time_now",
  ];
  for (const t of official) assert.ok(types.has(t), `missing ${t}`);
  // legacy types stay registered so old saves keep loading
  for (const t of ["drone_repeat", "drone_ping", "drone_if_wall", "drone_if_height"]) {
    assert.ok(types.has(t), `missing legacy ${t}`);
  }
  for (const b of data.BLOCKS) assert.equal(b.json.type, b.type);
});

test("level 1 toolbox is picture blocks only", () => {
  const l1 = data.toolboxForLevel(1);
  const types = l1.contents.flatMap((c) => c.contents.map((x) => x.type));
  assert.ok(types.length >= 10);
  for (const t of types) assert.match(t, /^pic_/);
  assert.deepEqual(l1.contents.map((c) => c.name),
    ["Fly", "Lights", "Sounds", "Tricks", "Repeat"]);
});

test("level 2 toolbox mirrors the official categories", () => {
  const l2 = data.toolboxForLevel(2);
  assert.deepEqual(l2.contents.map((c) => c.name), [
    "Events", "Flight Commands", "Flight Sequences", "Lights and Sounds",
    "Sensors", "Console", "Variables", "Functions", "Control", "Math",
    "Data Structures",
  ]);
  const byName = Object.fromEntries(l2.contents.map((c) => [c.name, c]));
  assert.equal(byName.Variables.custom, "VARIABLE");
  assert.equal(byName.Functions.custom, "PROCEDURE");
  assert.ok(byName.Math.contents.some((b) => b.type === "math_random_int"));
  assert.ok(byName.Control.contents.some((b) => b.type === "controls_whileUntil"));
  assert.ok(byName["Data Structures"].contents.some((b) => b.type === "lists_sort"));
  assert.match(byName.Sensors.cssconfig.row, /drone-cat-row/);
  // numeric drone-block params get math_number shadows so variables plug in
  const go = byName["Flight Commands"].contents.find((b) => b.type === "drone_go");
  assert.equal(go.inputs.VALUE.shadow.type, "math_number");
});

test("notes table spans C3..B7 and keeps old save values", () => {
  assert.equal(data.NOTES.length, 60);
  assert.deepEqual(data.NOTES[0], ["C3", "131"]);
  assert.deepEqual(data.NOTES[59], ["B7", "3951"]);
  assert.ok(data.NOTES.some(([, f]) => f === "262"));
  assert.ok(data.NOTES.some(([, f]) => f === "523"));
});

test("stepFor maps picture blocks to safe server actions", () => {
  assert.deepEqual(data.stepFor("pic_go", { DIR: "forward", VALUE: 999 }),
    { action: "forward", value: 150 });
  assert.deepEqual(data.stepFor("pic_go", { DIR: "backward", VALUE: 60 }),
    { action: "back", value: 60 });
  assert.deepEqual(data.stepFor("pic_turn", { DIR: "left", VALUE: "90" }),
    { action: "turn_left", value: 90 });
  assert.deepEqual(data.stepFor("pic_takeoff", {}), { action: "takeoff", value: null });
  assert.deepEqual(data.stepFor("pic_led", { COLOUR: "green" }),
    { action: "led", value: [23, 210, 139] });
  assert.deepEqual(data.stepFor("pic_sound", { KIND: "warning" }),
    { action: "sound_sequence", value: { kind: "warning", device: "drone" } });
  assert.deepEqual(data.stepFor("pic_square", {}),
    { action: "square", value: { direction: "right", speed: 40, duration: 1 } });
  assert.equal(data.stepFor("mystery", {}), null);
});

test("stepFor maps official blocks with clamps and unit conversion", () => {
  assert.deepEqual(data.stepFor("drone_go", { DIR: "forward", VALUE: 1, UNIT: "m" }),
    { action: "forward", value: 100 });
  assert.deepEqual(data.stepFor("drone_turn", { DIR: "left", VALUE: 10 }),
    { action: "turn_left", value: 45 });
  assert.deepEqual(data.stepFor("drone_led", { DEVICE: "drone", COLOUR: "cyan", BRIGHT: 999 }),
    { action: "led", value: { rgb: [0, 220, 220], brightness: 255, device: "drone" } });
  assert.deepEqual(data.stepFor("drone_buzzer", { NOTE: "523", DUR: 500, DEVICE: "controller" }),
    { action: "buzzer", value: { frequency: 523, duration: 500, device: "controller" } });
  assert.deepEqual(data.stepFor("drone_goto", { X: 9, Y: -9, Z: 0.8 }),
    { action: "goto", value: { x: 150, y: -150, z: 80 } });
  assert.deepEqual(data.stepFor("drone_set_rpyt", { AXIS: "throttle", POWER: 90 }),
    { action: "set_rpyt", value: { axis: "throttle", power: 30 } });
  assert.deepEqual(data.stepFor("drone_keep_distance", { DIST: 50, TIMEOUT: 99 }),
    { action: "keep_distance", value: { distance: 50, timeout: 10 } });
});
