/* macros.js — VIA dynamic-macro encode/decode (PURE logic, no browser globals).
   Injected into index.template.html at the __MACROS__ marker; also require()-able by
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

  return { encodeMacro };
})();
if (typeof module !== "undefined" && module.exports) module.exports = Macros;
