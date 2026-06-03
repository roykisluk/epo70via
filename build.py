#!/usr/bin/env python3
"""Assemble the standalone Epo70VIA.html from its sources.

Sources:
  index.template.html   — HTML shell, CSS, transport, VIA class, keycode module, panel registry
  panels.js             — feature panels (injected at the PANELS marker)
  _keycodes_basic.gen.js — auto-generated basic keycode table (see gen_keycodes.py)
  Epomaker_Split70.json — the VIA keyboard definition (embedded so the tool is offline-standalone)

Run:  python3 build.py
Output: Epo70VIA.html  (open directly in a Chromium browser)
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEF_JSON = os.path.join(HERE, "Epomaker_Split70.json")

def read(p): return open(p, encoding="utf-8").read()

def main():
    tpl    = read(os.path.join(HERE, "index.template.html"))
    kbdef  = read(DEF_JSON).rstrip()
    basic  = read(os.path.join(HERE, "_keycodes_basic.gen.js"))
    panels = read(os.path.join(HERE, "panels.js"))

    tpl = tpl.replace("/*__KEYBOARD_DEF__*/", "const KEYBOARD_DEF = " + kbdef + ";")
    tpl = tpl.replace("/*__BASIC_KEYCODES__*/", basic)
    tpl = tpl.replace("/*__PANELS__*/", panels)

    for marker in ("/*__KEYBOARD_DEF__*/", "/*__BASIC_KEYCODES__*/", "/*__PANELS__*/"):
        if marker in tpl:
            sys.exit("ERROR: marker not replaced: " + marker)

    out = os.path.join(HERE, "Epo70VIA.html")
    open(out, "w", encoding="utf-8").write(tpl)
    print("Wrote %s (%d bytes)" % (out, len(tpl)))

if __name__ == "__main__":
    main()
