#!/usr/bin/env python3
"""Regenerate _keycodes_basic.gen.js from QMK's machine-readable keycode constants.

The basic keycode table (0x0000-0x00FF) is the foundation of the whole tool's
correctness, so it is generated from QMK's authoritative source rather than typed.

Requires network access. Run:  python3 gen_keycodes.py
Output: _keycodes_basic.gen.js   (then run build.py to embed it)

Source: https://github.com/qmk/qmk_firmware/tree/master/data/constants/keycodes
        keycodes_0.0.1_basic.hjson  (the basic HID range; the most recent _basic file)

Layer ops, Auto Shift (0x7C10-0x7C15) and custom keycodes (QK_KB_0 = 0x7E00 + index)
are computed in the Keycodes module, not in this table — see ARCHITECTURE.md.
"""
import json, re, urllib.request, os

URL = ("https://raw.githubusercontent.com/qmk/qmk_firmware/master/"
       "data/constants/keycodes/keycodes_0.0.1_basic.hjson")
CATMAP = {"basic":"Basic","internal":"Special","system":"System",
          "media":"Media","mouse":"Mouse","modifiers":"Modifiers"}

def main():
    txt = urllib.request.urlopen(URL, timeout=30).read().decode()
    recs = []
    for m in re.finditer(r'"(0x[0-9A-Fa-f]+)"\s*:\s*\{(.*?)\n        \}', txt, re.S):
        code = int(m.group(1), 16); body = m.group(2)
        key = re.search(r'"key"\s*:\s*"([^"]+)"', body)
        grp = re.search(r'"group"\s*:\s*"([^"]*)"', body)
        lab = re.search(r'"label"\s*:\s*"([^"]*)"', body)
        if not key:
            continue
        name = key.group(1)
        label = (lab.group(1) if lab else "") or name.replace("KC_", "")
        cat = CATMAP.get(grp.group(1) if grp else "", "Basic")
        recs.append((code, name, label, cat))
    recs.sort()

    out = ["// AUTO-GENERATED from QMK data/constants/keycodes (keycodes_0.0.1_basic.hjson)",
           "// Regenerate with gen_keycodes.py. Format: [code, qmkName, displayLabel, category]",
           "const BASIC_KEYCODES = ["]
    for c, n, l, cat in recs:
        out.append("  [0x%04X,%s,%s,%s]," % (c, json.dumps(n), json.dumps(l), json.dumps(cat)))
    out.append("];\n")

    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_keycodes_basic.gen.js")
    open(path, "w").write("\n".join(out))
    print("Wrote %s (%d keycodes)" % (path, len(recs)))

if __name__ == "__main__":
    main()
