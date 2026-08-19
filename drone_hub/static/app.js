/* Drone Pilot — iPad client for the CoDrone EDU Hub.
   Multi-drone + 5 coding levels (Ozobot-style). Vanilla JS, no libraries. */

"use strict";

const $ = (id) => document.getElementById(id);

let token = sessionStorage.getItem("droneToken") || null;
let myName = sessionStorage.getItem("droneName") || "";
let droneId = sessionStorage.getItem("droneId") || null;
let level = parseInt(localStorage.getItem("codeLevel") || "1", 10);
let selectedDist = 50, selectedTurn = 90;          // FLY page settings
let activeCategory = "flight";
let program = [];        // {defId, action, value, sourceLevel}
let runningStep = null;  // 1-based index into the FLATTENED program
let flatMap = [];        // flattened index -> program index (for highlights)
let lastStatus = null;
let trail = [];
let radarFrom = null, radarTo = null, radarLed = [55, 213, 242];
let radarStart = 0, radarDuration = 1000, radarLastPoll = 0;
let radarFrame = null, radarFace = null, radarFaceKey = "";
let radarSweepGradient = null, radarSweepKey = "";
let radarPixelRatio = 1, radarCanvasDirty = true;
let hubConnected = null;
let pollTimer = null;
let deferredInstallPrompt = null;
let programStorageReady = false;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const PROGRAM_STORAGE_KEY = "dronePilotProgramV1";
const APP_TAB_KEY = "dronePilotActiveTab";
const HUB_CONTROL_SELECTOR = [
  "#droneChip", "#runBtn", "#stopBtn", "#motorsOffBtn", "#confirmMotorsOff",
  "[data-cmd]", "[data-move]", "[data-turn]", "#ledRow .led", ".drone-card",
].join(",");

/* ---------------- helpers ---------------- */

function toast(msg, ms = 1800) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add("hidden"), ms);
}

async function fetchWithTimeout(path, options = {}, timeout = 3500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(path, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function setHubConnection(connected) {
  const wasConnected = hubConnected;
  hubConnected = connected;
  document.body.classList.toggle("hub-offline", !connected);
  $("connectionBanner").classList.toggle("hidden", connected);
  document.querySelectorAll(HUB_CONTROL_SELECTOR).forEach((button) => { button.disabled = !connected; });

  if (!connected) {
    $("modeChip").textContent = "NO HUB";
    $("emergencyOverlay").classList.add("hidden");
    $("nowBar").classList.add("hidden");
    document.body.classList.remove("flying");
    document.body.classList.add("radar-stale");
    stopRadarLoop();
    if (runningStep !== null) {
      runningStep = null;
      renderProgram();
    }
  } else if (wasConnected === false) {
    toast("Drone Hub reconnected — flight controls are ready.", 2600);
  }
}

async function api(path, body) {
  try {
    const res = await fetchWithTimeout(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    setHubConnection(true);
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 && data.error === "not_pilot") {
      token = null;
      sessionStorage.removeItem("droneToken");
      showPicker();
      toast("Someone else took your drone! Pick again.");
    }
    return { ok: res.ok, data };
  } catch (error) {
    setHubConnection(false);
    toast("The Drone Hub is offline. Your work is still saved.", 2600);
    return { ok: false, data: { error: "offline" } };
  }
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
    card.disabled = hubConnected !== true;
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

/* ---------------- installable app ---------------- */

const standaloneQuery = window.matchMedia("(display-mode: standalone)");

function isStandaloneApp() {
  return standaloneQuery.matches || window.navigator.standalone === true;
}

function updateAppModeUi() {
  const standalone = isStandaloneApp();
  document.body.classList.toggle("standalone-mode", standalone);
  $("installBtn").classList.toggle("hidden", standalone);
}

function showInstallGuide() {
  $("installOverlay").classList.remove("hidden");
  $("closeInstallBtn").focus();
}

function hideInstallGuide() {
  $("installOverlay").classList.add("hidden");
  $("installBtn").focus();
}

updateAppModeUi();
if (standaloneQuery.addEventListener) standaloneQuery.addEventListener("change", updateAppModeUi);
else if (standaloneQuery.addListener) standaloneQuery.addListener(updateAppModeUi);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateAppModeUi();
});

$("installBtn").addEventListener("click", async () => {
  if (!deferredInstallPrompt) {
    showInstallGuide();
    return;
  }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  updateAppModeUi();
});

$("closeInstallBtn").addEventListener("click", hideInstallGuide);
$("installOverlay").addEventListener("click", (event) => {
  if (event.target === $("installOverlay")) hideInstallGuide();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("installOverlay").classList.contains("hidden")) hideInstallGuide();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  $("installBtn").classList.add("hidden");
  toast("Drone Pilot installed!");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {
    // Classroom HTTP still works as a Home Screen web app. Full offline
    // caching becomes available automatically on localhost or an HTTPS host.
  }));
}

/* ---------------- tabs ---------------- */

function showTab(fly, remember = true) {
  $("tabFly").classList.toggle("active", fly);
  $("tabCode").classList.toggle("active", !fly);
  $("tabFly").setAttribute("aria-selected", String(fly));
  $("tabCode").setAttribute("aria-selected", String(!fly));
  $("flyPage").classList.toggle("hidden", !fly);
  $("codePage").classList.toggle("hidden", fly);
  if (remember) localStorage.setItem(APP_TAB_KEY, fly ? "fly" : "code");
  syncRadarLoop();
}
$("tabFly").addEventListener("click", () => showTab(true));
$("tabCode").addEventListener("click", () => showTab(false));
showTab(localStorage.getItem(APP_TAB_KEY) !== "code", false);

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

