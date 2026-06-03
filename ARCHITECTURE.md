# Architecture — Epomaker Split 70 Config Tool

> Reference for future Claude sessions. Read this before changing anything.
> The user wants this tool to stay **easy to extend**. The whole design exists to
> make "add a feature" mean "add one panel object". Honor that.

## 1. What this is

A self-hosted replacement for caniusevia.com / Vial-GUI, specific to one keyboard
(Epomaker Split 70, VID `0x342d` / PID `0xe491`). It talks to the keyboard directly
over **WebHID** using the **VIA protocol**, and ships the keyboard's VIA definition
embedded so it never depends on an external device registry.

**Why it exists:** caniusevia.com rejected the board because its VID/PID isn't in the
public registry, even though the firmware exposes a working VIA raw-HID interface.
Embedding the JSON + filtering HID by usage page (not VID/PID) sidesteps that.

**Hard constraints:**
- WebHID is **Chromium-only** (Chrome/Edge/Brave/Opera). No Firefox/Safari. Not negotiable.
- Single self-contained `Epo70VIA.html` — no server, no build step *to run* (build step only to *assemble*).
- This is a **VIA** board, not Vial. Do not add Vial-prefixed (`0xFE`) commands.

## 2. File layout & build

```
index.template.html      shell: HTML/CSS, transport, Via class, Keycodes module, panel registry
panels.js                the feature panels (one registerPanel() call each)
panels.archived.js       parked panels NOT built in (Auto Shift, Lighting, Key Tester,
                         old verbose Layers&Presets). build.py ignores it; paste a
                         registerPanel back into panels.js + rebuild to restore.
macros.js                PURE VIA macro encode/decode (Node-testable). Injected at the
                         /*__MACROS__*/ marker.
test/macros.test.js      node --test suite for macros.js.
_keycodes_basic.gen.js   AUTO-GENERATED basic keycode table (do not hand-edit)
Epomaker_Split70.json    the VIA definition (embedded at build time)
build.py                 assembles the above → Epo70VIA.html
Epo70VIA.html            THE DELIVERABLE (generated; don't hand-edit — edit sources + rebuild)
```

**To rebuild after editing a source:** `python3 build.py`

`build.py` injects four markers in the template:
`/*__KEYBOARD_DEF__*/`, `/*__BASIC_KEYCODES__*/`, `/*__MACROS__*/`, `/*__PANELS__*/`.

> ⚠ `Epo70VIA.html` is generated. If you edit it directly your change is lost on the next
> build. Always edit `index.template.html` or `panels.js`, then run `build.py`.

## 3. Three layers (all end up inline in Epo70VIA.html)

### a. Transport + VIA protocol — `Via` class (in the template)
- WebHID framing: **32-byte payload, report ID 0**. `dev.sendReport(0, Uint8Array(32))`.
- Responses arrive via the `inputreport` event; `e.data` is a `DataView` **without** the
  report-ID byte, so `data[0]` == the firmware's `command_data[0]`.
- Commands are **serialized** (`exec()` chains on `_lock`) — one outstanding request at a time,
  1.5 s timeout. The input report is **matched to the command** by echoed byte 0 (and byte 1 for
  get/set_keyboard_value), with a generation token, so a late/stray report after a timeout cannot
  resolve the *next* command. Without this, one USB hiccup mid-`reloadKeymap` would desync every
  subsequent read → silent keymap corruption. (Verified by a Node transport test — recreate it if
  you touch `_raw`/`_onInput`.)
- Command IDs (`VIA_CMD`) verified against `the-via/qmk_firmware` `quantum/via.h`.

Key methods: `getProtocolVersion`, `getLayerCount`, `getKeymapBuffer(totalBytes)`,
`setKeycode(l,r,c,kc)`, `getEncoder/setEncoder(l,idx,cw,kc)`, `getMatrixState(rows,cols)`,
`customGet/customSet/customSave(channel,...)`, `eepromReset`.

