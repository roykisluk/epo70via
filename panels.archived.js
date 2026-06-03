/* ============================================================
   ARCHIVED PANELS  — NOT built into Epo70VIA.html.
   build.py only reads panels.js, so nothing here ships.

   These panels were removed from the active tool to keep the UI focused
   (see ARCHITECTURE.md). To restore one: copy its registerPanel({...}) call
   back into panels.js and run `python3 build.py`. They rely only on the
   shared helpers (App, Via, Keycodes, Picker, renderBoard, needConnection,
   log, escapeHtml, hex16) which still live in the template, so they work
   as-is once pasted back. (The old "Layers & Presets" panel also needs the
   `NUMPAD` table, which still lives in panels.js.)
   ============================================================ */

/* ============================================================
   3. AUTO SHIFT  — keycodes + firmware caveat + current bindings.
   ============================================================ */
registerPanel({
  id:"autoshift", title:"③ Auto Shift", requiresConnection:false,
  render(root){
    const AS=[["AS_TOGG","Toggle Auto Shift on/off",0x7C15],["AS_ON","Force on",0x7C13],
      ["AS_OFF","Force off",0x7C14],["AS_UP","Increase timeout +5ms",0x7C11],
      ["AS_DOWN","Decrease timeout −5ms",0x7C10],["AS_RPT","Print current timeout",0x7C12]];
    root.innerHTML=`
      <div class="card">
        <h2>Auto Shift</h2>
        <div class="note warn"><b>Firmware requirement:</b> these keycodes only do anything if your keyboard's firmware was compiled with <code>AUTO_SHIFT_ENABLE = yes</code>. Standard VIA has no separate "settings" command for Auto Shift — it is controlled entirely by binding these keycodes to keys (the same way VIA/Vial do it).</div>
        <p class="muted">Auto Shift lets a long press of a key produce its shifted character (e.g. hold <code>a</code> → <code>A</code>). Bind <code>AS_TOGG</code> to a convenient key to turn it on/off, and <code>AS_UP</code>/<code>AS_DOWN</code> to tune the hold time.</p>
        <table><tr><th>Keycode</th><th>Action</th><th>Value</th></tr>
        ${AS.map(([n,d,c])=>`<tr><td class="mono">${n}</td><td>${d}</td><td class="mono">${hex16(c)}</td></tr>`).join("")}</table>
        <p class="muted" style="margin-top:10px">To bind: go to <b>Remap</b>, click a key, open the <b>Auto Shift</b> category in the picker.</p>
      </div>
      <div class="card"><h3>Auto Shift keys currently bound</h3><div id="asBound" class="muted">Connect and load the keymap to scan.</div></div>`;
    const scan=()=>{
      const host=root.querySelector("#asBound");
      if(!App.keymap){ host.innerHTML='<span class="muted">Connect and load the keymap to scan.</span>'; return; }
      const hits=[];
      for(let l=0;l<App.layerCount;l++)for(let r=0;r<App.rows;r++)for(let c=0;c<App.cols;c++){
        const kc=App.getKC(l,r,c); if(kc>=0x7C10&&kc<=0x7C15) hits.push({l,r,c,kc});
      }
      host.innerHTML = hits.length
        ? '<table><tr><th>Layer</th><th>Matrix</th><th>Keycode</th></tr>'+hits.map(h=>`<tr><td>${h.l}</td><td class="mono">${h.r},${h.c}</td><td class="mono">${Keycodes.decode(h.kc).name}</td></tr>`).join("")+'</table>'
        : '<span class="muted">No Auto Shift keycodes are bound yet.</span>';
    };
    App.on("keymap-loaded",scan); App.on("disconnect",scan); scan();
  }
});

/* ============================================================
   4. LIGHTING  — built from the definition's Lighting menu via
   the VIA custom-value channel protocol.
   ============================================================ */
