# Design — Profiles & Macros panels (Epomaker Split 70 Config Tool)

**Date:** 2026-06-03
**Status:** Approved (design); pending implementation plan
**Scope:** Add two new feature panels — **⑤ Profiles** and **⑥ Macros** — to the
self-hosted VIA configurator, following the existing one-panel-per-feature contract
(see `ARCHITECTURE.md` §4). No changes to the transport/locking layer.

## 1. Motivation

The user runs the tool for economics research, Python, LaTeX, and admin work on an
Epomaker Split 70. Two features give the most leverage:

- **Macros** — LaTeX commands (`\begin{equation}`, `\frac{}{}`, `\cite{}`), Python
  boilerplate (`import numpy as np`, `if __name__ == "__main__":`), and admin snippets
  (email, signature) are all ASCII strings, which map perfectly onto VIA dynamic macros.
  The macro VIA command IDs are already defined in `VIA_CMD` (`0x0C`–`0x10`) but unused.
- **Profiles** — named, restorable full-keymap snapshots, with the explicit requirement
  that the user's **current layout is captured as a profile called `default`** as a
  safety net before they start experimenting.

## 2. Non-goals (YAGNI / deferred)

- **Macros inside profiles.** v1 profiles store keymap + encoders only (the existing
  export format). Capturing/applying macros as part of a profile is deferred — it would
  add risky macro-writes to every profile apply. Revisit later if wanted.
- **Combos, tap-dance, leader key.** Vial-only (`0xFE`); forbidden on this VIA board
  per `ARCHITECTURE.md` §1. Out of scope permanently.
- **Structured macro step-builder UI** and **raw hex macro editor.** Rejected in favor
  of the plain-text + token model (§5).

## 3. Authoritative protocol facts (sourced, not guessed)

Verified against `qmk/qmk_firmware` `master` (`quantum/dynamic_keymap.c`,
`quantum/send_string/send_string.c`, `quantum/send_string/send_string_keycodes.h`):

- **Macro buffer layout:** a single byte buffer holding all macros concatenated, each
  macro **terminated by a null byte `0x00`**. Macro `id` is located by skipping `id`
  null bytes from the start. Firmware refuses to send a macro if the **last byte of the
  buffer is non-zero** (it assumes an aborted write) — so a serialized buffer MUST end
  in `0x00`.
- **Special-sequence prefix** `SS_QMK_PREFIX = 0x01`, followed by a sub-code:
  - `SS_TAP_CODE = 0x01` → bytes `01 01 <keycode>` (tap a basic keycode, single byte)
  - `SS_DOWN_CODE = 0x02` → `01 02 <keycode>`
  - `SS_UP_CODE = 0x03` → `01 03 <keycode>`
  - `SS_DELAY_CODE = 0x04` → `01 04 <ascii-decimal-ms…> '|'` (e.g. 100 ms =
    `01 04 31 30 30 7C`). Firmware reads decimal digits until a non-digit, `|` terminates.
- **Plain ASCII text** is sent via the `ascii_to_keycode_lut`. Notably `'\n'` (`0x0A`) →
  `KC_ENT` (Enter) and `'\t'` (`0x09`) → `KC_TAB`. This is the **stable, version-robust**
  path (the LUT has been stable for years); the `01 04…|` delay and arbitrary-keycode
  tap encodings are likelier to differ on older firmware and are treated as secondary.
- **Constraints on literal text in a macro:** must not contain raw `0x00` (terminator)
  nor raw `0x01`–`0x04` (would be misread as a prefix). Printable ASCII (`≥0x20`) plus
  `0x09`/`0x0A` are safe; everything else must be expressed via tokens or rejected.
- **VIA command IDs** (already in `VIA_CMD`): `MACRO_GET_COUNT 0x0C`,
  `MACRO_GET_BUFFER_SIZE 0x0D`, `MACRO_GET_BUFFER 0x0E`, `MACRO_SET_BUFFER 0x0F`,
  `MACRO_RESET 0x10`. Get-buffer/set-buffer use the same 4-byte header + ≤28-byte chunk
  convention as the keymap buffer (`ARCHITECTURE.md` §3a).

## 4. Architecture

