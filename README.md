# Epomaker Split 70 — Config Tool

A self-contained configurator for the **Epomaker Split 70**, for when
[caniusevia.com](https://caniusevia.com) and Vial don't recognise the keyboard.
It runs entirely in your browser and talks to the keyboard directly — no install, no server,
no account, and it ships your keyboard's definition built-in so it doesn't rely on any registry.

## Requirements

- A **Chromium-based browser**: Chrome, Edge, Brave, or Opera (desktop).
  WebHID — the technology that lets the page talk to your keyboard — does **not** work in
  Firefox or Safari.
- The keyboard plugged in directly (a data cable, not charge-only; avoid flaky hubs/KVMs).

## How to use

1. **Open `Epo70VIA.html`** by double-clicking it (or drag it into a Chromium browser tab).
2. Start on the **① Diagnostic** tab and click **"Inspect HID interfaces…"**. Pick your
   keyboard from the browser dialog. It will tell you one of two things:
   - ✅ **VIA interface found** → great, the tool can configure your board. Go to step 3.
   - ❌ **No VIA interface** → your firmware doesn't expose VIA, and *no* browser tool
     (including this one) can configure it. You'd need to flash VIA-compatible firmware first.
3. Click **"Connect keyboard"** (top-right) and pick your keyboard again. The tool reads your
   current layout off the keyboard.
4. Use the tabs:
   - **② Remap & Layers** — click any key, pick a new keycode. Switch layers with the buttons.
     Edit rotary-encoder turn actions at the bottom. Changes save to the keyboard instantly.
   - **③ Auto Shift** — bind Auto Shift keys (see the note about firmware support).
   - **④ Lighting** — brightness, effect, speed, colour.
   - **⑤ Key Tester** — press keys and watch them light up. **Do this first** to confirm the
     connection works end-to-end before you trust remapping.
   - **⑥ Import / Export** — back up your layout to a file, restore it, or reset to defaults.
   - **⑦ Layers & Presets** — one-click **numpad** onto a layer (on both hands), and a finder
     that lists every layer/OS-switch key so you can rebind the one that keeps flipping you to
     Windows.

## "It keeps switching back to the Windows layout"

This isn't the tool changing your keyboard — the standard VIA protocol has **no command to set
the default layer**. Win/Mac is chosen by *pressing* a switch key (your `fn+s`), so an accidental
revert means you pressed a key bound to a Windows/`DF(0)` switch (most often the key **left of
left-Ctrl**). Open **⑦ Layers & Presets → Layer / OS-switch keys**, find that key, and **Rebind**
it to something harmless. The one tool action that *also* resets the default layer to 0 (Windows)
is **⑥ Reset keyboard (EEPROM)** — after it, press `fn+s` to get Mac back.

## Quick troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| No device appears in the browser picker | Wrong browser (use Chromium), charge-only cable, or a hub/KVM swallowing the HID interface. Try a direct USB port. |
| Diagnostic says "No VIA interface" | The firmware isn't VIA-compatible. A browser tool can't fix this — reflash with VIA firmware. |
| "VIA timeout — no HID response" | Another app may hold the device (close Vial / VIA / Epomaker's own software), then reconnect. |
| Auto Shift keys do nothing | Your firmware was built without `AUTO_SHIFT_ENABLE`. This can't be toggled from software — it's compiled in. |
| Remap seems to do nothing | Confirm with the Key Tester that the keyboard responds at all; check you're editing the right layer. |

## Backing up before you experiment

Go to **⑥ Import / Export → Export** and save the file. If anything goes wrong you can
re-import it, or use **Reset keyboard (EEPROM)** to return to firmware defaults.

## Auto Shift (macOS) — separate companion

Your keyboard's firmware was built **without** QMK Auto Shift, so it cannot be turned on
from this tool (or any config tool) — binding `AS_*` keycodes does nothing, because the
feature isn't in the firmware. A browser page also can't do it: it only sees keys typed
*into the page*, not into your other apps.

`autoshift-macos.lua` solves this host-side: it's a small [Hammerspoon](https://www.hammerspoon.org)
script that intercepts your typing system-wide and implements hold-to-shift, with a menubar
On/Off toggle (and the `⌃⌥⌘S` hotkey). Setup instructions are in the file's header comment.
Tune the hold threshold / which keys shift via the CONFIG block at the top.

## For developers / future edits

This `Epo70VIA.html` is **generated**. Edit the sources and rebuild — see `ARCHITECTURE.md`
for the full design and a step-by-step guide to adding new features.

```
python3 build.py     # regenerate Epo70VIA.html from the sources
```
