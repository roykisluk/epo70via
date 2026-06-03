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