### 4a. `Via` class (template) — 5 new typed methods
- `getMacroCount()` → `r[1]` (`0x0C`)
- `getMacroBufferSize()` → `(r[1]<<8)|r[2]` (`0x0D`)
- `getMacroBuffer(totalBytes)` → `Uint8Array`, 28-byte chunked reads, identical loop to
  `getKeymapBuffer` (`0x0E`, args `offHi, offLo, size`)
- `setMacroBuffer(offset, bytes)` → chunked writes ≤28 bytes (`0x0F`,
  args `offHi, offLo, size, …data`)
- `resetMacros()` → (`0x10`)

Each method gets a byte-layout comment, per `ARCHITECTURE.md` §4. No raw reports from panels.

### 4b. `Macros` helper module (template, beside `Keycodes`) — pure logic
- `encodeMacro(text) → Uint8Array` — tokenizer over the editor text model (§5).
- `decodeMacro(bytes) → text` — inverse.
- `parseBuffer(bytes, count) → string[]` — split on `0x00`, return `count` macro texts.
- `serializeBuffer(texts[], bufferSize) → Uint8Array` — concat each macro + `0x00`,
  zero-pad to `bufferSize`, guaranteed to end in `0x00`. Throws if content exceeds
  `bufferSize`.
- `validate(text) → {ok, error}` — rejects raw `0x00`/`0x01`–`0x04` and unknown tokens.
- Covered by `selfTest()` round-trips on boot (correctness-critical, hardware-untestable).

### 4c. `panels.js` refactor (no behavior change to IO panel)
Extract from the `④ Import / Export` panel into shared module-scope helpers:
- `buildKeymapObject() → obj` — the export serialization (layers + encoders).
- `applyKeymapObject(obj, progressFn) → {written, skipped, encWritten}` — the import
  write-loop. Both the IO panel and the Profiles panel call these. Uses **raw firmware
  layer indices**, not `LAYER_VIEW` (lossless backups — `ARCHITECTURE.md` §5).

### 4d. Two new panels registered after `④`
- `⑤ Profiles` (`id:"profiles"`, `requiresConnection:false` advisory; self-guards for writes)
- `⑥ Macros` (`id:"macros"`, `requiresConnection:true`)

Build with `python3 build.py`.

## 5. Macros panel (`⑥`) — behavior

