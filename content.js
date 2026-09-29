// Hover Image Zoom — content script
//
// All actions act on whichever element is currently under the mouse cursor
// (images, videos, divs, or anything else — not just <img> tags).
// Default shortcuts (fully remappable from the extension's options page):
//   Alt+X               hold to zoom in continuously, in 0.1x steps at a configurable rate
//   Alt+Z                hold to zoom out continuously, in 0.1x steps at a configurable rate
//   Ctrl+Shift+X          zoom in, snapping to the next whole integer level (1x, 2x, 3x, ...)
//   Ctrl+Shift+Z          zoom out, snapping to the previous whole integer level
//   Alt+C                 snap to 100% of the element's actual (natural) file resolution (images/video/canvas only)
//   Alt+V                 toggle nearest-neighbor (pixelated) scaling
//   Alt+S                 reset the element back to its original (100%) size
//   Alt+A                 toggle "fill the page" fullscreen (in-page, not the OS Fullscreen API)
(function () {
  if (window.__hoverImageZoomInstalled) return;
  window.__hoverImageZoomInstalled = true;

  const LOG_PREFIX = "[Hover Image Zoom]";
  console.log(LOG_PREFIX, "content script loaded on", location.href);

  const MIN_SCALE = 0.1;
  const STEP = 0.1; // size of each continuous zoom step
  const DEFAULT_RATE = 12; // steps per second, configurable via options page

  // Keep this object identical to DEFAULT_HOTKEYS in options.js / popup.js.
  const DEFAULT_HOTKEYS = {
    zoomIn: { code: "KeyX", ctrl: false, alt: true, shift: false, meta: false },
    zoomOut: { code: "KeyZ", ctrl: false, alt: true, shift: false, meta: false },
    zoomIntIn: { code: "KeyX", ctrl: true, alt: false, shift: true, meta: false },
    zoomIntOut: { code: "KeyZ", ctrl: true, alt: false, shift: true, meta: false },
    snapNative: { code: "KeyC", ctrl: false, alt: true, shift: false, meta: false },
    toggleNearest: { code: "KeyV", ctrl: false, alt: true, shift: false, meta: false },
    resetSize: { code: "KeyS", ctrl: false, alt: true, shift: false, meta: false },
    pageFullscreen: { code: "KeyA", ctrl: false, alt: true, shift: false, meta: false },
  };

  function mergeHotkeys(stored) {
    const merged = {};
    for (const id of Object.keys(DEFAULT_HOTKEYS)) {
      const c = stored && stored[id];
      merged[id] =
        c && typeof c.code === "string"
          ? { code: c.code, ctrl: !!c.ctrl, alt: !!c.alt, shift: !!c.shift, meta: !!c.meta }
          : DEFAULT_HOTKEYS[id];
    }
    return merged;
  }

  let hotkeys = mergeHotkeys(null);
  let zoomRate = DEFAULT_RATE;

  if (chrome?.storage?.sync) {
    chrome.storage.sync.get({ hotkeys: null, zoomRate: DEFAULT_RATE }, (items) => {
      hotkeys = mergeHotkeys(items.hotkeys);
      const n = Number(items.zoomRate);
      if (Number.isFinite(n) && n > 0) zoomRate = n;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      if (changes.hotkeys) hotkeys = mergeHotkeys(changes.hotkeys.newValue);
      if (changes.zoomRate) {
        const n = Number(changes.zoomRate.newValue);
        if (Number.isFinite(n) && n > 0) zoomRate = n;
      }
    });
  }

  function comboMatches(e, combo) {
    if (!combo) return false;
    return (
      e.code === combo.code &&
      e.ctrlKey === !!combo.ctrl &&
      e.altKey === !!combo.alt &&
      e.shiftKey === !!combo.shift &&
      e.metaKey === !!combo.meta
    );
  }

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

  // ---- Per-element zoom/rendering state ----
  const stateMap = new WeakMap();

  function getState(el) {
    let s = stateMap.get(el);
    if (!s) {
      s = { scale: 1, nearest: false, pageFull: false };
      stateMap.set(el, s);
    }
    return s;
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  // ---- Floating layer: lets a zoomed element escape ancestor overflow/
  // clipping and stacking context, by temporarily reparenting the *actual*
  // element (not a clone, so video/canvas/listeners keep working) into a
  // full-viewport overlay, leaving an invisible same-size placeholder behind
  // so the page layout doesn't jump.
  let zoomLayer = null;

  function ensureZoomLayer() {
    if (zoomLayer && zoomLayer.isConnected) return zoomLayer;
    zoomLayer = document.createElement("div");
    zoomLayer.id = "__hover-image-zoom-layer__";
    zoomLayer.style.cssText = [
      "position:fixed", "inset:0", "pointer-events:none",
      "z-index:2147483647", "overflow:visible",
    ].join(";");
    document.documentElement.appendChild(zoomLayer);
    return zoomLayer;
  }

  const FLOAT_STYLE_PROPS = [
    "position", "left", "top", "width", "height",
    "margin", "marginLeft", "marginTop", "marginRight", "marginBottom",
    "pointerEvents", "objectFit",
  ];

  const floatMap = new WeakMap(); // el -> { placeholder, prevStyle, pageLeft, pageTop, width, height }
  const floatingEls = new Set();

  function snapshotStyle(el) {
    const s = {};
    for (const p of FLOAT_STYLE_PROPS) s[p] = el.style[p];
    return s;
  }

  // Must be called BEFORE this step's new transform/size is written, so the
  // captured rect is always the true unscaled size the first time an
  // element floats (otherwise scale would compound on itself).
  function floatElement(el) {
    if (floatMap.has(el)) return;
    if (!el.parentNode) return;

    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const placeholder = document.createElement(el.tagName);
    placeholder.style.cssText = `width:${rect.width}px;height:${rect.height}px;visibility:hidden;`;
    placeholder.setAttribute("data-hiz-placeholder", "1");
    el.parentNode.insertBefore(placeholder, el);

    const prevStyle = snapshotStyle(el);

    ensureZoomLayer().appendChild(el);

    el.style.position = "absolute";
    el.style.margin = "0";
    el.style.width = rect.width + "px";
    el.style.height = rect.height + "px";
    el.style.pointerEvents = "auto";

    floatMap.set(el, {
      placeholder,
      prevStyle,
      pageLeft: rect.left + window.scrollX,
      pageTop: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    });
    floatingEls.add(el);
    positionFloatingElement(el);
  }

  // Puts a floating element back at its locked original size/position —
  // used to undo the "fill the page" fullscreen sizing while staying floated
  // (e.g. still zoomed to some other scale) or as part of general repositioning.
  function restoreFloatGeometry(el) {
    const info = floatMap.get(el);
    if (!info) return;
    el.style.width = info.width + "px";
    el.style.height = info.height + "px";
    positionFloatingElement(el);
  }

  function positionFloatingElement(el) {
    const info = floatMap.get(el);
    if (!info) return;
    const s = stateMap.get(el);
    if (s && s.pageFull) return; // fullscreen elements stay pinned to the viewport, not the original scroll position
    el.style.left = info.pageLeft - window.scrollX + "px";
    el.style.top = info.pageTop - window.scrollY + "px";
  }

  function unfloatElement(el) {
    const info = floatMap.get(el);
    if (!info) return;
    const { placeholder, prevStyle } = info;
    if (placeholder && placeholder.parentNode) {
      placeholder.parentNode.insertBefore(el, placeholder);
      placeholder.remove();
    }
    for (const p of FLOAT_STYLE_PROPS) el.style[p] = prevStyle[p] || "";
    floatMap.delete(el);
    floatingEls.delete(el);
  }

  let repositionScheduled = false;
  function scheduleReposition() {
    if (repositionScheduled) return;
    repositionScheduled = true;
    requestAnimationFrame(() => {
      repositionScheduled = false;
      floatingEls.forEach(positionFloatingElement);
    });
  }
  window.addEventListener("scroll", scheduleReposition, true);
  window.addEventListener("resize", scheduleReposition);

  function applyState(el, s, originX, originY) {
    const shouldFloat = s.scale !== 1 || s.pageFull;

    // Float/unfloat first, using whatever transform was in effect from the
    // *previous* call — on the very first zoom step that's still "none", so
    // the geometry locked in is always the true 100% size.
    if (shouldFloat) {
      floatElement(el);
    } else {
      unfloatElement(el);
    }

    if (s.pageFull) {
      if (el.dataset.hizPrevObjectFit === undefined) {
        el.dataset.hizPrevObjectFit = el.style.objectFit || "";
      }
      el.style.left = "0px";
      el.style.top = "0px";
      el.style.width = "100%";
      el.style.height = "100%";
      el.style.objectFit = "contain";
      el.style.transform = "none";
      el.style.transformOrigin = "50% 50%";
    } else {
      if (el.dataset.hizPrevObjectFit !== undefined) {
        el.style.objectFit = el.dataset.hizPrevObjectFit;
        delete el.dataset.hizPrevObjectFit;
      }
      if (shouldFloat) restoreFloatGeometry(el);

      if (originX !== undefined && originY !== undefined) {
        el.style.transformOrigin = `${originX}% ${originY}%`;
      } else if (!el.style.transformOrigin) {
        el.style.transformOrigin = "50% 50%";
      }
      el.style.transform = s.scale === 1 ? "" : `scale(${s.scale})`;
    }

    el.style.imageRendering = s.nearest ? "pixelated" : "";
    el.style.willChange = shouldFloat ? "transform" : "";
  }

  function getNaturalSize(el) {
    const tag = el.tagName;
    if (tag === "IMG" && el.naturalWidth) return [el.naturalWidth, el.naturalHeight];
    if (tag === "VIDEO" && el.videoWidth) return [el.videoWidth, el.videoHeight];
    if (tag === "CANVAS" && el.width) return [el.width, el.height];
    return null;
  }

  // ---- On-screen feedback toast (also doubles as a debugging aid) ----
  let toastEl = null;
  let toastTimer = null;

  function ensureToast() {
    if (toastEl && toastEl.isConnected) return toastEl;
    toastEl = document.createElement("div");
    toastEl.style.cssText = [
      "position:fixed", "right:16px", "bottom:16px", "z-index:2147483647",
      "background:rgba(0,0,0,0.78)", "color:#fff",
      "font:12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      "padding:6px 10px", "border-radius:6px", "pointer-events:none",
      "opacity:0", "transition:opacity .12s ease",
    ].join(";");
    (document.body || document.documentElement).appendChild(toastEl);
    return toastEl;
  }

  function showToast(text) {
    const el = ensureToast();
    el.textContent = text;
    el.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.style.opacity = "0";
    }, 700);
  }

  // ---- Track whichever element is currently under the cursor ----
  let hoveredEl = null;
  let lastClientX = 0;
  let lastClientY = 0;

  window.addEventListener(
    "mousemove",
    (e) => {
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      const t = e.target;
      hoveredEl = t && t.nodeType === 1 && t !== toastEl ? t : null;
    },
    true
  );

  function currentOrigin(el) {
    const rect = el.getBoundingClientRect();
    const originX = rect.width ? ((lastClientX - rect.left) / rect.width) * 100 : 50;
    const originY = rect.height ? ((lastClientY - rect.top) / rect.height) * 100 : 50;
    return [originX, originY];
  }

  function requireHoveredElement() {
    if (!hoveredEl) {
      showToast("Hover Image Zoom: no element under cursor");
      return null;
    }
    return hoveredEl;
  }

  // ---- Continuous zoom (held) ----
  let continuousTimer = null;
  let continuousDirection = null; // 'in' | 'out'

  function continuousStep() {
    const el = hoveredEl;
    if (!el) return;
    const s = getState(el);
    s.pageFull = false;
    s.scale = continuousDirection === "in" ? s.scale + STEP : s.scale - STEP;
    s.scale = Math.max(MIN_SCALE, round2(s.scale));
    const [ox, oy] = currentOrigin(el);
    applyState(el, s, ox, oy);
    showToast(`Zoom: ${Math.round(s.scale * 100)}%`);
  }

  function startContinuousZoom(direction) {
    console.log(LOG_PREFIX, comboLabel(direction === "in" ? hotkeys.zoomIn : hotkeys.zoomOut), "held — zoom", direction);
    if (!hoveredEl) showToast("Hover Image Zoom: no element under cursor");
    if (continuousDirection === direction) return;
    stopContinuousZoom();
    continuousDirection = direction;
    continuousStep();
    continuousTimer = setInterval(continuousStep, 1000 / Math.max(1, zoomRate));
  }

  function stopContinuousZoom() {
    if (continuousTimer) clearInterval(continuousTimer);
    continuousTimer = null;
    continuousDirection = null;
  }

  window.addEventListener("blur", stopContinuousZoom);

  // ---- Integer-snap zoom (one level per press) ----
  function integerZoomStep(direction) {
    console.log(LOG_PREFIX, comboLabel(direction === "in" ? hotkeys.zoomIntIn : hotkeys.zoomIntOut), "pressed");
    const el = requireHoveredElement();
    if (!el) return;
    const s = getState(el);
    s.pageFull = false;
    s.scale =
      direction === "in"
        ? Math.floor(s.scale) + 1
        : Math.max(1, Math.ceil(s.scale) - 1);
    const [ox, oy] = currentOrigin(el);
    applyState(el, s, ox, oy);
    showToast(`Zoom: ${Math.round(s.scale * 100)}%`);
  }

  // ---- Snap to native file resolution (images/video/canvas only) ----
  function snapToNative() {
    console.log(LOG_PREFIX, comboLabel(hotkeys.snapNative), "pressed");
    const el = requireHoveredElement();
    if (!el) return;
    const natural = getNaturalSize(el);
    if (!natural) {
      showToast("Hover Image Zoom: no native resolution for this element");
      return;
    }
    const s = getState(el);
    s.pageFull = false;
    // Use the locked layout width if already floating (the true 100%
    // reference size), otherwise the current on-page width.
    const info = floatMap.get(el);
    const baseWidth = info ? info.width : el.offsetWidth;
    if (!baseWidth) return;
    s.scale = round2(natural[0] / baseWidth);
    const [ox, oy] = currentOrigin(el);
    applyState(el, s, ox, oy);
    showToast(`Native size: ${Math.round(s.scale * 100)}%`);
  }

  // ---- Toggle nearest-neighbor scaling ----
  function toggleNearest() {
    console.log(LOG_PREFIX, comboLabel(hotkeys.toggleNearest), "pressed");
    const el = requireHoveredElement();
    if (!el) return;
    const s = getState(el);
    s.nearest = !s.nearest;
    applyState(el, s);
    showToast(`Pixelated: ${s.nearest ? "on" : "off"}`);
  }

  // ---- Reset back to original size ----
  function resetSize() {
    console.log(LOG_PREFIX, comboLabel(hotkeys.resetSize), "pressed");
    const el = requireHoveredElement();
    if (!el) return;
    const s = getState(el);
    s.scale = 1;
    s.pageFull = false;
    const [ox, oy] = currentOrigin(el);
    applyState(el, s, ox, oy);
    showToast("Reset to 100%");
  }

  // ---- Toggle "fill the page" fullscreen (in-page, not the OS Fullscreen API) ----
  function togglePageFullscreen() {
    console.log(LOG_PREFIX, comboLabel(hotkeys.pageFullscreen), "pressed");
    const el = requireHoveredElement();
    if (!el) return;
    const s = getState(el);
    s.pageFull = !s.pageFull;
    const [ox, oy] = currentOrigin(el);
    applyState(el, s, ox, oy);
    showToast(s.pageFull ? "Page fullscreen: on" : "Page fullscreen: off");
  }

  function isEditableTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (el.isContentEditable) return true;
    return false;
  }

  window.addEventListener(
    "keydown",
    (e) => {
      if (isEditableTarget(e.target)) return;

      if (comboMatches(e, hotkeys.zoomIn)) {
        e.preventDefault();
        if (!e.repeat) startContinuousZoom("in");
        return;
      }
      if (comboMatches(e, hotkeys.zoomOut)) {
        e.preventDefault();
        if (!e.repeat) startContinuousZoom("out");
        return;
      }
      if (comboMatches(e, hotkeys.zoomIntIn)) {
        e.preventDefault();
        if (!e.repeat) integerZoomStep("in");
        return;
      }
      if (comboMatches(e, hotkeys.zoomIntOut)) {
        e.preventDefault();
        if (!e.repeat) integerZoomStep("out");
        return;
      }
      if (comboMatches(e, hotkeys.snapNative)) {
        e.preventDefault();
        if (!e.repeat) snapToNative();
        return;
      }
      if (comboMatches(e, hotkeys.toggleNearest)) {
        e.preventDefault();
        if (!e.repeat) toggleNearest();
        return;
      }
      if (comboMatches(e, hotkeys.resetSize)) {
        e.preventDefault();
        if (!e.repeat) resetSize();
        return;
      }
      if (comboMatches(e, hotkeys.pageFullscreen)) {
        e.preventDefault();
        if (!e.repeat) togglePageFullscreen();
        return;
      }
    },
    true
  );

  window.addEventListener(
    "keyup",
    (e) => {
      const activeCombo =
        continuousDirection === "in" ? hotkeys.zoomIn : continuousDirection === "out" ? hotkeys.zoomOut : null;
      if (!activeCombo) return;
      const stillHeld =
        e.code !== activeCombo.code &&
        e.ctrlKey === !!activeCombo.ctrl &&
        e.altKey === !!activeCombo.alt &&
        e.shiftKey === !!activeCombo.shift &&
        e.metaKey === !!activeCombo.meta;
      if (!stillHeld) stopContinuousZoom();
    },
    true
  );
})();
