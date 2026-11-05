/* damndots-orchestrator-main-v1 */
// Codex 26.1029+ builds user turns in the Electron main process. The renderer pushes the selected orchestrator mode and
// subagent note here (see codexOrchestratorSync); this function adds them to every turn that starts in a chat.
function codexOrchestratorTurn(p, aeon, fallbackEffort) {
  try {
    if (!p || aeon != null || p.toolOutput != null || !p.input || !p.input.length) return p;
    if (p.turnTrigger != null && p.turnTrigger !== 'composer' && p.turnTrigger !== 'goal') return p;
    var S = globalThis.__dotsOrchState;
    if (!S || p.threadId == null) return p;
    var scopeId = String(p.threadId), mode = null;
    var times = S.claimTimes || (S.claimTimes = {}), pe = S.pending;
    var pendingOk = pe && Number.isFinite(pe.at) && Date.now() - pe.at <= 3600000 && (pe.mode === 'off' || Object.prototype.hasOwnProperty.call(CODEX_ORCH_TEXT, pe.mode));
    var known = Object.prototype.hasOwnProperty.call(S.modes, scopeId);
    // A draft selection is claimed by the first chat that uses it; a later change made in that same fresh chat view overrides the claim.
    if (pendingOk && (!known || (times[scopeId] && pe.at > times[scopeId]))) {
      mode = pe.mode; S.modes[scopeId] = mode; S.claims[scopeId] = mode; times[scopeId] = pe.at; S.consumedAt = pe.at; S.pending = null;
    } else if (known) mode = S.modes[scopeId];
    else mode = S.defaultMode || null;
    if (!mode || !Object.prototype.hasOwnProperty.call(CODEX_ORCH_TEXT, mode)) mode = null;
    var note = S.note || '';
    var context = Object.assign({}, p.additionalContext);
    var cmEffort = p.collaborationMode && p.collaborationMode.settings ? p.collaborationMode.settings.reasoning_effort : null;
    var effort = cmEffort != null ? cmEffort : p.effort != null ? p.effort : fallbackEffort;
    context.codex_orchestrator = { kind: 'application', value: mode ? CODEX_ORCH_TEXT[mode] + note : effort === 'ultra' ? CODEX_ORCH_OFF_ULTRA + note : CODEX_ORCH_OFF };
    var result = Object.assign({}, p, { additionalContext: context });
    var cm = p.collaborationMode;
    if (cm && cm.settings && /^\[ORKESTRATÖR MODU:/.test(cm.settings.developer_instructions || '')) {
      result.collaborationMode = Object.assign({}, cm, { settings: Object.assign({}, cm.settings, { developer_instructions: null }) });
    }
    return result;
  } catch (error) { return p; }
}
