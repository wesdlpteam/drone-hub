"use strict";
/* Blockly editor glue: inject, theme, 2 levels, save, run, highlight.
   Loads after app.js + program-runner.js; shares their top-level bindings
   (api, toast, token, droneId, showPicker, DroneRunner). */

const EDITOR_STORAGE_KEY = "dronePilotBlocklyV1";
const OLD_PROGRAM_KEY = "dronePilotProgramV1";
const EDITOR_LEVEL_HINTS = {
  1: "Picture blocks. Take off, fly around and land.",
  2: "Every CoDrone EDU block, just like the official app.",
};

let editorLevel = Math.min(2, Math.max(1, parseInt(localStorage.getItem("codeLevel") || "1", 10) || 1));
let workspace = null;
let runBlockIds = [];
let saveTimer = null;
let pythonTimer = null;

function editorEl(id) { return document.getElementById(id); }

function defineTheme() {
  const styles = {}, catStyles = {};
  for (const c of DroneBlocksData.CATEGORIES) {
    styles[`cat_${c.id}`] = { colourPrimary: c.colour, colourSecondary: c.colour, colourTertiary: "#060a18" };
    catStyles[`catstyle_${c.id}`] = { colour: c.colour };
  }
  // standard Blockly block families, official CoDrone colours
  const std = { logic_blocks: "#d64230", loop_blocks: "#d64230", math_blocks: "#5b79a3",
    text_blocks: "#2b4bd7", list_blocks: "#15a08c", variable_blocks: "#38b449",
    variable_dynamic_blocks: "#38b449", procedure_blocks: "#ef5da8", colour_blocks: "#a45cf0" };
  for (const [name, colour] of Object.entries(std)) {
    styles[name] = { colourPrimary: colour, colourSecondary: colour, colourTertiary: "#060a18" };
  }
  return Blockly.Theme.defineTheme("droneHub", {
    base: Blockly.Themes.Classic,
    blockStyles: styles,
    categoryStyles: catStyles,
    componentStyles: {
      workspaceBackgroundColour: "#05070f",
      toolboxBackgroundColour: "#0a0e27",
      toolboxForegroundColour: "#e8eeff",
      flyoutBackgroundColour: "#101733",
      flyoutForegroundColour: "#dbe6f5",
      flyoutOpacity: 0.98,
      scrollbarColour: "#2c3a66",
      insertionMarkerColour: "#8fd8ff",
      insertionMarkerOpacity: 0.4,
    },
    fontStyle: { family: "'Segoe UI', system-ui, sans-serif", weight: "600", size: 12 },
  });
}

/* ---------- Level 1 flat run path (unchanged /api/run pipeline) ---------- */

function scriptFromWorkspace() {
  const script = [];
  const tops = workspace.getTopBlocks(true);
  for (const top of tops) walkChain(top, script);
  return script;
}

function walkChain(block, out) {
  let current = block;
  while (current) {
    const meta = DroneBlocksData.BLOCK_BY_TYPE[current.type];
    if (meta && !current.isInsertionMarker()) {
      if (current.type === "pic_repeat" || current.type === "drone_repeat") {
        const body = [];
        const first = current.getInputTargetBlock("DO");
        if (first) walkChain(first, body);
        out.push({ id: current.id, action: "repeat",
          times: DroneBlocksData.clampNum(current.getFieldValue("TIMES"), 2, 5, 2), body });
      } else {
        const fields = {};
        for (const input of current.inputList) {
          for (const field of input.fieldRow) {
            if (field.name) fields[field.name] = field.getValue();
          }
        }
        const step = DroneBlocksData.stepFor(current.type, fields);
        if (step) out.push({ id: current.id, action: step.action, value: step.value });
      }
    }
    current = current.getNextBlock();
  }
}

function countLevel2Blocks() {
  let count = 0;
  workspace.getAllBlocks(false).forEach((b) => {
    if (!b.isInsertionMarker() && !b.isShadow() && b.type !== "drone_start") count += 1;
  });
  return count;
}

function refreshDerived() {
  if (editorLevel === 1) {
    const flat = DroneBlocksData.stepsFromScript(scriptFromWorkspace());
    const overLimit = !!flat.error && /30 steps/.test(flat.error);
    const count = flat.error ? (overLimit ? 31 : 0) : flat.steps.length;
    editorEl("blockCount").textContent = overLimit ? "TOO MANY STEPS" : `${count} / 30 ${count === 1 ? "STEP" : "STEPS"}`;
    editorEl("blockCount").classList.toggle("over-limit", overLimit);
  } else {
    const count = countLevel2Blocks();
    editorEl("blockCount").textContent = `${count} ${count === 1 ? "BLOCK" : "BLOCKS"}`;
    editorEl("blockCount").classList.remove("over-limit");
    clearTimeout(pythonTimer);
    pythonTimer = setTimeout(() => {
      editorEl("pythonCode").textContent = DroneRunner.pythonFor(workspace);
    }, 350);
  }
}

