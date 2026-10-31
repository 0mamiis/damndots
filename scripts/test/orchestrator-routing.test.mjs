import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
