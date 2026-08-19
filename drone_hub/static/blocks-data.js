"use strict";
/* Pure data + logic for the Blockly editor. No DOM, no Blockly API here,
   so Node can unit-test it (node --test drone_hub/tests). */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.DroneBlocksData = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  const CATEGORIES = [
    { id: "flight", name: "Flight", icon: "↗", colour: "#ffc86f" },
    { id: "movement", name: "Movement", icon: "↔", colour: "#ff9d2e" },
    { id: "lights", name: "Lights", icon: "☼", colour: "#c334ee" },
    { id: "sound", name: "Sound", icon: "♪", colour: "#586bdc" },
    { id: "timing", name: "Timing", icon: "◷", colour: "#ef4771" },
    { id: "loops", name: "Loops", icon: "⟳", colour: "#9edced" },
    { id: "sensors", name: "Sensors", icon: "◉", colour: "#9583f4" },
    { id: "logic", name: "Logic", icon: "◇", colour: "#48dbad" },
    { id: "tricks", name: "Tricks", icon: "✦", colour: "#df7bea" },
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
  const TURN = (label) => stmt({ message0: `${label} %1°`, args0: [num("VALUE", 90, 45, 180, 1)] });
  const PATTERN = (label) => stmt({ message0: `${label} %1`, args0: [drop("DIR", [["clockwise", "right"], ["counter-clockwise", "left"]])] });

  const BLOCKS = [
    { type: "drone_takeoff", action: "takeoff", category: "flight", minLevel: 1,
      json: stmt({ message0: "↑ take off" }) },
    { type: "drone_land", action: "land", category: "flight", minLevel: 1,
      json: stmt({ message0: "↓ land safely" }) },
    { type: "drone_forward", action: "forward", category: "movement", minLevel: 1, json: DIST("fly forward") },
    { type: "drone_back", action: "back", category: "movement", minLevel: 1, json: DIST("fly backward") },
    { type: "drone_turn_left", action: "turn_left", category: "movement", minLevel: 1, json: TURN("↶ turn left") },
    { type: "drone_turn_right", action: "turn_right", category: "movement", minLevel: 1, json: TURN("turn right ↷") },
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
      json: stmt({ message0: "♪ beep and blink" }) },
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
    // First pass: nested lists; repeat_start opens a body, repeat_end closes it.
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
          ? Object.assign({ type: "drone_repeat", fields: { TIMES: item.times } },
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

  return { CATEGORIES, LED_COLOURS, BLOCKS, BLOCK_BY_TYPE, toolboxForLevel, stepValue, clampNum,
    stepsFromScript, pythonLines, migrateOldProgram };
});
