/* ============================================================
   PANELS  — injected at the PANELS marker in index.template.html.
   Each panel: { id, title, requiresConnection, render(root, App) }.
   Shared helpers (escapeHtml, log, Picker, Keycodes, hex16) come
   from the shell. See ARCHITECTURE.md → "Adding a panel".
   ============================================================ */

/* ---- shared keyboard renderer ---- */
const KEY_UNIT = 46, KEY_GAP = 3;
function renderBoard(host, opts){
  opts = opts || {};
  let maxX=0, maxY=0;
  App.layout.forEach(k=>{ maxX=Math.max(maxX,k.x+k.w); maxY=Math.max(maxY,k.y+k.h); });
  host.style.position="relative";
  host.style.width=(maxX*KEY_UNIT)+"px";
  host.style.height=(maxY*KEY_UNIT)+"px";
  host.innerHTML="";
  for(const k of App.layout){
    const el=document.createElement("div");
    el.className="key"+(k.enc!=null?" enc":"");
    const extra=opts.classFor&&opts.classFor(k); if(extra) el.className+=" "+extra;
    el.style.left=(k.x*KEY_UNIT)+"px"; el.style.top=(k.y*KEY_UNIT)+"px";
    el.style.width=(k.w*KEY_UNIT-KEY_GAP)+"px"; el.style.height=(k.h*KEY_UNIT-KEY_GAP)+"px";
    const lab=opts.label?opts.label(k):{main:k.pos};
    el.innerHTML=`<span>${escapeHtml(lab.main||"")}</span>${lab.sub?`<small>${escapeHtml(lab.sub)}</small>`:""}`;
    el.dataset.row=k.row; el.dataset.col=k.col;
    if(opts.onClick) el.onclick=()=>opts.onClick(k,el);
    host.appendChild(el);
  }
}
function needConnection(){ if(!App.connected){ alert("Connect the keyboard first (top-right button)."); return false;} return true; }

/* ---- GUI layer view -------------------------------------------------------
   This board's firmware has 4 layers (0..3). The user only works with two:
   their base content lives on firmware layer 2 (the layer the keyboard boots /
   reverts to), and the numpad on firmware layer 3.
   Why the numpad is on 3, not 1: QMK resolves a key by scanning ACTIVE layers
   top-down and taking the first non-transparent code. A momentary layer only
   "wins" if its index is ABOVE the base. Base is 2, so the numpad must be 3 —
   on 1 it would sit below the base and stay hidden.
   We relabel + hide the rest in the GUI ONLY. VIA has no command to move layers
   or set the default layer, so this is display-only — it does NOT change what
   the keyboard boots into. Edit this one table to change the mapping.        */
const LAYER_VIEW = [
  { label:"0", fw:2 },   // shown as "Layer 0"  -> firmware layer 2 (base)
  { label:"1", fw:3 },   // shown as "Layer 1"  -> firmware layer 3 (numpad; above the base)
];
const NUMPAD_FW = 3;     // firmware layer that holds the numpad (must be > base layer)
App.state.layer = LAYER_VIEW[0].fw;   // GUI opens on the base layer

// [row, col, keycode-name] — keypad codes (Num-Lock aware), placed in a
// standard numpad layout: 7-8-9 on the TOP row, 1-2-3 on the BOTTOM row, 0/.
// below. NOTE: on this board the matrix-row numbering runs OPPOSITE to physical
// top→bottom within a hand's 3×3 block — the *higher*-numbered digit row sits
// physically on top (confirmed on hardware: writing 1-2-3 to row 8 put them on
// the top row). So for a normal numpad, 7-8-9 goes on the higher row number.
// Right hand: digit rows 6/7/8 (8=top), 0/. on row 9 (bottom). Verified.
// Left hand: digit rows 1/2/3 (3=top), 0/. on row 4 — same convention assumed
// (left half not used by the ③ Numpad button; mirror of the verified right).
const NUMPAD = {
  right:[
    [8,2,"KC_KP_7"],[8,3,"KC_KP_8"],[8,4,"KC_KP_9"],
    [7,2,"KC_KP_4"],[7,3,"KC_KP_5"],[7,4,"KC_KP_6"],
    [6,2,"KC_KP_1"],[6,3,"KC_KP_2"],[6,4,"KC_KP_3"],
    [9,3,"KC_KP_0"],[9,4,"KC_KP_DOT"],
  ],
  left:[
    [3,4,"KC_KP_7"],[3,5,"KC_KP_8"],[3,6,"KC_KP_9"],
    [2,4,"KC_KP_4"],[2,5,"KC_KP_5"],[2,6,"KC_KP_6"],
    [1,4,"KC_KP_1"],[1,5,"KC_KP_2"],[1,6,"KC_KP_3"],
    [4,3,"KC_KP_0"],[4,2,"KC_KP_DOT"],
  ],
};

