"use strict";
/* Pure data + logic for the Blockly editor. No DOM, no Blockly API here,
   so Node can unit-test it (node --test drone_hub/tests). */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.DroneBlocksData = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  return {};
});
