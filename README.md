# Hover Image Zoom

Zoom in/out on whatever page element is under your cursor with keyboard shortcuts (not limited to images).

## Install (unpacked, for personal/dev use)
1. Unzip this folder somewhere permanent (don't delete it after installing — Chrome loads the extension from these files).
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `image-zoom-extension` folder.
5. Done — it runs on every page automatically. Reload any tabs that were already open before installing.

## Usage
All shortcuts act on whichever element is currently under your mouse cursor — not just images. It works on videos, divs, buttons, whole page sections, anything — no click needed first.

| Shortcut | Effect |
|---|---|
| **Alt+X** (hold) | Zoom in continuously, in 0.1x steps, at a configurable rate |
| **Alt+Z** (hold) | Zoom out continuously, in 0.1x steps, at the same rate |
| **Ctrl+Shift+X** | Zoom in one whole integer level (e.g. 1x → 2x → 3x) |
| **Ctrl+Shift+Z** | Zoom out one whole integer level (floors at 1x) |
| **Alt+C** | Snap to 100% of the element's actual file resolution — only works on `<img>`, `<video>`, and `<canvas>`, which are the only elements with a "native" pixel size |
| **Alt+V** | Toggle nearest-neighbor (`image-rendering: pixelated`) scaling on/off |
| **Alt+S** | Reset the element back to its original (100%) size |

Each element keeps its own zoom level and rendering mode independently, tracked as long as it stays on the page. Zooming a large container (like a whole `<div>` or the page body) works too, but can get visually intense fast — Alt+S is there to snap it right back.

## Toolbar icon
Clicking the extension's icon (pin it via the puzzle-piece menu for quick access) opens a small popup listing the current shortcuts, plus a button to open full settings. The icon isn't required for the extension to work — shortcuts and the content script run on every page regardless of whether it's pinned or clicked.

## Settings
Right-click the extension in `chrome://extensions` (or click "Extension options" on its card) to open the settings page. From there you can:
- **Remap any shortcut** — click its button, then press the new key combination (any mix of Ctrl/Alt/Shift/Meta + a key). Press Esc to cancel a recording. Changes save immediately and take effect on already-open tabs right away — no reload needed.
- **Reset all shortcuts to defaults** with one button.
- **Set the zoom repeat rate** — how many 0.1x steps per second Alt+X/Alt+Z (or whatever you've remapped them to) apply while held.

If two actions end up sharing the same combination, the options page flags it — only one of them will actually fire (whichever the code checks first), so it's worth giving each action a distinct shortcut.

## If shortcuts seem to do nothing
1. **Reload the extension, not just the page.** After any code change, go to `chrome://extensions` and click the reload icon on the extension's card, then do a full reload (F5) of the tab you're testing on. Switching back to an already-open tab does not pick up new content script code.
2. **Open DevTools (F12) → Console** on the test page. You should see `[Hover Image Zoom] content script loaded on ...` when the page loads, and a line for every recognized keypress (e.g. `Alt+X held — zoom in`). If you see nothing at all when pressing a shortcut, the keystroke isn't reaching the page — see #3.
3. **Check for a system-wide hotkey conflict**, especially for `Alt+Z`: if you have an NVIDIA GPU with GeForce Experience or the NVIDIA app installed, `Alt+Z` is its default overlay hotkey and gets intercepted before Chrome (or any app) ever sees it — no extension can override this. Test by pressing `Alt+Z` in a plain text field like Notepad; if nothing happens there either, it's being swallowed at the OS level, not by this extension. You can either remap/disable that shortcut in the NVIDIA app's Settings → General → In-Game Overlay, or let me know and I can change this extension's shortcuts to something less contested (e.g. bracket keys or a Ctrl+Alt combo).
4. A small toast in the bottom-right corner of the page confirms each action fired (e.g. "Zoom: 130%" or "no image under cursor") — useful for telling apart "the shortcut didn't register" from "it registered, but you weren't hovering an image."

## Notes / limitations
- Zoom is applied via CSS `transform: scale()` on the image element itself, so it can occasionally get visually clipped by a parent container with `overflow: hidden`. The extension bumps the image's `z-index` while zoomed to reduce this, but it can't fix every page's layout.
- Minimum zoom is 0.1x; there's no hard maximum.
- Shortcuts are ignored while typing in a text field, textarea, or contenteditable element.
- Shortcuts use physical key codes (not the character produced), so they behave consistently even on keyboard layouts where Alt/Option remaps letters (e.g. macOS).