/* ---------------- STOP ---------------- */

$("stopBtn").addEventListener("click", async () => {
  const { ok } = await api("/api/stop", droneId ? { drone_id: droneId } : {});
  if (!ok) return;
  toast("🛑 Stopping and landing…");
});
$("motorsOffBtn").addEventListener("click", () => $("emergencyOverlay").classList.remove("hidden"));
$("cancelMotorsOff").addEventListener("click", () => $("emergencyOverlay").classList.add("hidden"));
$("confirmMotorsOff").addEventListener("click", async () => {
  $("emergencyOverlay").classList.add("hidden");
  const { ok } = await api("/api/motors_off", droneId ? { drone_id: droneId } : {});
  if (!ok) return;
  toast("⚠️ Motors off!");
});

/* ---------------- coding levels ---------------- */

/* ---------------- progressive block editor ---------------- */

const PROGRESSIVE_LEVEL_HINTS = {
  1: "Picture blocks use safe ready-made settings. Great for a first flight.",
  2: "Add words, sound, timing, loops, flips and movement in every direction.",
  3: "Tune distances in 1 cm steps, plus angles, colours, notes and flight patterns.",
  4: "Use the front and bottom range sensors to react to the world.",
  5: "Add power-based flight controls and see the real Python your blocks create.",
};

const CODE_CATEGORIES = [
  { id: "flight", name: "Flight", icon: "↗", colour: "#ffc86f" },
  { id: "movement", name: "Movement", icon: "↔", colour: "#ff9d2e" },
  { id: "lights", name: "Lights", icon: "☼", colour: "#c334ee" },
  { id: "sound", name: "Sound", icon: "◖))", colour: "#586bdc" },
  { id: "timing", name: "Timing", icon: "◷", colour: "#ef4771" },
  { id: "loops", name: "Loops", icon: "⟳", colour: "#9edced" },
  { id: "sensors", name: "Sensors", icon: "◉", colour: "#9583f4" },
  { id: "logic", name: "Logic", icon: "◇", colour: "#48dbad" },
  { id: "tricks", name: "Tricks", icon: "✦", colour: "#df7bea" },
];

const BLOCK_DEFS = [
  { id: "takeoff", action: "takeoff", category: "flight", minLevel: 1, icon: "↑", label: "take off", hint: "rise to about 80 cm" },
  { id: "land", action: "land", category: "flight", minLevel: 1, icon: "↓", label: "land safely", hint: "soft landing" },

  { id: "forward", action: "forward", category: "movement", minLevel: 1, icon: "↑", label: "fly forward", hint: "distance" },
  { id: "back", action: "back", category: "movement", minLevel: 1, icon: "↓", label: "fly backward", hint: "distance" },
  { id: "turn_left", action: "turn_left", category: "movement", minLevel: 1, icon: "↶", label: "turn left", hint: "angle" },
  { id: "turn_right", action: "turn_right", category: "movement", minLevel: 1, icon: "↷", label: "turn right", hint: "angle" },
  { id: "left", action: "left", category: "movement", minLevel: 2, icon: "←", label: "slide left", hint: "distance" },
  { id: "right", action: "right", category: "movement", minLevel: 2, icon: "→", label: "slide right", hint: "distance" },
  { id: "up", action: "up", category: "movement", minLevel: 2, icon: "⇡", label: "fly up", hint: "distance" },
  { id: "down", action: "down", category: "movement", minLevel: 2, icon: "⇣", label: "fly down", hint: "distance" },
  { id: "go_power", action: "go_power", category: "movement", minLevel: 5, icon: "➤", label: "fly with power", hint: "direction · power · time" },

  { id: "led_red", action: "led", category: "lights", minLevel: 1, icon: "●", label: "red light", colour: [255, 70, 84] },
  { id: "led_green", action: "led", category: "lights", minLevel: 1, icon: "●", label: "green light", colour: [23, 210, 139] },
  { id: "led_blue", action: "led", category: "lights", minLevel: 1, icon: "●", label: "blue light", colour: [67, 184, 255] },
  { id: "led_yellow", action: "led", category: "lights", minLevel: 2, icon: "●", label: "yellow light", colour: [255, 205, 70] },
  { id: "led_purple", action: "led", category: "lights", minLevel: 2, icon: "●", label: "purple light", colour: [187, 103, 255] },
  { id: "led_off", action: "led_off", category: "lights", minLevel: 2, icon: "○", label: "turn drone light off" },

  { id: "ping", action: "ping", category: "sound", minLevel: 2, icon: "♪", label: "beep and blink" },
  { id: "buzzer", action: "buzzer", category: "sound", minLevel: 3, icon: "♫", label: "play a note", hint: "pitch · duration" },
  { id: "sound_sequence", action: "sound_sequence", category: "sound", minLevel: 3, icon: "♬", label: "play a sound", hint: "success · warning · error" },

  { id: "hover", action: "hover", category: "timing", minLevel: 2, icon: "◷", label: "wait and hover", hint: "seconds" },
  { id: "repeat_start", action: "repeat_start", category: "loops", minLevel: 2, icon: "⟳", label: "repeat", hint: "start of loop" },
  { id: "repeat_end", action: "repeat_end", category: "loops", minLevel: 2, icon: "↵", label: "end repeat", hint: "end of loop" },

  { id: "avoid_wall", action: "avoid_wall", category: "sensors", minLevel: 4, icon: "◉", label: "fly until obstacle", hint: "front range sensor" },
  { id: "if_wall", action: "if_wall", category: "logic", minLevel: 4, icon: "◇", label: "if obstacle is close", hint: "sense, then react" },
  { id: "if_height", action: "if_height", category: "logic", minLevel: 4, icon: "◇", label: "if height matches", hint: "bottom range sensor" },

  { id: "flip_front", action: "flip", category: "tricks", minLevel: 2, icon: "↥", label: "front flip", direction: "front" },
  { id: "flip_back", action: "flip", category: "tricks", minLevel: 2, icon: "↧", label: "back flip", direction: "back" },
  { id: "flip_left", action: "flip", category: "tricks", minLevel: 2, icon: "↶", label: "left flip", direction: "left" },
  { id: "flip_right", action: "flip", category: "tricks", minLevel: 2, icon: "↷", label: "right flip", direction: "right" },
  { id: "square", action: "square", category: "tricks", minLevel: 3, icon: "□", label: "fly a square", hint: "direction" },
  { id: "triangle", action: "triangle", category: "tricks", minLevel: 3, icon: "△", label: "fly a triangle", hint: "direction" },
  { id: "circle", action: "circle", category: "tricks", minLevel: 3, icon: "○", label: "fly a circle", hint: "direction" },
  { id: "sway", action: "sway", category: "tricks", minLevel: 3, icon: "〰", label: "sway side to side", hint: "direction" },
];

