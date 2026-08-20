"use strict";
/* Pure data + logic for the Blockly editor. No DOM, no Blockly API here,
   so Node can unit-test it (node --test drone_hub/tests).
   Level 1 = picture blocks (pic_*), flat /api/run path.
   Level 2 = full official CoDrone EDU catalogue (drone_* + standard Blockly). */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.DroneBlocksData = api;
})(typeof self !== "undefined" ? self : globalThis, function () {

  // Level 2 categories mirror codrone.robolink.com/edu/blockly (Controller and
  // Color Data excluded: controller stays at the hub, colour ML needs their tool).
  const CATEGORIES = [
    { id: "events", name: "Events", icon: "🚩", colour: "#f5a623", level: 2 },
    { id: "flight", name: "Flight Commands", icon: "🚁", colour: "#3e75ff", level: 2 },
    { id: "sequences", name: "Flight Sequences", icon: "🌀", colour: "#31a3ff", level: 2 },
    { id: "lightsound", name: "Lights and Sounds", icon: "💡", colour: "#a45cf0", level: 2 },
    { id: "sensors", name: "Sensors", icon: "📡", colour: "#f57a20", level: 2 },
    { id: "console", name: "Console", icon: "🖥️", colour: "#2b4bd7", level: 2 },
    { id: "variables", name: "Variables", icon: "🏷️", colour: "#38b449", level: 2, custom: "VARIABLE" },
    { id: "functions", name: "Functions", icon: "𝑓", colour: "#ef5da8", level: 2, custom: "PROCEDURE" },
    { id: "control", name: "Control", icon: "🔀", colour: "#d64230", level: 2 },
    { id: "math", name: "Math", icon: "➗", colour: "#5b79a3", level: 2 },
    { id: "lists", name: "Data Structures", icon: "📚", colour: "#15a08c", level: 2 },
    // Level 1 picture categories
    { id: "p_fly", name: "Fly", icon: "🚁", colour: "#3e75ff", level: 1 },
    { id: "p_lights", name: "Lights", icon: "💡", colour: "#a45cf0", level: 1 },
    { id: "p_sounds", name: "Sounds", icon: "🔊", colour: "#586bdc", level: 1 },
    { id: "p_tricks", name: "Tricks", icon: "✨", colour: "#df7bea", level: 1 },
    { id: "p_loops", name: "Repeat", icon: "🔁", colour: "#9edced", level: 1 },
  ];

  const LED_COLOURS = {
    red: [255, 70, 84], green: [23, 210, 139], blue: [67, 184, 255],
    yellow: [255, 205, 70], purple: [187, 103, 255], white: [255, 255, 255],
    pink: [255, 120, 190], orange: [255, 140, 50],
    cyan: [0, 220, 220], magenta: [255, 0, 255], black: [0, 0, 0],
  };
  // Official colour dropdown (docs list these), plus kid favourites kept for old saves.
  const LED_CHOICES = ["red", "green", "yellow", "blue", "cyan", "magenta", "white",
    "purple", "pink", "orange"];

  // Notes C3..B7 like the official app; values are frequency strings so old
  // saves ("262", "523"...) still match.
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const NOTES = [];
  for (let midi = 48; midi <= 107; midi++) {
    const name = NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
    const freq = Math.round(440 * Math.pow(2, (midi - 69) / 12));
    NOTES.push([name, String(freq)]);
  }

  const UNIT_CM = { cm: 1, mm: 0.1, in: 2.54, m: 100 };

  const clampNum = (value, lo, hi, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
  };

  const stmt = (json) => Object.assign({ previousStatement: null, nextStatement: null }, json);
  const out = (json, type) => Object.assign({ output: type || "Number" }, json);
  const num = (name, value, min, max, precision) => ({ type: "field_number", name, value, min, max, precision });
  const drop = (name, options) => ({ type: "field_dropdown", name, options });
  const DIRS6 = [["forward", "forward"], ["backward", "backward"], ["left", "left"], ["right", "right"], ["up", "up"], ["down", "down"]];
  const LR = [["left", "left"], ["right", "right"]];
  const RL = [["right", "right"], ["left", "left"]];
  const DEVICE = [["drone", "drone"], ["controller", "controller"]];
  const XYZ = [["x", "x"], ["y", "y"], ["z", "z"]];
  const PATTERN = (label) => stmt({ message0: `%1 ${label}`, args0: [drop("DIR", RL)] });
  // Numeric params on Level 2 drone blocks are value inputs (with math_number
  // shadows from the toolbox) so variables and math plug in, like the official app.
  const val = (name) => ({ type: "input_value", name, check: "Number" });
  const inline = (json) => Object.assign(json, { inputsInline: true });

  // cat: toolbox category. level: 1, 2 or 0 (registered for old saves, no toolbox).
  const BLOCKS = [
    // ---- Events
    { type: "drone_start", cat: "events",
      json: { message0: "when %1 Run tapped", args0: [{ type: "field_label", name: "ICO", text: "▶" }], nextStatement: null } },
    // ---- Flight Commands (official wording)
    { type: "drone_takeoff", action: "takeoff", cat: "flight",
      json: stmt({ message0: "take off" }) },
    { type: "drone_land", action: "land", cat: "flight",
      json: stmt({ message0: "land" }) },
    { type: "drone_hover", action: "hover", cat: "flight", shadows: { VALUE: 1 },
      json: inline(stmt({ message0: "hover for %1 second(s)", args0: [val("VALUE")] })) },
    { type: "drone_go_power", action: "go_power", cat: "flight", shadows: { DUR: 1, POWER: 50 },
      json: inline(stmt({ message0: "go %1 for %2 second(s) at %3 % power", args0: [
        drop("DIR", DIRS6), val("DUR"), val("POWER")] })) },
    { type: "drone_go", action: "go", cat: "flight", shadows: { VALUE: 50 },
      json: inline(stmt({ message0: "go %1 %2 %3", args0: [
        drop("DIR", DIRS6), val("VALUE"),
        drop("UNIT", [["cm", "cm"], ["mm", "mm"], ["in", "in"], ["m", "m"]])] })) },
    { type: "drone_goto", action: "goto", cat: "flight", shadows: { X: 0, Y: 0, Z: 0.8 },
      json: inline(stmt({ message0: "go to coordinate (x, y, z) = ( %1 , %2 , %3 ) m", args0: [
        val("X"), val("Y"), val("Z")] })) },
    { type: "drone_turn", action: "turn", cat: "flight", shadows: { VALUE: 90 },
      json: inline(stmt({ message0: "turn %1 %2 degrees", args0: [drop("DIR", LR), val("VALUE")] })) },
    { type: "drone_turn_power", action: "turn_power", cat: "flight", shadows: { DUR: 1, POWER: 50 },
      json: inline(stmt({ message0: "turn %1 for %2 second(s) at %3 % power", args0: [
        drop("DIR", LR), val("DUR"), val("POWER")] })) },
    { type: "drone_turn_to", action: "turn_to", cat: "flight", shadows: { VALUE: 90 },
      json: inline(stmt({ message0: "turn to heading %1 °", args0: [val("VALUE")] })) },
    { type: "drone_set_rpyt", action: "set_rpyt", cat: "flight", shadows: { POWER: 0 },
      json: inline(stmt({ message0: "set %1 to %2 %", args0: [
        drop("AXIS", [["roll", "roll"], ["pitch", "pitch"], ["yaw", "yaw"], ["throttle", "throttle"]]),
        val("POWER")] })) },
    { type: "drone_move_sec", action: "move_apply", cat: "flight", shadows: { DUR: 1 },
      json: inline(stmt({ message0: "move %1 second(s)", args0: [val("DUR")] })) },
    { type: "drone_move_bare", action: "move_apply", cat: "flight",
      json: stmt({ message0: "move()" }) },
    // ---- Flight Sequences
    { type: "drone_flip", action: "flip", cat: "sequences",
      json: stmt({ message0: "flip %1", args0: [drop("DIR", [["back", "back"], ["front", "front"], ["left", "left"], ["right", "right"]])] }) },
    { type: "drone_circle", action: "circle", cat: "sequences", json: PATTERN("circle") },
    { type: "drone_triangle", action: "triangle", cat: "sequences", json: PATTERN("triangle") },
    { type: "drone_square", action: "square", cat: "sequences", json: PATTERN("square") },
    { type: "drone_sway", action: "sway", cat: "sequences", json: stmt({ message0: "sway" }) },
    { type: "drone_avoid_wall", action: "avoid_wall", cat: "sequences", shadows: { DIST: 50, TIMEOUT: 5 },
      json: inline(stmt({ message0: "avoid wall at %1 cm for %2 second(s)", args0: [
        val("DIST"), val("TIMEOUT")] })) },
    { type: "drone_keep_distance", action: "keep_distance", cat: "sequences", shadows: { DIST: 50, TIMEOUT: 5 },
      json: inline(stmt({ message0: "keep distance %1 cm for %2 second(s)", args0: [
        val("DIST"), val("TIMEOUT")] })) },
    // ---- Lights and Sounds
    { type: "drone_led", action: "led", cat: "lightsound", shadows: { BRIGHT: 255 },
      json: inline(stmt({ message0: "set %1 LED color to %2 , with a brightness of %3", args0: [
        drop("DEVICE", DEVICE), drop("COLOUR", LED_CHOICES.map((n) => [n, n])), val("BRIGHT")] })) },
    { type: "drone_led_rgb", action: "led", cat: "lightsound", shadows: { R: 255, G: 0, B: 0, BRIGHT: 255 },
      json: inline(stmt({ message0: "set %1 LED R= %2 , G= %3 , B= %4 , %5", args0: [
        drop("DEVICE", DEVICE), val("R"), val("G"), val("B"), val("BRIGHT")] })) },
    { type: "drone_led_sequence", action: "led_sequence", cat: "lightsound", shadows: { R: 0, G: 0, B: 255 },
      json: inline(stmt({ message0: "set %1 LED sequence %2 with color R= %3 , G= %4 , B= %5 and speed %6", args0: [
        drop("DEVICE", DEVICE),
        drop("MODE", [["dimming", "dimming"], ["fade in", "fade_in"], ["fade out", "fade_out"], ["blink", "blink"], ["double blink", "double_blink"], ["rainbow", "rainbow"]]),
        val("R"), val("G"), val("B"),
        drop("SPEED", [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"]])] })) },
    { type: "drone_led_off", action: "led_off", cat: "lightsound",
      json: stmt({ message0: "turn %1 LED off", args0: [drop("DEVICE", DEVICE)] }) },
    { type: "drone_buzzer", action: "buzzer", cat: "lightsound", shadows: { DUR: 500 },
      json: inline(stmt({ message0: "play this note %1 for %2 ms on %3", args0: [
        drop("NOTE", NOTES), val("DUR"), drop("DEVICE", DEVICE)] })) },
    { type: "drone_frequency", action: "buzzer", cat: "lightsound", shadows: { FREQ: 500, DUR: 1000 },
      json: inline(stmt({ message0: "play frequency %1 hertz for %2 ms on %3", args0: [
        val("FREQ"), val("DUR"), drop("DEVICE", DEVICE)] })) },
    { type: "drone_sound_sequence", action: "sound_sequence", cat: "lightsound",
      json: stmt({ message0: "play %1 sound on %2", args0: [
        drop("KIND", [["success", "success"], ["warning", "warning"], ["error", "error"]]), drop("DEVICE", DEVICE)] }) },
    // ---- Sensors (value blocks; read via /api/sensors)
    { type: "drone_get_angle", cat: "sensors", sensor: true,
      json: out({ message0: "get angle %1", args0: [drop("AXIS", XYZ)] }) },
    { type: "drone_get_angular_speed", cat: "sensors", sensor: true,
      json: out({ message0: "get angular speed %1", args0: [drop("AXIS", XYZ)] }) },
    { type: "drone_get_accel", cat: "sensors", sensor: true,
      json: out({ message0: "get acceleration %1", args0: [drop("AXIS", XYZ)] }) },
    { type: "drone_reset_gyro", action: "reset_gyro", cat: "sensors",
      json: stmt({ message0: "reset gyro" }) },
    { type: "drone_get_range", cat: "sensors", sensor: true,
      json: out({ message0: "get %1 range in %2", args0: [
        drop("WHICH", [["front", "front"], ["bottom", "bottom"]]),
        drop("UNIT", [["cm", "cm"], ["mm", "mm"], ["in", "in"], ["m", "m"]])] }) },
    { type: "drone_get_height_val", cat: "sensors", sensor: true,
      json: out({ message0: "get height in %1", args0: [drop("UNIT", [["cm", "cm"], ["mm", "mm"], ["in", "in"], ["m", "m"]])] }) },
    { type: "drone_get_position", cat: "sensors", sensor: true,
      json: out({ message0: "get position %1 in %2", args0: [drop("AXIS", XYZ),
        drop("UNIT", [["cm", "cm"], ["mm", "mm"], ["in", "in"], ["m", "m"]])] }) },
    { type: "drone_get_color", cat: "sensors", sensor: true,
      json: out({ message0: "get %1 color", args0: [drop("WHICH", [["front", "front"], ["back", "back"]])] }, "String") },
    { type: "drone_get_color_component", cat: "sensors", sensor: true,
      json: out({ message0: "get %1 %2 value", args0: [
        drop("WHICH", [["front", "front"], ["back", "back"]]),
        drop("COMP", [["hue", "hue"], ["saturation", "saturation"], ["value", "value"], ["lightness", "lightness"], ["red", "red"], ["green", "green"], ["blue", "blue"]])] }) },
    { type: "drone_get_pressure", cat: "sensors", sensor: true,
      json: out({ message0: "get pressure in %1", args0: [drop("UNIT", [["pascal", "pascal"], ["millibar", "millibar"]])] }) },
    { type: "drone_get_elevation", cat: "sensors", sensor: true,
      json: out({ message0: "get elevation in %1", args0: [drop("UNIT", [["m", "m"], ["km", "km"], ["ft", "ft"], ["mi", "mi"]])] }) },
    { type: "drone_get_temperature", cat: "sensors", sensor: true,
      json: out({ message0: "get drone temperature in %1", args0: [drop("UNIT", [["Fahrenheit", "F"], ["Celsius", "C"], ["Kelvin", "K"]])] }) },
    { type: "drone_get_battery", cat: "sensors", sensor: true,
      json: out({ message0: "get battery" }) },
    { type: "drone_get_state", cat: "sensors", sensor: true,
      json: out({ message0: "get %1 state", args0: [drop("WHICH", [["flight", "flight"], ["movement", "movement"]])] }, "String") },
    // ---- Control (timing; logic + loops are standard Blockly)
    { type: "drone_wait", cat: "control", shadows: { DUR: 1 },
      json: inline(stmt({ message0: "wait %1 second(s)", args0: [val("DUR")] })) },
    { type: "drone_time_now", cat: "control",
      json: out({ message0: "current time in %1", args0: [drop("UNIT", [["milliseconds", "ms"], ["seconds", "s"]])] }) },
    // ---- Level 1 picture blocks
    { type: "pic_takeoff", action: "takeoff", cat: "p_fly", json: stmt({ message0: "🛫 take off" }) },
    { type: "pic_land", action: "land", cat: "p_fly", json: stmt({ message0: "🛬 land" }) },
    { type: "pic_go", action: "go", cat: "p_fly",
      json: stmt({ message0: "%1 go %2 cm", args0: [
        drop("DIR", [["⬆️ forward", "forward"], ["⬇️ backward", "backward"], ["⬅️ left", "left"], ["➡️ right", "right"], ["🔼 up", "up"], ["🔽 down", "down"]]),
        num("VALUE", 50, 20, 150, 10)] }) },
    { type: "pic_turn", action: "turn", cat: "p_fly",
      json: stmt({ message0: "%1 turn %2", args0: [
        drop("DIR", [["↩️ left", "left"], ["↪️ right", "right"]]),
        drop("VALUE", [["45°", "45"], ["90°", "90"], ["180°", "180"]])] }) },
    { type: "pic_hover", action: "hover", cat: "p_fly",
      json: stmt({ message0: "⏸️ wait %1 second(s)", args0: [num("VALUE", 2, 1, 5, 1)] }) },
    { type: "pic_led", action: "led", cat: "p_lights",
      json: stmt({ message0: "💡 light %1", args0: [drop("COLOUR", [
        ["🔴 red", "red"], ["🟢 green", "green"], ["🔵 blue", "blue"], ["🟡 yellow", "yellow"],
        ["🟣 purple", "purple"], ["⚪ white", "white"], ["🩷 pink", "pink"], ["🟠 orange", "orange"]])] }) },
    { type: "pic_led_off", action: "led_off", cat: "p_lights", json: stmt({ message0: "⚫ light off" }) },
    { type: "pic_beep", action: "ping", cat: "p_sounds", json: stmt({ message0: "📣 beep and blink" }) },
    { type: "pic_sound", action: "sound_sequence", cat: "p_sounds",
      json: stmt({ message0: "🎵 play %1", args0: [drop("KIND", [["happy 😊", "success"], ["uh-oh 😮", "warning"], ["alarm 🚨", "error"]])] }) },
    { type: "pic_flip", action: "flip", cat: "p_tricks",
      json: stmt({ message0: "🤸 flip %1", args0: [drop("DIR", [["back", "back"], ["front", "front"], ["left", "left"], ["right", "right"]])] }) },
    { type: "pic_square", action: "square", cat: "p_tricks", json: stmt({ message0: "⬛ fly a square" }) },
    { type: "pic_triangle", action: "triangle", cat: "p_tricks", json: stmt({ message0: "🔺 fly a triangle" }) },
    { type: "pic_circle", action: "circle", cat: "p_tricks", json: stmt({ message0: "⭕ fly a circle" }) },
    { type: "pic_sway", action: "sway", cat: "p_tricks", json: stmt({ message0: "🌊 sway" }) },
    { type: "pic_repeat", action: "repeat", cat: "p_loops",
      json: { message0: "🔁 repeat %1 times", args0: [num("TIMES", 2, 2, 5, 1)],
        message1: "%1", args1: [{ type: "input_statement", name: "DO" }],
        previousStatement: null, nextStatement: null } },
    // ---- Registered for old saves only (no toolbox)
    { type: "drone_ping", action: "ping", cat: null, json: stmt({ message0: "beep and blink" }) },
    { type: "drone_repeat", action: "repeat", cat: null,
      json: { message0: "repeat %1 times", args0: [num("TIMES", 2, 2, 5, 1)],
        message1: "%1", args1: [{ type: "input_statement", name: "DO" }],
        previousStatement: null, nextStatement: null } },
    { type: "drone_if_wall", action: "if_wall", cat: null,
      json: stmt({ message0: "if obstacle closer than %1 cm then %2", args0: [
        num("DIST", 50, 20, 100, 10),
        drop("REACT", [["turn left", "turn_left"], ["turn right", "turn_right"], ["hover", "hover"], ["land", "land"]])] }) },
    { type: "drone_if_height", action: "if_height", cat: null,
      json: stmt({ message0: "if height %1 %2 cm then %3", args0: [
        drop("COMP", [["above", "above"], ["below", "below"]]),
        num("HEIGHT", 120, 30, 150, 10),
        drop("REACT", [["land", "land"], ["hover", "hover"], ["fly up", "up"], ["fly down", "down"]])] }) },
  ];
  BLOCKS.forEach((b) => {
    b.json.type = b.type;
    const cat = CATEGORIES.find((c) => c.id === b.cat);
    b.json.style = `cat_${b.cat || "flight"}`;
    if (b.type === "drone_start") b.json.style = "cat_events";
    b.json.tooltip = "";
    b.level = cat ? cat.level : 0;
  });

  const BLOCK_BY_TYPE = Object.fromEntries(BLOCKS.map((b) => [b.type, b]));

  // Standard Blockly toolbox contents for Level 2, official grouping.
  const shadowNum = (n) => ({ shadow: { type: "math_number", fields: { NUM: n } } });
  const STANDARD_CONTENTS = {
    console: [
      { kind: "block", type: "text_print", inputs: { TEXT: { shadow: { type: "text", fields: { TEXT: "Hello World!" } } } } },
      { kind: "block", type: "text" },
      { kind: "block", type: "text_join" },
    ],
    control_extra: [
      { kind: "label", text: "Logic" },
      { kind: "block", type: "controls_if" },
      { kind: "block", type: "logic_compare" },
      { kind: "block", type: "logic_operation" },
      { kind: "block", type: "logic_negate" },
      { kind: "block", type: "logic_boolean" },
      { kind: "label", text: "Loops" },
      { kind: "block", type: "controls_repeat_ext", inputs: { TIMES: shadowNum(10) } },
      { kind: "block", type: "controls_whileUntil" },
      { kind: "block", type: "controls_for", inputs: { FROM: shadowNum(0), TO: shadowNum(10), BY: shadowNum(1) } },
      { kind: "block", type: "controls_forEach" },
      { kind: "block", type: "controls_flow_statements" },
      { kind: "label", text: "Timing" },
      { kind: "block", type: "drone_wait" },
      { kind: "block", type: "drone_time_now" },
    ],
    math: [
      { kind: "block", type: "math_number" },
      { kind: "block", type: "math_arithmetic", inputs: { A: shadowNum(1), B: shadowNum(1) } },
      { kind: "block", type: "math_single", inputs: { NUM: shadowNum(9) } },
      { kind: "block", type: "math_trig", inputs: { NUM: shadowNum(45) } },
      { kind: "block", type: "math_constant" },
      { kind: "block", type: "math_number_property", inputs: { NUMBER_TO_CHECK: shadowNum(0) } },
      { kind: "block", type: "math_round", inputs: { NUM: shadowNum(3.1) } },
      { kind: "block", type: "math_on_list" },
      { kind: "block", type: "math_modulo", inputs: { DIVIDEND: shadowNum(64), DIVISOR: shadowNum(10) } },
      { kind: "block", type: "math_constrain", inputs: { VALUE: shadowNum(50), LOW: shadowNum(1), HIGH: shadowNum(100) } },
      { kind: "block", type: "math_random_int", inputs: { FROM: shadowNum(1), TO: shadowNum(100) } },
      { kind: "block", type: "math_random_float" },
    ],
    lists: [
      { kind: "block", type: "lists_create_empty" },
      { kind: "block", type: "lists_create_with" },
      { kind: "block", type: "lists_repeat", inputs: { NUM: shadowNum(5) } },
      { kind: "block", type: "lists_length" },
      { kind: "block", type: "lists_isEmpty" },
      { kind: "block", type: "lists_indexOf" },
      { kind: "block", type: "lists_getIndex" },
      { kind: "block", type: "lists_setIndex" },
      { kind: "block", type: "lists_getSublist" },
      { kind: "block", type: "lists_sort" },
      { kind: "block", type: "lists_split" },
      { kind: "block", type: "lists_reverse" },
    ],
  };

  function toolboxForLevel(level) {
    const contents = [];
    for (const cat of CATEGORIES) {
      if (cat.level !== level) continue;
      const entry = {
        kind: "category", name: cat.name, categorystyle: `catstyle_${cat.id}`,
        cssconfig: { row: `drone-cat-row drone-cat-${cat.id}`, icon: "drone-cat-icon", label: "drone-cat-label" },
      };
      if (cat.custom) {
        entry.custom = cat.custom;
      } else {
        const own = BLOCKS.filter((b) => b.cat === cat.id).map((b) => {
          const item = { kind: "block", type: b.type };
          if (b.shadows) {
            item.inputs = {};
            for (const [name, n] of Object.entries(b.shadows)) item.inputs[name] = shadowNum(n);
          }
          return item;
        });
        if (cat.id === "console") entry.contents = STANDARD_CONTENTS.console;
        else if (cat.id === "control") entry.contents = STANDARD_CONTENTS.control_extra;
        else if (cat.id === "math") entry.contents = STANDARD_CONTENTS.math;
        else if (cat.id === "lists") entry.contents = STANDARD_CONTENTS.lists;
        else entry.contents = own;
        if (!entry.contents.length) continue;
      }
      contents.push(entry);
    }
    return { kind: "categoryToolbox", contents };
  }

  // ---- Level 1 flat-run mapping (existing /api/run path) --------------------

  function stepFor(type, fields) {
    const meta = BLOCK_BY_TYPE[type];
    if (!meta) return null;
    switch (type) {
      case "drone_takeoff": case "pic_takeoff": return { action: "takeoff", value: null };
      case "drone_land": case "pic_land": return { action: "land", value: null };
      case "drone_led_off": case "pic_led_off": return { action: "led_off", value: null };
      case "drone_ping": case "pic_beep": return { action: "ping", value: null };
      case "drone_go": {
        const dir = DIRS6.some(([, v]) => v === fields.DIR) ? fields.DIR : "forward";
        const cm = clampNum(fields.VALUE, 0, 99999, 50) * (UNIT_CM[fields.UNIT] || 1);
        return { action: dir === "backward" ? "back" : dir, value: clampNum(cm, 20, 150, 50) };
      }
      case "pic_go": {
        const dir = fields.DIR === "backward" ? "back" : fields.DIR;
        return { action: ["forward", "back", "left", "right", "up", "down"].includes(dir) ? dir : "forward",
          value: clampNum(fields.VALUE, 20, 150, 50) };
      }
      case "drone_turn": case "pic_turn":
        return { action: fields.DIR === "left" ? "turn_left" : "turn_right",
          value: clampNum(fields.VALUE, 45, 180, 90) };
      case "drone_hover": case "pic_hover":
        return { action: "hover", value: clampNum(fields.VALUE, 1, 5, 2) };
      case "drone_flip": case "pic_flip":
        return { action: "flip", value: ["front", "back", "left", "right"].includes(fields.DIR) ? fields.DIR : "back" };
      case "pic_led":
        return { action: "led", value: [...(LED_COLOURS[fields.COLOUR] || LED_COLOURS.red)] };
      case "drone_led":
        return { action: "led", value: { rgb: [...(LED_COLOURS[fields.COLOUR] || LED_COLOURS.red)],
          brightness: clampNum(fields.BRIGHT, 0, 255, 255), device: fields.DEVICE === "controller" ? "controller" : "drone" } };
      case "drone_led_rgb":
        return { action: "led", value: { rgb: [clampNum(fields.R, 0, 255, 255), clampNum(fields.G, 0, 255, 0), clampNum(fields.B, 0, 255, 0)],
          brightness: clampNum(fields.BRIGHT, 0, 255, 255), device: fields.DEVICE === "controller" ? "controller" : "drone" } };
      case "drone_led_sequence":
        return { action: "led_sequence", value: {
          device: fields.DEVICE === "controller" ? "controller" : "drone",
          mode: ["dimming", "fade_in", "fade_out", "blink", "double_blink", "rainbow"].includes(fields.MODE) ? fields.MODE : "blink",
          rgb: [clampNum(fields.R, 0, 255, 0), clampNum(fields.G, 0, 255, 0), clampNum(fields.B, 0, 255, 255)],
          speed: clampNum(Number(fields.SPEED), 1, 5, 3) } };
      case "drone_buzzer":
        return { action: "buzzer", value: { frequency: clampNum(fields.NOTE, 100, 4000, 523),
          duration: clampNum(fields.DUR, 100, 3000, 500), device: fields.DEVICE === "controller" ? "controller" : "drone" } };
      case "drone_frequency":
        return { action: "buzzer", value: { frequency: clampNum(fields.FREQ, 100, 4000, 500),
          duration: clampNum(fields.DUR, 100, 3000, 1000), device: fields.DEVICE === "controller" ? "controller" : "drone" } };
      case "drone_sound_sequence": case "pic_sound":
        return { action: "sound_sequence", value: { kind: ["success", "warning", "error"].includes(fields.KIND) ? fields.KIND : "success",
          device: fields.DEVICE === "controller" ? "controller" : "drone" } };
      case "drone_square": case "drone_triangle": case "drone_circle": case "drone_sway":
      case "pic_square": case "pic_triangle": case "pic_circle": case "pic_sway":
        return { action: meta.action, value: { direction: fields.DIR === "left" ? "left" : "right", speed: 40, duration: 1 } };
      case "drone_avoid_wall":
        return { action: "avoid_wall", value: { distance: clampNum(fields.DIST, 20, 100, 50), timeout: clampNum(fields.TIMEOUT, 2, 10, 5) } };
      case "drone_keep_distance":
        return { action: "keep_distance", value: { distance: clampNum(fields.DIST, 20, 100, 50), timeout: clampNum(fields.TIMEOUT, 2, 10, 5) } };
      case "drone_goto":
        return { action: "goto", value: { x: clampNum(fields.X, -1.5, 1.5, 0) * 100,
          y: clampNum(fields.Y, -1.5, 1.5, 0) * 100, z: clampNum(fields.Z, 0.5, 1.5, 0.8) * 100 } };
      case "drone_turn_power":
        return { action: "turn_power", value: { direction: fields.DIR === "left" ? "left" : "right",
          power: clampNum(fields.POWER, 20, 70, 50), duration: clampNum(fields.DUR, 0.5, 3, 1) } };
      case "drone_turn_to":
        return { action: "turn_to", value: clampNum(fields.VALUE, 0, 359, 90) };
      case "drone_set_rpyt":
        return { action: "set_rpyt", value: { axis: ["roll", "pitch", "yaw", "throttle"].includes(fields.AXIS) ? fields.AXIS : "roll",
          power: clampNum(fields.POWER, -30, 30, 0) } };
      case "drone_move_sec":
        return { action: "move_apply", value: clampNum(fields.DUR, 0.2, 3, 1) };
      case "drone_move_bare":
        return { action: "move_apply", value: 1 };
      case "drone_reset_gyro":
        return { action: "reset_gyro", value: null };
      case "drone_if_wall": {
        const react = ["turn_left", "turn_right", "hover", "land"].includes(fields.REACT) ? fields.REACT : "turn_right";
        return { action: "if_wall", value: { distance: clampNum(fields.DIST, 20, 100, 50), reaction: react,
          reaction_value: react === "land" ? null : react === "hover" ? 2 : 90 } };
      }
      case "drone_if_height": {
        const react = ["land", "hover", "up", "down"].includes(fields.REACT) ? fields.REACT : "land";
        return { action: "if_height", value: { comparison: fields.COMP === "below" ? "below" : "above",
          height: clampNum(fields.HEIGHT, 30, 150, 120), reaction: react,
          reaction_value: react === "land" ? null : react === "hover" ? 2 : 40 } };
      }
      case "drone_go_power":
        return { action: "go_power", value: { direction: DIRS6.some(([, v]) => v === fields.DIR) ? fields.DIR : "forward",
          power: clampNum(fields.POWER, 20, 70, 50), duration: clampNum(fields.DUR, 0.5, 3, 1) } };
      default:
        return null;
    }
  }

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

  // ---- migration of pre-Blockly saved plans (kept from the old CODE tab) ----

  const OLD_DEF_TO_TYPE = {
    takeoff: "drone_takeoff", land: "drone_land", forward: "drone_go",
    back: "drone_go", left: "drone_go", right: "drone_go",
    up: "drone_go", down: "drone_go", turn_left: "drone_turn",
    turn_right: "drone_turn", go_power: "drone_go_power",
    led_red: "pic_led", led_green: "pic_led", led_blue: "pic_led",
    led_yellow: "pic_led", led_purple: "pic_led", led_off: "pic_led_off",
    ping: "pic_beep", buzzer: "drone_buzzer", sound_sequence: "drone_sound_sequence",
    hover: "drone_hover", avoid_wall: "drone_avoid_wall", if_wall: "drone_if_wall",
    if_height: "drone_if_height", flip_front: "drone_flip", flip_back: "drone_flip",
    flip_left: "drone_flip", flip_right: "drone_flip", square: "drone_square",
    triangle: "drone_triangle", circle: "drone_circle", sway: "drone_sway",
  };

  function nearestLedColour(rgb) {
    if (!Array.isArray(rgb) || rgb.length !== 3) return "red";
    let best = "red", bestDist = Infinity;
    for (const [name, ref] of Object.entries(LED_COLOURS)) {
      if (name === "black" || name === "cyan" || name === "magenta") continue;
      const d = (ref[0] - rgb[0]) ** 2 + (ref[1] - rgb[1]) ** 2 + (ref[2] - rgb[2]) ** 2;
      if (d < bestDist) { bestDist = d; best = name; }
    }
    return best;
  }

  function migratedFields(type, step) {
    const v = step.value;
    const obj = (x) => (x && typeof x === "object" ? x : {});
    switch (type) {
      case "drone_go": {
        const dirMap = { forward: "forward", back: "backward", left: "left", right: "right", up: "up", down: "down" };
        return { DIR: dirMap[step.defId] || "forward", VALUE: clampNum(v, 20, 150, 50), UNIT: "cm" };
      }
      case "drone_turn": {
        const deg = clampNum(v, 45, 180, 90);
        return { DIR: step.defId === "turn_left" ? "left" : "right", VALUE: deg };
      }
      case "drone_hover": return { VALUE: clampNum(v, 1, 5, 2) };
      case "drone_flip": return { DIR: ["front", "back", "left", "right"].includes(v) ? v : "back" };
      case "pic_led": return { COLOUR: nearestLedColour(v) };
      case "drone_buzzer": return { NOTE: String(clampNum(obj(v).frequency, 100, 4000, 523)), DUR: clampNum(obj(v).duration, 100, 3000, 500), DEVICE: "drone" };
      case "drone_sound_sequence": return { KIND: ["success", "warning", "error"].includes(v) ? v : "success", DEVICE: "drone" };
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
    const rootList = [];
    const stack = [rootList];
    for (const step of oldSteps) {
      if (!step || typeof step !== "object") continue;
      if (step.defId === "repeat_start") {
        const node = { repeat: true, times: clampNum(step.value, 2, 5, 2), body: [] };
        stack[stack.length - 1].push(node);
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
          ? Object.assign({ type: "pic_repeat", fields: { TIMES: item.times } },
              item.body.length ? { inputs: { DO: { block: toChain(item.body) } } } : {})
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

  return { CATEGORIES, LED_COLOURS, NOTES, UNIT_CM, BLOCKS, BLOCK_BY_TYPE,
    toolboxForLevel, stepFor, clampNum, stepsFromScript, migrateOldProgram };
});
