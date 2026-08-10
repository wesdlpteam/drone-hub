/* Drone Pilot — iPad client for the CoDrone EDU Hub.
   Multi-drone + 5 coding levels (Ozobot-style). Vanilla JS, no libraries. */

"use strict";

const $ = (id) => document.getElementById(id);

let token = sessionStorage.getItem("droneToken") || null;
let myName = sessionStorage.getItem("droneName") || "";
let droneId = sessionStorage.getItem("droneId") || null;
let level = parseInt(localStorage.getItem("codeLevel") || "1", 10);
let selectedDist = 50, selectedTurn = 90;          // FLY page settings
let codeDist = 50, codeTurn = 90, repeatCount = 2; // CODE page settings (L3+)
let program = [];        // {action, value, label}
let runningStep = null;  // 1-based index into the FLATTENED program
let flatMap = [];        // flattened index -> program index (for highlights)
let lastStatus = null;
let trail = [];
let radarFrom = null, radarTo = null, radarLed = [55, 213, 242];
let radarStart = 0, radarDuration = 1000, radarLastPoll = 0;
let radarFrame = null, radarFace = null, radarFaceKey = "";
let radarSweepGradient = null, radarSweepKey = "";
let radarPixelRatio = 1, radarCanvasDirty = true;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/* ---------------- helpers ---------------- */

function toast(msg, ms = 1800) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add("hidden"), ms);
}

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && data.error === "not_pilot") {
    token = null;
    sessionStorage.removeItem("droneToken");
    showPicker();
    toast("Someone else took your drone! Pick again.");
  }
  return { ok: res.ok, data };
}

function labelFor(action, value) {
  const names = {
    takeoff: "🛫 Take off", land: "🛬 Land", forward: "⬆️ Forward",
    back: "⬇️ Backward", left: "⬅️ Slide left", right: "➡️ Slide right",
    up: "🔼 Up", down: "🔽 Down", turn_left: "↩️ Turn left",
    turn_right: "↪️ Turn right", hover: "⏱️ Wait", flip: "🤸 Flip",
    led: "🌈 Light", repeat_start: "🔁 Repeat", repeat_end: "🏁 End repeat",
  };
  let label = names[action] || action;
  if (["forward", "back", "left", "right", "up", "down"].includes(action)) label += ` ${value} cm`;
  else if (action.startsWith("turn")) label += ` ${value}°`;
  else if (action === "hover") label += ` ${value} s`;
  else if (action === "repeat_start") label += ` ×${value}`;
  return label;
}

function myDrone() {
  if (!lastStatus || !droneId) return null;
  return lastStatus.drones.find((d) => d.id === droneId) || null;
}

/* ---------------- join + drone picker ---------------- */

$("joinBtn").addEventListener("click", () => {
  myName = $("nameInput").value.trim() || "Pilot";
  sessionStorage.setItem("droneName", myName);
  $("joinOverlay").classList.add("hidden");
  showPicker();
});
$("watchBtn").addEventListener("click", () => $("joinOverlay").classList.add("hidden"));
$("pickBackBtn").addEventListener("click", () => $("pickOverlay").classList.add("hidden"));
$("droneChip").addEventListener("click", () => {
  if (!myName) $("joinOverlay").classList.remove("hidden");
  else showPicker();
});

function showPicker() {
  $("pickOverlay").classList.remove("hidden");
  renderDroneCards();
}

