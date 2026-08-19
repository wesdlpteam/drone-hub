"use strict";
/* Blockly editor glue: inject, theme, levels, save, run, highlight.
   Loads after app.js; shares its top-level bindings (api, toast, token,
   droneId, showPicker) because both are classic scripts. */

const EDITOR_STORAGE_KEY = "dronePilotBlocklyV1";
const OLD_PROGRAM_KEY = "dronePilotProgramV1";
const EDITOR_LEVEL_HINTS = {
  1: "Take off, go, turn and set the lights. Everything for a first flight.",
  2: "Add sound, timing, loops and flips.",
  3: "Add notes, sounds and flight patterns like circles and squares.",
  4: "Use the front and bottom range sensors to react to the world.",
  5: "Add power flying and see the real Python your blocks create.",
};

let editorLevel = Math.max(1, Math.min(5, parseInt(localStorage.getItem("codeLevel") || "1", 10) || 1));
let workspace = null;
let runBlockIds = [];
let saveTimer = null;

function editorEl(id) { return document.getElementById(id); }

function defineTheme() {
  const styles = {}, catStyles = {};
  for (const c of DroneBlocksData.CATEGORIES) {
    styles[`cat_${c.id}`] = { colourPrimary: c.colour, colourSecondary: c.colour, colourTertiary: "#0b1020" };
    catStyles[`catstyle_${c.id}`] = { colour: c.colour };
  }
  return Blockly.Theme.defineTheme("droneHub", {
    base: Blockly.Themes.Classic,
    blockStyles: styles,
    categoryStyles: catStyles,
    componentStyles: {
      workspaceBackgroundColour: "#171d29",
      toolboxBackgroundColour: "#0d1420",
      toolboxForegroundColour: "#dbe6f5",
      flyoutBackgroundColour: "#1b2333",
      flyoutForegroundColour: "#dbe6f5",
      flyoutOpacity: 0.97,
      scrollbarColour: "#3a455c",
      insertionMarkerColour: "#8fd8ff",
      insertionMarkerOpacity: 0.4,
    },
    fontStyle: { family: "'Segoe UI', system-ui, sans-serif", weight: "600", size: 12 },
  });
}

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
      if (current.type === "drone_repeat") {
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

function refreshDerived() {
  const script = scriptFromWorkspace();
  const flat = DroneBlocksData.stepsFromScript(script);
  const overLimit = !!flat.error && /30 steps/.test(flat.error);
  const count = flat.error ? (overLimit ? 31 : 0) : flat.steps.length;
  editorEl("blockCount").textContent = overLimit ? "TOO MANY STEPS" : `${count} / 30 ${count === 1 ? "STEP" : "STEPS"}`;
  editorEl("blockCount").classList.toggle("over-limit", overLimit);
  if (editorLevel >= 5) {
    editorEl("pythonCode").textContent = DroneBlocksData.pythonLines(script).join("\n");
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
    button.classList.toggle("complete", buttonLevel < editorLevel);
  });
  editorEl("levelHint").textContent = EDITOR_LEVEL_HINTS[editorLevel];
  editorEl("pythonPanel").classList.toggle("hidden", editorLevel < 5);
  workspace.updateToolbox(DroneBlocksData.toolboxForLevel(editorLevel));
  refreshDerived();
}

function updateRotateCover() {
  const portrait = window.matchMedia("(orientation: portrait)").matches;
  const codeActive = !editorEl("codePage").classList.contains("hidden");
  editorEl("rotateCover").classList.toggle("hidden", !(portrait && codeActive));
}

const DroneEditor = {
  init() {
    if (typeof Blockly === "undefined" || !window.DroneBlocksData || !DroneBlocksData.BLOCKS) {
      editorEl("editorFallback").classList.remove("hidden");
      return;
    }
    Blockly.defineBlocksWithJsonArray(DroneBlocksData.BLOCKS.map((b) => b.json));
    workspace = Blockly.inject("blocklyDiv", {
      renderer: "zelos",
      theme: defineTheme(),
      toolbox: DroneBlocksData.toolboxForLevel(editorLevel),
      trashcan: true,
      sounds: false,
      zoom: { controls: false, wheel: true, pinch: true, startScale: 0.85 },
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

    editorEl("runBtn").addEventListener("click", async () => {
      if (!token || !droneId) return showPicker();
      const flat = DroneBlocksData.stepsFromScript(scriptFromWorkspace());
      if (flat.error) return toast(flat.error, 2800);
      runBlockIds = flat.blockIds;
      const { ok, data } = await api("/api/run", { steps: flat.steps, token, drone_id: droneId });
      if (ok) toast("Flight plan is running!");
      else if (data.error === "bad_program" || data.error === "bad_step") {
        toast("One of those blocks is not safe to run.", 2600);
      }
    });

    const pythonPanel = editorEl("pythonPanel");
    pythonPanel.classList.add("collapsed");
    pythonPanel.querySelector(".terminal-titlebar").addEventListener("click", () => {
      pythonPanel.classList.toggle("collapsed");
      if (workspace) Blockly.svgResize(workspace);
    });

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

  setRunningStep(step) {
    if (!workspace) return;
    if (!step || !runBlockIds[step - 1]) workspace.highlightBlock(null);
    else workspace.highlightBlock(runBlockIds[step - 1]);
  },
};
window.DroneEditor = DroneEditor;

DroneEditor.init();
