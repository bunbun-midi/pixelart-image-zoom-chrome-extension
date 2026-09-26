// Keep this object identical to DEFAULT_HOTKEYS in content.js.
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
  { id: "zoomIn", label: "Zoom in (hold to repeat)" },
  { id: "zoomOut", label: "Zoom out (hold to repeat)" },
  { id: "zoomIntIn", label: "Zoom in — snap to next integer level" },
  { id: "zoomIntOut", label: "Zoom out — snap to previous integer level" },
  { id: "snapNative", label: "Snap to 100% native file resolution (images/video/canvas)" },
  { id: "toggleNearest", label: "Toggle nearest-neighbor (pixelated) scaling" },
  { id: "resetSize", label: "Reset to original (100%) size" },
];

// Keys that can't be recorded as a standalone shortcut trigger — we wait for
// the actual letter/number/etc. key while these are just held as modifiers.
const MODIFIER_CODES = new Set([
  "ControlLeft", "ControlRight",
  "AltLeft", "AltRight",
  "ShiftLeft", "ShiftRight",
  "MetaLeft", "MetaRight",
]);

const DEFAULT_RATE = 12;

let hotkeys = JSON.parse(JSON.stringify(DEFAULT_HOTKEYS));
let recordingAction = null;

const hotkeysContainer = document.getElementById("hotkeys");
const hotkeyStatusEl = document.getElementById("hotkeyStatus");
const rateInput = document.getElementById("rate");
const statusEl = document.getElementById("status");

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

function comboKey(combo) {
  return `${combo.code}|${!!combo.ctrl}|${!!combo.alt}|${!!combo.shift}|${!!combo.meta}`;
}

function findConflicts() {
  // Maps a combo signature to the list of action ids using it.
  const bySignature = {};
  for (const { id } of ACTIONS) {
    const sig = comboKey(hotkeys[id]);
    (bySignature[sig] = bySignature[sig] || []).push(id);
  }
  const conflicting = new Set();
  for (const ids of Object.values(bySignature)) {
    if (ids.length > 1) ids.forEach((id) => conflicting.add(id));
  }
  return conflicting;
}

function render() {
  hotkeysContainer.innerHTML = "";
  const conflicts = findConflicts();

  for (const { id, label } of ACTIONS) {
    const row = document.createElement("div");
    row.className = "hotkey-row";

    const descWrap = document.createElement("div");
    const desc = document.createElement("span");
    desc.className = "desc";
    desc.textContent = label;
    descWrap.appendChild(desc);

    if (conflicts.has(id)) {
      const warn = document.createElement("span");
      warn.className = "conflict";
      warn.textContent = "Same shortcut as another action above — only one will fire.";
      descWrap.appendChild(warn);
    }

    const btn = document.createElement("button");
    btn.className = "combo-btn" + (recordingAction === id ? " recording" : "");
    btn.textContent = recordingAction === id ? "Press keys… (Esc to cancel)" : comboLabel(hotkeys[id]);
    btn.addEventListener("click", () => {
      recordingAction = recordingAction === id ? null : id;
      render();
    });

    row.append(descWrap, btn);
    hotkeysContainer.appendChild(row);
  }
}

window.addEventListener("keydown", (e) => {
  if (!recordingAction) return;
  e.preventDefault();

  if (e.code === "Escape") {
    recordingAction = null;
    render();
    return;
  }
  if (MODIFIER_CODES.has(e.code)) return; // wait for a real key

  hotkeys[recordingAction] = {
    code: e.code,
    ctrl: e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    meta: e.metaKey,
  };
  recordingAction = null;
  saveHotkeys();
});

function saveHotkeys() {
  chrome.storage.sync.set({ hotkeys }, () => {
    render();
    hotkeyStatusEl.textContent = "Saved.";
    setTimeout(() => (hotkeyStatusEl.textContent = ""), 1500);
  });
}

function resetHotkeys() {
  hotkeys = JSON.parse(JSON.stringify(DEFAULT_HOTKEYS));
  saveHotkeys();
}

function loadHotkeys() {
  chrome.storage.sync.get({ hotkeys: null }, (items) => {
    hotkeys = { ...DEFAULT_HOTKEYS };
    if (items.hotkeys) {
      for (const id of Object.keys(DEFAULT_HOTKEYS)) {
        const c = items.hotkeys[id];
        if (c && typeof c.code === "string") {
          hotkeys[id] = { code: c.code, ctrl: !!c.ctrl, alt: !!c.alt, shift: !!c.shift, meta: !!c.meta };
        }
      }
    }
    render();
  });
}

function loadRate() {
  chrome.storage.sync.get({ zoomRate: DEFAULT_RATE }, (items) => {
    rateInput.value = items.zoomRate;
  });
}

function saveRate() {
  let n = Number(rateInput.value);
  if (!Number.isFinite(n) || n <= 0) n = DEFAULT_RATE;
  n = Math.min(60, Math.max(1, Math.round(n)));
  rateInput.value = n;
  chrome.storage.sync.set({ zoomRate: n }, () => {
    statusEl.textContent = "Saved.";
    setTimeout(() => (statusEl.textContent = ""), 1500);
  });
}

document.getElementById("resetHotkeys").addEventListener("click", resetHotkeys);
document.getElementById("saveRate").addEventListener("click", saveRate);

loadHotkeys();
loadRate();