/* ============================================================
   1. DIAGNOSTIC  — the lead panel. Determines whether any web
   tool can possibly configure this board (FF60 interface check).
   ============================================================ */
registerPanel({
  id:"diag", title:"① Diagnostic", requiresConnection:false,
  render(root){
    root.innerHTML=`
      <div class="card">
        <h2>Connection diagnostic</h2>
        <p class="muted">If VIA / caniusevia.com can't see your keyboard, there are two very different causes — and only one is fixable by any browser tool. This check tells you which one you're in.</p>
        <div class="row"><button id="diagScan" class="primary">Inspect HID interfaces…</button>
          <button id="diagGranted">List already-allowed devices</button></div>
        <div id="diagOut" style="margin-top:12px"></div>
      </div>
      <div class="card">
        <h3>What this means</h3>
        <table>
          <tr><th>Result</th><th>Meaning</th><th>Fix</th></tr>
          <tr><td class="ok">FF60 interface found</td><td>Your firmware exposes the VIA raw-HID interface. caniusevia.com only rejected it because your VID/PID isn't in its registry.</td><td>Use the <b>Connect keyboard</b> button — this tool ships your JSON, so it works.</td></tr>
          <tr><td class="err">No FF60 interface</td><td>This firmware does <b>not</b> expose VIA. No web tool (this one included) can configure it.</td><td>Flash VIA-compatible QMK firmware, then return here.</td></tr>
        </table>
      </div>
      <div class="card"><h3>Session log</h3><div id="log"></div></div>`;
    const out=root.querySelector("#diagOut");
    const inspect=(devs)=>{
      if(!devs.length){ out.innerHTML='<div class="note warn">No device selected.</div>'; return; }
      let html="", anyVia=false;
      for(const d of devs){
        let rows="";
        for(const c of d.collections){
          const via=(c.usagePage===0xFF60);
          if(via) anyVia=true;
          rows+=`<tr><td class="mono">${hex16(c.usagePage)}</td><td class="mono">${hex16(c.usage)}</td><td>${via?'<span class="ok">◀ VIA raw-HID</span>':''}</td></tr>`;
        }
        html+=`<div style="margin-bottom:10px"><b>${escapeHtml(d.productName||"(unnamed)")}</b>
          <span class="muted mono">VID ${hex16(d.vendorId)} PID ${hex16(d.productId)}</span>
          <table style="margin-top:6px"><tr><th>Usage Page</th><th>Usage</th><th></th></tr>${rows}</table></div>`;
      }
      const verdict=anyVia
        ? '<div class="note"><b class="ok">✓ VIA interface present.</b> Click <b>Connect keyboard</b> at the top — this tool will configure it.</div>'
        : '<div class="note err"><b>✗ No 0xFF60 / usage 0x61 interface found.</b> This firmware does not expose VIA. No browser tool can configure it; you would need to flash VIA-compatible firmware.</div>';
      out.innerHTML=verdict+html;
    };
    root.querySelector("#diagScan").onclick=async()=>{
      if(!("hid" in navigator)){ out.innerHTML='<div class="note err">WebHID unavailable. Use Chrome/Edge/Brave/Opera.</div>'; return; }
      try{ const devs=await navigator.hid.requestDevice({filters:[]});
        log(`Inspected ${devs.length} selected device(s).`); inspect(devs);
      }catch(e){ out.innerHTML=`<div class="note err">${escapeHtml(e.message)}</div>`; }
    };
    root.querySelector("#diagGranted").onclick=async()=>{
      const devs=await navigator.hid.getDevices(); inspect(devs);
    };
  }
});

/* ============================================================
   2. REMAP  — visual keymap editor + layer selector + encoders.
   ============================================================ */
