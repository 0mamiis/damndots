import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../desktop-features/orchestrator-ui.js', import.meta.url), 'utf8');
const start = source.indexOf('var CODEX_ORCH_KEY=');
const end = source.indexOf('function codexOrchestratorClose()', start);
const routing = source.slice(start, end);
if (start < 0 || end < 0) throw new Error('Orchestrator routing boundary missing');

function fixture(defaultMode = 'off') {
  const store = new Map();
  const events = [];
  const window = {__damndotsOrchestratorDefaults: {mode: defaultMode}, dispatchEvent: event => events.push(event.type)};
  const context = vm.createContext({window, localStorage: {getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key)}, Event: class { constructor(type) { this.type = type; } }, Date, JSON, Number, Object, String});
  context.codexOrchestratorModelNote = () => '';
  context.codexOrchL = text => text;
  vm.runInContext(routing, context);
  return {context, store, events, index: id => context.CODEX_ORCH_MODES.findIndex(mode => mode[0] === id)};
}

function turn(threadId, trigger = 'composer') {
  return {threadId, turnTrigger: trigger, input: [{type: 'text', text: 'test'}], additionalContext: {keep: {kind: 'application', value: 'yes'}}};
}

test('new-chat selection binds to the real thread and explicit Off survives defaults', () => {
  const {context, index} = fixture('off');
  context.codexOrchestratorSet(index('lead'), 'draft:client-new');
  assert.equal(context.codexOrchestratorMode('draft:client-new'), 'lead');
  context.codexOrchestratorBind('client-new', 'thread-new');
  assert.equal(context.codexOrchestratorMode('thread-new'), 'lead');
  assert.equal(context.codexOrchestratorMode('draft:client-new'), null);
  context.codexOrchestratorSet(index('off'), 'thread-new');
  assert.equal(context.codexOrchestratorMode('thread-new'), null, 'explicit Off fell back to the default mode');
});

