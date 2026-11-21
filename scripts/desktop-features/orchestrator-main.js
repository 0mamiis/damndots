/* damndots-orchestrator-main-v1 */
// Codex 26.1029+ builds user turns in the Electron main process. The renderer pushes the selected orchestrator mode,
// the composer that is on screen and the mode it shows (see codexOrchestratorSync); this function adds them to every turn.
// Rule: a turn uses the mode the user sees in the composer. A chat without a saved mode takes the new-chat (draft)
// selection only when it was sent from the new-chat composer; any other chat falls back to the configured default.
function codexOrchestratorTurn(p, aeon, fallbackEffort) {
  try {
    if (!p || aeon != null || p.toolOutput != null || !p.input || !p.input.length) return p;
    if (p.turnTrigger != null && p.turnTrigger !== 'composer' && p.turnTrigger !== 'goal') return p;
    var S = globalThis.__dotsOrchState;
    var externalState = false;
    if (!S && typeof require === 'function') {
      try {
        var __fs = require('node:fs'), __path = require('node:path'), __os = require('node:os');
        var __dir = __path.join(__os.homedir(), '.codex', 'dots-local-bridge');
        var __raw = JSON.parse(__fs.readFileSync(__path.join(__dir, 'orchestrator-state.json'), 'utf8'));
        if (__raw && typeof __raw === 'object') {
          var __cache = globalThis.__dotsOrchUtilityState || (globalThis.__dotsOrchUtilityState = { fresh: {}, claims: {}, consumedAt: 0 });
          S = { modes: Object.assign({}, __raw.modes || {}, __cache.claims), pending: __raw.pending || null, note: __raw.note || '', notes: __raw.notes || null, disabled: __raw.disabled || null, defaultMode: __raw.defaultMode || null, scope: __raw.scope || null, scopeMode: __raw.scopeMode || null, fresh: __cache.fresh, claims: __cache.claims, consumedAt: Math.max(__cache.consumedAt || 0, __raw.consumedAt || 0) };
          if (S.pending && Number.isFinite(S.pending.at) && S.pending.at <= S.consumedAt) S.pending = null;
          externalState = true;
        }
      } catch (e) {}
    }
    if (!S || p.threadId == null) return p;
    var has = function (o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); };
    var valid = function (m) { return typeof m === 'string' && (m === 'off' || has(CODEX_ORCH_TEXT, m)); };
    var scopeId = String(p.threadId), mode = null;
    var fresh = S.fresh || (S.fresh = {});
    var view = typeof S.scope === 'string' ? S.scope : null;
    var draftView = p.turnTrigger !== 'goal' && !!view && view.indexOf('draft:') === 0;
    var known = has(S.modes, scopeId);
    if (draftView && (!known || fresh[scopeId])) {
      // Sent from the new-chat composer: the chat starts with the mode shown there (a later change in that same view wins).
      var pe = S.pending;
      mode = valid(S.scopeMode) ? S.scopeMode : pe && valid(pe.mode) ? pe.mode : valid(S.modes['draft:new']) ? S.modes['draft:new'] : S.defaultMode;
      fresh[scopeId] = true;
      if (pe && Number.isFinite(pe.at)) { S.consumedAt = Math.max(S.consumedAt || 0, pe.at); S.pending = null; }
    } else if (known) mode = S.modes[scopeId];
    else mode = view === scopeId && valid(S.scopeMode) ? S.scopeMode : S.defaultMode;
    if (!valid(mode)) mode = 'off';
    if (!known || (draftView && fresh[scopeId])) { S.modes[scopeId] = mode; S.claims[scopeId] = mode; } // the picker adopts exactly what was used
    if (externalState) {
      try {
        var __fs2 = require('node:fs'), __path2 = require('node:path'), __os2 = require('node:os');
        var __dir2 = __path2.join(__os2.homedir(), '.codex', 'dots-local-bridge');
        var __cf = __path2.join(__dir2, 'orchestrator-claims.json'), __tmp = __cf + '.tmp-' + process.pid;
        if (globalThis.__dotsOrchUtilityState) globalThis.__dotsOrchUtilityState.consumedAt = S.consumedAt || 0;
        __fs2.writeFileSync(__tmp, JSON.stringify({ claims: S.claims, consumedAt: S.consumedAt || 0 }), { mode: 0o600 });
        __fs2.renameSync(__tmp, __cf);
      } catch (e) {}
    }
    if (mode === 'off' || (Array.isArray(S.disabled) && S.disabled.indexOf(mode) >= 0)) mode = null; // switched off in the Damndots dashboard
    // The subagent model note is stored per chat; a fresh chat sent from the new-chat composer uses the draft selection, like the mode.
    var notes = S.notes || null;
    var note = notes ? (has(notes, scopeId) ? notes[scopeId] : (draftView ? (notes['draft:new'] || '') : '')) : (S.note || '');
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
