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
        trail = [];
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

    $("modeChip").textContent = s.mode === "practice" ? "🎮 Practice" : "🚁 Real";
    if (d) {
      $("droneChip").textContent = `● ${d.name}`;
      $("droneChip").style.background = `rgb(${d.colour.join(",")})`;
      $("droneChip").style.color = "#fff";
      const battery = d.battery < 0 ? "?" : `${d.battery}%`;
      $("batteryChip").textContent = `🔋 ${battery}`;
      $("batteryChip").classList.toggle("warn", d.battery >= 0 && d.battery < 30);
      $("pilotChip").textContent = `👤 ${d.pilot || "nobody"}`;
    } else {
      $("droneChip").textContent = "🎨 pick a drone";
      $("droneChip").style.background = "";
      $("droneChip").style.color = "";
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

    $("mapPanel").classList.toggle("hidden", s.mode !== "practice" || !d);
    if (s.mode === "practice" && d && d.pose) drawMap(d.pose, d.led);
  } catch (err) {
    $("modeChip").textContent = "⛔ No connection";
  }
  setTimeout(poll, 1000);
}

/* ---------------- practice map ---------------- */

function drawMap(pose, led) {
  const canvas = $("map");
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const scale = w / 400; // 4 m x 4 m practice sky
  const cx = w / 2 + pose.x * scale;
  const cy = h / 2 - pose.y * scale;

  trail.push([cx, cy]);
  if (trail.length > 150) trail.shift();

  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#c9e4f8";
  ctx.lineWidth = 1;
  for (let g = 0; g <= w; g += 50 * scale) {
    ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(w, g); ctx.stroke();
  }
  ctx.fillStyle = "#b7d9f2";
  ctx.beginPath(); ctx.arc(w / 2, h / 2, 14, 0, Math.PI * 2); ctx.fill();

  if (trail.length > 1) {
    ctx.strokeStyle = "#7fc2ef";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(trail[0][0], trail[0][1]);
    trail.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((pose.heading * Math.PI) / 180);
  const size = 14 + pose.altitude / 12;
  ctx.fillStyle = `rgb(${led[0]},${led[1]},${led[2]})`;
  ctx.strokeStyle = "#17324d";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.8, size);
  ctx.lineTo(0, size * 0.5);
  ctx.lineTo(-size * 0.8, size);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (pose.trick) {
    ctx.rotate(-((pose.heading * Math.PI) / 180));
    ctx.font = "28px sans-serif";
    ctx.fillText("🤸", 14, -14);
  }
  ctx.restore();

  const pct = Math.min(1, pose.altitude / 250);
  $("altFill").style.transform = `scaleX(${pct})`;
  $("altLabel").textContent = `${Math.round(pose.altitude)} cm`;
}

applyLevel();
poll();
