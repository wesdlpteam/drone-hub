"use strict";
/* Level 2 run engine. Blocks compile to JavaScript (Blockly generator) and run
   in a sandboxed JS-Interpreter. Drone actions go through /api/command (server
   allowlist + clamps stay the safety authority); sensors via /api/sensors.
   Loads after app.js (api, toast, token, droneId, showPicker are shared). */

const DroneRunner = (function () {
  const D = () => window.DroneBlocksData;
  const MAX_RUN_ACTIONS = 30;      // mirror of MAX_PROGRAM_STEPS
  const clampN = (v, lo, hi, fb) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb;
  };

  let running = false;
  let abortFlag = false;
  let actionCount = 0;
  let onStateChange = null;   // callback(runningBool)
  let printSink = null;       // callback(text)
  let highlightSink = null;   // callback(blockId)

  function resolveGen(kind) {
    const B = window.Blockly;
    if (!B) return null;
    if (kind === "js") return B.JavaScript || (B.javascript && B.javascript.javascriptGenerator) || null;
    return B.Python || (B.python && B.python.pythonGenerator) || null;
  }

  /* ------------------------ generators for custom blocks ----------------- */

  function fieldOr(block, name, fallback) {
    try { const v = block.getFieldValue(name); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }
  const q = (s) => JSON.stringify(String(s));

  function installGenerators() {
    const js = resolveGen("js");
    const py = resolveGen("py");
    if (!js) return false;
    const jsF = js.forBlock || js;
    const pyF = py ? (py.forBlock || py) : null;
    const vJS = (block, name, fb) => {
      const code = js.valueToCode(block, name, 0);
      return code ? `(${code})` : String(fb);
    };
    const vPY = (block, name, fb) => {
      if (!py) return String(fb);
      const code = py.valueToCode(block, name, 0);
      return code ? `(${code})` : String(fb);
    };

    // action, [argName -> code] builders. da() is the interpreter binding.
    const defs = {
      drone_start: {
        js: () => "",
        py: () => "",
      },
      drone_takeoff: { js: () => "da('takeoff', null);\n", py: () => "drone.takeoff()\n" },
      drone_land: { js: () => "da('land', null);\n", py: () => "drone.land()\n" },
      drone_hover: {
        js: (b) => `da('hover', ${vJS(b, "VALUE", 1)});\n`,
        py: (b) => `drone.hover(${vPY(b, "VALUE", 1)})\n`,
      },
      drone_go: {
        js: (b) => `da('go', {dir: ${q(fieldOr(b, "DIR", "forward"))}, n: ${vJS(b, "VALUE", 50)}, unit: ${q(fieldOr(b, "UNIT", "cm"))}});\n`,
        py: (b) => {
          const dir = fieldOr(b, "DIR", "forward"), unit = fieldOr(b, "UNIT", "cm"), n = vPY(b, "VALUE", 50);
          if (dir === "up" || dir === "down") return `drone.go("${dir}", 40, 1)\n`;
          const fn = { forward: "move_forward", backward: "move_backward", left: "move_left", right: "move_right" }[dir];
          return `drone.${fn}(${n}, "${unit}")\n`;
        },
      },
      drone_go_power: {
        js: (b) => `da('go_power', {direction: ${q(fieldOr(b, "DIR", "forward"))}, duration: ${vJS(b, "DUR", 1)}, power: ${vJS(b, "POWER", 50)}});\n`,
        py: (b) => `drone.go("${fieldOr(b, "DIR", "forward")}", ${vPY(b, "POWER", 50)}, ${vPY(b, "DUR", 1)})\n`,
      },
      drone_goto: {
        js: (b) => `da('goto', {x: ${vJS(b, "X", 0)}, y: ${vJS(b, "Y", 0)}, z: ${vJS(b, "Z", 0.8)}});\n`,
        py: (b) => `drone.send_absolute_position(${vPY(b, "X", 0)}, ${vPY(b, "Y", 0)}, ${vPY(b, "Z", 0.8)}, 0.5, 0, 0)\n`,
      },
      drone_turn: {
        js: (b) => `da('turn', {dir: ${q(fieldOr(b, "DIR", "left"))}, n: ${vJS(b, "VALUE", 90)}});\n`,
        py: (b) => `drone.turn_${fieldOr(b, "DIR", "left")}(${vPY(b, "VALUE", 90)})\n`,
      },
      drone_turn_power: {
        js: (b) => `da('turn_power', {direction: ${q(fieldOr(b, "DIR", "left"))}, duration: ${vJS(b, "DUR", 1)}, power: ${vJS(b, "POWER", 50)}});\n`,
        py: (b) => `drone.set_yaw(${fieldOr(b, "DIR", "left") === "left" ? "" : "-"}${vPY(b, "POWER", 50)})\ndrone.move(${vPY(b, "DUR", 1)})\ndrone.set_yaw(0)\n`,
      },
      drone_turn_to: {
        js: (b) => `da('turn_to', ${vJS(b, "VALUE", 90)});\n`,
        py: (b) => `drone.turn_degree(${vPY(b, "VALUE", 90)})\n`,
      },
      drone_set_rpyt: {
        js: (b) => `da('set_rpyt', {axis: ${q(fieldOr(b, "AXIS", "roll"))}, power: ${vJS(b, "POWER", 0)}});\n`,
        py: (b) => `drone.set_${fieldOr(b, "AXIS", "roll")}(${vPY(b, "POWER", 0)})\n`,
      },
      drone_move_sec: {
        js: (b) => `da('move_apply', ${vJS(b, "DUR", 1)});\n`,
        py: (b) => `drone.move(${vPY(b, "DUR", 1)})\n`,
      },
      drone_move_bare: { js: () => "da('move_apply', 1);\n", py: () => "drone.move(1)\n" },
      drone_flip: {
        js: (b) => `da('flip', ${q(fieldOr(b, "DIR", "back"))});\n`,
        py: (b) => `drone.flip("${fieldOr(b, "DIR", "back")}")\n`,
      },
      drone_circle: { js: (b) => patJS(b, "circle"), py: (b) => `drone.circle(40, ${fieldOr(b, "DIR", "right") === "right" ? 1 : -1})\n` },
      drone_triangle: { js: (b) => patJS(b, "triangle"), py: (b) => patPY(b, "triangle") },
      drone_square: { js: (b) => patJS(b, "square"), py: (b) => patPY(b, "square") },
      drone_sway: { js: () => "da('sway', {direction: 'right', speed: 40, duration: 1});\n", py: () => "drone.sway(40, 1, 1)\n" },
      drone_avoid_wall: {
        js: (b) => `da('avoid_wall', {distance: ${vJS(b, "DIST", 50)}, timeout: ${vJS(b, "TIMEOUT", 5)}});\n`,
        py: (b) => `drone.avoid_wall(timeout=${vPY(b, "TIMEOUT", 5)}, distance=${vPY(b, "DIST", 50)})\n`,
      },
      drone_keep_distance: {
        js: (b) => `da('keep_distance', {distance: ${vJS(b, "DIST", 50)}, timeout: ${vJS(b, "TIMEOUT", 5)}});\n`,
        py: (b) => `drone.keep_distance(timeout=${vPY(b, "TIMEOUT", 5)}, distance=${vPY(b, "DIST", 50)})\n`,
      },
      drone_led: {
        js: (b) => `da('led', {named: ${q(fieldOr(b, "COLOUR", "red"))}, brightness: ${vJS(b, "BRIGHT", 255)}, device: ${q(fieldOr(b, "DEVICE", "drone"))}});\n`,
        py: (b) => ledPY(b, (D().LED_COLOURS[fieldOr(b, "COLOUR", "red")] || D().LED_COLOURS.red).join(", ")),
      },
      drone_led_rgb: {
        js: (b) => `da('led', {rgb: [${vJS(b, "R", 255)}, ${vJS(b, "G", 0)}, ${vJS(b, "B", 0)}], brightness: ${vJS(b, "BRIGHT", 255)}, device: ${q(fieldOr(b, "DEVICE", "drone"))}});\n`,
        py: (b) => ledPY(b, `${vPY(b, "R", 255)}, ${vPY(b, "G", 0)}, ${vPY(b, "B", 0)}`),
      },
      drone_led_sequence: {
        js: (b) => `da('led_sequence', {device: ${q(fieldOr(b, "DEVICE", "drone"))}, mode: ${q(fieldOr(b, "MODE", "blink"))}, rgb: [${vJS(b, "R", 0)}, ${vJS(b, "G", 0)}, ${vJS(b, "B", 255)}], speed: ${Number(fieldOr(b, "SPEED", "3")) || 3}});\n`,
        py: (b) => `# LED sequence ${fieldOr(b, "MODE", "blink")}\n${ledPY(b, `${vPY(b, "R", 0)}, ${vPY(b, "G", 0)}, ${vPY(b, "B", 255)}`)}`,
      },
      drone_led_off: {
        js: (b) => `da('led_off', {device: ${q(fieldOr(b, "DEVICE", "drone"))}});\n`,
        py: (b) => fieldOr(b, "DEVICE", "drone") === "controller" ? "drone.controller_LED_off()\n" : "drone.drone_LED_off()\n",
      },
      drone_buzzer: {
        js: (b) => `da('buzzer', {frequency: ${Number(fieldOr(b, "NOTE", "523")) || 523}, duration: ${vJS(b, "DUR", 500)}, device: ${q(fieldOr(b, "DEVICE", "drone"))}});\n`,
        py: (b) => `drone.${fieldOr(b, "DEVICE", "drone")}_buzzer(${Number(fieldOr(b, "NOTE", "523")) || 523}, ${vPY(b, "DUR", 500)})\n`,
      },
      drone_frequency: {
        js: (b) => `da('buzzer', {frequency: ${vJS(b, "FREQ", 500)}, duration: ${vJS(b, "DUR", 1000)}, device: ${q(fieldOr(b, "DEVICE", "drone"))}});\n`,
        py: (b) => `drone.${fieldOr(b, "DEVICE", "drone")}_buzzer(${vPY(b, "FREQ", 500)}, ${vPY(b, "DUR", 1000)})\n`,
      },
      drone_sound_sequence: {
        js: (b) => `da('sound_sequence', {kind: ${q(fieldOr(b, "KIND", "success"))}, device: ${q(fieldOr(b, "DEVICE", "drone"))}});\n`,
        py: (b) => `drone.drone_buzzer_sequence("${fieldOr(b, "KIND", "success")}")\n`,
      },
      drone_reset_gyro: { js: () => "da('reset_gyro', null);\n", py: () => "drone.reset_gyro()\n" },
      drone_wait: {
        js: (b) => `waitSeconds(${vJS(b, "DUR", 1)});\n`,
        py: (b) => `time.sleep(${vPY(b, "DUR", 1)})\n`,
      },
      // legacy blocks from old saves still run
      drone_ping: { js: () => "da('ping', null);\n", py: () => "drone.ping()\n" },
      pic_beep: { js: () => "da('ping', null);\n", py: () => "drone.ping()\n" },
    };

    // sensor value blocks -> sv('<key>', 'arg') expression
    const sensorDefs = {
      drone_get_angle: { js: (b) => [`sv('angle', ${q(fieldOr(b, "AXIS", "x"))}, '')`, `drone.get_angle_${fieldOr(b, "AXIS", "x")}()`] },
      drone_get_angular_speed: { js: (b) => [`sv('angular_speed', ${q(fieldOr(b, "AXIS", "x"))}, '')`, `drone.get_angular_speed_${fieldOr(b, "AXIS", "x")}()`] },
      drone_get_accel: { js: (b) => [`sv('accel', ${q(fieldOr(b, "AXIS", "x"))}, '')`, `drone.get_accel_${fieldOr(b, "AXIS", "x")}()`] },
      drone_get_range: { js: (b) => [`sv('range', ${q(fieldOr(b, "WHICH", "front"))}, ${q(fieldOr(b, "UNIT", "cm"))})`, `drone.get_${fieldOr(b, "WHICH", "front")}_range("${fieldOr(b, "UNIT", "cm")}")`] },
      drone_get_height_val: { js: (b) => [`sv('height', '', ${q(fieldOr(b, "UNIT", "cm"))})`, `drone.get_height("${fieldOr(b, "UNIT", "cm")}")`] },
      drone_get_position: { js: (b) => [`sv('position', ${q(fieldOr(b, "AXIS", "x"))}, ${q(fieldOr(b, "UNIT", "cm"))})`, `drone.get_pos_${fieldOr(b, "AXIS", "x")}("${fieldOr(b, "UNIT", "cm")}")`] },
      drone_get_color: { js: (b) => [`sv('color', ${q(fieldOr(b, "WHICH", "front"))}, '')`, `drone.get_colors()[${fieldOr(b, "WHICH", "front") === "front" ? 0 : 1}]`] },
      drone_get_color_component: { js: (b) => [`sv('color_component', ${q(fieldOr(b, "WHICH", "front"))}, ${q(fieldOr(b, "COMP", "hue"))})`, `drone.get_color_data()  # ${fieldOr(b, "COMP", "hue")}`] },
      drone_get_pressure: { js: (b) => [`sv('pressure', '', ${q(fieldOr(b, "UNIT", "pascal"))})`, `drone.get_pressure()`] },
      drone_get_elevation: { js: (b) => [`sv('elevation', '', ${q(fieldOr(b, "UNIT", "m"))})`, `drone.get_elevation("${fieldOr(b, "UNIT", "m")}")`] },
      drone_get_temperature: { js: (b) => [`sv('temperature', '', ${q(fieldOr(b, "UNIT", "F"))})`, `drone.get_drone_temperature("${fieldOr(b, "UNIT", "F")}")`] },
      drone_get_battery: { js: () => ["sv('battery', '', '')", "drone.get_battery()"] },
      drone_get_state: { js: (b) => [`sv('state', ${q(fieldOr(b, "WHICH", "flight"))}, '')`, `drone.get_${fieldOr(b, "WHICH", "flight")}_state()`] },
      drone_time_now: { js: (b) => [fieldOr(b, "UNIT", "ms") === "s" ? "(timeNow() / 1000)" : "timeNow()", fieldOr(b, "UNIT", "ms") === "s" ? "time.time()" : "(time.time() * 1000)"] },
    };

    function patJS(b, name) {
      return `da('${name}', {direction: ${q(fieldOr(b, "DIR", "right"))}, speed: 40, duration: 1});\n`;
    }
    function patPY(b, name) {
      return `drone.${name}(40, 1, ${fieldOr(b, "DIR", "right") === "right" ? 1 : -1})\n`;
    }
    function ledPY(b, rgbCode) {
      const dev = fieldOr(b, "DEVICE", "drone") === "controller" ? "controller" : "drone";
      return `drone.set_${dev}_LED(${rgbCode}, ${vPY(b, "BRIGHT", 255)})\n`;
    }

    for (const [type, def] of Object.entries(defs)) {
      jsF[type] = (block) => def.js(block);
      if (pyF) pyF[type] = (block) => def.py(block);
    }
    for (const [type, def] of Object.entries(sensorDefs)) {
      jsF[type] = (block) => [def.js(block)[0], 0];
      if (pyF) pyF[type] = (block) => [def.js(block)[1], 0];
    }
    // legacy statement blocks from old saves (flat semantics)
    const legacy = {
      pic_takeoff: "drone_takeoff", pic_land: "drone_land", pic_hover: "drone_hover",
      pic_flip: "drone_flip", pic_square: "drone_square", pic_triangle: "drone_triangle",
      pic_circle: "drone_circle", pic_sway: "drone_sway", pic_led_off: "drone_led_off",
    };
    for (const [type, target] of Object.entries(legacy)) {
      jsF[type] = (block) => defs[target].js(block);
      if (pyF) pyF[type] = (block) => defs[target].py(block);
    }
    const flatStep = (block) => {
      const fields = {};
      block.inputList.forEach((inp) => inp.fieldRow.forEach((f) => { if (f.name) fields[f.name] = f.getValue(); }));
      return D().stepFor(block.type, fields);
    };
    ["pic_go", "pic_turn", "pic_led", "pic_sound", "drone_if_wall", "drone_if_height"].forEach((type) => {
      jsF[type] = (block) => {
        const step = flatStep(block);
        return step ? `da(${q(step.action)}, ${JSON.stringify(step.value)});\n` : "";
      };
      if (pyF) pyF[type] = () => "";
    });
    const repeatGen = (gen, isPy) => (block) => {
      const times = clampN(block.getFieldValue("TIMES"), 2, 5, 2);
      const branch = gen.statementToCode(block, "DO") || (isPy ? "    pass\n" : "");
      return isPy ? `for _ in range(${times}):\n${branch}` : `for (var _i = 0; _i < ${times}; _i++) {\n${branch}}\n`;
    };
    jsF.pic_repeat = repeatGen(js, false);
    jsF.drone_repeat = repeatGen(js, false);
    if (pyF) { pyF.pic_repeat = repeatGen(py, true); pyF.drone_repeat = repeatGen(py, true); }
    // print goes to the app console panel, not window.alert
    jsF.text_print = (block) => `printLine(String(${js.valueToCode(block, "TEXT", 0) || "''"}));\n`;
    return true;
  }

  /* ------------------------ code building --------------------------------- */

  function buildCode(workspace, kind) {
    const gen = resolveGen(kind);
    if (!gen) return null;
    if (kind === "js") {
      gen.STATEMENT_PREFIX = "highlightBlock(%1);\n";
      gen.addReservedWords("highlightBlock,da,sv,waitSeconds,printLine,timeNow,LoopTrap");
      gen.INFINITE_LOOP_TRAP = 'if (--LoopTrap < 0) { throw "loop"; }\n';
    }
    gen.init(workspace);
    let tops = workspace.getTopBlocks(true).filter((b) => !b.isInsertionMarker());
    const hats = tops.filter((b) => b.type === "drone_start");
    if (hats.length) tops = hats;   // official behaviour: the start hat runs
    const parts = [];
    for (const top of tops) {
      let code = gen.blockToCode(top);
      if (Array.isArray(code)) code = "";   // a lone value block does nothing
      if (code) parts.push(code);
    }
    let all = parts.join("\n");
    all = gen.finish(all);
    if (kind === "js") {
      gen.STATEMENT_PREFIX = "";
      gen.INFINITE_LOOP_TRAP = null;
    }
    return all;
  }

  /* ------------------------ hub I/O --------------------------------------- */

  async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async function hubStatusMine() {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (!res.ok) return null;
      const s = await res.json();
      if (s.paused) throw { reason: "paused" };
      return (s.drones || []).find((d) => d.id === droneId) || null;
    } catch (e) {
      if (e && e.reason) throw e;
      return null;
    }
  }

  async function waitForIdle() {
    for (let i = 0; i < 480; i++) {           // <= 2 minutes per action
      if (abortFlag) throw { reason: "stopped" };
      const d = await hubStatusMine();
      if (d && !d.current && d.queue === 0) return;
      await sleep(250);
    }
    throw { reason: "timeout" };
  }

  function buildValue(action, a) {
    const dd = (v, opts, fb) => (opts.includes(v) ? v : fb);
    switch (action) {
      case "go": {
        const cm = clampN(a.n, 0, 1e6, 50) * (D().UNIT_CM[a.unit] || 1);
        const dir = dd(a.dir, ["forward", "backward", "left", "right", "up", "down"], "forward");
        return { action: dir === "backward" ? "back" : dir, value: clampN(cm, 20, 150, 50) };
      }
      case "turn":
        return { action: a.dir === "left" ? "turn_left" : "turn_right", value: clampN(a.n, 45, 180, 90) };
      case "hover": return { action, value: clampN(a, 1, 5, 1) };
      case "go_power": return { action, value: { direction: dd(a.direction, ["forward", "backward", "left", "right", "up", "down"], "forward"), power: clampN(a.power, 20, 70, 50), duration: clampN(a.duration, 0.5, 3, 1) } };
      case "goto": return { action, value: { x: clampN(a.x, -1.5, 1.5, 0) * 100, y: clampN(a.y, -1.5, 1.5, 0) * 100, z: clampN(a.z, 0.5, 1.5, 0.8) * 100 } };
      case "turn_power": return { action, value: { direction: a.direction === "right" ? "right" : "left", power: clampN(a.power, 20, 70, 50), duration: clampN(a.duration, 0.5, 3, 1) } };
      case "turn_to": return { action, value: clampN(a, 0, 359, 90) };
      case "set_rpyt": return { action, value: { axis: dd(a.axis, ["roll", "pitch", "yaw", "throttle"], "roll"), power: clampN(a.power, -30, 30, 0) } };
      case "move_apply": return { action, value: clampN(a, 0.2, 3, 1) };
      case "flip": return { action, value: dd(a, ["front", "back", "left", "right"], "back") };
      case "square": case "triangle": case "circle": case "sway":
        return { action, value: { direction: a.direction === "left" ? "left" : "right", speed: 40, duration: 1 } };
      case "avoid_wall": case "keep_distance":
        return { action, value: { distance: clampN(a.distance, 20, 100, 50), timeout: clampN(a.timeout, 2, 10, 5) } };
      case "led": {
        const rgb = a.named ? [...(D().LED_COLOURS[a.named] || D().LED_COLOURS.red)]
          : (Array.isArray(a.rgb) ? a.rgb.map((v) => clampN(v, 0, 255, 0)) : [255, 0, 0]);
        return { action, value: { rgb, brightness: clampN(a.brightness, 0, 255, 255), device: a.device === "controller" ? "controller" : "drone" } };
      }
      case "led_sequence": return { action, value: { device: a.device === "controller" ? "controller" : "drone", mode: dd(a.mode, ["dimming", "fade_in", "fade_out", "blink", "double_blink", "rainbow"], "blink"), rgb: (a.rgb || [0, 0, 255]).map((v) => clampN(v, 0, 255, 0)), speed: clampN(a.speed, 1, 5, 3) } };
      case "led_off": return { action, value: { device: a && a.device === "controller" ? "controller" : "drone" } };
      case "buzzer": return { action, value: { frequency: clampN(a.frequency, 100, 4000, 523), duration: clampN(a.duration, 100, 3000, 500), device: a.device === "controller" ? "controller" : "drone" } };
      case "sound_sequence": return { action, value: { kind: dd(a.kind, ["success", "warning", "error"], "success"), device: a.device === "controller" ? "controller" : "drone" } };
      case "if_wall": case "if_height": return { action, value: a };
      default: return { action, value: a === undefined ? null : a };
    }
  }

  async function doDroneAction(action, args) {
    if (abortFlag) throw { reason: "stopped" };
    actionCount += 1;
    if (actionCount > MAX_RUN_ACTIONS) throw { reason: "too_many" };
    const step = buildValue(action, args);
    for (let attempt = 0; attempt < 60; attempt++) {
      if (abortFlag) throw { reason: "stopped" };
      const { ok, data } = await api("/api/command", { action: step.action, value: step.value, token, drone_id: droneId });
      if (ok) break;
      if (data.error === "busy") { await sleep(400); continue; }
      if (data.error === "paused") throw { reason: "paused" };
      throw { reason: "rejected" };
    }
    await waitForIdle();
  }

  const SENSOR_UNITS = {
    cm: (v) => v, mm: (v) => v * 10, in: (v) => v / 2.54, m: (v) => v / 100,
  };

  async function readSensor(kind, arg, unit) {
    if (abortFlag) throw { reason: "stopped" };
    await waitForIdle();
    const { ok, data } = await api("/api/sensors", { drone_id: droneId });
    if (!ok || !data.sensors) return 0;
    const s = data.sensors;
    const conv = SENSOR_UNITS[unit] || ((v) => v);
    const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    switch (kind) {
      case "angle": return n(s["angle_" + arg]);
      case "angular_speed": return n(s["angular_speed_" + arg]);
      case "accel": return n(s["accel_" + arg]);
      case "range": return conv(n(arg === "bottom" ? s.bottom_range : s.front_range));
      case "height": return conv(n(s.height));
      case "position": return conv(n(s["pos_" + arg]));
      case "color": return String(arg === "back" ? (s.color_back || "unknown") : (s.color_front || "unknown"));
      case "color_component": {
        const src = arg === "back" ? s.color_data_back : s.color_data_front;
        return src && Number.isFinite(Number(src[unit])) ? Number(src[unit]) : 0;
      }
      case "pressure": return unit === "millibar" ? n(s.pressure) / 100 : n(s.pressure);
      case "elevation": {
        const m = n(s.elevation);
        return unit === "km" ? m / 1000 : unit === "ft" ? m * 3.28084 : unit === "mi" ? m / 1609.344 : m;
      }
      case "temperature": {
        const c = n(s.temperature);
        return unit === "F" ? c * 9 / 5 + 32 : unit === "K" ? c + 273.15 : c;
      }
      case "battery": return n(s.battery);
      case "state": return String(arg === "movement" ? (s.movement_state || "ready") : (s.flight_state || "ready"));
      default: return 0;
    }
  }

  /* ------------------------ interpreter ----------------------------------- */

  function makeInterpreter(code) {
    return new Interpreter("var LoopTrap = 200000;\n" + code, (interp, globalObject) => {
      interp.setProperty(globalObject, "highlightBlock",
        interp.createNativeFunction((id) => { if (highlightSink) highlightSink(String(id)); }));
      interp.setProperty(globalObject, "printLine",
        interp.createNativeFunction((text) => { if (printSink) printSink(String(text)); }));
      interp.setProperty(globalObject, "timeNow",
        interp.createNativeFunction(() => Date.now()));
      interp.setProperty(globalObject, "da",
        interp.createAsyncFunction((action, argsPseudo, callback) => {
          const args = interp.pseudoToNative(argsPseudo);
          doDroneAction(String(action), args).then(() => callback(undefined), (err) => { failRun(err); });
        }));
      interp.setProperty(globalObject, "sv",
        interp.createAsyncFunction((kind, arg, unit, callback) => {
          readSensor(String(kind), String(arg), String(unit)).then(
            (v) => callback(interp.nativeToPseudo(v)), (err) => { failRun(err); });
        }));
      interp.setProperty(globalObject, "waitSeconds",
        interp.createAsyncFunction((secs, callback) => {
          const ms = clampN(secs, 0, 10, 1) * 1000;
          const started = Date.now();
          const tick = () => {
            if (abortFlag) return failRun({ reason: "stopped" });
            if (Date.now() - started >= ms) return callback(undefined);
            setTimeout(tick, 100);
          };
          tick();
        }));
    });
  }

  let finishRun = null;
  function failRun(err) { if (finishRun) finishRun(err || { reason: "error" }); }

  /* ------------------------ public API ------------------------------------ */

  const FRIENDLY = {
    stopped: "Program stopped.",
    paused: "Your teacher has paused flying.",
    too_many: `That is more than ${MAX_RUN_ACTIONS} drone steps in one run.`,
    timeout: "The drone took too long, so the program stopped.",
    rejected: "One of those blocks is not safe to run.",
    loop: "Your program looped too many times, so it stopped.",
    error: "Something went wrong running your program.",
  };

  return {
    installGenerators,
    isRunning: () => running,
    pythonFor(workspace) {
      const py = resolveGen("py");
      if (!py) return "";
      try {
        const body = buildCode(workspace, "py") || "";
        const needsTime = /time\./.test(body);
        return ["from codrone_edu.drone import Drone", needsTime ? "import time" : null, "",
          "drone = Drone()", "drone.pair()", "", body.trim() || "pass", "", "drone.close()"]
          .filter((l) => l !== null).join("\n");
      } catch (e) { return "# Python preview unavailable for this plan"; }
    },
    abort() { abortFlag = true; },
    onState(cb) { onStateChange = cb; },
    onPrint(cb) { printSink = cb; },
    onHighlight(cb) { highlightSink = cb; },
    async run(workspace) {
      if (running) { this.abort(); return { ok: false, reason: "stopped" }; }
      let code;
      try { code = buildCode(workspace, "js"); }
      catch (e) { return { ok: false, reason: "error" }; }
      if (!code || !/da\(|sv\(|printLine|waitSeconds/.test(code)) {
        return { ok: false, reason: "empty" };
      }
      running = true;
      abortFlag = false;
      actionCount = 0;
      if (onStateChange) onStateChange(true);
      const interp = makeInterpreter(code);
      const result = await new Promise((resolve) => {
        let settled = false;
        finishRun = (err) => { if (!settled) { settled = true; resolve(err || null); } };
        const pump = () => {
          if (settled) return;
          if (abortFlag) return finishRun({ reason: "stopped" });
          let more = false;
          try { more = interp.run(); }
          catch (e) { return finishRun({ reason: e === "loop" ? "loop" : "error" }); }
          if (more) setTimeout(pump, 25);
          else finishRun(null);
        };
        pump();
      });
      finishRun = null;
      running = false;
      if (onStateChange) onStateChange(false);
      if (highlightSink) highlightSink(null);
      if (result) return { ok: false, reason: result.reason, message: FRIENDLY[result.reason] || FRIENDLY.error };
      return { ok: true };
    },
  };
})();
window.DroneRunner = DroneRunner;
