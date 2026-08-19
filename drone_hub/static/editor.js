"use strict";
/* Blockly editor glue: inject, theme, levels, save, run, highlight.
   Loads after app.js; shares its top-level bindings (api, toast, token,
   droneId, showPicker) because both are classic scripts. */
const DroneEditor = {
  init() {},
  refreshLayout() {},
  setRunningStep() {},
};
window.DroneEditor = DroneEditor;
