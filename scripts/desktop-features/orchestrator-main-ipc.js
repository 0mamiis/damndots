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
      }
      return { claims: S.claims, pendingConsumed: S.consumedAt };
    });
  }
} catch (error) {}
