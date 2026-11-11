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
        S.defaultMode = typeof st.defaultMode === "string" ? st.defaultMode : null;
        const ac = st.active;
        S.active = ac && typeof ac === "object" && typeof ac.scope === "string" && typeof ac.mode === "string" ? { scope: ac.scope.slice(0, 120), mode: ac.mode.slice(0, 40), at: Date.now() } : null;
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
      const keys = ["enabled", "thinking", "model", "mode"];
      let value = { enabled: true, thinking: true, model: true, mode: true };
      try {
        const saved = JSON.parse(__dotsFs.readFileSync(__dotsPath.join(dir, "scroll-controls.json"), "utf8"));
        if (keys.every((k) => typeof saved[k] === "boolean")) value = { enabled: saved.enabled, thinking: saved.thinking, model: saved.model, mode: saved.mode };
      } catch (e) {}
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