### 5a. Capability gate (Diagnostic philosophy)
On render/connect, read `getMacroCount()` and `getMacroBufferSize()`. If count is `0` or
buffer size is `0`/tiny, render an explanatory message ("This firmware reports no macro
storage; macros can't be configured") and **no editor**.

### 5b. Editor model — plain text + tokens
One text field per macro slot (`0 … count-1`):
- Literal printable text typed as-is. **LaTeX braces `{}` are literal** — see delimiter
  choice below — so `\frac{}{}` and `\begin{equation}` work verbatim.
- A real newline in the textarea → `0x0A` (Enter on the board).
- Special keys via **`[[…]]`-delimited tokens** (square-bracket pairs, chosen because
  they almost never occur in LaTeX/Python/econ text, whereas `{}`/`<>` collide with
  braces and inequalities). Case-insensitive: `[[ENTER]]`, `[[TAB]]`, `[[DELAY:<ms>]]`,
  `[[TAP:<KC_NAME>]]`, `[[DOWN:<KC_NAME>]]`, `[[UP:<KC_NAME>]]`. `<KC_NAME>` resolves to a
  basic single-byte keycode via the existing `Keycodes` basic table; non-basic names are
  rejected at validate time.
- **Interpretation rule:** a `[[…]]` substring is only treated as a token if it matches
  the known token grammar above; any other text (including all LaTeX braces and any stray
  `[`/`]`) is literal. Inserting special keys is also offered via **"insert" buttons** so
  the user rarely types token syntax by hand. The only sequence needing escaping is a
  literal `[[TAB]]`-style string the user genuinely wants typed (escape the leading
  bracket-pair as `[[[`); in practice this never arises.

### 5c. Write model — whole-buffer rewrite
Read full buffer → `parseBuffer` into N texts → user edits → on **Write**: `serializeBuffer`
→ chunked `setMacroBuffer`. A live **byte-budget meter** ("147 / 1000 bytes") blocks Write
when over budget. Buffer always ends in `0x00`.

### 5d. Starter pack (version-robust ordering)
A **Load starter pack** action fills only *empty* slots; writes nothing until **Write**.
Ordered so the robust ones come first:
1. **Pure text + Enter/Tab** (covers ~all of LaTeX/Python/admin); braces are literal,
   newlines are real Enter: `\begin{equation}` ⏎⏎ `\end{equation}`, `\frac{}{}`,
   `\cite{}`, `import numpy as np` ⏎, `import pandas as pd` ⏎,
   `if __name__ == "__main__":` ⏎ `[[TAB]]`, email + signature.
2. **Secondary, flagged "verify on your board":** any macro using `[[DELAY:…]]` /
   `[[TAP:…]]` (older-firmware-dependent).

### 5e. Proof-of-life instruction (mirrors Key Tester)
Top-of-panel note: first set slot 0 to a trivial macro (e.g. `hello`), Write it, trigger
it, and confirm it types — before trusting the starter pack. Neither the author nor Claude
can test macros on hardware in the dev environment.

## 6. Profiles panel (`⑤`) — behavior

### 6a. Storage with `file://` safety net
- Primary store: `localStorage` key `epo70.profiles` = `{ name → profileObj }`, where
  `profileObj = { name, savedAt, ...buildKeymapObject() }`.
- **Feature-detect persistence on load** (probe write/read/delete). If it fails (the tool
  is commonly opened from a `file://` origin where localStorage can silently not persist),
  show a visible banner steering the user to Export-to-file.

### 6b. Auto-capture `default`
On the **first real keymap load after connect** (guarded by a session flag so an *import*
does not trigger it), if no `default` profile exists:
1. Save it to `localStorage` as `default`, **and**
2. Trigger a one-click `default-profile.json` download (the same file format as Export),
   so the current layout is preserved as a real artifact regardless of localStorage.

This is the literal fulfillment of "make sure the current layout is saved as a profile
called default."

### 6c. UI
List of profiles (name, `savedAt` date, layer/key-count summary). Buttons:
- **Save current as new** (prompt for name; refuse empty/dupe unless confirmed overwrite)
- **Apply to keyboard** (confirm dialog → `applyKeymapObject`) — writes to the board
- **Rename**, **Delete**
- **Export to file** / **Import from file** — reuses the existing keymap-file format, so
  prior `*-keymap.json` exports load straight in as profiles.

## 7. Error handling
- Macro write over budget → blocked with a clear message; nothing sent.
- Macro validate failure (bad token / illegal byte) → inline per-slot error; Write disabled.
- Profile apply on disconnected board → `needConnection()` guard (existing helper).
- localStorage unavailable → banner; in-memory profiles still work for the session, export
  still works.
- All hardware calls wrapped; failures go to `log(msg,"err")` (existing pattern).

## 8. Testing (no hardware)
Extend the in-page `selfTest()` and the Node harness (`ARCHITECTURE.md` §6):
- Round-trips: plain text; newline→Enter (`0x0A`) / `[[TAB]]`→`0x09`;
  `[[TAP:KC_LEFT]]` → `01 01 50`; `[[DELAY:100]]` → `01 04 31 30 30 7C`; literal LaTeX
  braces (`\frac{}{}`) survive unchanged; a non-token `[[x]]` stays literal.
- `parseBuffer`/`serializeBuffer`: N macros split on `0x00`, zero-padding, last-byte-zero
  invariant, over-budget throw.
- Validator rejects raw `0x00`/`0x01`–`0x04` and unknown `[[TOKENS]]`.
- `node --check` the extracted bundle.
- On-hardware proof-of-life remains the user's slot-0 trivial-macro step (§5e).

## 9. File touch list
- `index.template.html` — add 5 `Via` methods; add `Macros` helper; extend `selfTest()`.
- `panels.js` — refactor IO helpers; add `⑤ Profiles` and `⑥ Macros` panels.
- `build.py` / `Epo70VIA.html` — rebuild (generated; do not hand-edit the HTML).
- Node test harness — add macro/profile assertions.
- `ARCHITECTURE.md` — update §5 (panel list) and §7 (macros now implemented).