function renderDroneCards() {
  const box = $("droneCards");
  if (!lastStatus) { box.innerHTML = "<p>Connecting…</p>"; return; }
  box.innerHTML = "";
  lastStatus.drones.forEach((d) => {
    const card = document.createElement("button");
    card.className = "drone-card";
    const battery = d.battery < 0 ? "?" : d.battery + "%";
    card.innerHTML =
      `<span class="dot" style="background:rgb(${d.colour.join(",")})"></span>` +
      `<span class="dc-name">${d.name}</span>` +
      `<span class="dc-sub">🔋 ${battery} · ${d.pilot ? "👤 " + d.pilot : "free!"}</span>`;
    card.addEventListener("click", async () => {
      const { data } = await api("/api/control", { drone_id: d.id, name: myName });
      if (data.token) {
        token = data.token;
        droneId = d.id;
        sessionStorage.setItem("droneToken", token);
        sessionStorage.setItem("droneId", droneId);
        resetRadar();
        $("pickOverlay").classList.add("hidden");
        toast(`You fly the ${d.name}, ${myName}! 🎉`);
      }
    });
    box.append(card);
  });
}

if (token && droneId) $("joinOverlay").classList.add("hidden");
if (myName) $("nameInput").value = myName;

/* ---------------- tabs ---------------- */

function showTab(fly) {
  $("tabFly").classList.toggle("active", fly);
  $("tabCode").classList.toggle("active", !fly);
  $("flyPage").classList.toggle("hidden", !fly);
  $("codePage").classList.toggle("hidden", fly);
  syncRadarLoop();
}
$("tabFly").addEventListener("click", () => showTab(true));
$("tabCode").addEventListener("click", () => showTab(false));

/* ---------------- FLY controls ---------------- */

async function sendCommand(action, value) {
  if (!token || !droneId) { showPicker(); return; }
  const { ok, data } = await api("/api/command", { action, value, token, drone_id: droneId });
  if (ok) toast(data.label || "Sent!");
  else if (data.error === "busy") toast("Whoa, slow down! Your drone is busy.");
  else if (data.error === "paused") toast("⏸️ Your teacher has paused flying.");
}

document.querySelectorAll("[data-cmd]").forEach((b) =>
  b.addEventListener("click", () => {
    const cmd = b.dataset.cmd;
    sendCommand(cmd, cmd === "flip" ? "back" : null);
  })
);
document.querySelectorAll("[data-move]").forEach((b) =>
  b.addEventListener("click", () => sendCommand(b.dataset.move, selectedDist))
);
document.querySelectorAll("[data-turn]").forEach((b) =>
  b.addEventListener("click", () => sendCommand(b.dataset.turn, selectedTurn))
);
document.querySelectorAll("#ledRow .led").forEach((b) =>
  b.addEventListener("click", () => sendCommand("led", b.dataset.led.split(",").map(Number)))
);

function chipGroup(sel, apply) {
  document.querySelectorAll(sel).forEach((b) =>
    b.addEventListener("click", () => {
      apply(b);
      document.querySelectorAll(sel).forEach((x) => x.classList.toggle("active", x === b));
    })
  );
}
chipGroup("#distChips .chip-btn", (b) => (selectedDist = Number(b.dataset.dist)));
chipGroup("#turnChips .chip-btn", (b) => (selectedTurn = Number(b.dataset.deg)));
chipGroup("#codeDistChips .chip-btn", (b) => (codeDist = Number(b.dataset.dist)));
chipGroup("#codeTurnChips .chip-btn", (b) => (codeTurn = Number(b.dataset.deg)));
chipGroup("#repeatChips .chip-btn", (b) => (repeatCount = Number(b.dataset.rep)));

/* ---------------- STOP ---------------- */

$("stopBtn").addEventListener("click", async () => {
  await api("/api/stop", droneId ? { drone_id: droneId } : {});
  toast("🛑 Stopping and landing…");
});
$("motorsOffBtn").addEventListener("click", () => $("emergencyOverlay").classList.remove("hidden"));
$("cancelMotorsOff").addEventListener("click", () => $("emergencyOverlay").classList.add("hidden"));
$("confirmMotorsOff").addEventListener("click", async () => {
  $("emergencyOverlay").classList.add("hidden");
  await api("/api/motors_off", droneId ? { drone_id: droneId } : {});
  toast("⚠️ Motors off!");
});

/* ---------------- coding levels ---------------- */