const BLOCK_BY_ID = Object.fromEntries(BLOCK_DEFS.map((def) => [def.id, def]));

function categoryFor(id) {
  return CODE_CATEGORIES.find((category) => category.id === id) || CODE_CATEGORIES[0];
}

function unlockedDefs(categoryId = activeCategory) {
  return BLOCK_DEFS.filter((def) => def.category === categoryId && def.minLevel <= level);
}

function renderCategories() {
  const rail = $("categoryRail");
  rail.innerHTML = "";
  CODE_CATEGORIES.forEach((category) => {
    const count = unlockedDefs(category.id).length;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "category-button";
    button.style.setProperty("--category-colour", category.colour);
    button.classList.toggle("active", activeCategory === category.id);
    button.classList.toggle("locked", count === 0);
    button.disabled = count === 0;
    button.setAttribute("aria-label", count ? `${category.name}, ${count} blocks` : `${category.name}, locked`);
    button.innerHTML = `<span class="category-icon" aria-hidden="true">${category.icon}</span>` +
      `<span class="category-name">${category.name}</span><span class="category-count">${count || "•"}</span>`;
    button.addEventListener("click", () => {
      activeCategory = category.id;
      renderCategories();
      renderPalette();
    });
    rail.append(button);
  });
}

function renderPalette() {
  const category = categoryFor(activeCategory);
  $("toolboxTitle").textContent = category.name;
  $("toolboxTitle").style.color = category.colour;
  $("toolboxIcon").textContent = category.icon;
  $("toolboxIcon").style.color = category.colour;
  const palette = $("palette");
  palette.innerHTML = "";
  palette.classList.toggle("icons-only", level === 1);

  unlockedDefs().forEach((def) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "block palette-block";
    button.style.setProperty("--block-colour", category.colour);
    button.draggable = false;
    button.dataset.block = def.id;
    button.setAttribute("aria-label", `Drag ${def.label} to the workspace. Press Enter to add it.`);
    button.title = `Drag ${def.label} into the workspace`;
    const iconStyle = def.colour ? ` style="color:rgb(${def.colour.join(",")})"` : "";
    button.innerHTML = `<span class="palette-block-icon"${iconStyle}>${def.icon}</span>` +
      `<span class="palette-block-copy"><strong>${def.label}</strong>${def.hint ? `<small>${def.hint}</small>` : ""}</span>` +
      `<span class="block-level">L${level}</span>`;
    button.addEventListener("click", (event) => {
      if (button._ignoreNextClick) {
        button._ignoreNextClick = false;
        event.preventDefault();
        return;
      }
      if (event.detail === 0) {
        addBlock(def.id);
        return;
      }
      button.classList.remove("needs-drag");
      void button.offsetWidth;
      button.classList.add("needs-drag");
      toast("Drag the block into My flight plan to connect it.", 2200);
    });
    enablePalettePointerDrag(button, def);
    palette.append(button);
  });
}

function applyLevel() {
  level = Math.max(1, Math.min(5, level));
  localStorage.setItem("codeLevel", String(level));
  document.querySelectorAll(".level-btn").forEach((button) => {
    const buttonLevel = Number(button.dataset.level);
    button.classList.toggle("active", buttonLevel === level);
    button.classList.toggle("complete", buttonLevel < level);
  });
  if (!unlockedDefs(activeCategory).length) {
    activeCategory = CODE_CATEGORIES.find((category) => unlockedDefs(category.id).length).id;
  }
  $("levelPill").textContent = `LEVEL ${level}`;
  $("levelHint").textContent = PROGRESSIVE_LEVEL_HINTS[level];
  $("pythonPanel").classList.toggle("hidden", level < 5);
  renderCategories();
  renderPalette();
  renderProgram();
}

document.querySelectorAll(".level-btn").forEach((button) =>
  button.addEventListener("click", () => {
    level = Number(button.dataset.level);
    applyLevel();
  })
);

/* ---------------- progressive program builder ---------------- */

