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

  function encodeMacro(text, kc) {
    const out = [];
    pushLiteral(out, String(text));
    return Uint8Array.from(out);
  }

  return { encodeMacro };
})();
if (typeof module !== "undefined" && module.exports) module.exports = Macros;