const LEVEL_HINTS = {
  1: "Tap the pictures to build your flight, then press RUN!",
  2: "New blocks: slide, up & down, and wait.",
  3: "You choose the numbers now — distance, turns and more.",
  4: "Repeat blocks! Put blocks between 🔁 Repeat and 🏁 End repeat.",
  5: "You're coding like a pro — check out the real Python your blocks make!",
};

function applyLevel() {
  localStorage.setItem("codeLevel", String(level));
  document.querySelectorAll(".level-btn").forEach((b) =>
    b.classList.toggle("active", Number(b.dataset.level) === level)
  );
  document.querySelectorAll("[data-min-level]").forEach((el) => {
    el.classList.toggle("hidden", level < Number(el.dataset.minLevel));
  });
  $("palette").classList.toggle("icons-only", level === 1);
  $("pythonPanel").classList.toggle("hidden", level < 5);
  $("levelHint").textContent = LEVEL_HINTS[level];
  renderPython();
}

document.querySelectorAll(".level-btn").forEach((b) =>
  b.addEventListener("click", () => { level = Number(b.dataset.level); applyLevel(); })
);

/* ---------------- CODE (block programs) ---------------- */

function blockValue(action) {
  const dist = level >= 3 ? codeDist : 50;
  const turn = level >= 3 ? codeTurn : 90;
  if (["forward", "back", "left", "right", "up", "down"].includes(action)) return dist;
  if (action === "turn_left" || action === "turn_right") return turn;
  if (action === "hover") return 2;
  if (action === "flip") return "back";
  if (action === "repeat_start") return repeatCount;
  if (action === "led") {
    const colours = [[255, 89, 100], [255, 209, 102], [6, 214, 160], [76, 201, 240], [179, 136, 255]];
    return colours[Math.floor(Math.random() * colours.length)];
  }
  return null;
}

function renderProgram() {
  const list = $("programList");
  list.innerHTML = "";
  $("programEmpty").classList.toggle("hidden", program.length > 0);
  const runningProgIdx = runningStep !== null && flatMap[runningStep - 1] !== undefined
    ? flatMap[runningStep - 1] : null;
  let depth = 0;
  program.forEach((step, i) => {
    if (step.action === "repeat_end") depth = Math.max(0, depth - 1);
    const li = document.createElement("li");
    if (runningProgIdx === i) li.classList.add("running");
    if (depth > 0 && step.action !== "repeat_start") li.classList.add("nested");
    if (step.action === "repeat_start") depth += 1;
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = i + 1;
    const lbl = document.createElement("span");
    lbl.className = "lbl";
    lbl.textContent = step.label;
    li.append(num, lbl);
    [["▲", () => moveStep(i, -1)], ["▼", () => moveStep(i, 1)],
     ["✖️", () => { program.splice(i, 1); renderProgram(); }]].forEach(([txt, fn]) => {
      const btn = document.createElement("button");
      btn.textContent = txt;
      btn.addEventListener("click", fn);
      li.append(btn);
    });
    list.append(li);
  });
  renderPython();
}

function moveStep(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= program.length) return;
  [program[i], program[j]] = [program[j], program[i]];
  renderProgram();
}

document.querySelectorAll(".palette .block").forEach((b) =>
  b.addEventListener("click", () => {
    if (program.length >= 30) return toast("Program is full (30 blocks max)");
    const action = b.dataset.block;
    const value = blockValue(action);
    program.push({ action, value, label: labelFor(action, value) });
    renderProgram();
  })
);

$("clearBtn").addEventListener("click", () => { program = []; renderProgram(); });

