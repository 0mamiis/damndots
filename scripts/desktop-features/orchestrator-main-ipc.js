/* damndots-orchestrator-main-ipc-v1 */
try {
  const __dotsOrchElectron = require("electron");
  if (__dotsOrchElectron.ipcMain) {
    const S = globalThis.__dotsOrchState || (globalThis.__dotsOrchState = { modes: {}, pending: null, note: '', defaultNote: '', defaultMode: null, claims: {}, draftClaims: {}, windows: {}, viewScopes: {}, consumedAt: 0 });
    if (!S.draftClaims) S.draftClaims = {};
    if (!S.windows) S.windows = {};
    if (!S.viewScopes) S.viewScopes = {};
    const __dotsOrchFs = require("node:fs"), __dotsOrchPath = require("node:path"), __dotsOrchOs = require("node:os");
    const __dotsOrchDir = __dotsOrchPath.join(__dotsOrchOs.homedir(), ".codex", "dots-local-bridge");
    const __dotsOrchStateFile = __dotsOrchPath.join(__dotsOrchDir, "orchestrator-state.json");
    const __dotsOrchClaimsFile = __dotsOrchPath.join(__dotsOrchDir, "orchestrator-claims.json");
    __dotsOrchElectron.ipcMain.handle("damndots:orchestrator-sync", (event, st) => {
      const url = String((event.senderFrame && event.senderFrame.url) || (event.sender && event.sender.getURL && event.sender.getURL()) || "");
      if (!url.startsWith("app://-/")) return null;
      try {
        const ext = JSON.parse(__dotsOrchFs.readFileSync(__dotsOrchClaimsFile, "utf8"));
        if (ext && typeof ext === "object") {
          if (Number.isFinite(ext.consumedAt) && ext.consumedAt > S.consumedAt) S.consumedAt = ext.consumedAt;
          if (ext.claims && typeof ext.claims === "object") for (const k of Object.keys(ext.claims)) if (typeof ext.claims[k] === "string") S.claims[k] = ext.claims[k];
          if (ext.draftClaims && typeof ext.draftClaims === "object") for (const k of Object.keys(ext.draftClaims)) if (ext.draftClaims[k]) S.draftClaims[k] = true;
          try { __dotsOrchFs.unlinkSync(__dotsOrchClaimsFile); } catch {}
        }
      } catch {}
      if (st && typeof st === "object") {
        const modes = st.modes && typeof st.modes === "object" ? st.modes : {};
        for (const k of Object.keys(S.claims)) if (Object.prototype.hasOwnProperty.call(modes, k)) { delete S.claims[k]; delete S.draftClaims[k]; }
        const next = {};
        for (const k of Object.keys(modes)) if (typeof modes[k] === "string") next[k] = modes[k];
        S.modes = Object.assign(next, S.claims);
        const pe = st.pending;
        S.pending = pe && typeof pe === "object" && typeof pe.mode === "string" && Number.isFinite(pe.at) && pe.at > S.consumedAt ? { mode: pe.mode, at: pe.at } : null;
        S.note = typeof st.note === "string" ? st.note.slice(0, 4000) : "";
        S.defaultNote = typeof st.defaultNote === "string" ? st.defaultNote.slice(0, 4000) : "";
        S.disabled = Array.isArray(st.disabled) ? st.disabled.filter((m) => typeof m === "string").slice(0, 20) : null;
        S.defaultMode = typeof st.defaultMode === "string" ? st.defaultMode : null;
        const now = Date.now();
        const senderId = event && event.sender && event.sender.id != null ? String(event.sender.id) : "default";
        if (event && event.sender && typeof event.sender.once === "function" && !S.windows[senderId]) {
          try { event.sender.once("destroyed", () => { delete S.windows[senderId]; }); } catch {}
        }
        let winFocused = st.focused === true;
        try {
          const bw = __dotsOrchElectron.BrowserWindow && event && event.sender ? __dotsOrchElectron.BrowserWindow.fromWebContents(event.sender) : null;
          if (bw && typeof bw.isFocused === "function") winFocused = bw.isFocused();
        } catch {}
        const winScope = typeof st.scope === "string" ? st.scope.slice(0, 200) : null;
        const winScopeMode = typeof st.scopeMode === "string" ? st.scopeMode.slice(0, 40) : null;
        const winScopes = {};
        if (st.scopes && typeof st.scopes === "object") {
          for (const k of Object.keys(st.scopes).slice(0, 40)) if (typeof st.scopes[k] === "string") winScopes[k.slice(0, 200)] = st.scopes[k].slice(0, 40);
        }
        if (winScope && winScopeMode && !Object.prototype.hasOwnProperty.call(winScopes, winScope)) winScopes[winScope] = winScopeMode;
        S.windows[senderId] = { scope: winScope, scopeMode: winScopeMode, scopes: winScopes, focused: winFocused, at: now };
        const winKeys = Object.keys(S.windows);
        for (const wk of winKeys) if (winKeys.length > 1 && now - S.windows[wk].at > 30000) delete S.windows[wk];
        const mergedScopes = {};
        let chosen = null;
        for (const wk of Object.keys(S.windows)) {
          const w = S.windows[wk];
          if (w.scopes) Object.assign(mergedScopes, w.scopes);
          if (!chosen || (w.focused && !chosen.focused) || (w.focused === chosen.focused && w.at >= chosen.at)) chosen = w;
        }
        S.viewScopes = mergedScopes;
        S.scope = chosen ? chosen.scope : winScope;
        S.scopeMode = chosen ? chosen.scopeMode : winScopeMode;
        const nt = st.notes, notes = {};
        if (nt && typeof nt === "object") for (const k of Object.keys(nt).slice(0, 400)) if (typeof nt[k] === "string") notes[k.slice(0, 120)] = nt[k].slice(0, 4000);
        S.notes = notes;
        try {
          __dotsOrchFs.mkdirSync(__dotsOrchDir, { recursive: true });
          const tmp = __dotsOrchStateFile + ".tmp-" + process.pid;
          __dotsOrchFs.writeFileSync(tmp, JSON.stringify({ modes: S.modes, pending: S.pending, note: S.note, defaultNote: S.defaultNote, notes: S.notes, disabled: S.disabled, defaultMode: S.defaultMode, scope: S.scope, scopeMode: S.scopeMode, viewScopes: S.viewScopes, consumedAt: S.consumedAt }), { mode: 0o600 });
          __dotsOrchFs.renameSync(tmp, __dotsOrchStateFile);
        } catch {}
      }
      return { claims: S.claims, draftClaims: S.draftClaims, pendingConsumed: S.consumedAt };
    });
  }
} catch (error) {}