function defaultValue(def) {
  if (["forward", "back", "left", "right", "up", "down"].includes(def.action)) return 50;
  if (["turn_left", "turn_right"].includes(def.action)) return 90;
  if (def.action === "hover") return 2;
  if (def.action === "repeat_start") return 2;
  if (def.action === "led") return [...def.colour];
  if (def.action === "flip") return def.direction;
  if (def.action === "buzzer") return { frequency: 523, duration: 500 };
  if (def.action === "sound_sequence") return "success";
  if (["square", "triangle", "circle", "sway"].includes(def.action)) {
    return { direction: "right", speed: 40, duration: 1 };
  }
  if (def.action === "avoid_wall") return { distance: 50, timeout: 5 };
  if (def.action === "if_wall") return { distance: 50, reaction: "turn_right", reaction_value: 90 };
  if (def.action === "if_height") return { comparison: "above", height: 120, reaction: "land", reaction_value: null };
  if (def.action === "go_power") return { direction: "forward", power: 40, duration: 1 };
  return null;
}

function savedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
}

function safeSavedValue(def, value) {
  const action = def.action;
  const fallback = defaultValue(def);
  if (["forward", "back", "left", "right", "up", "down"].includes(action)) {
    return savedNumber(value, fallback, 20, 150);
  }
  if (["turn_left", "turn_right"].includes(action)) return savedNumber(value, fallback, 45, 180);
  if (action === "hover") return savedNumber(value, fallback, 1, 5);
  if (action === "repeat_start") return savedNumber(value, fallback, 2, 5);
  if (action === "led") {
    if (!Array.isArray(value) || value.length !== 3) return fallback;
    return value.map((channel, index) => savedNumber(channel, fallback[index], 0, 255));
  }
  if (action === "flip") return ["front", "back", "left", "right"].includes(value) ? value : fallback;
  if (action === "sound_sequence") return ["success", "warning", "error"].includes(value) ? value : fallback;
  if (action === "buzzer") {
    const input = value && typeof value === "object" ? value : {};
    return {
      frequency: savedNumber(input.frequency, fallback.frequency, 200, 1200),
      duration: savedNumber(input.duration, fallback.duration, 100, 2000),
    };
  }
  if (["square", "triangle", "circle", "sway"].includes(action)) {
    const input = value && typeof value === "object" ? value : {};
    return {
      direction: ["left", "right"].includes(input.direction) ? input.direction : fallback.direction,
      speed: savedNumber(input.speed, fallback.speed, 25, 60),
      duration: savedNumber(input.duration, fallback.duration, 0.5, 2),
    };
  }
  if (action === "avoid_wall") {
    const input = value && typeof value === "object" ? value : {};
    return {
      distance: savedNumber(input.distance, fallback.distance, 20, 100),
      timeout: savedNumber(input.timeout, fallback.timeout, 2, 10),
    };
  }
  if (action === "if_wall") {
    const input = value && typeof value === "object" ? value : {};
    const reaction = ["turn_left", "turn_right", "hover", "land"].includes(input.reaction)
      ? input.reaction : fallback.reaction;
    return {
      distance: savedNumber(input.distance, fallback.distance, 20, 100),
      reaction,
      reaction_value: reaction === "land" ? null : savedNumber(input.reaction_value, reaction === "hover" ? 2 : 90, reaction === "hover" ? 1 : 45, reaction === "hover" ? 5 : 180),
    };
  }
  if (action === "if_height") {
    const input = value && typeof value === "object" ? value : {};
    const reaction = ["land", "hover", "up", "down"].includes(input.reaction)
      ? input.reaction : fallback.reaction;
    return {
      comparison: ["above", "below"].includes(input.comparison) ? input.comparison : fallback.comparison,
      height: savedNumber(input.height, fallback.height, 30, 150),
      reaction,
      reaction_value: reaction === "land" ? null : savedNumber(input.reaction_value, reaction === "hover" ? 2 : 40, reaction === "hover" ? 1 : 20, reaction === "hover" ? 5 : 60),
    };
  }
  if (action === "go_power") {
    const input = value && typeof value === "object" ? value : {};
    return {
      direction: ["forward", "backward", "left", "right", "up", "down"].includes(input.direction)
        ? input.direction : fallback.direction,
      power: savedNumber(input.power, fallback.power, 20, 70),
      duration: savedNumber(input.duration, fallback.duration, 0.5, 3),
    };
  }
  return null;
}

function loadSavedProgram() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROGRAM_STORAGE_KEY) || "null");
    const steps = Array.isArray(saved) ? saved : saved && Array.isArray(saved.steps) ? saved.steps : [];
    program = steps.slice(0, 30).flatMap((step) => {
      if (!step || typeof step !== "object") return [];
      const def = BLOCK_BY_ID[step.defId];
      if (!def || step.action !== def.action) return [];
      const sourceLevel = Math.max(def.minLevel, Math.min(5, Number(step.sourceLevel) || def.minLevel));
      return [{ defId: def.id, action: def.action, value: safeSavedValue(def, step.value), sourceLevel }];
    });
  } catch (error) {
    program = [];
  }
  programStorageReady = true;
}

function saveProgram() {
  if (!programStorageReady) return;
  const status = $("saveStatus");
  try {
    localStorage.setItem(PROGRAM_STORAGE_KEY, JSON.stringify({ version: 1, updatedAt: Date.now(), steps: program }));
    status.textContent = "SAVED ON THIS DEVICE";
    status.classList.remove("save-error");
  } catch (error) {
    status.textContent = "SAVING UNAVAILABLE";
    status.classList.add("save-error");
  }
}

