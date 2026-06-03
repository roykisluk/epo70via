# Profiles & Macros Panels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `⑤ Profiles` panel (named, restorable keymap snapshots with a `file://`-safe auto-saved `default`) and a `⑥ Macros` panel (a VIA dynamic-macro editor) to the Epomaker Split 70 config tool.

**Architecture:** A new **pure, Node-testable** `macros.js` module holds the correctness-critical VIA macro byte encode/decode (injected into the template at a new `/*__MACROS__*/` marker, also `require()`-able by a `node --test` suite). The `Via` class gains five typed macro methods. `panels.js` gets shared keymap (de)serialization helpers (refactored out of the existing Import/Export panel) plus the two new panels. Macros become *triggerable* by teaching the keycode picker the `QK_MACRO` range.

**Tech Stack:** Vanilla ES (browser, single inlined `<script>`), Python 3 build step (`build.py`), Node 22 built-in test runner (`node --test`), WebHID + VIA protocol.

**Spec:** `docs/superpowers/specs/2026-06-03-profiles-and-macros-design.md`

**Conventions for every task:** Source files are `index.template.html`, `panels.js`, `macros.js`, `build.py`. **Never hand-edit `Epo70VIA.html`** — it is generated. After source edits, rebuild with `python3 build.py`. Commit messages end with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. Work happens on branch `feat/profiles-and-macros` (already created).

---

## File Structure

- **Create `macros.js`** — pure `Macros` module: `encodeMacro`, `decodeMacro`, `parseBuffer`, `serializeBuffer`, `bytesUsed`, `validate`. No browser globals at module scope; keycode resolution is injected via a `kc` adapter (`{nameToCode, codeToName}`). Tail-guarded CommonJS export so Node can `require` it; harmless when inlined in the browser.
- **Create `test/macros.test.js`** — `node --test` suite for `macros.js` (the hardware-untestable core).
- **Modify `build.py`** — inject `macros.js` at a new `/*__MACROS__*/` marker.
- **Modify `index.template.html`** — add the `/*__MACROS__*/` marker; add a `MacroKC` adapter after `Keycodes`; add a `QK_MACRO` decode branch; add five `Via` macro methods; add macro entries + a `"Macro"` category to the keycode picker; extend `selfTest()`.
- **Modify `panels.js`** — extract `buildKeymapObject()`/`applyKeymapObject()` from the IO panel; add profile storage helpers + the `connect`-driven auto-capture of `default`; register `⑤ Profiles` and `⑥ Macros`.
- **Modify `ARCHITECTURE.md`** — update §5 (panel list) and §7 (macros now implemented).

---

## Task 1: `macros.js` — literal text + newline encoding (TDD)

**Files:**
- Create: `macros.js`
- Test: `test/macros.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/macros.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const Macros = require("../macros.js");

// keycode adapter stub (mirrors what the browser builds from Keycodes)
const kc = {
  nameToCode: n => ({ KC_LEFT: 0x50, KC_A: 0x04, "LCTL(KC_A)": 0x0104 }[n] ?? null),
  codeToName: c => ({ 0x50: "KC_LEFT", 0x04: "KC_A" }[c] ?? null),
};
const arr = a => Array.from(a);

test("literal text encodes to ASCII bytes", () => {
  assert.deepEqual(arr(Macros.encodeMacro("hi", kc)), [0x68, 0x69]);
});
test("newline encodes to 0x0A (Enter)", () => {
  assert.deepEqual(arr(Macros.encodeMacro("a\nb", kc)), [0x61, 0x0a, 0x62]);
});
test("CRLF is normalised (CR stripped)", () => {
  assert.deepEqual(arr(Macros.encodeMacro("a\r\nb", kc)), [0x61, 0x0a, 0x62]);
});
test("LaTeX braces are literal", () => {
  assert.deepEqual(arr(Macros.encodeMacro("\\frac{}{}", kc)),
    [0x5c, 0x66, 0x72, 0x61, 0x63, 0x7b, 0x7d, 0x7b, 0x7d]);
});
test("non-ASCII character is rejected", () => {
  assert.throws(() => Macros.encodeMacro("café", kc), /unsupported character/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/macros.test.js`
