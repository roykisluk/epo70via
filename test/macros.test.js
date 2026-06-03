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
