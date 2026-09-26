// Keep in sync with content.js / options.js.
const DEFAULT_HOTKEYS = {
  zoomIn: { code: "KeyX", ctrl: false, alt: true, shift: false, meta: false },
  zoomOut: { code: "KeyZ", ctrl: false, alt: true, shift: false, meta: false },
  zoomIntIn: { code: "KeyX", ctrl: true, alt: false, shift: true, meta: false },
  zoomIntOut: { code: "KeyZ", ctrl: true, alt: false, shift: true, meta: false },
  snapNative: { code: "KeyC", ctrl: false, alt: true, shift: false, meta: false },
  toggleNearest: { code: "KeyV", ctrl: false, alt: true, shift: false, meta: false },
  resetSize: { code: "KeyS", ctrl: false, alt: true, shift: false, meta: false },
};

const ACTIONS = [
  { id: "zoomIn", label: "Zoom in (hold)" },
  { id: "zoomOut", label: "Zoom out (hold)" },
  { id: "zoomIntIn", label: "Zoom in, whole levels" },
  { id: "zoomIntOut", label: "Zoom out, whole levels" },
  { id: "snapNative", label: "Snap to native size" },
  { id: "toggleNearest", label: "Toggle pixelated" },
  { id: "resetSize", label: "Reset to 100%" },
];

function codeToLabel(code) {
  if (!code) return "?";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}

function comboLabel(combo) {
  if (!combo) return "(unset)";
  const parts = [];
  if (combo.ctrl) parts.push("Ctrl");
  if (combo.alt) parts.push("Alt");
  if (combo.shift) parts.push("Shift");
  if (combo.meta) parts.push("Meta");
  parts.push(codeToLabel(combo.code));
  return parts.join("+");
}

function render(hotkeys) {
  const table = document.getElementById("shortcuts");
  table.innerHTML = "";
  for (const { id, label } of ACTIONS) {
    const row = document.createElement("tr");
    const comboCell = document.createElement("td");
    comboCell.className = "combo";
    comboCell.textContent = comboLabel(hotkeys[id]);
    const labelCell = document.createElement("td");
    labelCell.textContent = label;
    row.append(comboCell, labelCell);
    table.appendChild(row);
  }
}

chrome.storage.sync.get({ hotkeys: null }, (items) => {
  const hotkeys = { ...DEFAULT_HOTKEYS };
  if (items.hotkeys) {
    for (const id of Object.keys(DEFAULT_HOTKEYS)) {
      const c = items.hotkeys[id];
      if (c && typeof c.code === "string") {
        hotkeys[id] = { code: c.code, ctrl: !!c.ctrl, alt: !!c.alt, shift: !!c.shift, meta: !!c.meta };
      }
    }
  }
  render(hotkeys);
});

document.getElementById("openOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