Expected: FAIL — `Cannot find module '../macros.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `macros.js`:

```js
/* macros.js — VIA dynamic-macro encode/decode (PURE logic, no browser globals).
   Injected into index.template.html at the /*__MACROS__*/ marker; also require()-able by
   Node tests. Sourced from QMK master (quantum/dynamic_keymap.c, quantum/send_string/*):
     - Buffer = all macros concatenated, each terminated by a null byte 0x00. Macro `id`
       is found by skipping `id` nulls. The whole buffer MUST end in 0x00 (firmware ignores
       a buffer whose last byte != 0, treating it as an aborted write).
     - SS_QMK_PREFIX 0x01, then TAP 0x01 / DOWN 0x02 / UP 0x03 (each + one keycode byte),
       or DELAY 0x04 + ascii-decimal-ms + '|' (0x7C).
     - Plain ASCII via send_string LUT; '\n'(0x0A)=Enter, '\t'(0x09)=Tab.
   Editor text model: literal printable text + real newlines (=> Enter); LaTeX-safe [[...]]
   tokens: [[ENTER]] [[TAB]] [[DELAY:<ms>]] [[TAP:<KC>]] [[DOWN:<KC>]] [[UP:<KC>]].
   A [[word]]/[[word:arg]]-shaped sequence whose word isn't a known command is an ERROR
   (likely a typo); any other text (incl. {} and stray brackets) stays literal.
   kc adapter (injected): { nameToCode(name)->int|null, codeToName(code)->string|null }. */
const Macros = (() => {
  const PREFIX = 0x01, SUB = { TAP: 0x01, DOWN: 0x02, UP: 0x03 }, DELAY = 0x04;
  const PIPE = 0x7c, NUL = 0x00;

  function pushChar(out, code) {
    if (code === 0x0d) return;                 // strip CR (textarea CRLF)
    if (code === 0x0a || code === 0x09) { out.push(code); return; } // Enter / Tab
    if (code < 0x20 || code > 0x7e) throw new Error(`unsupported character (0x${code.toString(16)})`);
    out.push(code);
  }
  function pushLiteral(out, s) { for (let i = 0; i < s.length; i++) pushChar(out, s.charCodeAt(i)); }

  function encodeMacro(text, kc) {
    const out = [];
    pushLiteral(out, String(text));
    return Uint8Array.from(out);
  }

  return { encodeMacro };
})();
if (typeof module !== "undefined" && module.exports) module.exports = Macros;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/macros.test.js`
Expected: PASS (5 tests). The "non-ASCII" and brace tests pass; token tests don't exist yet.

- [ ] **Step 5: Commit**

```bash
git add macros.js test/macros.test.js
git commit -m "feat(macros): encode literal text + newlines to VIA macro bytes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `macros.js` — `[[...]]` tokens (TDD)

**Files:**
- Modify: `macros.js`
- Test: `test/macros.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/macros.test.js`:

```js
test("[[TAB]] -> 0x09 and [[ENTER]] -> 0x0A", () => {
  assert.deepEqual(arr(Macros.encodeMacro("[[TAB]][[ENTER]]", kc)), [0x09, 0x0a]);
});
test("[[TAP:KC_LEFT]] -> 01 01 50", () => {
  assert.deepEqual(arr(Macros.encodeMacro("[[TAP:KC_LEFT]]", kc)), [0x01, 0x01, 0x50]);
});
test("[[DOWN/UP]] use sub-codes 2 and 3", () => {
  assert.deepEqual(arr(Macros.encodeMacro("[[DOWN:KC_A]][[UP:KC_A]]", kc)),
    [0x01, 0x02, 0x04, 0x01, 0x03, 0x04]);
});
test("[[DELAY:100]] -> 01 04 '1' '0' '0' '|'", () => {
  assert.deepEqual(arr(Macros.encodeMacro("[[DELAY:100]]", kc)),
    [0x01, 0x04, 0x31, 0x30, 0x30, 0x7c]);
});
test("token word is case-insensitive", () => {
  assert.deepEqual(arr(Macros.encodeMacro("[[tab]]", kc)), [0x09]);
});
test("text around a token is preserved", () => {
  assert.deepEqual(arr(Macros.encodeMacro("x[[TAB]]y", kc)), [0x78, 0x09, 0x79]);
});
test("unknown token throws", () => {
  assert.throws(() => Macros.encodeMacro("hi[[FOO]]", kc), /unknown token/);
});
test("non-token brackets stay literal", () => {
  // [1] and [[x y]] don't match the token grammar -> literal
  assert.deepEqual(arr(Macros.encodeMacro("[a]", kc)), [0x5b, 0x61, 0x5d]);
  assert.doesNotThrow(() => Macros.encodeMacro("[[x y]]", kc));
});
test("[[DELAY]] without number throws", () => {
  assert.throws(() => Macros.encodeMacro("[[DELAY:x]]", kc), /needs a number/);
});
test("only basic keycodes (<=0xFF) allowed in tap", () => {
  assert.throws(() => Macros.encodeMacro("[[TAP:LCTL(KC_A)]]", kc), /basic keycodes/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/macros.test.js`
Expected: FAIL — tokens are currently encoded as literal `[`/`]` text, so byte assertions mismatch.

- [ ] **Step 3: Write the implementation**

In `macros.js`, replace the `encodeMacro` function and add token helpers (inside the IIFE, before `encodeMacro`):

```js
  const KNOWN = new Set(["ENTER", "TAB", "DELAY", "TAP", "DOWN", "UP"]);
  const TOKEN_RE = /\[\[([A-Za-z]+)(?::([^\]]*))?\]\]/g;

  function emitToken(out, word, arg, kc) {
    const W = word.toUpperCase();
    if (!KNOWN.has(W)) throw new Error(`unknown token [[${word}]]`);
    if (W === "ENTER") { out.push(0x0a); return; }
    if (W === "TAB") { out.push(0x09); return; }
    if (W === "DELAY") {
      if (!/^\d+$/.test(arg || "")) throw new Error(`[[DELAY:n]] needs a number`);
      out.push(PREFIX, DELAY);
      for (const d of String(parseInt(arg, 10))) out.push(d.charCodeAt(0));
      out.push(PIPE);
      return;
    }
    // TAP / DOWN / UP
    const code = kc && kc.nameToCode ? kc.nameToCode(arg || "") : null;
    if (code == null) throw new Error(`[[${W}:${arg}]] — unknown keycode`);
    if (code > 0xff) throw new Error(`[[${W}:${arg}]] — only basic keycodes (<=0xFF) allowed`);
    out.push(PREFIX, SUB[W], code);
  }

  function encodeMacro(text, kc) {
    text = String(text);
    const out = [];
    let last = 0, m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(text)) !== null) {
      pushLiteral(out, text.slice(last, m.index));
      emitToken(out, m[1], m[2], kc);
      last = m.index + m[0].length;
    }
    pushLiteral(out, text.slice(last));
    return Uint8Array.from(out);
  }
```

(Remove the old one-line `encodeMacro` from Task 1.) The `return { encodeMacro };` line at the end of the IIFE stays for now.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/macros.test.js`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Commit**

```bash
git add macros.js test/macros.test.js
git commit -m "feat(macros): [[...]] tokens (Enter/Tab/Delay/Tap/Down/Up)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `macros.js` — decode, buffer (de)serialize, validate, budget (TDD)

**Files:**
- Modify: `macros.js`
- Test: `test/macros.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/macros.test.js`:

```js
test("decode round-trips canonical forms", () => {
  for (const s of ["hi", "a\nb", "\\frac{}{}", "x[[TAB]]y", "[[TAP:KC_LEFT]]", "[[DELAY:100]]"]) {
    assert.equal(Macros.decodeMacro(Macros.encodeMacro(s, kc), kc), s);
  }
});
test("decode falls back to hex for unknown tap keycode", () => {
  assert.equal(Macros.decodeMacro(Uint8Array.from([0x01, 0x01, 0xab]), kc), "[[TAP:0xAB]]");
});
test("serializeBuffer terminates each macro and ends in 0x00", () => {
  const buf = Macros.serializeBuffer(["hi", ""], 10, kc);
  assert.deepEqual(arr(buf), [0x68, 0x69, 0x00, 0x00, 0, 0, 0, 0, 0, 0]);
  assert.equal(buf[buf.length - 1], 0x00);
});
test("parseBuffer splits on NUL and pads to count", () => {
  const buf = Macros.serializeBuffer(["hi", ""], 10, kc);
  assert.deepEqual(Macros.parseBuffer(buf, 2, kc), ["hi", ""]);
});
test("buffer survives a full round-trip of mixed macros", () => {
  const texts = ["import numpy as np\n", "[[TAP:KC_LEFT]]", ""];
  const buf = Macros.serializeBuffer(texts, 64, kc);
  assert.deepEqual(Macros.parseBuffer(buf, 3, kc), texts);
});
test("over-budget serialize throws", () => {
  assert.throws(() => Macros.serializeBuffer(["toolong"], 4, kc), /exceed buffer/);
});
test("bytesUsed counts content plus one terminator per macro", () => {
  assert.equal(Macros.bytesUsed(["hi", ""], kc), 4); // 2 + term + 0 + term
});
test("validate reports ok / error without throwing", () => {
  assert.equal(Macros.validate("hi", kc).ok, true);
  assert.equal(Macros.validate("[[FOO]]", kc).ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/macros.test.js`
Expected: FAIL — `Macros.decodeMacro is not a function` (and the other new symbols).

- [ ] **Step 3: Write the implementation**

In `macros.js`, add these functions inside the IIFE (after `encodeMacro`):

```js
  function decodeMacro(bytes, kc) {
    let s = "";
    const n = bytes.length;
    for (let i = 0; i < n;) {
      const b = bytes[i];
      if (b === PREFIX && i + 1 < n) {
        const sub = bytes[i + 1];
        if (sub === DELAY) {
          let j = i + 2, num = "";
          while (j < n && bytes[j] >= 0x30 && bytes[j] <= 0x39) { num += String.fromCharCode(bytes[j]); j++; }
          if (j < n && bytes[j] === PIPE) j++;
          s += `[[DELAY:${num || "0"}]]`; i = j; continue;
        }
        const name = Object.keys(SUB).find(k => SUB[k] === sub);
        if (name && i + 2 < n) {
          const code = bytes[i + 2];
          const kn = (kc && kc.codeToName ? kc.codeToName(code) : null)
            || ("0x" + code.toString(16).toUpperCase());
          s += `[[${name}:${kn}]]`; i += 3; continue;
        }
      }
      if (b === 0x0a) { s += "\n"; i++; continue; }
      if (b === 0x09) { s += "[[TAB]]"; i++; continue; }
      s += String.fromCharCode(b); i++;
    }
    return s;
  }

  function bytesUsed(texts, kc) {
    return texts.reduce((sum, t) => sum + encodeMacro(t, kc).length + 1, 0);
  }

  function serializeBuffer(texts, bufferSize, kc) {
    const parts = texts.map(t => encodeMacro(t, kc));
    const used = parts.reduce((s, e) => s + e.length + 1, 0);
    if (used > bufferSize) throw new Error(`macros exceed buffer (${used}/${bufferSize} bytes)`);
    const buf = new Uint8Array(bufferSize); // zero-filled => trailing NULs; buffer ends in 0x00
    let off = 0;
    for (const e of parts) { buf.set(e, off); off += e.length; buf[off] = NUL; off++; }
    return buf;
  }

  function parseBuffer(bytes, count, kc) {
    const texts = [];
    let start = 0;
    for (let i = 0; i < bytes.length && texts.length < count; i++) {
      if (bytes[i] === NUL) { texts.push(decodeMacro(bytes.subarray(start, i), kc)); start = i + 1; }
    }
    while (texts.length < count) texts.push("");
    return texts;
  }

  function validate(text, kc) {
    try { encodeMacro(text, kc); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }
```

Then change the IIFE's return line from `return { encodeMacro };` to:

```js
  return { encodeMacro, decodeMacro, parseBuffer, serializeBuffer, bytesUsed, validate };
```

Note: `bytes.subarray` requires a `Uint8Array`; `parseBuffer` is always called with the `Uint8Array` from `serializeBuffer`/`getMacroBuffer`, so this is safe.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/macros.test.js`
Expected: PASS (all tests across Tasks 1–3).

- [ ] **Step 5: Commit**

```bash
git add macros.js test/macros.test.js
git commit -m "feat(macros): decode, buffer (de)serialize, budget, validate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire `macros.js` into the build

**Files:**
- Modify: `build.py:24-32`
- Modify: `index.template.html` (add marker after the `Keycodes` IIFE, before the VIA section comment at line ~170)

- [ ] **Step 1: Add the marker to the template**

In `index.template.html`, immediately after the `Keycodes` IIFE closing line (`})();` at line 168) and before the `/* ===… VIA PROTOCOL …=== */` comment, insert:

```js

// Macro encode/decode (injected from macros.js). Browser keycode adapter for it:
const MacroKC = {
  nameToCode(n){ const e = Keycodes.byName.get(n); return e ? e.code : null; },
  codeToName(c){ const e = Keycodes.byCode.get(c); return e ? e.name : null; },
};
/*__MACROS__*/
```

- [ ] **Step 2: Teach `build.py` the new marker**

In `build.py`, after the `panels = read(...)` line (line 24), add:

```python
    macros = read(os.path.join(HERE, "macros.js"))
```

After the `tpl = tpl.replace("/*__PANELS__*/", panels)` line (line 28), add:

```python
    tpl = tpl.replace("/*__MACROS__*/", macros)
```

In the marker-verification loop (line 30), add `"/*__MACROS__*/"` to the tuple:

```python
    for marker in ("/*__KEYBOARD_DEF__*/", "/*__BASIC_KEYCODES__*/", "/*__PANELS__*/", "/*__MACROS__*/"):
```

- [ ] **Step 3: Build and syntax-check**

Run:
```bash
python3 build.py && node --check <(sed -n '/<script>/,/<\/script>/p' Epo70VIA.html | sed '1d;$d')
```
Expected: `Wrote …/Epo70VIA.html (… bytes)` and no syntax errors from `node --check`.

(If your shell lacks process substitution, run: `python3 build.py` then `python3 -c "import re,sys; s=open('Epo70VIA.html').read(); m=re.search(r'<script>(.*)</script>', s, re.S); open('/tmp/bundle.js','w').write(m.group(1))"` then `node --check /tmp/bundle.js`.)

- [ ] **Step 4: Commit**

```bash
git add build.py index.template.html Epo70VIA.html
git commit -m "build: inject macros.js at __MACROS__ marker; add MacroKC adapter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Add five macro methods to the `Via` class

**Files:**
- Modify: `index.template.html` (in the `Via` class, after `getKeymapBuffer` at line ~241)

- [ ] **Step 1: Add the methods**

In `index.template.html`, immediately after the `getKeymapBuffer` method's closing brace (line 241), insert:

```js
  // ---- dynamic macros (VIA 0x0C–0x10). Buffer = macros concatenated, each NUL-terminated;
  //      whole buffer must end in 0x00. Get/set chunk in ≤28-byte windows like the keymap buffer.
  async getMacroCount(){ const r=await this.exec([VIA_CMD.MACRO_GET_COUNT]); return r[1]; }
  async getMacroBufferSize(){ const r=await this.exec([VIA_CMD.MACRO_GET_BUFFER_SIZE]); return (r[1]<<8)|r[2]; }
  async getMacroBuffer(totalBytes){
    const buf=new Uint8Array(totalBytes); const CHUNK=28;
    for(let off=0; off<totalBytes; off+=CHUNK){
      const sz=Math.min(CHUNK,totalBytes-off);
      const r=await this.exec([VIA_CMD.MACRO_GET_BUFFER,(off>>8)&0xFF,off&0xFF,sz]);
      for(let i=0;i<sz;i++) buf[off+i]=r[4+i];
    }
    return buf;
  }
  async setMacroBuffer(offset, bytes){
    const CHUNK=28;
    for(let i=0;i<bytes.length;i+=CHUNK){
      const chunk=Array.from(bytes.slice(i,i+CHUNK)); const off=offset+i;
      await this.exec([VIA_CMD.MACRO_SET_BUFFER,(off>>8)&0xFF,off&0xFF,chunk.length,...chunk]);
    }
  }
  async resetMacros(){ await this.exec([VIA_CMD.MACRO_RESET]); }
```

- [ ] **Step 2: Build and syntax-check**

Run: `python3 build.py && python3 -c "import re; s=open('Epo70VIA.html').read(); open('/tmp/bundle.js','w').write(re.search(r'<script>(.*)</script>', s, re.S).group(1))" && node --check /tmp/bundle.js`
Expected: build succeeds, no syntax errors.

- [ ] **Step 3: Commit**

```bash
git add index.template.html Epo70VIA.html
git commit -m "feat(via): add dynamic-macro buffer methods (0x0C-0x10)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Make macros triggerable — decode `QK_MACRO`, picker entries, selfTest

**Files:**
- Modify: `index.template.html` — `Keycodes.decode` (line ~164), picker `catsOrder` (line 329), picker `_entries` (line ~352), `selfTest` (line ~463)

- [ ] **Step 1: Add a `QK_MACRO` decode branch**

In `index.template.html`, in `decode(kc)`, just before the final fallback `return {code:kc,name:hex(kc),…}` (line 164), insert:

```js
    if (between(0x7700,0x77FF)) return {code:kc,name:`M${kc-0x7700}`,label:`M${kc-0x7700}`,cat:"Macro"};
```

- [ ] **Step 2: Add the `"Macro"` category to the picker**

In `index.template.html` line 329, change `catsOrder` to include `"Macro"` after `"Custom"`:

```js
  catsOrder:["Basic","Modifiers","Layers","Auto Shift","Media","Mouse","System","Custom","Macro","Special","All"],
```

- [ ] **Step 3: Add macro entries to the picker list**

In `_entries()` (line ~352), just before `return out;`, insert:

```js
    const M = App.macroCount||0;
    for(let i=0;i<M;i++) out.push({code:0x7700+i,name:`M${i}`,label:`M${i}`,cat:"Macro"});
```

- [ ] **Step 4: Extend `selfTest()`**

In `selfTest()` (after the `LT decode` assertion at line 472), insert:

```js
  t("macro M3 decodes", Keycodes.decode(0x7703).label==="M3");
  t("macro encodes 'hi'", Array.from(Macros.encodeMacro("hi",MacroKC)).join()==="104,105");
  t("macro [[TAP:KC_LEFT]] encodes", Array.from(Macros.encodeMacro("[[TAP:KC_LEFT]]",MacroKC)).join()==="1,1,80");
  t("macro buffer round-trip", Macros.parseBuffer(Macros.serializeBuffer(["hi","x"],16,MacroKC),2,MacroKC).join("|")==="hi|x");
```

(`KC_LEFT` is `0x50` = 80; this also confirms `MacroKC.nameToCode` resolves real keycodes.)

- [ ] **Step 5: Build and verify selfTest passes in Node**

Run:
```bash
python3 build.py && python3 -c "import re; s=open('Epo70VIA.html').read(); open('/tmp/bundle.js','w').write(re.search(r'<script>(.*)</script>', s, re.S).group(1))" && node --check /tmp/bundle.js
```
Expected: build succeeds, no syntax errors. (Full `selfTest()` runs in-browser on boot; the macro asserts here are also covered directly by `test/macros.test.js`.)

- [ ] **Step 6: Commit**

```bash
git add index.template.html Epo70VIA.html
git commit -m "feat(keycodes): decode QK_MACRO range + add M0.. to picker; selfTest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Refactor Import/Export into shared keymap helpers

**Files:**
- Modify: `panels.js` — add helpers above the `io` panel (before line 279); rewrite the `io` panel's export/import handlers to call them. No behavior change.

- [ ] **Step 1: Add the shared helpers**

In `panels.js`, immediately before `registerPanel({ id:"io", …` (line 279), insert:

```js
// Shared keymap (de)serialization — used by Import/Export and Profiles.
// Uses RAW firmware layer indices (NOT LAYER_VIEW) so snapshots stay lossless.
async function buildKeymapObject(){
  const layers=[];
  for(let l=0;l<App.layerCount;l++){ const layer=[];
    for(let r=0;r<App.rows;r++)for(let c=0;c<App.cols;c++) layer.push(kcToken(App.getKC(l,r,c)));
    layers.push(layer);
  }
  const encoders=[];
  if(App.encoders.length){
    for(let l=0;l<App.layerCount;l++){ const le=[];
      for(const enc of App.encoders){
        try{ const cw=await App.via.getEncoder(l,enc.idx,true), ccw=await App.via.getEncoder(l,enc.idx,false);
          le.push([kcToken(ccw),kcToken(cw)]); }
        catch(e){ le.push(null); }
      }
      encoders.push(le);
    }
  }
  return { tool:"epo70-config", name:App.def.name,
    vendorProductId:((parseInt(App.def.vendorId,16)<<16)>>>0)|parseInt(App.def.productId,16),
    matrix:{rows:App.rows,cols:App.cols}, layerCount:App.layerCount,
    encoderCount:App.encoders.length, layers, encoders };
}
async function applyKeymapObject(data, onProgress){
  if(!data.layers || !data.matrix || data.matrix.rows!==App.rows || data.matrix.cols!==App.cols)
    throw new Error("File does not match this keyboard's matrix.");
  let written=0, skipped=0;
  const nLayers=Math.min(data.layerCount||data.layers.length, App.layerCount);
  for(let l=0;l<nLayers;l++){ let idx=0;
    for(let r=0;r<App.rows;r++)for(let c=0;c<App.cols;c++){
      const tok=data.layers[l][idx++]; const kc=tokenToKc(tok);
      if(kc==null){ skipped++; continue; }
      if(kc!==App.getKC(l,r,c)){ try{ await App.via.setKeycode(l,r,c,kc); App.keymap[App.kmIndex(l,r,c)]=kc; written++; }catch(e){ skipped++; } }
    }
    if(onProgress) onProgress(`Writing… layer ${l+1}/${nLayers}, ${written} keys`);
  }
  let encWritten=0;
  if(Array.isArray(data.encoders) && App.encoders.length){
    for(let l=0;l<Math.min(data.encoders.length,App.layerCount);l++){
      const le=data.encoders[l]||[];
      for(let ei=0; ei<App.encoders.length && ei<le.length; ei++){
        const pair=le[ei]; if(!pair) continue;
        const idx=App.encoders[ei].idx, ccw=tokenToKc(pair[0]), cw=tokenToKc(pair[1]);
        try{ if(ccw!=null){ await App.via.setEncoder(l,idx,false,ccw); encWritten++; }
             if(cw!=null){ await App.via.setEncoder(l,idx,true,cw); encWritten++; } }
        catch(e){ skipped++; }
      }
    }
  }
  App.emit("keymap-loaded");
  return {written, skipped, encWritten};
}
```

- [ ] **Step 2: Rewrite the export handler to use `buildKeymapObject`**

In the `io` panel, replace the body of `root.querySelector("#exportBtn").onclick=async()=>{ … }` (lines 300–327) with:

```js
    root.querySelector("#exportBtn").onclick=async()=>{
      if(!App.keymap){ alert("Connect and load the keymap first."); return; }
      const obj=await buildKeymapObject();
      const blob=new Blob([JSON.stringify(obj,null,1)],{type:"application/json"});
      const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
      a.download=App.def.name+"-keymap.json"; a.click(); URL.revokeObjectURL(a.href);
      log("Exported keymap.","ok");
    };
```

- [ ] **Step 3: Rewrite the import handler to use `applyKeymapObject`**

Replace the body of `root.querySelector("#importBtn").onclick=async()=>{ … }` (lines 329–364) with:

```js
    root.querySelector("#importBtn").onclick=async()=>{
      if(!needConnection()) return;
      const f=root.querySelector("#importFile").files[0];
      const out=root.querySelector("#importOut");
      if(!f){ out.innerHTML='<span class="warn">Choose a file first.</span>'; return; }
      let data; try{ data=JSON.parse(await f.text()); }catch(e){ out.innerHTML='<span class="err">Invalid JSON.</span>'; return; }
      try{
        const res=await applyKeymapObject(data, msg=>{ out.innerHTML=`<span class="muted">${msg}</span>`; });
        out.innerHTML=`<span class="ok">Import complete: ${res.written} keys${res.encWritten?`, ${res.encWritten} encoder actions`:""} written, ${res.skipped} skipped.</span>`;
        log(`Imported keymap (${res.written} written, ${res.skipped} skipped).`,"ok");
      }catch(e){ out.innerHTML=`<span class="err">${escapeHtml(e.message)}</span>`; }
    };
```

- [ ] **Step 4: Build, syntax-check, and confirm no behavior drift**

Run: `python3 build.py && python3 -c "import re; s=open('Epo70VIA.html').read(); open('/tmp/bundle.js','w').write(re.search(r'<script>(.*)</script>', s, re.S).group(1))" && node --check /tmp/bundle.js`
Expected: build succeeds, no syntax errors. Manually confirm the `io` panel still references `kcToken`, `tokenToKc`, `needConnection`, `escapeHtml`, `log` (all still in scope).

- [ ] **Step 5: Commit**

```bash
git add panels.js Epo70VIA.html
git commit -m "refactor(io): extract buildKeymapObject/applyKeymapObject helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `⑤ Profiles` panel + `file://`-safe auto-capture of `default`

**Files:**
- Modify: `panels.js` — add storage helpers + module-scope auto-capture + the panel (after the `io` panel, before any later panels).

- [ ] **Step 1: Add storage helpers and the auto-capture listener**

In `panels.js`, after the shared helpers from Task 7 (and before the `io` panel registration is fine, or directly after it), insert:

```js
// ---- Profiles: localStorage-backed keymap snapshots (keymap + encoders only; not macros).
const PROFILES_KEY="epo70.profiles";
function storageOK(){ try{ const k="__epo70probe"; localStorage.setItem(k,"1"); localStorage.removeItem(k); return true; }catch(e){ return false; } }
function loadProfiles(){ try{ return JSON.parse(localStorage.getItem(PROFILES_KEY)||"{}"); }catch(e){ return {}; } }
function saveProfiles(p){ try{ localStorage.setItem(PROFILES_KEY, JSON.stringify(p)); return true; }catch(e){ return false; } }
function downloadJSON(obj, filename){
  const blob=new Blob([JSON.stringify(obj,null,1)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download=filename; a.click(); URL.revokeObjectURL(a.href);
}

// Auto-capture the live layout as "default" once per connection. We listen on "connect"
// (NOT "keymap-loaded"): on initial connect reloadKeymap()/keymap-loaded fires BEFORE
// "connect", and App.keymap is already populated by the time "connect" fires. Import/apply
// emit "keymap-loaded" but NOT "connect", so this never fires on a profile apply.
App.on("connect", async ()=>{
  if(!App.keymap) return;
  const profiles=loadProfiles();
  if(profiles["default"]) return;            // already captured on this machine
  try{
    const obj=await buildKeymapObject();
    const prof={ name:"default", savedAt:new Date().toISOString(), ...obj };
    profiles["default"]=prof;
    const stored=saveProfiles(profiles);
    downloadJSON(prof, "default-profile.json");
    log(stored
      ? 'Saved current layout as profile "default" (and downloaded default-profile.json).'
      : 'Storage unavailable — downloaded default-profile.json as your safety backup.', "ok");
    App.emit("profiles-changed");
  }catch(e){ log("Auto-save of default profile failed: "+e.message,"warn"); }
});

// Keep App.macroCount fresh so the keycode picker can offer M0.. without opening the Macros tab.
App.on("connect", async ()=>{ try{ App.macroCount=await App.via.getMacroCount(); }catch(e){} });
```

- [ ] **Step 2: Register the Profiles panel**

Append to `panels.js`:

```js
registerPanel({
  id:"profiles", title:"⑤ Profiles", requiresConnection:false,
  render(root){
    const draw=()=>{
      const profiles=loadProfiles();
      const names=Object.keys(profiles).sort((a,b)=> a==="default"?-1 : b==="default"?1 : a.localeCompare(b));
      const banner = storageOK() ? "" :
        `<div class="note err">This browser context can't persist profiles (common when the tool is opened from a <code>file://</code> path). Profiles you save this session won't survive a reload — use <b>Export to file</b> to keep them.</div>`;
      const rows = names.length ? names.map(n=>{
        const p=profiles[n]; const when=(p.savedAt||"").replace("T"," ").slice(0,16);
        const keys=(p.layers||[]).reduce((s,l)=>s+l.length,0);
        return `<tr>
          <td><b>${escapeHtml(n)}</b></td>
          <td class="muted">${escapeHtml(when)}</td>
          <td class="muted">${p.layerCount||0} layers / ${keys} keys</td>
          <td>
            <button data-act="apply" data-n="${escapeHtml(n)}">Apply</button>
            <button data-act="export" data-n="${escapeHtml(n)}">Export</button>
            <button data-act="rename" data-n="${escapeHtml(n)}">Rename</button>
            <button class="danger" data-act="delete" data-n="${escapeHtml(n)}">Delete</button>
          </td></tr>`;
      }).join("") : `<tr><td colspan="4" class="muted">No saved profiles yet.</td></tr>`;
      root.innerHTML=`
        <div class="card">
          <h2>Profiles</h2>
          <p class="muted">A profile is a full snapshot of every layer + encoder action (not macros). Your current layout is auto-saved as <b>default</b> the first time you connect.</p>
          ${banner}
          <div class="row">
            <button id="saveNew" class="primary">Save current layout as new profile…</button>
            <input type="file" id="profImport" accept="application/json,.json">
            <button id="profImportBtn">Import profile from file</button>
          </div>
        </div>
        <div class="card">
          <table class="kv"><thead><tr><th>Name</th><th>Saved</th><th>Size</th><th>Actions</th></tr></thead>
          <tbody>${rows}</tbody></table>
          <div id="profOut" style="margin-top:10px"></div>
        </div>`;

      const out=root.querySelector("#profOut");

      root.querySelector("#saveNew").onclick=async()=>{
        if(!needConnection()) return;
        const name=(prompt("Profile name:")||"").trim();
        if(!name){ return; }
        const profiles=loadProfiles();
        if(profiles[name] && !confirm(`Overwrite existing profile "${name}"?`)) return;
        try{
          const obj=await buildKeymapObject();
          profiles[name]={ name, savedAt:new Date().toISOString(), ...obj };
          const ok=saveProfiles(profiles);
          if(!ok) downloadJSON(profiles[name], name+"-profile.json");
          log(`Saved profile "${name}".${ok?"":" (storage unavailable — downloaded instead)"}`, "ok");
          draw();
        }catch(e){ out.innerHTML=`<span class="err">${escapeHtml(e.message)}</span>`; }
      };

      root.querySelector("#profImportBtn").onclick=async()=>{
        const f=root.querySelector("#profImport").files[0];
        if(!f){ out.innerHTML='<span class="warn">Choose a file first.</span>'; return; }
        let data; try{ data=JSON.parse(await f.text()); }catch(e){ out.innerHTML='<span class="err">Invalid JSON.</span>'; return; }
        if(!data.layers){ out.innerHTML='<span class="err">Not a keymap/profile file.</span>'; return; }
        const name=(prompt("Save imported profile as:", data.name||f.name.replace(/\.json$/,""))||"").trim();
        if(!name) return;
        const profiles=loadProfiles();
        profiles[name]={ name, savedAt:new Date().toISOString(), ...data };
        saveProfiles(profiles); log(`Imported profile "${name}".`,"ok"); draw();
      };

      root.querySelectorAll("button[data-act]").forEach(btn=>{
        btn.onclick=async()=>{
          const act=btn.dataset.act, n=btn.dataset.n;
          const profiles=loadProfiles(); const p=profiles[n]; if(!p) return;
          if(act==="export"){ downloadJSON(p, n+"-profile.json"); return; }
          if(act==="delete"){ if(confirm(`Delete profile "${n}"?`)){ delete profiles[n]; saveProfiles(profiles); draw(); } return; }
          if(act==="rename"){
            const nn=(prompt("New name:", n)||"").trim(); if(!nn||nn===n) return;
            profiles[nn]={...p, name:nn}; delete profiles[n]; saveProfiles(profiles); draw(); return;
          }
          if(act==="apply"){
            if(!needConnection()) return;
            if(!confirm(`Apply profile "${n}" — this overwrites the keymap on the keyboard. Continue?`)) return;
            try{
              const res=await applyKeymapObject(p, msg=>{ out.innerHTML=`<span class="muted">${msg}</span>`; });
              out.innerHTML=`<span class="ok">Applied "${escapeHtml(n)}": ${res.written} keys${res.encWritten?`, ${res.encWritten} encoder actions`:""} written, ${res.skipped} skipped.</span>`;
              log(`Applied profile "${n}".`,"ok");
            }catch(e){ out.innerHTML=`<span class="err">${escapeHtml(e.message)}</span>`; }
          }
        };
      });
    };
    draw();
    App.on("profiles-changed", draw);
    App.on("connect", draw);
    App.on("disconnect", draw);
  }
});
```

- [ ] **Step 2b: Confirm the `kv` table style exists**

Run: `grep -n "\.kv" index.template.html`
Expected: a CSS rule for `.kv` (used by the Diagnostic panel). If absent, the table still renders unstyled — acceptable; do not add CSS.

- [ ] **Step 3: Build and syntax-check**

Run: `python3 build.py && python3 -c "import re; s=open('Epo70VIA.html').read(); open('/tmp/bundle.js','w').write(re.search(r'<script>(.*)</script>', s, re.S).group(1))" && node --check /tmp/bundle.js`
Expected: build succeeds, no syntax errors.

- [ ] **Step 4: Commit**

```bash
git add panels.js Epo70VIA.html
git commit -m "feat(profiles): localStorage profiles + connect-time auto-capture of default

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `⑥ Macros` panel (capability-gated editor + starter pack)

**Files:**
- Modify: `panels.js` — append the panel; add the starter-pack constant.

- [ ] **Step 1: Add the starter pack constant**

In `panels.js`, before the Macros panel registration, insert:

```js
// Starter macros. Robust first (pure text + Enter/Tab); [[DELAY]]/[[TAP]] flagged in the UI.
const MACRO_STARTER=[
  {label:"LaTeX: equation env", text:"\\begin{equation}\n\n\\end{equation}"},
  {label:"LaTeX: \\frac{}{}", text:"\\frac{}{}"},
  {label:"LaTeX: \\cite{}", text:"\\cite{}"},
  {label:"Python: import numpy", text:"import numpy as np\n"},
  {label:"Python: import pandas", text:"import pandas as pd\n"},
  {label:"Python: main guard", text:"if __name__ == \"__main__\":\n[[TAB]]"},
  {label:"Admin: email", text:"roykisluk@gmail.com"},
];
```

- [ ] **Step 2: Register the Macros panel**

Append to `panels.js`:

```js
registerPanel({
  id:"macros", title:"⑥ Macros", requiresConnection:true,
  render(root){
    let count=0, bufSize=0, texts=[];
    const show=(html)=>{ root.innerHTML=html; };

    const renderEditor=()=>{
      const used=Macros.bytesUsed(texts, MacroKC);
      const over=used>bufSize;
      const slots=texts.map((t,i)=>{
        const v=Macros.validate(t, MacroKC);
        return `<div class="card">
          <div class="row" style="justify-content:space-between">
            <b>M${i}</b>
            <span class="muted">bind a key to <code>M${i}</code> in ② Remap to trigger it</span>
          </div>
          <textarea data-i="${i}" rows="3" style="width:100%;font-family:monospace">${escapeHtml(t)}</textarea>
          <div class="muted">${v.ok?"&nbsp;":`<span class="err">${escapeHtml(v.error)}</span>`}</div>
        </div>`;
      }).join("");
      show(`
        <div class="card">
          <h2>Macros</h2>
          <div class="note">Type the text a macro should "type out". A newline = Enter. Special keys use tokens:
            <code>[[ENTER]]</code> <code>[[TAB]]</code> <code>[[DELAY:100]]</code> <code>[[TAP:KC_LEFT]]</code>.
            LaTeX braces <code>{}</code> are literal. <b>[[DELAY]]/[[TAP]] depend on newer firmware — verify on your board.</b></div>
          <div class="note warn"><b>First time:</b> set <code>M0</code> to <code>hello</code>, Write, bind a key to <code>M0</code> in ② Remap, press it, and confirm it types — before trusting the starter pack.</div>
          <div class="row">
            <button id="macWrite" class="primary" ${over?"disabled":""}>Write all macros to keyboard</button>
            <button id="macStarter">Load starter pack into empty slots</button>
            <button id="macReload">Reload from keyboard</button>
            <span class="${over?"err":"muted"}">${used} / ${bufSize} bytes${over?" — too large, trim before writing":""}</span>
          </div>
          <div id="macOut" style="margin-top:8px"></div>
        </div>
        ${slots}`);

      root.querySelectorAll("textarea[data-i]").forEach(ta=>{
        ta.oninput=()=>{ texts[+ta.dataset.i]=ta.value; renderEditorMeterOnly(); };
      });
      root.querySelector("#macStarter").onclick=()=>{
        let n=0;
        for(const s of MACRO_STARTER){ const i=texts.findIndex(t=>t===""); if(i<0) break; texts[i]=s.text; n++; }
        log(n?`Loaded ${n} starter macro(s) into empty slots. Review, then Write.`:"No empty slots to fill.","ok");
        renderEditor();
      };
      root.querySelector("#macReload").onclick=load;
      root.querySelector("#macWrite").onclick=write;
    };

    // Cheap path: update only the byte meter + Write-enabled state while typing.
    const renderEditorMeterOnly=()=>{
      const used=Macros.bytesUsed(texts, MacroKC); const over=used>bufSize;
      const meter=root.querySelector("#macWrite")?.parentElement?.querySelector("span");
      if(meter){ meter.className=over?"err":"muted"; meter.textContent=`${used} / ${bufSize} bytes${over?" — too large, trim before writing":""}`; }
      const wb=root.querySelector("#macWrite"); if(wb) wb.disabled=over;
    };

    const write=async()=>{
      if(!needConnection()) return;
      const out=root.querySelector("#macOut");
      let buf; try{ buf=Macros.serializeBuffer(texts, bufSize, MacroKC); }
      catch(e){ out.innerHTML=`<span class="err">${escapeHtml(e.message)}</span>`; return; }
      try{
        await App.via.setMacroBuffer(0, buf);
        out.innerHTML=`<span class="ok">Wrote ${texts.filter(t=>t).length} macro(s) (${buf.length} bytes).</span>`;
        log("Macros written to keyboard.","ok");
      }catch(e){ out.innerHTML=`<span class="err">Write failed: ${escapeHtml(e.message)}</span>`; }
    };

    const load=async()=>{
      if(!App.connected){ show(`<div class="card"><div class="note">Connect the keyboard to edit macros.</div></div>`); return; }
      show(`<div class="card"><p class="muted">Reading macro storage…</p></div>`);
      try{
        count=await App.via.getMacroCount();
        bufSize=await App.via.getMacroBufferSize();
        App.macroCount=count;
        if(!count || !bufSize){
          show(`<div class="card"><h2>Macros</h2><div class="note err">This firmware reports no macro storage (count ${count}, buffer ${bufSize} bytes), so macros can't be configured here.</div></div>`);
          return;
        }
        const buf=await App.via.getMacroBuffer(bufSize);
        texts=Macros.parseBuffer(buf, count, MacroKC);
        renderEditor();
      }catch(e){ show(`<div class="card"><div class="note err">Failed to read macros: ${escapeHtml(e.message)}</div></div>`); }
    };

    load();
    App.on("connect", load);
    App.on("disconnect", load);
  }
});
```

- [ ] **Step 3: Build and syntax-check**

Run: `python3 build.py && python3 -c "import re; s=open('Epo70VIA.html').read(); open('/tmp/bundle.js','w').write(re.search(r'<script>(.*)</script>', s, re.S).group(1))" && node --check /tmp/bundle.js`
Expected: build succeeds, no syntax errors.

- [ ] **Step 4: Run the full macro test suite again (regression)**

Run: `node --test test/macros.test.js`
Expected: PASS (all tests) — the panel reuses the tested module.

- [ ] **Step 5: Commit**

```bash
git add panels.js Epo70VIA.html
git commit -m "feat(macros): capability-gated editor panel + starter pack

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Update ARCHITECTURE.md and final verification

**Files:**
- Modify: `ARCHITECTURE.md` — §2 file layout, §5 panel list, §7 limitations.

- [ ] **Step 1: Update the file layout (§2)**

In `ARCHITECTURE.md` §2, add to the file list:

```
macros.js                PURE VIA macro encode/decode (Node-testable). Injected at __MACROS__.
test/macros.test.js      `node --test` suite for macros.js.
```

And note the new marker beside the existing three: `/*__MACROS__*/`.

- [ ] **Step 2: Update the panel list (§5)**

In `ARCHITECTURE.md` §5, change "deliberately trimmed to four panels" to six, and add:

```
5. **Profiles** — localStorage-backed full-keymap snapshots (keymap + encoders, RAW layer
   indices via the shared buildKeymapObject/applyKeymapObject helpers). Auto-captures the
   live layout as "default" on the first connect (also downloads default-profile.json as a
   file:// safety net) and feature-detects whether localStorage persists.
6. **Macros** — VIA dynamic-macro editor. Capability-gated on getMacroCount/getMacroBufferSize.
   Whole-buffer rewrite model; plain text + [[…]] tokens (LaTeX braces literal). Macros are
   triggerable because the keycode picker now offers M0.. (QK_MACRO 0x7700+i).
```

- [ ] **Step 3: Update limitations (§7)**

In `ARCHITECTURE.md` §7, change the Macros line from "not implemented yet" to:

```
- **Macros** are implemented (Macros panel + macros.js). Encoding sourced from QMK master;
  the [[DELAY]]/[[TAP]] non-text encodings may differ on older firmware — flagged in the UI.
  Profiles do NOT include macros (keymap + encoders only).
```

- [ ] **Step 4: Final full build + verification**

Run:
```bash
python3 build.py \
 && python3 -c "import re; s=open('Epo70VIA.html').read(); open('/tmp/bundle.js','w').write(re.search(r'<script>(.*)</script>', s, re.S).group(1))" \
 && node --check /tmp/bundle.js \
 && node --test test/macros.test.js
```
Expected: build succeeds; `node --check` clean; all macro tests PASS.

- [ ] **Step 5: Commit**

```bash
git add ARCHITECTURE.md Epo70VIA.html
git commit -m "docs: ARCHITECTURE for Profiles & Macros panels

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Manual (on-hardware) verification — the parts no test can cover

Neither `node --test` nor `selfTest()` proves the *board* accepts the bytes. After the plan is implemented, the user (with the keyboard, in a Chromium browser) should:

1. Open `Epo70VIA.html`, go to **① Diagnostic** → confirm the VIA interface, then **Connect**.
2. Confirm a `default-profile.json` downloads and a `default` row appears under **⑤ Profiles**.
3. **⑥ Macros:** set `M0` to `hello`, click **Write**. In **② Remap**, bind a key to `M0` (Macro category), press it in a text field, confirm `hello` types.
4. Only then **Load starter pack**, review, **Write**, and test a LaTeX macro (e.g. `\frac{}{}`).
5. **⑤ Profiles:** make a trivial remap, **Apply** the `default` profile, confirm it reverts.

---

## Self-Review (completed by author)

- **Spec coverage:** Via methods (Task 5) ✓; pure macro logic + tests (Tasks 1–3) ✓; build wiring (Task 4) ✓; capability gate + editor + starter pack + proof-of-life (Task 9) ✓; profiles storage + auto-capture + file:// safety net + feature-detect (Task 8) ✓; profiles reuse export format via shared helpers (Task 7) ✓; macro triggering via picker (Task 6) ✓; testing strategy (Tasks 1–3, 6, 10) ✓; ARCHITECTURE update (Task 10) ✓.
- **`connect` vs `keymap-loaded` ordering:** auto-capture binds to `connect` (fires after keymap is populated, not emitted by import) — verified against template lines 432/434/447.
- **Naming consistency:** `buildKeymapObject`/`applyKeymapObject`, `MacroKC`, `Macros.{encodeMacro,decodeMacro,parseBuffer,serializeBuffer,bytesUsed,validate}`, `loadProfiles`/`saveProfiles`/`storageOK`/`downloadJSON` used identically across tasks.
- **No placeholders:** every code step is complete and runnable.
