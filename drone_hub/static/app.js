/* Drone Pilot — iPad client for the CoDrone EDU Hub.
   Multi-drone + 5 coding levels (Ozobot-style). Vanilla JS, no libraries. */

"use strict";

const $ = (id) => document.getElementById(id);

let token = sessionStorage.getItem("droneToken") || null;
let myName = sessionStorage.getItem("droneName") || "";
let droneId = sessionStorage.getItem("droneId") || null;
let selectedDist = 50, selectedTurn = 90;          // FLY page settings
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
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
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
    if (window.DroneEditor) DroneEditor.setRunningStep(null);
  } else if (wasConnected === false) {
    toast("Drone Hub reconnected. Flight controls are ready.", 2600);
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
  document.body.classList.toggle("code-tab-active", !fly);
  if (window.DroneEditor) DroneEditor.refreshLayout();
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
      now.textContent = "⏸️ Your teacher has paused flying. Eyes up front!";
      DroneEditor.setRunningStep(null);
    } else if (d && d.current) {
      now.classList.remove("hidden");
      now.textContent = d.current.step
        ? `Step ${d.current.step}/${d.current.total}: ${d.current.label}`
        : `Now: ${d.current.label}`;
      DroneEditor.setRunningStep(d.current.step || null);
    } else {
      now.classList.add("hidden");
      DroneEditor.setRunningStep(null);
    }

    if (!$("pickOverlay").classList.contains("hidden")) renderDroneCards();
    if (window.DroneEditor && DroneEditor.onStatus) DroneEditor.onStatus(s, d);

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
poll();
