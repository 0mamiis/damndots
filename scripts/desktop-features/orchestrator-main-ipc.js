/* damndots-orchestrator-main-ipc-v1 */
try {
  const __dotsOrchElectron = require("electron");
  if (__dotsOrchElectron.ipcMain) {
    const S = globalThis.__dotsOrchState || (globalThis.__dotsOrchState = { modes: {}, pending: null, note: '', defaultMode: null, claims: {}, consumedAt: 0 });
    __dotsOrchElectron.ipcMain.handle("damndots:orchestrator-sync", (event, st) => {
      const url = String((event.senderFrame && event.senderFrame.url) || (event.sender && event.sender.getURL && event.sender.getURL()) || "");
      if (!url.startsWith("app://-/")) return null;
      if (st && typeof st === "object") {
        const modes = st.modes && typeof st.modes === "object" ? st.modes : {};
        for (const k of Object.keys(S.claims)) if (Object.prototype.hasOwnProperty.call(modes, k)) delete S.claims[k];
        const next = {};
        for (const k of Object.keys(modes)) if (typeof modes[k] === "string") next[k] = modes[k];
        S.modes = Object.assign(next, S.claims);
        const pe = st.pending;
        S.pending = pe && typeof pe === "object" && typeof pe.mode === "string" && Number.isFinite(pe.at) && pe.at > S.consumedAt ? { mode: pe.mode, at: pe.at } : null;
        S.note = typeof st.note === "string" ? st.note.slice(0, 4000) : "";
        S.disabled = Array.isArray(st.disabled) ? st.disabled.filter((m) => typeof m === "string").slice(0, 20) : null;
        S.defaultMode = typeof st.defaultMode === "string" ? st.defaultMode : null;
        S.scope = typeof st.scope === "string" ? st.scope.slice(0, 200) : null;
        S.scopeMode = typeof st.scopeMode === "string" ? st.scopeMode.slice(0, 40) : null;
        const nt = st.notes, notes = {};
        if (nt && typeof nt === "object") for (const k of Object.keys(nt).slice(0, 400)) if (typeof nt[k] === "string") notes[k.slice(0, 120)] = nt[k].slice(0, 4000);
        S.notes = notes;
      }
      return { claims: S.claims, pendingConsumed: S.consumedAt };
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
