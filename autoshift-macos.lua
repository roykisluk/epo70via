-- ============================================================
--  Global Auto Shift for macOS  (Hammerspoon)
--  Companion to the Epomaker Split 70 config tool.
--
--  WHY THIS EXISTS, NOT AN HTML TOGGLE:
--  Auto Shift means "hold a key briefly -> get its shifted character".
--  That requires intercepting your keystrokes as you type into ANY app.
--  Your keyboard's firmware was built without QMK Auto Shift, and a
--  browser page only sees keys typed into the page itself — so neither
--  can do this. A small host-side interceptor (this script) can.
--
--  SETUP (one time):
--   1. Install Hammerspoon (free):  https://www.hammerspoon.org  (or `brew install --cask hammerspoon`)
--   2. Put this file at  ~/.hammerspoon/init.lua
--      (or, if you already have an init.lua, add:  dofile("/path/to/autoshift-macos.lua")  )
--   3. Launch Hammerspoon. Grant it Accessibility permission when prompted
--      (System Settings -> Privacy & Security -> Accessibility -> enable Hammerspoon).
--   4. Click the Hammerspoon menubar icon -> "Reload Config" if needed.
--
--  USE:
--   - Menubar shows  ⇧A (on)  or  ⇧a (off).  Click it to toggle, or press
--     the hotkey  ⌃⌥⌘S  (Control+Option+Command+S).
--   - With it ON: tap a key normally for lowercase; HOLD it past the
--     threshold for the shifted character (a->A, 1->!, ,-><, etc.).
--
--  TUNE: edit the three values in CONFIG below, then reload config.
-- ============================================================

-- ---------- CONFIG ----------
local THRESHOLD   = 0.165   -- seconds to hold before a key shifts (QMK default ~0.175)
local START_ON    = true    -- whether Auto Shift is enabled when the script loads
-- Which characters auto-shift. Default: letters + numbers + symbols (everything with a shifted form).
-- For "letters only" use: "abcdefghijklmnopqrstuvwxyz"
local SHIFT_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789-=[]\\;',./`"
-- ----------------------------

local eventtap = hs.eventtap
local etypes    = eventtap.event.types
local eprops    = eventtap.event.properties
local MAGIC      = 0xA570        -- tag so we ignore our own synthetic events

local enabled = START_ON
local pending = nil              -- { code=<int>, resolved=<bool>, timer=<hs.timer> }

-- Build the set of macOS keycodes we manage, from SHIFT_CHARS.
local targetCodes = {}
for ch in SHIFT_CHARS:gmatch(".") do
  local code = hs.keycodes.map[ch]
  if code then targetCodes[code] = true end
end

-- Emit a synthetic key tap (optionally shifted), tagged so our own tap ignores it.
local function emit(code, shift)
  local mods = shift and {"shift"} or {}
  local down = eventtap.event.newKeyEvent(mods, code, true)
  local up   = eventtap.event.newKeyEvent(mods, code, false)
  down:setProperty(eprops.eventSourceUserData, MAGIC)
  up:setProperty(eprops.eventSourceUserData, MAGIC)
  down:post()
  up:post()
end

-- Resolve any in-flight key as a normal (unshifted) tap, preserving typing order.
local function flushTap()
  if pending then
    if pending.timer then pending.timer:stop() end
    if not pending.resolved then emit(pending.code, false) end
    pending = nil
  end
end

local function clearPending()
  if pending and pending.timer then pending.timer:stop() end
  pending = nil
end

local tap = eventtap.new({ etypes.keyDown, etypes.keyUp }, function(e)
  if not enabled then return false end
  -- Ignore the synthetic events we post ourselves (prevents feedback loop).
  if e:getProperty(eprops.eventSourceUserData) == MAGIC then return false end

  local code  = e:getKeyCode()
  local etype = e:getType()
  local f     = e:getFlags()

  -- Real command-style modifier held -> it's a shortcut (⌘C, ⌃A, ⌥…): never auto-shift.
  if f.cmd or f.ctrl or f.alt or f.fn then
    flushTap()
    return false
  end

  if etype == etypes.keyDown then
    -- Not a managed key (space, enter, arrows, …): flush any pending tap, pass through.
    if not targetCodes[code] then
      flushTap()
      return false
    end
    -- User is holding Shift already -> manual capital, pass straight through.
    if f.shift then
      flushTap()
      return false
    end
    -- Swallow OS auto-repeat while a key is held (Auto Shift fires once, doesn't repeat).
    if e:getProperty(eprops.keyboardEventAutorepeat) == 1 then
      return true
    end
    -- A different managed key pressed while one is pending (fast rollover):
    -- commit the previous one as a normal tap first.
    if pending and pending.code ~= code then
      flushTap()
    end
    if not pending then
      pending = { code = code, resolved = false }
      pending.timer = hs.timer.doAfter(THRESHOLD, function()
        if pending and pending.code == code then
          pending.resolved = true
          emit(code, true)        -- held long enough -> shifted character
        end
      end)
    end
    return true                   -- swallow the original keyDown (we decide what to send)

  elseif etype == etypes.keyUp then
    if pending and pending.code == code then
      if pending.resolved then
        clearPending()            -- shifted char already sent on hold; just stop
      else
        if pending.timer then pending.timer:stop() end
        emit(code, false)         -- released before threshold -> normal lowercase tap
        pending = nil
      end
      return true                 -- swallow the original keyUp too
    end
    return false
  end
  return false
end)

-- ---------- menubar + hotkey ----------
local menu = hs.menubar.new()
local function refresh()
  if not menu then return end
  menu:setTitle(enabled and "⇧A" or "⇧a")
  menu:setTooltip("Auto Shift: " .. (enabled and "ON" or "OFF"))
end
local function setEnabled(v)
  enabled = v
  if not enabled then clearPending() end
  refresh()
end
if menu then
  menu:setMenu(function()
    return {
      { title = (enabled and "✓ " or "  ") .. "Auto Shift ON",  fn = function() setEnabled(true)  end },
      { title = (not enabled and "✓ " or "  ") .. "Auto Shift OFF", fn = function() setEnabled(false) end },
      { title = "-" },
      { title = "Hold threshold: " .. math.floor(THRESHOLD * 1000) .. " ms", disabled = true },
      { title = "Toggle hotkey: ⌃⌥⌘S", disabled = true },
      { title = "-" },
      { title = "Reload config", fn = function() hs.reload() end },
    }
  end)
  refresh()
end

hs.hotkey.bind({ "ctrl", "alt", "cmd" }, "s", function() setEnabled(not enabled) end)

tap:start()
hs.alert.show("Auto Shift loaded — " .. (enabled and "ON" or "OFF"))