function flattenProgram() {
  /* Expands repeat blocks into a flat step list the server understands.
     Returns {steps, map} or {error}. One level of repeats only. */
  const steps = [], map = [];
  let block = null, count = 0;
  for (let i = 0; i < program.length; i++) {
    const { action, value } = program[i];
    if (action === "repeat_start") {
      if (block !== null) return { error: "One repeat at a time! Finish it with 🏁 first." };
      block = []; count = value;
    } else if (action === "repeat_end") {
      if (block === null) return { error: "🏁 End repeat needs a 🔁 Repeat before it." };
      for (let r = 0; r < count; r++) block.forEach(([s, idx]) => { steps.push(s); map.push(idx); });
      block = null;
    } else if (block !== null) {
      block.push([{ action, value }, i]);
    } else {
      steps.push({ action, value }); map.push(i);
    }
  }
  if (block !== null) return { error: "Your 🔁 Repeat needs a 🏁 End repeat block." };
  if (!steps.length) return { error: "Add some blocks first!" };
  if (steps.length > 30) return { error: "Too many steps after repeats (30 max)." };
  return { steps, map };
}

$("runBtn").addEventListener("click", async () => {
  if (!token || !droneId) return showPicker();
  const flat = flattenProgram();
  if (flat.error) return toast(flat.error);
  flatMap = flat.map;
  const { ok } = await api("/api/run", { steps: flat.steps, token, drone_id: droneId });
  if (ok) toast("▶️ Program running!");
});

/* ---------------- Python view (level 5) ---------------- */

function pythonFor(action, value) {
  switch (action) {
    case "takeoff": return "drone.takeoff()";
    case "land": return "drone.land()";
    case "forward": return `drone.move_forward(${value}, "cm")`;
    case "back": return `drone.move_backward(${value}, "cm")`;
    case "left": return `drone.move_left(${value}, "cm")`;
    case "right": return `drone.move_right(${value}, "cm")`;
    case "up": return `drone.go("up", 40, 1.0)`;
    case "down": return `drone.go("down", 40, 1.0)`;
    case "turn_left": return `drone.turn_left(${value})`;
    case "turn_right": return `drone.turn_right(${value})`;
    case "hover": return `drone.hover(${value})`;
    case "flip": return `drone.flip("${value}")`;
    case "led": return `drone.set_drone_LED(${value.join(", ")}, 255)`;
    default: return null;
  }
}

function renderPython() {
  if (level < 5) return;
  const lines = ["from codrone_edu.drone import Drone", "", "drone = Drone()", "drone.pair()"];
  let indent = "";
  program.forEach(({ action, value }) => {
    if (action === "repeat_start") {
      lines.push(`for i in range(${value}):`);
      indent = "    ";
    } else if (action === "repeat_end") {
      indent = "";
    } else {
      const code = pythonFor(action, value);
      if (code) lines.push(indent + code);
    }
  });
  lines.push("drone.close()");
  $("pythonCode").textContent = lines.join("\n");
}

/* ---------------- status polling ---------------- */

async function poll() {
  try {
    const res = await fetch("/api/status");
    const s = await res.json();
    lastStatus = s;
    const d = myDrone();

    $("modeChip").textContent = s.mode === "practice" ? "PRACTICE" : "LIVE";
    document.body.classList.remove("radar-stale");
    document.body.classList.toggle("flying", !!(d && d.flying));
    if (d) {
      $("droneChip").textContent = `● ${d.name}`;
      $("droneChip").style.background = `rgb(${d.colour.join(",")})`;
      $("droneChip").style.color = "#fff";
      const battery = d.battery < 0 ? "—" : `${d.battery}%`;
      $("batteryChip").textContent = battery;
      $("batteryChip").classList.toggle("warn", d.battery >= 0 && d.battery < 30);
      $("batteryChip").classList.toggle("caution", d.battery >= 30 && d.battery < 50);
      $("batteryChip").classList.toggle("known", d.battery >= 0);
      $("pilotChip").textContent = d.pilot || "—";
    } else {
      $("droneChip").textContent = "PICK A DRONE";
      $("droneChip").style.background = "";
      $("droneChip").style.color = "";
      $("batteryChip").textContent = "—";
      $("pilotChip").textContent = "—";
      $("batteryChip").classList.remove("warn", "caution", "known");
    }

    const now = $("nowBar");
    if (s.paused) {
      now.classList.remove("hidden");
      now.textContent = "⏸️ Your teacher has paused flying — eyes up front!";
      if (runningStep !== null) { runningStep = null; renderProgram(); }
    } else if (d && d.current) {
      now.classList.remove("hidden");
      now.textContent = d.current.step
        ? `Step ${d.current.step}/${d.current.total}: ${d.current.label}`
        : `Now: ${d.current.label}`;
      const prev = runningStep;
      runningStep = d.current.step || null;
      if (prev !== runningStep) renderProgram();
    } else {
      now.classList.add("hidden");
      if (runningStep !== null) { runningStep = null; renderProgram(); }
    }

    if (!$("pickOverlay").classList.contains("hidden")) renderDroneCards();

    const showMap = s.mode === "practice" && !!d;
    $("mapPanel").classList.toggle("hidden", !showMap);
    if (showMap && d.pose) updateRadarPose(d.pose, d.led);
    syncRadarLoop();
  } catch (err) {
    $("modeChip").textContent = "NO LINK";
    document.body.classList.remove("flying");
    document.body.classList.add("radar-stale");
    stopRadarLoop();
  }
  setTimeout(poll, 1000);
}

