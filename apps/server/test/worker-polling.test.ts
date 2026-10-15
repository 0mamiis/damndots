import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../src/storage.js';
import { AuthService } from '../src/auth.js';
import { WorkerBroker } from '../src/workers.js';

function setup() {
  const store = new SqliteStore(':memory:'), auth = new AuthService(Buffer.alloc(32, 7), 'admin', store), broker = new WorkerBroker(store, auth, { onlineMs: 60000 });
  const add = (name: string) => broker.register({ token: auth.enroll('worker').token, name, platform: 'test', roots: ['/work'], capabilities: ['codex', 'browser', 'filesystem'] }).computerId;
  return { store, broker, add };
}

test('each computer receives only its own jobs, oldest first, and running work is not handed out twice', async () => {
  const { store, broker, add } = setup();
  try {
    const a = add('A'), b = add('B');
    const first = broker.queue(a, 'browser', { n: 1 }), second = broker.queue(a, 'browser', { n: 2 }), other = broker.queue(b, 'browser', { n: 3 });
    assert.equal(broker.next(a)?.id, first.id);
    assert.equal(broker.next(a)?.id, second.id);
    assert.equal(broker.next(a), undefined, 'both of A\'s jobs are running now');
    assert.equal(broker.next(b)?.id, other.id);
    assert.deepEqual(broker.active(a).sort(), [first.id, second.id].sort());
    broker.finish(a, first.id, { ok: true });
    assert.deepEqual(broker.active(a), [second.id]);
    assert.equal(broker.executingCodex(a), false);
  } finally { store.close(); }
});

test('a queued job lookup stays correct with thousands of finished jobs in the table', () => {
  const { store, broker, add } = setup();
  try {
    const a = add('A');
    for (let i = 0; i < 3000; i++) store.put('worker_jobs', { id: 'old' + i, computerId: a, kind: 'browser', status: 'completed', payload: { filler: 'x'.repeat(200) }, result: null, error: null, createdAt: '', updatedAt: '', leaseUntil: null });
    const wanted = broker.queue(a, 'browser', { n: 1 });
    const started = process.hrtime.bigint();
    for (let i = 0; i < 200; i++) { broker.heartbeat(a); if (i === 0) assert.equal(broker.next(a)?.id, wanted.id); else broker.next(a); }
    const millis = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(millis < 1500, '200 polls took ' + millis.toFixed(0) + ' ms');
  } finally { store.close(); }
});