function persistWorkspace() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const status = editorEl("saveStatus");
    try {
      const state = Blockly.serialization.workspaces.save(workspace);
      localStorage.setItem(EDITOR_STORAGE_KEY, JSON.stringify(state));
      status.textContent = "SAVED ON THIS DEVICE";
      status.classList.remove("save-error");
    } catch (error) {
      status.textContent = "SAVING UNAVAILABLE";
      status.classList.add("save-error");
    }
  }, 400);
}

function restoreWorkspace() {
  try {
    const saved = localStorage.getItem(EDITOR_STORAGE_KEY);
    if (saved) {
      Blockly.serialization.workspaces.load(JSON.parse(saved), workspace);
      return;
    }
    const old = JSON.parse(localStorage.getItem(OLD_PROGRAM_KEY) || "null");
    const oldSteps = Array.isArray(old) ? old : old && Array.isArray(old.steps) ? old.steps : null;
    const migrated = oldSteps ? DroneBlocksData.migrateOldProgram(oldSteps) : null;
    if (migrated) {
      Blockly.serialization.workspaces.load(migrated, workspace);
      toast("Your saved flight plan moved into the new blocks!", 2600);
    }
  } catch (error) {
    console.warn("Could not restore saved plan", error);
  }
}

function applyEditorLevel() {
  localStorage.setItem("codeLevel", String(editorLevel));
  document.querySelectorAll(".level-btn").forEach((button) => {
    const buttonLevel = Number(button.dataset.level);
    button.classList.toggle("active", buttonLevel === editorLevel);
  });
  editorEl("levelHint").textContent = EDITOR_LEVEL_HINTS[editorLevel];
  editorEl("bottomPanel").classList.toggle("hidden", editorLevel < 2);
  workspace.updateToolbox(DroneBlocksData.toolboxForLevel(editorLevel));
  refreshDerived();
}

function updateRotateCover() {
  const portrait = window.matchMedia("(orientation: portrait)").matches;
  const codeActive = !editorEl("codePage").classList.contains("hidden");
  editorEl("rotateCover").classList.toggle("hidden", !(portrait && codeActive));
}

/* ---------- console panel ---------- */

function printToConsole(text) {
  const pre = editorEl("consoleOut");
  pre.textContent += (pre.textContent ? "\n" : "") + text;
  pre.scrollTop = pre.scrollHeight;
  showBottomTab("console");
  editorEl("bottomPanel").classList.remove("collapsed");
  Blockly.svgResize(workspace);
}

function showBottomTab(which) {
  editorEl("consoleOut").classList.toggle("hidden", which !== "console");
  editorEl("pythonCode").classList.toggle("hidden", which !== "python");
  editorEl("tabConsole").classList.toggle("active", which === "console");
  editorEl("tabPython").classList.toggle("active", which === "python");
}

/* ---------- run / stop wiring ---------- */

function setRunButton(runningNow) {
  const btn = editorEl("runBtn");
  btn.classList.toggle("running", runningNow);
  btn.querySelector(".pill-label").textContent = runningNow ? "Stop run" : "Run";
}

async function runProgram() {
  if (DroneRunner.isRunning()) { DroneRunner.abort(); return; }
  if (!token || !droneId) return showPicker();
  if (editorLevel === 1) {
    const flat = DroneBlocksData.stepsFromScript(scriptFromWorkspace());
    if (flat.error) return toast(flat.error, 2800);
    runBlockIds = flat.blockIds;
    const { ok, data } = await api("/api/run", { steps: flat.steps, token, drone_id: droneId });
    if (ok) toast("Flight plan is running!");
    else if (data.error === "bad_program" || data.error === "bad_step") {
      toast("One of those blocks is not safe to run.", 2600);
    }
    return;
  }
  editorEl("consoleOut").textContent = "";
  const result = await DroneRunner.run(workspace);
  if (result.ok) toast("Program finished!", 2200);
  else if (result.reason === "empty") toast("Add some blocks first!", 2400);
  else if (result.message) toast(result.message, 2800);
}

/* ---------- drone connection box (official-style, bottom left) ---------- */