function addBlock(defId, insertAt = program.length) {
  if (program.length >= 30) return toast("Your flight plan is full (30 blocks max).");
  const def = BLOCK_BY_ID[defId];
  if (!def || def.minLevel > level) return;
  const step = { defId, action: def.action, value: defaultValue(def), sourceLevel: level };
  const insertionIndex = Math.max(0, Math.min(insertAt, program.length));
  program.splice(insertionIndex, 0, step);
  renderProgram();
  showConnectionFeedback(insertionIndex);
  toast(`${def.label} connected`);
}

function numberField(label, value, min, max, step, unit, onChange) {
  const field = document.createElement("label");
  field.className = "inline-field";
  const text = document.createElement("span");
  text.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.value = value;
  input.min = min;
  input.max = max;
  input.step = step;
  input.inputMode = "decimal";
  input.addEventListener("change", () => onChange(Math.max(min, Math.min(max, Number(input.value) || min))));
  field.append(text, input);
  if (unit) {
    const suffix = document.createElement("span");
    suffix.textContent = unit;
    field.append(suffix);
  }
  return field;
}

function selectField(label, value, options, onChange) {
  const field = document.createElement("label");
  field.className = "inline-field";
  if (label) {
    const text = document.createElement("span");
    text.textContent = label;
    field.append(text);
  }
  const select = document.createElement("select");
  options.forEach(([optionValue, optionLabel]) => {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionLabel;
    option.selected = String(optionValue) === String(value);
    select.append(option);
  });
  select.addEventListener("change", () => onChange(select.value));
  field.append(select);
  return field;
}

function editStep(index, update) {
  if (!program[index]) return;
  update(program[index]);
  renderProgram();
}

function appendStepFields(container, step, index) {
  const action = step.action;
  const configurable = step.sourceLevel >= 3;
  if (["forward", "back", "left", "right", "up", "down"].includes(action) && configurable) {
    container.append(numberField("distance", step.value, 20, 150, 1, "cm", (value) => editStep(index, (item) => { item.value = value; })));
  } else if (["turn_left", "turn_right"].includes(action) && configurable) {
    container.append(numberField("angle", step.value, 45, 180, 15, "°", (value) => editStep(index, (item) => { item.value = value; })));
  } else if (action === "hover" && configurable) {
    container.append(numberField("for", step.value, 1, 5, 1, "sec", (value) => editStep(index, (item) => { item.value = value; })));
  } else if (action === "repeat_start" && configurable) {
    container.append(numberField("", step.value, 2, 5, 1, "times", (value) => editStep(index, (item) => { item.value = value; })));
  } else if (action === "led" && configurable) {
    const field = document.createElement("label");
    field.className = "inline-field colour-field";
    field.innerHTML = "<span>colour</span>";
    const input = document.createElement("input");
    input.type = "color";
    input.value = "#" + step.value.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("");
    input.addEventListener("change", () => editStep(index, (item) => {
      item.value = [1, 3, 5].map((start) => parseInt(input.value.slice(start, start + 2), 16));
    }));
    field.append(input);
    container.append(field);
  } else if (action === "buzzer") {
    container.append(selectField("note", step.value.frequency, [[262, "C4"], [330, "E4"], [392, "G4"], [523, "C5"], [659, "E5"], [784, "G5"]],
      (value) => editStep(index, (item) => { item.value.frequency = Number(value); })));
    container.append(numberField("for", step.value.duration, 100, 2000, 100, "ms", (value) => editStep(index, (item) => { item.value.duration = value; })));
  } else if (action === "sound_sequence") {
    container.append(selectField("", step.value, [["success", "success"], ["warning", "warning"], ["error", "error"]],
      (value) => editStep(index, (item) => { item.value = value; })));
  } else if (["square", "triangle", "circle", "sway"].includes(action)) {
    container.append(selectField("", step.value.direction, [["right", "clockwise"], ["left", "counter-clockwise"]],
      (value) => editStep(index, (item) => { item.value.direction = value; })));
  } else if (action === "avoid_wall") {
    container.append(numberField("stop at", step.value.distance, 20, 100, 10, "cm", (value) => editStep(index, (item) => { item.value.distance = value; })));
    container.append(numberField("timeout", step.value.timeout, 2, 10, 1, "sec", (value) => editStep(index, (item) => { item.value.timeout = value; })));
  } else if (action === "if_wall") {
    container.append(numberField("closer than", step.value.distance, 20, 100, 10, "cm", (value) => editStep(index, (item) => { item.value.distance = value; })));
    container.append(selectField("then", step.value.reaction,
      [["turn_left", "turn left"], ["turn_right", "turn right"], ["hover", "hover"], ["land", "land"]],
      (value) => editStep(index, (item) => {
        item.value.reaction = value;
        item.value.reaction_value = value === "hover" ? 2 : value === "land" ? null : 90;
      })));
  } else if (action === "if_height") {
    container.append(selectField("if", step.value.comparison, [["above", "above"], ["below", "below"]],
      (value) => editStep(index, (item) => { item.value.comparison = value; })));
    container.append(numberField("height", step.value.height, 30, 150, 10, "cm", (value) => editStep(index, (item) => { item.value.height = value; })));
    container.append(selectField("then", step.value.reaction,
      [["land", "land"], ["hover", "hover"], ["up", "fly up"], ["down", "fly down"]],
      (value) => editStep(index, (item) => {
        item.value.reaction = value;
        item.value.reaction_value = value === "land" ? null : value === "hover" ? 2 : 40;
      })));
  } else if (action === "go_power") {
    container.append(selectField("", step.value.direction,
      [["forward", "forward"], ["backward", "backward"], ["left", "left"], ["right", "right"], ["up", "up"], ["down", "down"]],
      (value) => editStep(index, (item) => { item.value.direction = value; })));
    container.append(numberField("power", step.value.power, 20, 70, 5, "%", (value) => editStep(index, (item) => { item.value.power = value; })));
    container.append(numberField("for", step.value.duration, 0.5, 3, 0.5, "sec", (value) => editStep(index, (item) => { item.value.duration = value; })));
  }
}

