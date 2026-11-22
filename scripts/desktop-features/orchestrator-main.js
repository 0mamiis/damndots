/* damndots-orchestrator-main-v2 */
// Codex 26.1029+ builds user turns in the Electron main process. The renderer pushes the selected orchestrator mode,
// the composer that is on screen and the mode it shows (see codexOrchestratorSync); this function adds them to every turn.
// Rule: a turn uses the mode the user sees in the composer. A chat without a saved mode takes the new-chat (draft)
// selection only when it was sent from the new-chat composer; any other chat falls back to the configured default.
function codexOrchestratorTurn(p, aeon, fallbackEffort) {
  try {
    if (!p || aeon != null || p.toolOutput != null || !p.input || !p.input.length) return p;
    if (p.turnTrigger != null && p.turnTrigger !== 'composer' && p.turnTrigger !== 'goal' && p.turnTrigger !== 'edit_user_message') return p;
    var S = globalThis.__dotsOrchState;
    var externalState = false;
    var claimsFile = null;
    if (!S && typeof require === 'function') {
      try {
        var __fs = require('node:fs'), __path = require('node:path'), __os = require('node:os');
        var __dir = __path.join(__os.homedir(), '.codex', 'dots-local-bridge');
        claimsFile = __path.join(__dir, 'orchestrator-claims.json');
        var __raw = JSON.parse(__fs.readFileSync(__path.join(__dir, 'orchestrator-state.json'), 'utf8'));
        if (__raw && typeof __raw === 'object') {
          var __cache = globalThis.__dotsOrchUtilityState || (globalThis.__dotsOrchUtilityState = { fresh: {}, claims: {}, consumedAt: 0 });
          var rawModes = __raw.modes && typeof __raw.modes === 'object' ? __raw.modes : {};
          for (var ck in __cache.claims) {
            if (Object.prototype.hasOwnProperty.call(__cache.claims, ck) && Object.prototype.hasOwnProperty.call(rawModes, ck)) {
              delete __cache.claims[ck];
            }
          }
          S = { modes: Object.assign({}, rawModes, __cache.claims), pending: __raw.pending || null, note: __raw.note || '', notes: __raw.notes || null, disabled: __raw.disabled || null, defaultMode: __raw.defaultMode || null, scope: __raw.scope || null, scopeMode: __raw.scopeMode || null, fresh: __cache.fresh, claims: __cache.claims, consumedAt: Math.max(__cache.consumedAt || 0, __raw.consumedAt || 0) };
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
    var draftView = p.turnTrigger !== 'goal' && p.turnTrigger !== 'edit_user_message' && !!view && view.indexOf('draft:') === 0;
    var known = has(S.modes, scopeId);
    var claimed = false;
    if (draftView && (!known || fresh[scopeId])) {
      // Sent from the new-chat composer: the chat starts with the mode shown there (a later change in that same view wins).
      var pe = S.pending;
      mode = valid(S.scopeMode) ? S.scopeMode : pe && valid(pe.mode) ? pe.mode : valid(S.modes['draft:new']) ? S.modes['draft:new'] : S.defaultMode;
      fresh[scopeId] = true;
      if (pe && Number.isFinite(pe.at)) { S.consumedAt = Math.max(S.consumedAt || 0, pe.at); S.pending = null; claimed = true; }
    } else {
      if (!draftView && fresh[scopeId]) delete fresh[scopeId];
      if (known) mode = S.modes[scopeId];
      else mode = view === scopeId && valid(S.scopeMode) ? S.scopeMode : S.defaultMode;
    }
    if (!valid(mode)) mode = 'off';
    if (!known || (draftView && fresh[scopeId])) { S.modes[scopeId] = mode; S.claims[scopeId] = mode; claimed = true; } // the picker adopts exactly what was used
    if (externalState && claimed && claimsFile) {
      try {
        var __fs2 = require('node:fs'), __tmp = claimsFile + '.tmp-' + process.pid;
        if (globalThis.__dotsOrchUtilityState) globalThis.__dotsOrchUtilityState.consumedAt = S.consumedAt || 0;
        __fs2.writeFileSync(__tmp, JSON.stringify({ claims: S.claims, consumedAt: S.consumedAt || 0 }), { mode: 0o600 });
        __fs2.renameSync(__tmp, claimsFile);
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

// Goal starts/resumes and queued follow-ups trigger turns inside codex.exe without sending turn/start from Electron.
// Inject the current chat's orchestrator instruction as a developer item right before those RPCs so the latest mode applies.
async function codexOrchestratorInject(client, threadId, trigger, fallbackEffort) {
  try {
    if (!client || typeof client.sendRequest !== 'function' || threadId == null) return;
    var conv = typeof client.getConversation === 'function' ? client.getConversation(threadId) : null;
    if (conv && conv.mode === 'durable') return;
    var effort = fallbackEffort != null ? fallbackEffort : conv && conv.latestReasoningEffort;
    var built = codexOrchestratorTurn({ threadId: threadId, turnTrigger: trigger || 'goal', input: [{ type: 'text', text: '' }] }, null, effort);
    var val = built && built.additionalContext && built.additionalContext.codex_orchestrator && built.additionalContext.codex_orchestrator.value;
    if (!val) return;
    await client.sendRequest('thread/inject_items', {
      threadId: threadId,
      items: [{ type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<codex_orchestrator>' + val + '</codex_orchestrator>' }] }]
    });
  } catch (error) {}
}