/* ---------------- practice map ---------------- */

function poseCopy(pose) {
  const finite = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  };
  return {
    x: finite(pose.x),
    y: finite(pose.y),
    altitude: finite(pose.altitude),
    heading: finite(pose.heading),
    trick: pose.trick || null,
  };
}

function resetRadar() {
  radarFrom = null;
  radarTo = null;
  radarLastPoll = 0;
  trail = [];
  syncRadarLoop();
}

function updateRadarPose(pose, led) {
  const now = performance.now();
  const next = poseCopy(pose);
  if (radarTo) {
    radarFrom = interpolatedPose(now) || radarTo;
    radarTo = next;
    radarDuration = radarLastPoll
      ? Math.max(400, Math.min(1250, now - radarLastPoll))
      : 1000;
  } else {
    radarFrom = next;
    radarTo = next;
    radarDuration = 1;
  }
  radarStart = now;
  radarLastPoll = now;
  radarLed = Array.isArray(led) ? led.slice(0, 3) : [55, 213, 242];
  const lastTrailPoint = trail[trail.length - 1];
  if (!lastTrailPoint || Math.hypot(next.x - lastTrailPoint.x, next.y - lastTrailPoint.y) >= 1) {
    trail.push({ x: next.x, y: next.y, time: now });
  }
  while (trail.length > 150 || (trail[0] && now - trail[0].time > 90000)) trail.shift();
}

function interpolatedPose(now) {
  if (!radarTo) return null;
  const from = radarFrom || radarTo;
  const t = Math.max(0, Math.min(1, (now - radarStart) / radarDuration));
  const turn = ((radarTo.heading - from.heading + 540) % 360) - 180;
  return {
    x: from.x + (radarTo.x - from.x) * t,
    y: from.y + (radarTo.y - from.y) * t,
    altitude: from.altitude + (radarTo.altitude - from.altitude) * t,
    heading: (from.heading + turn * t + 360) % 360,
    trick: radarTo.trick || (t < 1 ? from.trick : null),
  };
}

function radarVisible() {
  const panel = $("mapPanel");
  return !document.hidden && panel && !panel.classList.contains("hidden") &&
    !$("flyPage").classList.contains("hidden");
}

function stopRadarLoop() {
  if (radarFrame !== null) cancelAnimationFrame(radarFrame);
  radarFrame = null;
}

function syncRadarLoop() {
  if (!radarVisible() || !radarTo || reducedMotion.matches) {
    stopRadarLoop();
    if (radarVisible() && radarTo && reducedMotion.matches) {
      const now = performance.now();
      drawMap(radarTo, radarLed, null, now);
    }
    return;
  }
  if (radarFrame === null) radarFrame = requestAnimationFrame(radarTick);
}