/* ---------------- progressive workspace ---------------- */

function renderProgram() {
  const list = $("programList");
  list.innerHTML = "";
  $("programEmpty").classList.toggle("hidden", program.length > 0);
  $("blockCount").textContent = `${program.length} / 30 BLOCKS`;
  const runningProgIdx = runningStep !== null && flatMap[runningStep - 1] !== undefined ? flatMap[runningStep - 1] : null;
  let depth = 0;

  program.forEach((step, index) => {
    const def = BLOCK_BY_ID[step.defId] || BLOCK_DEFS.find((item) => item.action === step.action);
    if (!def) return;
    if (step.action === "repeat_end") depth = Math.max(0, depth - 1);
    const category = categoryFor(def.category);
    const item = document.createElement("li");
    item.className = "program-block";
    item.style.setProperty("--block-colour", category.colour);
    item.dataset.index = index;
    item.draggable = true;
    item.classList.toggle("running", runningProgIdx === index);
    item.classList.toggle("nested", depth > 0 && step.action !== "repeat_start");
    item.classList.toggle("is-picture", step.sourceLevel === 1);
    item.classList.toggle("repeat-cap", step.action === "repeat_start" || step.action === "repeat_end");
    if (step.action === "repeat_start") depth += 1;

    const drag = document.createElement("span");
    drag.className = "drag-handle";
    drag.textContent = "⠿";
    drag.setAttribute("aria-label", "Hold and drag to reorder this block");
    drag.setAttribute("role", "button");
    drag.title = "Hold and drag to reorder";
    const icon = document.createElement("span");
    icon.className = "program-block-icon";
    icon.textContent = def.icon;
    if (def.colour) icon.style.color = `rgb(${step.value.join(",")})`;
    const main = document.createElement("span");
    main.className = "program-block-main";
    const title = document.createElement("strong");
    title.className = "block-title";
    title.textContent = def.label;
    const fields = document.createElement("span");
    fields.className = "program-fields";
    appendStepFields(fields, step, index);
    main.append(title, fields);
    const source = document.createElement("span");
    source.className = "source-level";
    source.textContent = `L${step.sourceLevel}`;
    source.title = `Added from level ${step.sourceLevel}`;

    const controls = document.createElement("span");
    controls.className = "program-controls";
    [["↑", "Move block up", () => moveStep(index, -1)], ["↓", "Move block down", () => moveStep(index, 1)],
      ["×", "Delete block", () => { program.splice(index, 1); renderProgram(); }]].forEach(([text, label, action]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.setAttribute("aria-label", label);
      button.addEventListener("click", action);
      controls.append(button);
    });
    item.append(drag, icon, main, source, controls);
    item.setAttribute("aria-label", `${def.label}, level ${step.sourceLevel}`);
    item.addEventListener("dragstart", (event) => {
      if (["INPUT", "SELECT", "BUTTON"].includes(event.target.tagName) || event.target.closest(".drag-handle")) {
        return event.preventDefault();
      }
      event.dataTransfer.setData("text/program-index", String(index));
      event.dataTransfer.effectAllowed = "move";
      item.classList.add("dragging");
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      clearDropFeedback();
    });
    item.addEventListener("dragover", (event) => {
      event.preventDefault();
      clearDropFeedback();
      const rect = item.getBoundingClientRect();
      const placeBefore = event.clientY < rect.top + rect.height / 2;
      item.dataset.dropPosition = placeBefore ? "before" : "after";
      item.classList.add(placeBefore ? "drop-before" : "drop-after");
    });
    item.addEventListener("dragleave", () => item.classList.remove("drop-before", "drop-after"));
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const insertionIndex = index + (item.dataset.dropPosition === "after" ? 1 : 0);
      clearDropFeedback();
      handleProgramDrop(event, insertionIndex);
    });
    enablePointerReorder(item, drag, index);
    list.append(item);
  });
  renderPython();
  saveProgram();
}

let pointerReorder = null;
let palettePointerDrag = null;

function clearDropFeedback() {
  document.querySelectorAll("#programList .drop-before, #programList .drop-after")
    .forEach((item) => item.classList.remove("drop-before", "drop-after"));
  $("programList").classList.remove("drop-empty");
  document.querySelector(".workspace-pane")?.classList.remove("is-drop-target");
}

function workspaceInsertionIndex(clientX, clientY) {
  clearDropFeedback();
  const workspace = document.querySelector(".workspace-pane");
  const workspaceRect = workspace.getBoundingClientRect();
  const insideWorkspace = clientX >= workspaceRect.left && clientX <= workspaceRect.right
    && clientY >= workspaceRect.top && clientY <= workspaceRect.bottom;
  if (!insideWorkspace) return null;

  workspace.classList.add("is-drop-target");
  const list = $("programList");
  const blocks = [...list.querySelectorAll(".program-block")];
  if (!blocks.length) {
    list.classList.add("drop-empty");
    return 0;
  }

  for (const block of blocks) {
    const rect = block.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      block.classList.add("drop-before");
      return Number(block.dataset.index);
    }
  }

  blocks.at(-1).classList.add("drop-after");
  return program.length;
}

function updatePointerDrop(clientX, clientY) {
  if (!pointerReorder) return;
  pointerReorder.targetIndex = workspaceInsertionIndex(clientX, clientY);
}