**Important protocol facts (don't relearn these the hard way):**
- Dynamic-keymap writes (`setKeycode`, `setEncoder`) persist to EEPROM **immediately** —
  no separate "save" needed for the keymap. Lighting (`customSet`) **does** need `customSave(channel)`.
- Keymap buffer is layer-major: index `((layer*rows + row)*cols + col)`; each keycode is 2 bytes,
  big-endian. `getBuffer` returns ≤28 data bytes per call (32 − 4-byte header) → read in 28-byte chunks.
- `getMatrixState` for **9 cols (>8)** packs **2 bytes per row, high byte first**
  (`(v>>8)&0xFF` then `v&0xFF`), starting at byte index 2. Bit `c` of the row value = column `c`.

### b. Keycodes module — `Keycodes` (in the template)
Encodes/decodes 16-bit QMK keycodes. **Correctness here is the whole tool** — a wrong value
fails silently on hardware. Sources, not guesses:
- Basic codes (`0x0000`–`0x00FF`): generated from QMK `data/constants/keycodes` → `_keycodes_basic.gen.js`.
- Range bases (verified against the same source):
  `QK_MODS 0x0100`, `QK_MOD_TAP 0x2000`, `QK_LAYER_TAP 0x4000`, `QK_LAYER_MOD 0x5000`,
  `QK_TO 0x5200`, `QK_MOMENTARY 0x5220`, `QK_DEF_LAYER 0x5240`, `QK_TOGGLE_LAYER 0x5260`,
  `QK_ONE_SHOT_LAYER 0x5280`, `QK_ONE_SHOT_MOD 0x52A0`, `QK_LAYER_TAP_TOGGLE 0x52C0`.
  Layer ops use mask `0x1F` (no hidden ON_PRESS bit — the range width confirms it).
- Auto Shift: `0x7C10`–`0x7C15` (`AS_DOWN/UP/RPT/ON/OFF/TOGG`).
- **Custom keycodes**: `customKeycodes[i]` → `0x7E00 + i` (`QK_KB_0`). This is why MOR_1=`0x7E03`, etc.
  Get this wrong and existing binds decode as "unknown" and export corrupts them.

`decode(kc)` → `{code,name,label,cat,unknown?}`. `layerCode(op,layer)` → encoded value.
There is an in-page `selfTest()` (runs on boot, logs pass/fail) asserting round-trips — extend it
when you add encoders/decoders.

### c. UI: panel registry + shell (template) and panels (`panels.js`)
- `App` is the shared state + event bus (`App.on/emit`). Holds `def, rows, cols, via, connected,
  layerCount, keymap (Uint16Array), state.layer, layout, encoders`.
- `App.layout` is parsed from the definition's KLE `layouts.keymap` by `parseLayout()` →
  array of `{x,y,w,h,pos,row,col,enc}`. Encoders are keys whose label contains an `e<N>` segment
  (here: position `0,0` is encoder 0).
- The shell builds one tab per registered panel and calls `panel.render(rootDiv, App)`.

## 4. Adding a panel (the extensibility contract)

In `panels.js`, append:

```js
registerPanel({
  id: "macros",                 // unique, used for the DOM id / tab
  title: "⑦ Macros",            // tab label
  requiresConnection: true,     // advisory flag (panels still self-guard with needConnection())
  render(root, App) {
    root.innerHTML = `<div class="card">…</div>`;
    // Talk to hardware via App.via.<method>()  (add new methods to the Via class if needed)
    // React to lifecycle: App.on("connect"|"disconnect"|"keymap-loaded"|"layer-change", fn)
    // Open the keycode picker:  Picker.open("title", code => { … })
    // Render the keyboard:      renderBoard(hostEl, { label(k){…}, onClick(k,el){…}, classFor(k){…} })
    // Log to the session log:   log("message", "ok"|"warn"|"err")
  }
});
```
Then `python3 build.py`. That's the whole process — no shell changes needed.

**Shared helpers available to every panel:** `App`, `Via` (via `App.via`), `Keycodes`,
`Picker`, `renderBoard`, `needConnection`, `log`, `escapeHtml`, `hex16`, `reloadKeymap`.

**Events emitted by the shell:** `connect`, `disconnect`, `keymap-loaded`, `layer-change`.

**If a feature needs a new VIA command**, add a typed method to the `Via` class in the template
(keep the byte layout in a comment), then use it from the panel. Don't issue raw reports from panels.

## 5. Current panels (panels.js)
The active tool is deliberately trimmed to six panels (the rest are parked in
`panels.archived.js`). Order = registration order = tab order.
1. **Diagnostic** — enumerates HID collections, reports whether the `0xFF60`/usage `0x61`
   interface exists. This is the gate: no FF60 → no web tool can help (firmware needs flashing).
2. **Remap & Layers** — visual keymap from `App.layout`; layer selector; click key → picker;
   encoder CW/CCW editing. The selector is driven by **`LAYER_VIEW`** (see below), not the raw
   firmware layer count.
3. **Numpad** — *one* button. Writes the right-hand numpad (`NUMPAD.right`, keypad keycodes,
   non-destructive to the rest of the layer) to firmware layer `NUMPAD_FW` (**3**), **and** binds
   the corner key left of L-Ctrl (matrix `4,0`) to `MO(3)` on **every** firmware layer.
   - **Why layer 3, not 1:** QMK resolves a key by scanning active layers top-down. A momentary
     layer only wins if its index is *above* the base. The user's base is firmware layer 2, so the
     numpad must be 3 — on 1 it sits below the base and stays occluded (this was the original
     "not working" bug). `NUMPAD_FW` must stay `> ` the base layer; the panel guards against
     `NUMPAD_FW >= layerCount`.
   - Writing the momentary key to all layers (not just the base) means it works regardless of which
     layer is active; `(4,0)` is never a numpad digit and `MO` on the numpad layer is a no-op.
4. **Import / Export** — keymap JSON round-trip (`kcToken`/`tokenToKc`) + EEPROM reset. Uses **raw
   firmware layer indices** (NOT `LAYER_VIEW`) so backups stay lossless across the whole keymap.
5. **Profiles** — localStorage-backed full-keymap snapshots (keymap + encoders, RAW layer
   indices via the shared buildKeymapObject/applyKeymapObject helpers). Auto-captures the
   live layout as "default" on the first connect (also downloads default-profile.json as a
   file:// safety net) and feature-detects whether localStorage persists. Auto-capture binds
   to the "connect" event (App.keymap is already populated by then; import/apply emit only
   "keymap-loaded", so it never re-fires on a profile apply).
6. **Macros** — VIA dynamic-macro editor. Capability-gated on getMacroCount/getMacroBufferSize.
   Whole-buffer rewrite model; plain text + [[…]] tokens (LaTeX braces literal, newline=Enter).
   Macros are triggerable because the keycode picker now offers M0.. (QK_MACRO 0x7700+i).

**`LAYER_VIEW` (top of panels.js) — display-only layer relabel.** The user works with only two
layers: their base content lives on firmware layer **2**, the numpad on firmware layer **3**. The
GUI relabels firmware-2 → "Layer 0" and firmware-3 → "Layer 1" and hides firmware 0 & 1. This is
**display only** — VIA has *no command to move layers or set the default layer*, so it does NOT
change what the keyboard boots into. `App.state.layer` is initialised to `LAYER_VIEW[0].fw`. To
change the mapping, edit that one table. (Caveat: the in-template keycode **picker** still lists
`MO(0)…MO(3)` by raw firmware index, so it shows "MO(3)" for the numpad the selector calls "Layer 1".)

> The "keyboard keeps reverting to the Windows layout" fix surface (rebinding an OS/`DF` switch key)
> now lives in the archived verbose Layers&Presets panel; restore it from `panels.archived.js` if needed.

## 6. Testing without hardware
There is no physical keyboard available to the author, so:
- `node --check` the extracted `<script>` for syntax.
- A Node harness stubs `document`/`navigator` with a universal proxy, runs the bundle, and asserts:
  layout parses, encoder detected, keycode round-trips, complex decodes (LT/MT/MODS), all layer-op
  bases, the matrix bit-packing math, and keymap-index uniqueness. (Recreate it if you change that logic.)
- The in-page **Key Tester** is the user-facing proof-of-life — it validates the full
  transport+protocol path on real hardware before the user trusts remapping.

## 7. Known caveats / honest limitations
- **Auto Shift** keycodes only act if firmware was built with `AUTO_SHIFT_ENABLE`. The UI says so.
- **Lighting `showIf`** conditions in the definition are not evaluated — all controls are shown.
- **Macros** are implemented (Macros panel + macros.js). Encoding sourced from QMK master;
  the [[DELAY]]/[[TAP]] non-text encodings may differ on older firmware — flagged in the UI.
  Profiles do NOT include macros (keymap + encoders only).
- Export uses QMK names for simple keycodes and hex for complex composites (LT/MT/MODS/OSM) so the
  round-trip is lossless within this tool; it is close to but not byte-identical to VIA's own format.
- Export/import **includes encoder rotation** (read live per layer via `getEncoder`, replayed via
  `setEncoder`). Macros are not part of export (keymap + encoders only).
