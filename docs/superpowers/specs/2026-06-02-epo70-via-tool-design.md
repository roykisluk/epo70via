# Epomaker Split 70 — Self-Hosted VIA Config Tool

**Date:** 2026-06-02
**Status:** Approved, in implementation
**Deliverable:** A single self-contained `index.html` (no build, no server, no deps) opened in a Chromium browser.

## Problem

The user's Epomaker Split 70 is not configurable via [caniusevia.com](https://caniusevia.com) or Vial. The keyboard itself works (typing is fine) — only the config software fails to detect it. The keyboard ships a **VIA V3** definition (`Epo70/Epomaker_Split70.json`): `vendorId 0x342d`, `productId 0xe491`, 10×9 matrix, a Lighting menu, 8 custom keycodes, and at least one rotary encoder.

The most likely root cause is that the VID/PID is not in caniusevia.com's public registry, so its device picker rejects the board even though the board exposes a working VIA raw-HID interface. A self-hosted tool that ships *this* JSON and filters HID by usage page (not VID/PID registry) sidesteps that.

## Goals

Minimum (explicitly requested): remapping, autoshift, layers, export/import.
Added: connection diagnostic, key/matrix tester, rotary encoder support, RGB lighting.
Cross-cutting (explicitly requested): **easy to extend** with future features, and **documented for future Claude sessions**.

## Non-goals

- Supporting non-Chromium browsers (WebHID is Chromium-only — hard constraint).
- Flashing firmware (out of scope; the diagnostic will *tell* the user if a flash is needed).
- Vial-specific protocol (`id_vial_prefix 0xFE`). This is a VIA board, not Vial.

## Architecture

Single HTML file, three logical layers, all inline:

1. **Transport** (`hid.js` logic) — WebHID open/close, `sendReport`/`receiveReport`, 32-byte command framing (report ID 0, 32-byte payload), request/response matching with timeout.
2. **VIA protocol** (`Via` class) — typed methods over the command IDs (see ARCHITECTURE.md for the table). Knows nothing about UI.
3. **UI / panel registry** — a `PANELS` array; each feature is a self-contained panel object `{ id, title, requiresConnection, render(root, ctx) }`. The shell renders a tab per panel and calls `render` with a shared context `ctx = { via, kbd, keymap, keycodes, bus }`. **Adding a feature = adding one object to `PANELS`.** This is the extensibility contract.

A small event `bus` lets panels react to connect/disconnect and keymap reloads without coupling to each other.

### Why the "Connection Diagnostic" leads

"Not recognized" has two causes and only one is fixable by any web tool:
1. Board exposes the `0xFF60` / usage `0x61` raw-HID interface but caniusevia rejected the VID/PID → **this tool works**.
2. Firmware exposes no `0xFF60` interface at all → **no web tool can configure it**; needs a VIA-compatible firmware flash.

The diagnostic enumerates already-granted devices and, on request, calls `navigator.hid.requestDevice` to inspect every collection's `usagePage`/`usage`, then states plainly which case the user is in. This is verifiable in ~10 seconds and gates whether the rest of the tool can work.

## Data model

- **Definition** (`kbd`): parsed from the embedded `Epomaker_Split70.json`. Provides matrix size, `layouts.keymap` (KLE-style rows with `"row,col"` labels and an `e0`-style encoder tag), `customKeycodes`, and the Lighting `menus`.
- **Keymap** (`keymap`): `layers × rows × cols` array of 16-bit keycodes, read from the firmware via `dynamic_keymap_get_buffer`. Layer count from `dynamic_keymap_get_layer_count`.
- **Keycodes** (`keycodes`): the authoritative table (basic codes sourced from QMK `data/constants/keycodes`; layer/mod/autoshift/custom encoders computed). See ARCHITECTURE.md.

## Keycode correctness (critical)

The whole tool is only as correct as its keycode table; a wrong value fails silently on hardware. Therefore:
- Basic codes (0x00–0xFF) are generated from QMK's machine-readable constants, not hand-typed.
- Layer/mod ranges use QMK's documented range bases (verified against `data/constants/keycodes`): `QK_LAYER_TAP 0x4000`, `QK_LAYER_MOD 0x5000`, `QK_TO 0x5200`, `QK_MOMENTARY 0x5220`, `QK_DEF_LAYER 0x5240`, `QK_TOGGLE_LAYER 0x5260`, `QK_ONE_SHOT_LAYER 0x5280`, `QK_ONE_SHOT_MOD 0x52A0`, `QK_LAYER_TAP_TOGGLE 0x52C0`, `QK_MOD_TAP 0x2000`, `QK_MODS 0x0100`.
- **Auto Shift** = keycodes `0x7C10`–`0x7C15` (`AS_DOWN/UP/RPT/ON/OFF/TOGG`). They only act if firmware was built with `AUTO_SHIFT_ENABLE`; the UI says so.
- **Custom keycodes**: `customKeycodes[i]` → `0x7E00 + i` (`QK_KB_0`). Round-tripped so existing binds (MOR_1, IM_BATQ, …) don't decode as "unknown" and don't corrupt on export.

## Features (panels)

| Panel | Protocol used | Notes |
|---|---|---|
| Diagnostic | WebHID enumerate | Leads; detects the FF60 case |
| Remap | get/set_keycode, get_buffer | Visual keymap from JSON; click key → picker |
| Layers | get_layer_count | Per-layer view; MO/TG/TO/LT/DF in picker |
| Auto Shift | (keycodes) | AS_* keycodes + firmware caveat |
| Encoder | get/set_encoder (0x14/0x15) | Position `0,0` knob handled here, not as a key |
| Key Tester | get_keyboard_value→matrix_state (0x03) | Proof-of-life; user validates round-trip |
| Lighting | custom_get/set_value (0x08/0x07), save (0x09) | Driven by the JSON Lighting menu |
| Import/Export | get/set_buffer | VIA-compatible `.json`; `eeprom_reset` to restore defaults |

Writes are live; an explicit **Save** issues the appropriate commit so changes survive a power cycle.

## Testing strategy

No physical hardware available to the author. Therefore:
- Static validation: JS parses/loads with no console errors; keycode encode↔decode is unit-checked in-page (a hidden self-test asserts round-trips).
- The **Key Tester** is the user-facing proof-of-life: the user presses keys and confirms the matrix lights up, validating the whole transport+protocol path on real hardware before trusting remap.
- All destructive actions (eeprom reset) require confirmation.

## Build sequence

1. Transport + `Via` class + panel-registry shell + Diagnostic panel.
2. Keycode module (embedded generated table + computed ranges + decode/encode + self-test).
3. Remap + Layers + Auto Shift + Encoder panels.
4. Key Tester + Lighting + Import/Export panels.
5. Verify, finalize docs, deliver.