function finishPointerReorder(cancelled = false) {
  const state = pointerReorder;
  if (!state) return;
  pointerReorder = null;
  clearDropFeedback();
  state.item.classList.remove("touch-dragging");
  document.body.classList.remove("touch-reordering");
  if (state.handle.hasPointerCapture?.(state.pointerId)) {
    state.handle.releasePointerCapture(state.pointerId);
  }
  if (!cancelled && state.active && state.targetIndex !== null) {
    reorderProgram(state.fromIndex, state.targetIndex);
  }
}

function createPaletteDragGhost(button) {
  const rect = button.getBoundingClientRect();
  const ghost = button.cloneNode(true);
  ghost.classList.add("block-drag-ghost");
  ghost.disabled = true;
  ghost.removeAttribute("title");
  ghost.setAttribute("aria-hidden", "true");
  ghost.style.width = `${Math.min(rect.width, 320)}px`;
  document.body.append(ghost);
  return ghost;
}

function positionPaletteDrag(clientX, clientY) {
  if (!palettePointerDrag?.ghost) return;
  palettePointerDrag.lastX = clientX;
  palettePointerDrag.lastY = clientY;
  palettePointerDrag.ghost.style.left = `${clientX}px`;
  palettePointerDrag.ghost.style.top = `${clientY - 46}px`;
  palettePointerDrag.targetIndex = workspaceInsertionIndex(clientX, clientY);
  palettePointerDrag.ghost.classList.toggle("can-connect", palettePointerDrag.targetIndex !== null);
}

function finishPalettePointerDrag(cancelled = false) {
  const state = palettePointerDrag;
  if (!state) return;
  palettePointerDrag = null;
  clearDropFeedback();
  state.button.classList.remove("pointer-drag-source");
  state.ghost?.remove();
  document.body.classList.remove("block-dragging");
  if (state.button.hasPointerCapture?.(state.pointerId)) {
    state.button.releasePointerCapture(state.pointerId);
  }
  if (state.active) state.button._ignoreNextClick = true;
  if (!cancelled && state.active && state.targetIndex !== null) {
    addBlock(state.defId, state.targetIndex);
  } else if (!cancelled && state.active) {
    toast("Drop the block inside My flight plan.", 2200);
  }
}

function autoScrollEditor(clientX, clientY, amount = 18) {
  const stackedEditor = window.matchMedia("(max-width: 900px)").matches;
  let scroller = $("codePage");

  if (!stackedEditor) {
    const workspace = document.querySelector(".workspace-pane");
    const workspaceRect = workspace?.getBoundingClientRect();
    scroller = workspaceRect && clientX >= workspaceRect.left
      ? workspace
      : document.querySelector(".toolbox-pane .palette");
  }

  if (!scroller) return;
  const rect = scroller.getBoundingClientRect();
  const visibleTop = Math.max(0, rect.top);
  const visibleBottom = Math.min(window.innerHeight, rect.bottom);
  const edgeZone = Math.min(96, Math.max(48, (visibleBottom - visibleTop) * 0.18));

  if (clientY < visibleTop + edgeZone) scroller.scrollBy({ top: -amount, behavior: "auto" });
  else if (clientY > visibleBottom - edgeZone) scroller.scrollBy({ top: amount, behavior: "auto" });
}

function enablePalettePointerDrag(button, def) {
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    palettePointerDrag = {
      pointerId: event.pointerId,
      defId: def.id,
      startX: event.clientX,
      startY: event.clientY,
      targetIndex: null,
      active: false,
      button,
      ghost: null,
    };
    button.setPointerCapture?.(event.pointerId);
  });

  button.addEventListener("pointermove", (event) => {
    if (!palettePointerDrag || palettePointerDrag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - palettePointerDrag.startX, event.clientY - palettePointerDrag.startY);
    if (!palettePointerDrag.active && distance < 6) return;
    if (!palettePointerDrag.active) {
      palettePointerDrag.active = true;
      palettePointerDrag.ghost = createPaletteDragGhost(button);
      button.classList.add("pointer-drag-source");
      document.body.classList.add("block-dragging");
    }
    autoScrollEditor(event.clientX, event.clientY);
    positionPaletteDrag(event.clientX, event.clientY);
    event.preventDefault();
  }, { passive: false });

  button.addEventListener("pointerup", (event) => {
    if (palettePointerDrag?.pointerId === event.pointerId) finishPalettePointerDrag(false);
  });
  button.addEventListener("pointercancel", (event) => {
    if (palettePointerDrag?.pointerId === event.pointerId) finishPalettePointerDrag(true);
  });
}

function showConnectionFeedback(index) {
  const item = document.querySelector(`#programList .program-block[data-index="${index}"]`);
  if (!item) return;
  item.classList.add("just-connected");
  const badge = document.createElement("span");
  badge.className = "connection-click";
  badge.textContent = "SNAP!";
  badge.setAttribute("aria-hidden", "true");
  item.append(badge);
  setTimeout(() => {
    item.classList.remove("just-connected");
    badge.remove();
  }, reducedMotion.matches ? 250 : 720);
}