test('selection made before a scope exists is claimed by the first real turn', () => {
  const {context, index} = fixture('off');
  context.codexOrchestratorSet(index('lead'), null);
  const out = context.codexOrchestratorTurn(turn('thread-created-from-draft'), null, 'medium');
  assert.match(out.additionalContext.codex_orchestrator.value, /^\[ORKESTRATÖR MODU: LEAD/);
  assert.equal(context.codexOrchestratorMode('thread-created-from-draft'), 'lead');
});

test('goal continuation turns receive the thread mode instead of silently reverting to default', () => {
  const {context, index} = fixture('off');
  context.codexOrchestratorSet(index('lead'), 'thread-goal');
  const out = context.codexOrchestratorTurn(turn('thread-goal', 'goal'), null, 'medium');
  assert.match(out.additionalContext.codex_orchestrator.value, /^\[ORKESTRATÖR MODU: LEAD/);
  assert.deepEqual(out.additionalContext.keep, {kind: 'application', value: 'yes'});
});

test('unconfigured chats use the configured default while tool-output turns remain untouched', () => {
  const {context} = fixture('subagents');
  const normal = context.codexOrchestratorTurn(turn('thread-default'), null, 'medium');
  assert.match(normal.additionalContext.codex_orchestrator.value, /^\[ORKESTRATÖR MODU: ALT AJANLAR/);
  const tool = {...turn('thread-default'), toolOutput: {text: 'x'}};
  assert.equal(context.codexOrchestratorTurn(tool, null, 'medium'), tool);
});


const mainSource = fs.readFileSync(new URL('../desktop-features/orchestrator-main.js', import.meta.url), 'utf8');
function mainFixture(state) {
  const S = {modes: {}, pending: null, note: '', defaultMode: 'off', claims: {}, consumedAt: 0, ...state};
  const context = vm.createContext({globalThis: {__dotsOrchState: S}, CODEX_ORCH_TEXT: {lead: '[ORKESTRATÖR MODU: LEAD', swarm: '[ORKESTRATÖR MODU: SWARM'}, CODEX_ORCH_OFF: '[ORCHESTRATOR OFF', CODEX_ORCH_OFF_ULTRA: '[ORCHESTRATOR OFF + ULTRA', Date, Object, Array, Number, String, Math});
  vm.runInContext(mainSource, context);
  return {S, run: (id, trigger) => context.codexOrchestratorTurn(turn(id, trigger), null, 'medium').additionalContext.codex_orchestrator.value};
}

test('an existing chat shown as Off stays Off although an older new-chat pick was Swarm', () => {
  const {S, run} = mainFixture({modes: {'draft:new': 'swarm'}, pending: {mode: 'swarm', at: Date.now() - 600000}, scope: 'old-chat', scopeMode: 'off'});
  assert.match(run('old-chat'), /^\[ORCHESTRATOR OFF/);
  assert.equal(S.claims['old-chat'], 'off');
  assert.ok(S.pending, 'a draft pick must stay with the new-chat composer');
  const other = mainFixture({modes: {'draft:new': 'swarm'}, pending: {mode: 'swarm', at: Date.now()}, scope: 'draft:new', scopeMode: 'swarm'});
  assert.match(other.run('background-chat', 'goal'), /^\[ORCHESTRATOR OFF/);
});

test('a chat sent from the new-chat composer starts with the mode shown there and follows later changes in that view', () => {
  const pendingAt = Date.now();
  const {S, run} = mainFixture({modes: {'draft:new': 'swarm'}, pending: {mode: 'swarm', at: pendingAt}, scope: 'draft:new', scopeMode: 'swarm'});
  assert.match(run('fresh-chat'), /^\[ORKESTRATÖR MODU: SWARM/);
  assert.equal(S.claims['fresh-chat'], 'swarm');
  assert.equal(S.consumedAt, pendingAt);
  S.scopeMode = 'lead';
  assert.match(run('fresh-chat'), /^\[ORKESTRATÖR MODU: LEAD/);
  S.scope = 'fresh-chat'; S.scopeMode = 'off'; S.modes['fresh-chat'] = 'off';
  assert.match(run('fresh-chat'), /^\[ORCHESTRATOR OFF/);
});

test('a saved chat mode is used and a dashboard-disabled mode counts as Off', () => {
  const {run, S} = mainFixture({modes: {'saved-chat': 'lead'}, scope: 'saved-chat', scopeMode: 'lead'});
  assert.match(run('saved-chat'), /^\[ORKESTRATÖR MODU: LEAD/);
  S.disabled = ['lead'];
  assert.match(run('saved-chat'), /^\[ORCHESTRATOR OFF/);
});

test('edit_user_message turns receive the active orchestrator mode', () => {
  const {run} = mainFixture({modes: {'edit-chat': 'swarm'}, scope: 'edit-chat', scopeMode: 'swarm'});
  assert.match(run('edit-chat', 'edit_user_message'), /^\[ORKESTRATÖR MODU: SWARM/);
});

test('utility-process cached claims do not overwrite a later UI switch to Swarm', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'damndots-orch-test-'));
  const bridgeDir = path.join(tmpHome, '.codex', 'dots-local-bridge');
  fs.mkdirSync(bridgeDir, {recursive: true});
  const stateFile = path.join(bridgeDir, 'orchestrator-state.json');
  const claimsFile = path.join(bridgeDir, 'orchestrator-claims.json');
  try {
    const fakeRequire = id => {
      if (id === 'node:fs') return fs;
      if (id === 'node:os') return {homedir: () => tmpHome};
      if (id === 'node:path') return path;
      throw new Error('unexpected require ' + id);
    };
    const context = vm.createContext({globalThis: {}, require: fakeRequire, process: {pid: 12345}, CODEX_ORCH_TEXT: {lead: '[ORKESTRATÖR MODU: LEAD', swarm: '[ORKESTRATÖR MODU: SWARM'}, CODEX_ORCH_OFF: '[ORCHESTRATOR OFF', CODEX_ORCH_OFF_ULTRA: '[ORCHESTRATOR OFF + ULTRA', Date, Object, Array, Number, String, Math, JSON});
    vm.runInContext(mainSource, context);
    // Turn 1: new chat starts as Off and gets cached in __dotsOrchUtilityState.claims.
    fs.writeFileSync(stateFile, JSON.stringify({modes: {'draft:new': 'off'}, scope: 'draft:new', scopeMode: 'off', defaultMode: 'off', consumedAt: 0}));
    const t1 = context.codexOrchestratorTurn(turn('chat-1'), null, 'medium');
    assert.match(t1.additionalContext.codex_orchestrator.value, /^\[ORCHESTRATOR OFF/);
    assert.equal(fs.existsSync(claimsFile), true);
    // Main process consumes claims and user switches chat-1 to Swarm in the UI.
    fs.unlinkSync(claimsFile);
    fs.writeFileSync(stateFile, JSON.stringify({modes: {'chat-1': 'swarm'}, scope: 'chat-1', scopeMode: 'swarm', defaultMode: 'off', consumedAt: 0}));
    const t2 = context.codexOrchestratorTurn(turn('chat-1'), null, 'medium');
    assert.match(t2.additionalContext.codex_orchestrator.value, /^\[ORKESTRATÖR MODU: SWARM/);
    assert.equal(fs.existsSync(claimsFile), false, 'must not rewrite stale claims when no claim occurred');
  } finally {
    fs.rmSync(tmpHome, {recursive: true, force: true});
  }
});

test('codexOrchestratorInject injects developer item for goals/queues and skips durable threads', async () => {
  const S = {modes: {'goal-chat': 'swarm'}, pending: null, note: '', defaultMode: 'off', claims: {}, consumedAt: 0, scope: 'goal-chat', scopeMode: 'swarm'};
  const context = vm.createContext({globalThis: {__dotsOrchState: S}, CODEX_ORCH_TEXT: {swarm: '[ORKESTRATÖR MODU: SWARM'}, CODEX_ORCH_OFF: '[ORCHESTRATOR OFF', CODEX_ORCH_OFF_ULTRA: '[ORCHESTRATOR OFF + ULTRA', Date, Object, Array, Number, String, Math});
  vm.runInContext(mainSource, context);
  const sent = [];
  const client = {
    getConversation: id => ({mode: id === 'durable-chat' ? 'durable' : 'local', latestReasoningEffort: 'high'}),
    sendRequest: async (method, params) => { sent.push({method, params}); return {}; }
  };
  await context.codexOrchestratorInject(client, 'goal-chat', 'goal');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'thread/inject_items');
  assert.equal(sent[0].params.threadId, 'goal-chat');
  assert.equal(sent[0].params.items[0].role, 'developer');
  assert.match(sent[0].params.items[0].content[0].text, /^<codex_orchestrator>\[ORKESTRATÖR MODU: SWARM[\s\S]*<\/codex_orchestrator>$/);
  await context.codexOrchestratorInject(client, 'durable-chat', 'goal');
  assert.equal(sent.length, 1, 'durable conversations must not be injected');
});

test('queue turnTrigger receives active orchestrator mode and does not steal draft selection', () => {
  const {S, run} = mainFixture({modes: {'draft:new': 'swarm', 'queued-chat': 'lead'}, pending: {mode: 'swarm', at: Date.now()}, scope: 'draft:new', scopeMode: 'swarm'});
  assert.match(run('queued-chat', 'queue'), /^\[ORKESTRATÖR MODU: LEAD/);
  assert.match(run('other-queued', 'queue'), /^\[ORCHESTRATOR OFF/);
  assert.ok(S.pending, 'queue turns must not consume the draft pending selection');
});

test('viewScopes isolates a secondary open composer from draftView and applies its own mode', () => {
  const {S, run} = mainFixture({
    modes: {'draft:new': 'swarm'},
    pending: {mode: 'swarm', at: Date.now()},
    scope: 'draft:new',
    scopeMode: 'swarm',
    viewScopes: {'draft:new': 'swarm', 'side-chat': 'lead'}
  });
  assert.match(run('side-chat'), /^\[ORKESTRATÖR MODU: LEAD/);
  assert.equal(S.claims['side-chat'], 'lead');
  assert.ok(!S.draftClaims || !S.draftClaims['side-chat'], 'secondary open composer must not be marked as a draft claim');
  assert.ok(S.pending, 'secondary open composer must not consume draft pending');
});

test('draftClaims preserves draft subagent note on turn 2 until renderer sync copies it', () => {
  const {S, run} = mainFixture({
    modes: {'draft:new': 'swarm'},
    scope: 'draft:new',
    scopeMode: 'swarm',
    notes: {'draft:new': '\n\n[ALT AJAN MODELİ — DRAFT]'},
    defaultNote: ''
  });
  const t1 = run('new-chat-1');
  assert.match(t1, /^\[ORKESTRATÖR MODU: SWARM/);
  assert.match(t1, /\[ALT AJAN MODELİ — DRAFT\]/);
  assert.equal(S.draftClaims['new-chat-1'], true);
  // Turn 2 arrives (e.g. steer/follow-up) after scope moved, before renderer copied submodel into notes['new-chat-1'].
  S.scope = 'new-chat-1';
  S.scopeMode = 'swarm';
  const t2 = run('new-chat-1', 'composer', {expectedTurnId: 'turn-1'});
  assert.match(t2, /\[ALT AJAN MODELİ — DRAFT\]/);
});

test('codexScopeFromConvId normalizes prefixes and draft ids; model list uses __codexPickerModels and dashboard defaults', () => {
  const subEnd = source.indexOf('function codexOrchestratorCls(');
  assert.ok(subEnd > 0, 'submodel helper boundary missing');
  const subSrc = source.slice(0, subEnd);
  const store = new Map();
  const localStorage = {
    getItem: k => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: k => { store.delete(String(k)); }
  };
  const win = {
    __damndotsOrchestratorDefaults: {model: 'gpt-5.4-mini', effort: 'high', fast: true},
    __codexPickerModels: {
      sub: {
        models: [
          {model: 'gpt-5.4-mini', supportedReasoningEfforts: [{reasoningEffort: 'low'}, {reasoningEffort: 'high'}], serviceTiers: [{id: 'priority', name: 'Fast'}]},
          {model: 'gpt-no-fast', supportedReasoningEfforts: [{reasoningEffort: 'medium'}], serviceTiers: []}
        ]
      }
    },
    dispatchEvent() {}
  };
  const ctx = vm.createContext({window: win, localStorage, navigator: {language: 'en-US'}, Event: class Event { constructor(t) { this.type = t; } }, codexOrchestratorComposerScope: () => 'chat-a', Object, Array, JSON, String, Number, Math});
  vm.runInContext(subSrc, ctx);
  assert.equal(ctx.codexScopeFromConvId('codex:thread:abc-123'), 'abc-123');
  assert.equal(ctx.codexScopeFromConvId('local:abc-123'), 'abc-123');
  assert.equal(ctx.codexScopeFromConvId('client-new-thread:99'), 'draft:new');
  assert.equal(ctx.codexScopeFromConvId('home'), 'draft:new');
  assert.equal(ctx.codexScopeFromConvId(null), 'draft:new');

  // Dashboard default applies with Fast when supported by model list from __codexPickerModels.
  const defNote = ctx.codexOrchestratorModelNote('chat-a');
  assert.match(defNote, /model="gpt-5\.4-mini"/);
  assert.match(defNote, /reasoning_effort="high"/);
  assert.match(defNote, /ALT AJAN FAST/);

  // Unsupported fast and effort are stripped using __codexPickerModels metadata.
  store.set('codex-orchestrator-subagent-model-v2:chat-b', JSON.stringify({model: 'gpt-no-fast', effort: 'ultra', fast: true}));
  const noFastNote = ctx.codexOrchestratorModelNote('chat-b');
  assert.match(noFastNote, /model="gpt-no-fast"/);
  assert.match(noFastNote, /omit reasoning_effort/);
  assert.doesNotMatch(noFastNote, /ALT AJAN FAST/);

  // Explicit clear overrides dashboard default.
  win.__codexSubScopeOverride = 'chat-c';
  ctx.codexOrchestratorSubmodelSet(null);
  win.__codexSubScopeOverride = null;
  assert.equal(ctx.codexOrchestratorModelNote('chat-c'), '');
});

test('orchestrator-main-ipc merges multi-window viewScopes and prefers focused window for scope', () => {
  const ipcSource = fs.readFileSync(new URL('../desktop-features/orchestrator-main-ipc.js', import.meta.url), 'utf8');
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'damndots-orch-ipc-'));
  try {
    const handlers = new Map();
    const fakeRequire = id => {
      if (id === 'electron') return {
        ipcMain: {handle: (ch, fn) => handlers.set(ch, fn)},
        BrowserWindow: {fromWebContents: sender => ({isFocused: () => !!sender._focused})}
      };
      if (id === 'node:fs') return fs;
      if (id === 'node:os') return {homedir: () => tmpHome};
      if (id === 'node:path') return path;
      throw new Error('unexpected require ' + id);
    };
    const g = {};
    const ctx = vm.createContext({globalThis: g, require: fakeRequire, process: {pid: 4321}, Date, Object, Array, Number, String, JSON});
    vm.runInContext(ipcSource, ctx);
    const sync = handlers.get('damndots:orchestrator-sync');
    assert.equal(typeof sync, 'function');

    const ev1 = {senderFrame: {url: 'app://-/index.html'}, sender: {id: 1, _focused: true, once() {}}};
    const ev2 = {senderFrame: {url: 'app://-/index.html'}, sender: {id: 2, _focused: false, once() {}}};
    sync(ev1, {modes: {'chat-1': 'swarm'}, scope: 'chat-1', scopeMode: 'swarm', scopes: {'chat-1': 'swarm'}, focused: true, notes: {'chat-1': 'N1'}});
    sync(ev2, {modes: {'chat-1': 'swarm', 'chat-2': 'lead'}, scope: 'draft:new', scopeMode: 'off', scopes: {'draft:new': 'off', 'chat-2': 'lead'}, focused: false, notes: {'chat-2': 'N2'}});

    assert.equal(g.__dotsOrchState.scope, 'chat-1', 'focused window must remain the primary scope');
    assert.equal(g.__dotsOrchState.scopeMode, 'swarm');
    assert.equal(g.__dotsOrchState.viewScopes['chat-1'], 'swarm');
    assert.equal(g.__dotsOrchState.viewScopes['chat-2'], 'lead');
    assert.equal(g.__dotsOrchState.viewScopes['draft:new'], 'off');
  } finally {
    fs.rmSync(tmpHome, {recursive: true, force: true});
  }
});