registerPanel({
  id:"remap", title:"② Remap & Layers", requiresConnection:true,
  render(root){
    root.innerHTML=`
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <div><h2>Keymap</h2><span class="muted">Click any key, then choose a keycode. Writes save to the keyboard's EEPROM immediately.</span></div>
          <div class="row" id="layerBar"></div>
        </div>
        <div id="kbWrap" style="margin-top:12px"><div id="kb"></div></div>
      </div>
      <div class="card" id="encCard"><h2>Rotary encoders</h2><div id="encList" class="muted">—</div></div>
      <div class="note">Tip: layer-switch keys (MO/TO/TG/DF/OSL/TT) live under the <b>Layers</b> category in the picker. The selector above shows only the layers you use — <b>Layer 0</b> is your base (firmware layer 2), <b>Layer 1</b> is the numpad (firmware layer 1).</div>`;
    const kb=root.querySelector("#kb"), layerBar=root.querySelector("#layerBar");

    const drawLayers=()=>{
      layerBar.innerHTML="";
      const lbl=document.createElement("span"); lbl.className="muted"; lbl.textContent="Layer:"; layerBar.appendChild(lbl);
      for(const v of LAYER_VIEW){ const b=document.createElement("button");
        b.textContent=v.label; if(v.fw===App.state.layer)b.className="primary";
        b.onclick=()=>{ App.state.layer=v.fw; App.emit("layer-change"); drawLayers(); draw(); };
        layerBar.appendChild(b);
      }
    };
    const label=(k)=>{
      if(!App.keymap) return {main:k.pos, sub:k.enc!=null?"⟳ enc":""};
      const d=Keycodes.decode(App.getKC(App.state.layer,k.row,k.col));
      return {main:d.label, sub:k.enc!=null?("⟳ enc "+k.enc):(d.name!==d.label?d.name:"")};
    };
    const onClick=(k)=>{
      if(!needConnection()) return;
      Picker.open(`${k.pos} · layer ${App.state.layer}`, async(code)=>{
        try{ await App.via.setKeycode(App.state.layer,k.row,k.col,code);
          App.keymap[App.kmIndex(App.state.layer,k.row,k.col)]=code; draw();
          log(`Set ${k.pos} L${App.state.layer} → ${Keycodes.decode(code).label}`,"ok");
        }catch(e){ log("Set failed: "+e.message,"err"); }
      });
    };
    const draw=()=>renderBoard(kb,{label,onClick});

    const drawEncoders=async()=>{
      const host=root.querySelector("#encList"), card=root.querySelector("#encCard");
      if(!App.encoders.length){ card.style.display="none"; return; }
      if(!App.connected){ host.innerHTML='<span class="muted">Connect to view/edit encoder rotation.</span>'; return; }
      host.innerHTML="";
      for(const enc of App.encoders){
        let cw=0,ccw=0;
        try{ cw=await App.via.getEncoder(App.state.layer,enc.idx,true);
             ccw=await App.via.getEncoder(App.state.layer,enc.idx,false); }catch(e){}
        const wrap=document.createElement("div"); wrap.className="row"; wrap.style.margin="6px 0";
        wrap.innerHTML=`<b>Encoder ${enc.idx}</b> <span class="muted mono">(${enc.row},${enc.col})</span> L${App.state.layer}`;
        const mk=(dir,code)=>{ const b=document.createElement("button");
          b.textContent=(dir?"CW ⟳ ":"CCW ⟲ ")+Keycodes.decode(code).label;
          b.onclick=()=>{ if(!needConnection())return;
            Picker.open(`Encoder ${enc.idx} ${dir?"CW":"CCW"} · L${App.state.layer}`, async(c)=>{
              try{ await App.via.setEncoder(App.state.layer,enc.idx,dir,c); log(`Encoder ${enc.idx} ${dir?"CW":"CCW"} → ${Keycodes.decode(c).label}`,"ok"); drawEncoders(); }
              catch(e){ log("Encoder set failed: "+e.message,"err"); }
            }); };
          return b; };
        wrap.appendChild(mk(false,ccw)); wrap.appendChild(mk(true,cw));
        host.appendChild(wrap);
      }
    };

    drawLayers(); draw(); drawEncoders();
    App.on("keymap-loaded",()=>{drawLayers();draw();drawEncoders();});
    App.on("connect",()=>{drawLayers();draw();drawEncoders();});
    App.on("disconnect",()=>{draw();drawEncoders();});
    App.on("layer-change",()=>{drawEncoders();});
  }
});

/* ============================================================
   3. NUMPAD  — one button: writes the right-hand numpad to the
   numpad layer and binds the corner key (left of L-Ctrl) to a
   momentary switch to it, on every layer so it always works.
   ============================================================ */
