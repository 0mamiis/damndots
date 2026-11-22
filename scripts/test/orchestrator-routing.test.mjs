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