function radarTick(now) {
  radarFrame = null;
  if (!radarVisible() || reducedMotion.matches) {
    syncRadarLoop();
    return;
  }
  const pose = interpolatedPose(now);
  if (pose) drawMap(pose, radarLed, ((now % 4000) / 4000) * Math.PI * 2 - Math.PI / 2, now);
  if (radarVisible()) radarFrame = requestAnimationFrame(radarTick);
}

function markRadarCanvasDirty() {
  radarCanvasDirty = true;
  radarFace = null;
  radarSweepGradient = null;
  syncRadarLoop();
}

function ensureRadarCanvas(canvas) {
  if (!radarCanvasDirty) return;
  const cssSize = Math.round(canvas.getBoundingClientRect().width);
  if (cssSize < 2) return;
  const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const backingSize = Math.round(cssSize * ratio);
  if (canvas.width !== backingSize || canvas.height !== backingSize || radarPixelRatio !== ratio) {
    canvas.width = backingSize;
    canvas.height = backingSize;
    radarPixelRatio = ratio;
    radarFace = null;
    radarFaceKey = "";
    radarSweepGradient = null;
    radarSweepKey = "";
  }
  radarCanvasDirty = false;
}

function radarMetrics(w, h) {
  const radius = Math.max(60, Math.min(w, h) / 2 - 24);
  return { ox: w / 2, oy: h / 2, radius, scale: radius / 200 };
}

function radarFaceFor(canvas, w, h) {
  const key = `${canvas.width}x${canvas.height}@${radarPixelRatio}`;
  if (radarFace && radarFaceKey === key) return radarFace;

  const makeLayer = () => {
    const layer = document.createElement("canvas");
    layer.width = canvas.width;
    layer.height = canvas.height;
    return layer;
  };
  const base = makeLayer();
  const overlay = makeLayer();
  radarFace = { base, overlay };
  radarFaceKey = key;
  radarSweepGradient = null;

  const { ox, oy, radius, scale } = radarMetrics(w, h);
  const baseCtx = base.getContext("2d");
  baseCtx.setTransform(radarPixelRatio, 0, 0, radarPixelRatio, 0, 0);
  const bg = baseCtx.createRadialGradient(ox, oy, 0, ox, oy, radius * 1.35);
  bg.addColorStop(0, "#0b1c2b");
  bg.addColorStop(0.68, "#07131f");
  bg.addColorStop(1, "#02060d");
  baseCtx.fillStyle = bg;
  baseCtx.fillRect(0, 0, w, h);

  const ctx = overlay.getContext("2d");
  ctx.setTransform(radarPixelRatio, 0, 0, radarPixelRatio, 0, 0);
  ctx.save();
  ctx.beginPath();
  ctx.arc(ox, oy, radius, 0, Math.PI * 2);
  ctx.clip();

  const grid = (step, colour, lineWidth) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    for (let x = ox % step; x <= w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = oy % step; y <= h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  };
  grid(25 * scale, "rgba(103, 147, 181, 0.12)", 0.7);
  grid(50 * scale, "rgba(111, 161, 195, 0.19)", 1);

  ctx.strokeStyle = "rgba(130, 177, 207, 0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox, oy - radius); ctx.lineTo(ox, oy + radius);
  ctx.moveTo(ox - radius, oy); ctx.lineTo(ox + radius, oy);
  ctx.stroke();
  ctx.restore();

  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(128, 180, 210, 0.38)";
  ctx.fillStyle = "#9eb6c9";
  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  [50, 100, 150].forEach((centimetres) => {
    const ringRadius = centimetres * scale;
    ctx.beginPath();
    ctx.arc(ox, oy, ringRadius, 0, Math.PI * 2);
    ctx.stroke();
    const angle = -Math.PI / 4;
    ctx.fillText(`${(centimetres / 100).toFixed(1)}M`,
      ox + Math.cos(angle) * ringRadius + 5,
      oy + Math.sin(angle) * ringRadius - 2);
  });

  ctx.strokeStyle = "rgba(151, 198, 224, 0.56)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(ox, oy, radius, 0, Math.PI * 2);
  ctx.stroke();

  for (let degrees = 0; degrees < 360; degrees += 10) {
    const angle = (degrees * Math.PI) / 180 - Math.PI / 2;
    const major = degrees % 30 === 0;
    const inner = radius - (major ? 9 : 5);
    ctx.strokeStyle = major ? "rgba(189, 222, 239, 0.78)" : "rgba(137, 181, 207, 0.5)";
    ctx.lineWidth = major ? 1.25 : 0.8;
    ctx.beginPath();
    ctx.moveTo(ox + Math.cos(angle) * inner, oy + Math.sin(angle) * inner);
    ctx.lineTo(ox + Math.cos(angle) * radius, oy + Math.sin(angle) * radius);
    ctx.stroke();
  }

  ctx.fillStyle = "#d2e0eb";
  ctx.font = "700 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("N", ox, oy - radius - 12);
  ctx.fillText("E", ox + radius + 12, oy);
  ctx.fillText("S", ox, oy + radius + 12);
  ctx.fillText("W", ox - radius - 12, oy);

  ctx.fillStyle = "rgba(87, 220, 245, 0.13)";
  ctx.strokeStyle = "rgba(87, 220, 245, 0.82)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(ox, oy, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#bff5ff";
  ctx.font = "800 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.fillText("H", ox, oy + 0.5);
  return radarFace;
}