registerPanel({
  id:"presets", title:"③ Numpad", requiresConnection:true,
  render(root){
    root.innerHTML=`
      <div class="card">
        <h2>Numpad + momentary key</h2>
        <p class="muted">One click sets everything up: writes a Num-Lock-aware keypad
          (<code>KC_KP_*</code>) onto the <b>right half</b> of <b>Layer&nbsp;1</b>, and binds the
          corner key <b>left of left-Ctrl</b> (matrix <span class="mono">4,0</span>) to a
          <b>momentary switch</b> to it on every layer. <b>Hold</b> it for the numpad,
          <b>release</b> to return to your base layer (Layer&nbsp;0). Layer&nbsp;1 sits just above
          your base so the held layer actually wins. Only those keys change; everything else is
          left untouched and saved to the keyboard immediately.</p>
        <button id="npGo" class="primary">Set up numpad + momentary key</button>
        <div id="npOut" class="muted" style="margin-top:12px"></div>
      </div>`;
    const exists=(r,c)=> App.layout.some(k=>k.row===r&&k.col===c);
    const posLabel=(r,c)=>{ const k=App.layout.find(k=>k.row===r&&k.col===c); return k?k.pos:`${r},${c}`; };
    root.querySelector("#npGo").onclick=async()=>{
      if(!needConnection())return;
      const out=root.querySelector("#npOut");
      if(NUMPAD_FW>=(App.layerCount||0)){
        out.innerHTML=`<span class="err">This keyboard reports only ${App.layerCount} layer(s), but the numpad needs firmware layer ${NUMPAD_FW} (it must sit above your base). Aborting — adjust LAYER_VIEW/NUMPAD_FW.</span>`;
        return;
      }
      let ok=0, skip=0;
      // 1) numpad on the right half of the numpad layer (firmware NUMPAD_FW)
      for(const [r,c,n] of NUMPAD.right){ const rec=Keycodes.byName.get(n);
        if(!rec||!exists(r,c)){ skip++; continue; }
        try{ await App.via.setKeycode(NUMPAD_FW,r,c,rec.code); App.keymap[App.kmIndex(NUMPAD_FW,r,c)]=rec.code; ok++; }
        catch(e){ skip++; }
      }
      // 2) momentary MO(numpad) on the corner key (4,0) of EVERY firmware layer,
      //    so it works no matter which layer is the active base. (4,0) is never a
      //    numpad digit, and MO on the numpad layer itself is a harmless no-op.
      const MOM_R=4, MOM_C=0, mo=Keycodes.layerCode("MO",NUMPAD_FW);
      let mok=0;
      if(exists(MOM_R,MOM_C)){
        for(let l=0;l<(App.layerCount||1);l++){
          try{ await App.via.setKeycode(l,MOM_R,MOM_C,mo); App.keymap[App.kmIndex(l,MOM_R,MOM_C)]=mo; mok++; }
          catch(e){ skip++; }
        }
      } else { skip++; }
      out.innerHTML=`<span class="ok">Done — ${ok} numpad keys on Layer 1; momentary ${escapeHtml(Keycodes.decode(mo).label)} on ${posLabel(MOM_R,MOM_C)} across ${mok} layer(s)${skip?`; ${skip} skipped`:""}.</span>`;
      log(`Numpad setup: ${ok} keys + ${Keycodes.decode(mo).label} on (4,0)x${mok} layers${skip?`, ${skip} skipped`:""}.`,"ok");
      App.emit("keymap-loaded");
    };
  }
});

/* ============================================================
   6. IMPORT / EXPORT  — VIA-style keymap JSON + reset to defaults.
   ============================================================ */