function updateConnectionBox(drone, status) {
  const box = editorEl("droneConnBox");
  if (!box) return;
  const label = editorEl("droneConnLabel");
  const connected = !!(drone && token);
  box.classList.toggle("connected", connected);
  if (!connected) {
    label.textContent = "no drone connected";
  } else {
    const state = drone.flying ? "flying" : "ready";
    label.textContent = `${drone.name} ${state}`;
  }
  editorEl("droneConnBtn").textContent = connected ? "Change" : "Connect";
}

const DroneEditor = {
  init() {
    if (typeof Blockly === "undefined" || !window.DroneBlocksData || !DroneBlocksData.BLOCKS) {
      editorEl("editorFallback").classList.remove("hidden");
      return;
    }
    Blockly.defineBlocksWithJsonArray(DroneBlocksData.BLOCKS.map((b) => b.json));
    if (!DroneRunner.installGenerators()) {
      console.warn("Blockly JavaScript generator missing; Level 2 run disabled");
    }
    workspace = Blockly.inject("blocklyDiv", {
      renderer: "zelos",
      theme: defineTheme(),
      toolbox: DroneBlocksData.toolboxForLevel(editorLevel),
      trashcan: true,
      sounds: false,
      grid: { spacing: 34, length: 34, colour: "#121a38", snap: false },
      zoom: { controls: true, wheel: true, pinch: true, startScale: 0.8 },
      move: { scrollbars: { horizontal: true, vertical: true }, drag: true, wheel: true },
    });
    restoreWorkspace();
    applyEditorLevel();
    workspace.addChangeListener((event) => {
      if (event.isUiEvent) return;
      refreshDerived();
      persistWorkspace();
    });

    document.querySelectorAll(".level-btn").forEach((button) =>
      button.addEventListener("click", () => {
        editorLevel = Number(button.dataset.level);
        applyEditorLevel();
      }));

    editorEl("clearBtn").addEventListener("click", () => {
      workspace.clear();
      toast("Plan cleared.");
    });

    editorEl("runBtn").addEventListener("click", runProgram);
    editorEl("landBtn").addEventListener("click", async () => {
      if (!token || !droneId) return showPicker();
      await api("/api/command", { action: "land", value: null, token, drone_id: droneId });
      toast("Landing…");
    });
    editorEl("codeStopBtn").addEventListener("click", async () => {
      DroneRunner.abort();
      await api("/api/stop", droneId ? { drone_id: droneId } : {});
      toast("🛑 Stopping and landing…");
    });
    editorEl("stopBtn").addEventListener("click", () => DroneRunner.abort());
    editorEl("droneConnBtn").addEventListener("click", () => {
      if (!myName) editorEl("joinOverlay").classList.remove("hidden");
      else showPicker();
    });

    DroneRunner.onPrint(printToConsole);
    DroneRunner.onHighlight((id) => workspace.highlightBlock(id));
    DroneRunner.onState(setRunButton);

    const bottomPanel = editorEl("bottomPanel");
    bottomPanel.classList.add("collapsed");
    showBottomTab("python");
    bottomPanel.querySelector(".terminal-titlebar").addEventListener("click", (event) => {
      if (event.target.closest(".panel-tab")) return;
      bottomPanel.classList.toggle("collapsed");
      if (workspace) Blockly.svgResize(workspace);
    });
    editorEl("tabConsole").addEventListener("click", () => showBottomTab("console"));
    editorEl("tabPython").addEventListener("click", () => showBottomTab("python"));

    editorEl("railCollapseBtn").addEventListener("click", () => {
      const toolbox = workspace.getToolbox();
      const hidden = document.body.classList.toggle("rail-collapsed");
      if (toolbox) toolbox.setVisible(!hidden);
      Blockly.svgResize(workspace);
    });

    window.addEventListener("resize", () => {
      updateRotateCover();
      if (workspace) Blockly.svgResize(workspace);
    });
    window.matchMedia("(orientation: portrait)").addEventListener("change", updateRotateCover);
    updateRotateCover();
  },

  refreshLayout() {
    updateRotateCover();
    if (workspace) Blockly.svgResize(workspace);
  },

  onStatus(status, drone) {
    updateConnectionBox(drone, status);
    if (status && status.paused && DroneRunner.isRunning()) DroneRunner.abort();
  },

  setRunningStep(step) {
    if (!workspace || DroneRunner.isRunning()) return;
    if (!step || !runBlockIds[step - 1]) workspace.highlightBlock(null);
    else workspace.highlightBlock(runBlockIds[step - 1]);
  },
};
window.DroneEditor = DroneEditor;

DroneEditor.init();