function drawSweep(ctx, w, h, angle) {
  const { ox, oy, radius } = radarMetrics(w, h);
  const key = `${w}x${h}@${radarPixelRatio}`;
  if (!radarSweepGradient || radarSweepKey !== key) {
    radarSweepGradient = ctx.createRadialGradient(ox, oy, 0, ox, oy, radius);
    radarSweepGradient.addColorStop(0, "rgba(55, 213, 242, 0.72)");
    radarSweepGradient.addColorStop(0.72, "rgba(55, 213, 242, 0.18)");
    radarSweepGradient.addColorStop(1, "rgba(55, 213, 242, 0)");
    radarSweepKey = key;
  }

  const span = Math.PI / 4.5;
  ctx.save();
  ctx.beginPath();
  ctx.arc(ox, oy, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = radarSweepGradient;
  for (let i = 0; i < 18; i++) {
    const a0 = angle - span + span * (i / 18);
    const a1 = angle - span + span * ((i + 1) / 18);
    ctx.globalAlpha = 0.018 + 0.2 * Math.pow((i + 1) / 18, 2);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.arc(ox, oy, radius, a0, a1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 0.42;
  ctx.strokeStyle = "#37d5f2";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(ox + Math.cos(angle) * radius, oy + Math.sin(angle) * radius);
  ctx.stroke();
  ctx.restore();
}

function drawTrail(ctx, w, h, now) {
  if (trail.length < 2) return;
  const { ox, oy, radius, scale } = radarMetrics(w, h);
  ctx.save();
  ctx.beginPath();
  ctx.arc(ox, oy, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.lineCap = "round";
  ctx.lineWidth = 2;
  for (let i = 1; i < trail.length; i++) {
    const from = trail[i - 1], to = trail[i];
    const rank = i / (trail.length - 1);
    const age = Math.max(0, Math.min(1, 1 - (now - to.time) / 90000));
    const alpha = 0.52 * rank * age;
    if (alpha <= 0.01) continue;
    ctx.strokeStyle = `rgba(55, 213, 242, ${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(ox + from.x * scale, oy - from.y * scale);
    ctx.lineTo(ox + to.x * scale, oy - to.y * scale);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMap(pose, led, sweepAngle = null, now = performance.now()) {
  const canvas = $("map");
  ensureRadarCanvas(canvas);
  const ctx = canvas.getContext("2d");
  const w = canvas.width / radarPixelRatio, h = canvas.height / radarPixelRatio;
  const { ox, oy, radius, scale } = radarMetrics(w, h); // 4 m x 4 m practice sky
  const dx = pose.x * scale;
  const dy = -pose.y * scale;
  const distance = Math.hypot(dx, dy);
  const limit = radius - 18;
  const clamp = distance > limit ? limit / distance : 1;
  const cx = ox + dx * clamp;
  const cy = oy + dy * clamp;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(radarPixelRatio, 0, 0, radarPixelRatio, 0, 0);
  const face = radarFaceFor(canvas, w, h);
  ctx.drawImage(face.base, 0, 0, w, h);
  if (sweepAngle !== null) drawSweep(ctx, w, h, sweepAngle);
  ctx.drawImage(face.overlay, 0, 0, w, h);
  drawTrail(ctx, w, h, now);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((pose.heading * Math.PI) / 180);
  const size = 13 + Math.min(10, Math.max(0, pose.altitude) / 25);
  const rgb = [0, 1, 2].map((i) => Math.max(0, Math.min(255, Number(led[i]) || 0)));
  const colour = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  ctx.fillStyle = colour;
  ctx.strokeStyle = "#e9f0fa";
  ctx.lineWidth = 2;
  ctx.shadowColor = colour;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.8, size);
  ctx.lineTo(0, size * 0.5);
  ctx.lineTo(-size * 0.8, size);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();
  if (distance > limit) {
    ctx.strokeStyle = "#ffc45d";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, size + 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (pose.trick) {
    ctx.rotate(-((pose.heading * Math.PI) / 180));
    ctx.font = "28px sans-serif";
    ctx.fillText("🤸", 14, -14);
  }
  ctx.restore();

  updateAltitude(pose.altitude);
}

function updateAltitude(altitude) {
  const value = Math.max(0, Math.min(250, Number(altitude) || 0));
  const pct = value / 250;
  const fill = $("altFill");
  const levelKey = pct.toFixed(4);
  if (fill.dataset.level !== levelKey) {
    fill.dataset.level = levelKey;
    fill.style.transform = `scaleX(${pct})`;
    fill.parentElement.style.setProperty("--altitude", `${pct * 100}%`);
  }
  const rounded = Math.round(value);
  if ($("altLabel").dataset.value !== String(rounded)) {
    $("altLabel").dataset.value = String(rounded);
    $("altLabel").textContent = `${rounded} cm`;
    const track = fill.parentElement;
    track.setAttribute("aria-valuenow", String(rounded));
    track.setAttribute("aria-valuetext", `${rounded} centimetres`);
  }
}

function initAltitudeGauge() {
  const track = $("altFill").parentElement;
  track.setAttribute("role", "meter");
  track.setAttribute("aria-label", "Altitude");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "250");
  if (track.querySelector(".alt-ticks")) return;
  const ticks = document.createElement("span");
  ticks.className = "alt-ticks";
  ticks.setAttribute("aria-hidden", "true");
  for (let value = 0; value <= 250; value += 50) {
    const tick = document.createElement("i");
    tick.className = "alt-tick";
    tick.dataset.value = String(value);
    tick.style.left = `${(value / 250) * 100}%`;
    ticks.append(tick);
  }
  track.append(ticks);
}

const onMotionPreference = () => syncRadarLoop();
if (reducedMotion.addEventListener) reducedMotion.addEventListener("change", onMotionPreference);
else reducedMotion.addListener(onMotionPreference);
document.addEventListener("visibilitychange", syncRadarLoop);
window.addEventListener("resize", markRadarCanvasDirty);
window.addEventListener("orientationchange", markRadarCanvasDirty);
if (window.ResizeObserver) {
  const radarResizeObserver = new ResizeObserver(markRadarCanvasDirty);
  radarResizeObserver.observe($("map"));
}

initAltitudeGauge();
applyLevel();
poll();