function kcToken(code){
  const d=Keycodes.decode(code);
  if(d.unknown) return Keycodes.hex(code);
  if(["MO","TO","TG","DF","OSL","TT"].includes(d.name)) return d.label; // e.g. MO(2)
  if(["MODS","MT","OSM","LT"].includes(d.name)) return Keycodes.hex(code); // complex → hex (round-trips)
  return d.name; // KC_A, AS_TOGG, MOR_1, …
}
function tokenToKc(tok){
  tok=String(tok).trim();
  if(/^0x[0-9a-f]+$/i.test(tok)) return parseInt(tok,16)&0xFFFF;
  const m=tok.match(/^(MO|TO|TG|DF|OSL|TT)\((\d+)\)$/);
  if(m) return Keycodes.layerCode(m[1],+m[2]);
  const r=Keycodes.byName.get(tok);
  return r?r.code:null;
}
registerPanel({
  id:"io", title:"④ Import / Export", requiresConnection:false,
  render(root){
    root.innerHTML=`
      <div class="card">
        <h2>Export</h2>
        <p class="muted">Saves the full keymap (all layers + encoders) to a JSON file you can back up or re-import.</p>
        <button id="exportBtn" class="primary">Export keymap to file</button>
      </div>
      <div class="card">
        <h2>Import</h2>
        <p class="muted">Loads a keymap file and writes it to the keyboard. Matrix dimensions must match this keyboard.</p>
        <div class="row"><input type="file" id="importFile" accept="application/json,.json"><button id="importBtn">Import & write</button></div>
        <div id="importOut" style="margin-top:10px"></div>
      </div>
      <div class="card">
        <h2>Reset to firmware defaults</h2>
        <div class="note err">Erases all customisation stored on the keyboard (keymap, lighting) and restores the firmware's built-in defaults. <b>This also resets the default layer to 0 (Windows)</b> — afterwards you'll need <code>fn+s</code> to return to the Mac layout.</div>
        <button id="resetBtn" class="danger" style="margin-top:10px">Reset keyboard (EEPROM)</button>
      </div>`;

    root.querySelector("#exportBtn").onclick=async()=>{
      if(!App.keymap){ alert("Connect and load the keymap first."); return; }
      const layers=[];
      for(let l=0;l<App.layerCount;l++){ const layer=[];
        for(let r=0;r<App.rows;r++)for(let c=0;c<App.cols;c++) layer.push(kcToken(App.getKC(l,r,c)));
        layers.push(layer);
      }
      // encoders: per layer → per encoder → [ccw, cw] tokens (read live from the keyboard)
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
      const obj={ tool:"epo70-config", name:App.def.name,
        vendorProductId:((parseInt(App.def.vendorId,16)<<16)>>>0)|parseInt(App.def.productId,16),
        matrix:{rows:App.rows,cols:App.cols}, layerCount:App.layerCount,
        encoderCount:App.encoders.length, layers, encoders };
      const blob=new Blob([JSON.stringify(obj,null,1)],{type:"application/json"});
      const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
      a.download=App.def.name+"-keymap.json"; a.click(); URL.revokeObjectURL(a.href);
      log("Exported keymap.","ok");
    };

    root.querySelector("#importBtn").onclick=async()=>{
      if(!needConnection()) return;
      const f=root.querySelector("#importFile").files[0];
      const out=root.querySelector("#importOut");
      if(!f){ out.innerHTML='<span class="warn">Choose a file first.</span>'; return; }
      let data; try{ data=JSON.parse(await f.text()); }catch(e){ out.innerHTML='<span class="err">Invalid JSON.</span>'; return; }
      if(!data.layers || !data.matrix || data.matrix.rows!==App.rows || data.matrix.cols!==App.cols){
        out.innerHTML='<span class="err">File does not match this keyboard\'s matrix.</span>'; return; }
      let written=0, skipped=0;
      const nLayers=Math.min(data.layerCount||data.layers.length, App.layerCount);
      for(let l=0;l<nLayers;l++){ let idx=0;
        for(let r=0;r<App.rows;r++)for(let c=0;c<App.cols;c++){
          const tok=data.layers[l][idx++]; const kc=tokenToKc(tok);
          if(kc==null){ skipped++; continue; }
          if(kc!==App.getKC(l,r,c)){ try{ await App.via.setKeycode(l,r,c,kc); App.keymap[App.kmIndex(l,r,c)]=kc; written++; }catch(e){ skipped++; } }
        }
        out.innerHTML=`<span class="muted">Writing… layer ${l+1}/${nLayers}, ${written} keys</span>`;
      }
      // replay encoder mappings (per layer → per encoder → [ccw, cw])
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
      out.innerHTML=`<span class="ok">Import complete: ${written} keys${encWritten?`, ${encWritten} encoder actions`:""} written, ${skipped} skipped.</span>`;
      log(`Imported keymap (${written} written, ${skipped} skipped).`,"ok");
      App.emit("keymap-loaded");
    };

    root.querySelector("#resetBtn").onclick=async()=>{
      if(!needConnection()) return;
      if(!confirm("Reset the keyboard to firmware defaults?\n\nThis erases your customisation AND resets the default layer to 0 (Windows) — you'll need fn+s to get the Mac layout back.")) return;
      try{ await App.via.eepromReset(); log("EEPROM reset sent. Reloading keymap…","warn");
        await reloadKeymap(); }
      catch(e){ log("Reset failed: "+e.message,"err"); }
    };
  }
});