/* damndots-scroll-controls-main-v1 */
try {
  const __dotsEl = require("electron"), __dotsFs = require("node:fs"), __dotsPath = require("node:path"), __dotsOs = require("node:os");
  if (__dotsEl.ipcMain) {
    __dotsEl.ipcMain.handle("damndots:scroll-controls", (event) => {
      const url = String((event.senderFrame && event.senderFrame.url) || "");
      if (!url.startsWith("app://-/")) return null;
      const dir = __dotsPath.join(__dotsOs.homedir(), ".codex", "dots-local-bridge");
      // Same rules as scripts/scroll-controls-settings.cjs (older files stored a boolean per action).
      const KEYS = ["none", "shift", "ctrl", "alt", "ctrl+shift"], ZONES = ["any", "model", "thinking", "mode", "fast"];
      const DEFAULTS = { thinking: { on: true, key: "none", zone: "any" }, model: { on: true, key: "shift", zone: "any" }, mode: { on: true, key: "ctrl", zone: "any" }, fast: { on: true, key: "alt", zone: "any" } };
      const bind = (name, v) => {
        if (typeof v === "boolean") return Object.assign({}, DEFAULTS[name], { on: v });
        if (v && typeof v === "object" && typeof v.on === "boolean" && KEYS.includes(v.key) && ZONES.includes(v.zone)) return { on: v.on, key: v.key, zone: v.zone };
        throw new Error("invalid");
      };
      const norm = (s) => { if (!s || typeof s.enabled !== "boolean") throw new Error("invalid"); const o = { enabled: s.enabled }; for (const n of Object.keys(DEFAULTS)) o[n] = n in s ? bind(n, s[n]) : Object.assign({}, DEFAULTS[n]); return o; };
      let value = norm({ enabled: true });
      try { value = norm(JSON.parse(__dotsFs.readFileSync(__dotsPath.join(dir, "scroll-controls.json"), "utf8"))); } catch (e) {}
      try {
        __dotsFs.mkdirSync(dir, { recursive: true });
        const file = __dotsPath.join(dir, "scroll-controls-status.json"), tmp = file + ".tmp-" + process.pid;
        __dotsFs.writeFileSync(tmp, JSON.stringify({ pid: process.pid, preferences: value, updatedAt: new Date().toISOString() }), { mode: 0o600 });
        __dotsFs.renameSync(tmp, file);
      } catch (e) {}
      return value;
    });
  }
} catch (error) {}