registerPanel({
  id:"light", title:"④ Lighting", requiresConnection:true,
  render(root){
    // collect controls: nodes whose content[0] is an "id_*" string
    const controls=[];
    (function walk(nodes){ for(const n of nodes||[]){
      if(Array.isArray(n.content) && typeof n.content[0]==="string" && n.content[0].startsWith("id_")) controls.push(n);
      else if(Array.isArray(n.content)) walk(n.content);
    }})(App.def.menus);
    root.innerHTML=`<div class="card"><h2>Lighting</h2>
      <p class="muted">Reads & writes RGB settings live over the VIA custom-value channel. Changes are saved to the keyboard automatically.</p>
      <div id="lightCtrls">${App.connected?"":'<span class="muted">Connect the keyboard to control lighting.</span>'}</div></div>`;
    const host=root.querySelector("#lightCtrls");
    const lenOf=(t)=> t==="color"?2:1;
    const build=async()=>{
      if(!App.connected){ host.innerHTML='<span class="muted">Connect the keyboard to control lighting.</span>'; return; }
      host.innerHTML="";
      for(const ctl of controls){
        const [id,channel,value]=ctl.content;
        let cur=[0]; try{ cur=await App.via.customGet(channel,value,lenOf(ctl.type)); }catch(e){ log("Lighting read failed ("+ctl.label+"): "+e.message,"warn"); }
        const row=document.createElement("div"); row.style.margin="10px 0";
        const head=document.createElement("div"); head.innerHTML=`<b>${escapeHtml(ctl.label)}</b> <span class="muted mono">ch${channel}/v${value}</span>`;
        row.appendChild(head);
        const commit=async(bytes)=>{ try{ await App.via.customSet(channel,value,bytes); await App.via.customSave(channel); }
          catch(e){ log("Lighting set failed: "+e.message,"err"); } };
        if(ctl.type==="range"){
          const [mn,mx]=ctl.options; const inp=document.createElement("input");
          inp.type="range"; inp.min=mn; inp.max=mx; inp.value=cur[0]; inp.style.width="260px";
          const v=document.createElement("span"); v.className="mono"; v.textContent=cur[0];
          inp.oninput=()=>v.textContent=inp.value;
          inp.onchange=()=>commit([+inp.value]);
          const r=document.createElement("div"); r.className="row"; r.append(inp,v); row.appendChild(r);
        } else if(ctl.type==="dropdown"){
          const sel=document.createElement("select");
          for(const opt of ctl.options){ const [t,val]=Array.isArray(opt)?opt:[opt,ctl.options.indexOf(opt)];
            const o=document.createElement("option"); o.value=val; o.textContent=t; if(val===cur[0])o.selected=true; sel.appendChild(o);}
          sel.onchange=()=>commit([+sel.value]); row.appendChild(sel);
        } else if(ctl.type==="color"){
          const hue=document.createElement("input"); hue.type="range"; hue.min=0;hue.max=255;hue.value=cur[0]||0;hue.style.width="200px";
          const sat=document.createElement("input"); sat.type="range"; sat.min=0;sat.max=255;sat.value=cur[1]||0;sat.style.width="200px";
          const sw=document.createElement("span"); sw.className="swatch";
          const paint=()=>{ sw.style.background=`hsl(${hue.value/255*360},${sat.value/255*100}%,50%)`; };
          paint(); const send=()=>{commit([+hue.value,+sat.value]);paint();};
          hue.onchange=send; sat.onchange=send; hue.oninput=paint; sat.oninput=paint;
          const r=document.createElement("div"); r.className="row";
          r.append(label("Hue",hue),label("Sat",sat),sw); row.appendChild(r);
        } else {
          row.appendChild(Object.assign(document.createElement("span"),{className:"muted",textContent:"(unsupported control type: "+ctl.type+")"}));
        }
        host.appendChild(row);
      }
      function label(t,el){ const l=document.createElement("label"); l.className="fld"; l.textContent=t; l.appendChild(el); return l; }
    };
    App.on("connect",build); App.on("disconnect",build); build();
  }
});

/* ============================================================
   5. KEY TESTER  — proof-of-life via switch matrix state polling.
   ============================================================ */
registerPanel({
  id:"tester", title:"⑤ Key Tester", requiresConnection:true,
  render(root){
    root.innerHTML=`<div class="card">
      <div class="row" style="justify-content:space-between">
        <div><h2>Key tester</h2><span class="muted">Press keys — they light up green. This proves the VIA protocol round-trips on your actual hardware. (Live matrix state is an optional firmware feature; if it times out, remapping can still work.)</span></div>
        <button id="testToggle" class="primary">Start test</button>
      </div>
      <div id="kbWrap" style="margin-top:12px"><div id="tkb"></div></div></div>`;
    const tkb=root.querySelector("#tkb"); let state=null, timer=null, busy=false;
    const classFor=(k)=> (state && state[k.row] && state[k.row][k.col]) ? "pressed" : "";
    const draw=()=>renderBoard(tkb,{label:k=>({main:k.pos}),classFor});
    draw();
    const tick=async()=>{ if(busy||!App.connected) return; busy=true;
      try{ state=await App.via.getMatrixState(App.rows,App.cols); draw(); }
      catch(e){ log("Matrix-state poll failed: "+e.message+" — this firmware may not expose live matrix state (it's optional). Remapping can still work; verify by remapping a key and typing.","warn"); stop(); }
      finally{ busy=false; } };
    const btn=root.querySelector("#testToggle");
    const start=()=>{ if(!needConnection())return; timer=setInterval(tick,90); btn.textContent="Stop test"; btn.classList.remove("primary"); log("Key tester started."); };
    const stop=()=>{ clearInterval(timer); timer=null; btn.textContent="Start test"; btn.classList.add("primary"); };
    btn.onclick=()=> timer?stop():start();
    App.on("disconnect",()=>{stop();state=null;draw();});
  }
});