function enablePointerReorder(item, handle, index) {
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    pointerReorder = {
      pointerId: event.pointerId,
      fromIndex: index,
      targetIndex: index,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      item,
      handle,
    };
    handle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  handle.addEventListener("pointermove", (event) => {
    if (!pointerReorder || pointerReorder.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - pointerReorder.startX, event.clientY - pointerReorder.startY);
    if (!pointerReorder.active && distance < 6) return;
    pointerReorder.active = true;
    pointerReorder.item.classList.add("touch-dragging");
    document.body.classList.add("touch-reordering");
    autoScrollEditor(event.clientX, event.clientY, 14);
    updatePointerDrop(event.clientX, event.clientY);
    event.preventDefault();
  }, { passive: false });

  handle.addEventListener("pointerup", (event) => {
    if (pointerReorder?.pointerId === event.pointerId) finishPointerReorder(false);
  });
  handle.addEventListener("pointercancel", (event) => {
    if (pointerReorder?.pointerId === event.pointerId) finishPointerReorder(true);
  });
}

function reorderProgram(fromIndex, insertionIndex) {
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= program.length) return;
  const [step] = program.splice(fromIndex, 1);
  const adjustedIndex = fromIndex < insertionIndex ? insertionIndex - 1 : insertionIndex;
  const finalIndex = Math.max(0, Math.min(adjustedIndex, program.length));
  program.splice(finalIndex, 0, step);
  renderProgram();
  if (finalIndex !== fromIndex) showConnectionFeedback(finalIndex);
}

function handleProgramDrop(event, targetIndex) {
  const defId = event.dataTransfer.getData("text/block-id");
  if (defId) return addBlock(defId, targetIndex);
  const fromText = event.dataTransfer.getData("text/program-index");
  if (fromText === "") return;
  const from = Number(fromText);
  if (!Number.isInteger(from) || from < 0 || from >= program.length) return;
  reorderProgram(from, targetIndex);
}

function moveStep(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= program.length) return;
  [program[index], program[target]] = [program[target], program[index]];
  renderProgram();
  showConnectionFeedback(target);
}

$("programList").addEventListener("dragover", (event) => event.preventDefault());
$("programList").addEventListener("drop", (event) => {
  event.preventDefault();
  handleProgramDrop(event, program.length);
});

$("clearBtn").addEventListener("click", () => {
  program = [];
  renderProgram();
});

function flattenProgram() {
  /* Repeat markers are expanded for the server. Sensor decisions stay as
     executable steps because they need live readings from the real drone. */
  const steps = [], map = [];
  let repeatBlock = null, count = 0;
  for (let index = 0; index < program.length; index++) {
    const { action, value } = program[index];
    if (action === "repeat_start") {
      if (repeatBlock !== null) return { error: "Finish one repeat before starting another." };
      repeatBlock = [];
      count = value;
    } else if (action === "repeat_end") {
      if (repeatBlock === null) return { error: "End repeat needs a repeat block before it." };
      for (let repeat = 0; repeat < count; repeat++) {
        repeatBlock.forEach(([step, sourceIndex]) => { steps.push(step); map.push(sourceIndex); });
      }
      repeatBlock = null;
    } else if (repeatBlock !== null) {
      repeatBlock.push([{ action, value }, index]);
    } else {
      steps.push({ action, value });
      map.push(index);
    }
  }
  if (repeatBlock !== null) return { error: "Your repeat block needs an end repeat block." };
  if (!steps.length) return { error: "Add some blocks first!" };
  if (steps.length > 30) return { error: "That becomes more than 30 steps after repeating." };
  return { steps, map };
}

$("runBtn").addEventListener("click", async () => {
  if (!token || !droneId) return showPicker();
  const flat = flattenProgram();
  if (flat.error) return toast(flat.error, 2800);
  flatMap = flat.map;
  const { ok, data } = await api("/api/run", { steps: flat.steps, token, drone_id: droneId });
  if (ok) toast("Flight plan is running!");
  else if (data.error === "bad_program") toast("One of those blocks is not safe to run.", 2600);
});

/* ---------------- progressive Python view ---------------- */

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
    case "square":
    case "triangle":
    case "sway": return [`drone.${action}(${value.speed}, ${value.duration}, ${value.direction === "right" ? 1 : -1})`];
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

function renderPython() {
  if (level < 5) return;
  const lines = ["from codrone_edu.drone import Drone", "", "drone = Drone()", "drone.pair()"];
  let indent = "";
  program.forEach(({ action, value }) => {
    if (action === "repeat_start") {
      lines.push(`${indent}for _ in range(${value}):`);
      indent += "    ";
    } else if (action === "repeat_end") {
      indent = indent.slice(0, -4);
    } else {
      pythonFor(action, value).forEach((line) => lines.push(indent + line));
    }
  });
  lines.push("drone.close()");
  $("pythonCode").textContent = lines.join("\n");
}

/* ---------------- status polling ---------------- */

async function poll() {
  clearTimeout(pollTimer);
  if (!navigator.onLine) {
    setHubConnection(false);
    pollTimer = setTimeout(poll, 2000);
    return;
  }
  try {
    const res = await fetchWithTimeout("/api/status", { cache: "no-store" }, 3000);
    if (!res.ok) throw new Error(`Hub status ${res.status}`);
    const s = await res.json();
    setHubConnection(true);
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
    setHubConnection(false);
  }
  pollTimer = setTimeout(poll, hubConnected ? 1000 : 2000);
}

$("retryConnectionBtn").addEventListener("click", () => {
  if (!navigator.onLine) {
    toast("This device is offline. Rejoin the classroom Wi-Fi, then try again.", 2800);
    return;
  }
  $("modeChip").textContent = "CONNECTING";
  clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, 0);
});
window.addEventListener("online", () => {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, 0);
});
window.addEventListener("offline", () => setHubConnection(false));

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
document.querySelectorAll(HUB_CONTROL_SELECTOR).forEach((button) => { button.disabled = true; });
loadSavedProgram();
applyLevel();
poll();