/* ---- old verbose "Layers & Presets" panel (replaced by ③ Numpad) ---- */
registerPanel({
  id:"presets", title:"⑦ Layers & Presets", requiresConnection:true,
  render(root){
    root.innerHTML=`
      <div class="card">
        <h2>Numpad preset</h2>
        <p class="muted">Writes a keypad-keycode numpad (<code>KC_KP_*</code> — Num-Lock aware) onto a layer, on <b>both hands</b> so you can use whichever is free. Only the numpad keys are written; the rest of the layer is left untouched. Saves to the keyboard's EEPROM immediately. Bind an <code>MO()</code>/<code>TG()</code> key to this layer (in <b>② Remap</b>) to reach it.</p>
        <div class="row">
          <label class="fld" style="flex-direction:row;align-items:center;gap:6px">Target layer
            <select id="npLayer"></select></label>
          <label class="fld" style="flex-direction:row;align-items:center;gap:6px">Hands
            <select id="npHands">
              <option value="both">Both hands</option>
              <option value="right">Right only</option>
              <option value="left">Left only</option>
            </select></label>
          <button id="npApply" class="primary">Apply numpad</button>
        </div>
        <div id="npPreview" class="muted" style="margin-top:12px"></div>
        <div class="row" style="margin-top:14px;align-items:center;gap:10px">
          <button id="npMomentary">Bind momentary key (left of L-Ctrl → numpad)</button>
          <span class="muted">Writes <code>MO(target&nbsp;layer)</code> to matrix <span class="mono">4,0</span> on <b>layer 0</b>. <b>Hold</b> it for the numpad; <b>release</b> returns to layer 0. This also replaces any permanent <code>TO/DF</code> switch sitting on that key (the usual cause of "stuck on layer 2").</span>
        </div>
      </div>
      <div class="card">
        <h2>Layer / OS-switch keys</h2>
        <p class="muted">Every key bound to a layer or OS switch (<code>DF/TO/TG/MO/TT/OSL/LT</code> plus the board's custom <code>IM_BATQ/MM_BATQ/KC_FILP/MOR_*/RL_MOD</code> keycodes), across all layers.</p>
        <div class="note warn"><b>Keyboard keeps dropping to the Windows layout?</b> Standard VIA has <b>no command to set the default layer</b> — Win/Mac is chosen by <i>pressing</i> a switch key (your <code>fn+s</code>), and the only tool action that resets it to Windows is <b>⑥ EEPROM reset</b>. So the durable fix for an accidental revert is to rebind whatever switch key you keep hitting — most likely the key <b>left of left-Ctrl (matrix 4,0)</b>, flagged below. Click <b>Rebind</b> to change it.</div>
        <div id="osScan" class="muted" style="margin-top:10px">Connect and load the keymap to scan.</div>
      </div>`;
    const posLabel=(r,c)=>{ const k=App.layout.find(k=>k.row===r&&k.col===c); return k?k.pos:`${r},${c}`; };
    const exists=(r,c)=> App.layout.some(k=>k.row===r&&k.col===c);

    // ---- numpad preset ----
    const layerSel=root.querySelector("#npLayer"), handSel=root.querySelector("#npHands");
    const fillLayers=()=>{ const cur=layerSel.value, n=App.layerCount||4; layerSel.innerHTML="";
      for(let i=0;i<n;i++){ const o=document.createElement("option"); o.value=i; o.textContent="Layer "+i;
        if(String(i)===cur || (!cur && i===1)) o.selected=true; layerSel.appendChild(o); } };
    const setFor=(hands)=> hands==="both" ? NUMPAD.left.concat(NUMPAD.right) : (NUMPAD[hands]||[]);
    const renderPreview=()=>{
      const valid=setFor(handSel.value).filter(([r,c])=>exists(r,c));
      root.querySelector("#npPreview").innerHTML=`Will write ${valid.length} keys → `+
        valid.map(([r,c,n])=>`<span class="mono">${posLabel(r,c)}=${escapeHtml(Keycodes.byName.get(n).label)}</span>`).join(" · ");
    };
    handSel.onchange=renderPreview;
    root.querySelector("#npApply").onclick=async()=>{
      if(!needConnection())return;
      const layer=+layerSel.value, set=setFor(handSel.value);
      let ok=0,skip=0;
      for(const [r,c,n] of set){ const rec=Keycodes.byName.get(n);
        if(!rec||!exists(r,c)){ skip++; continue; }
        try{ await App.via.setKeycode(layer,r,c,rec.code); App.keymap[App.kmIndex(layer,r,c)]=rec.code; ok++; }
        catch(e){ skip++; }
      }
      log(`Numpad applied to layer ${layer}: ${ok} keys written${skip?`, ${skip} skipped`:""}.`,"ok");
      App.emit("keymap-loaded");
    };

    // ---- momentary numpad key (corner key left of L-Ctrl = matrix 4,0) ----
    // The MO key must live on the BASE layer (0): held = numpad layer active,
    // released = back to layer 0. That is what makes it momentary, and it
    // overwrites any permanent TO/DF switch parked on that key.
    const MOM_R=4, MOM_C=0, momBtn=root.querySelector("#npMomentary");
    const updMom=()=>{ momBtn.textContent=`Bind momentary key (left of L-Ctrl → MO(${layerSel.value||0}))`; };
    layerSel.addEventListener("change",updMom);
    momBtn.onclick=async()=>{
      if(!needConnection())return;
      if(!exists(MOM_R,MOM_C)){ log(`Key ${MOM_R},${MOM_C} is not on this board's layout — cannot bind.`,"err"); return; }
      const target=+layerSel.value, code=Keycodes.layerCode("MO",target);
      try{ await App.via.setKeycode(0,MOM_R,MOM_C,code); App.keymap[App.kmIndex(0,MOM_R,MOM_C)]=code;
        log(`Bound ${posLabel(MOM_R,MOM_C)} on layer 0 → ${Keycodes.decode(code).label} (hold for numpad, release for layer 0).`,"ok");
        App.emit("keymap-loaded");
      }catch(e){ log("Momentary bind failed: "+e.message,"err"); }
    };

    // ---- layer / OS-switch finder ----
    const isSwitch=(kc)=> (kc>=0x7E00&&kc<=0x7E0F) || Keycodes.decode(kc).cat==="Layers";
    const scan=()=>{
      const host=root.querySelector("#osScan");
      if(!App.keymap){ host.innerHTML='<span class="muted">Connect and load the keymap to scan.</span>'; return; }
      const hits=[];
      for(let l=0;l<App.layerCount;l++)for(let r=0;r<App.rows;r++)for(let c=0;c<App.cols;c++){
        const kc=App.getKC(l,r,c); if(isSwitch(kc)) hits.push({l,r,c,kc});
      }
      if(!hits.length){ host.innerHTML='<span class="muted">No layer/OS-switch keys are bound.</span>'; return; }
      const tbl=document.createElement("table");
      tbl.innerHTML='<tr><th>Layer</th><th>Key</th><th>Bound to</th><th></th></tr>';
      for(const h of hits){
        const tr=document.createElement("tr"); const d=Keycodes.decode(h.kc);
        const culprit=(h.r===4&&h.c===0);
        tr.innerHTML=`<td>${h.l}</td><td class="mono">${posLabel(h.r,h.c)}${culprit?' <span class="warn">← left of L-Ctrl</span>':''}</td>`+
          `<td class="mono">${escapeHtml(d.label)} <span class="muted">(${escapeHtml(d.name)})</span></td>`;
        const td=document.createElement("td"), b=document.createElement("button"); b.textContent="Rebind";
        b.onclick=()=>{ if(!needConnection())return;
          Picker.open(`${posLabel(h.r,h.c)} · layer ${h.l}`, async(code)=>{
            try{ await App.via.setKeycode(h.l,h.r,h.c,code); App.keymap[App.kmIndex(h.l,h.r,h.c)]=code;
              log(`Rebound ${posLabel(h.r,h.c)} L${h.l} → ${Keycodes.decode(code).label}`,"ok"); App.emit("keymap-loaded"); }
            catch(e){ log("Rebind failed: "+e.message,"err"); }
          }); };
        td.appendChild(b); tr.appendChild(td); tbl.appendChild(tr);
      }
      host.innerHTML=""; host.appendChild(tbl);
    };

    fillLayers(); updMom(); renderPreview(); scan();
    App.on("keymap-loaded",()=>{fillLayers();updMom();scan();});
    App.on("connect",()=>{fillLayers();updMom();renderPreview();scan();});
    App.on("disconnect",scan);
  }
});
