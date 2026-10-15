import test from 'node:test';
import assert from 'node:assert/strict';
import type { RecordStore } from '@dots/contracts';
import { SqliteStore, query } from '../src/storage.js';
import { applyRetention, RETENTION } from '../src/retention.js';

const put = (s: SqliteStore, ns: string, id: string, extra: Record<string, unknown> = {}) => s.put(ns, { id, ...extra });
const sleep = (ms = 2) => new Promise(r => setTimeout(r, ms));

test('filters, limits and newest-first reads keep a stable chronological order', async () => {
  const s = new SqliteStore(':memory:');
  for (let i = 1; i <= 6; i++) { put(s, 'activity', 'a' + i, { taskId: i % 2 ? 'odd' : 'even', dotId: 'd', n: i, flag: i > 4 }); await sleep(); }
  assert.deepEqual(s.list<any>('activity', { where: { taskId: 'odd' } }).map(r => r.n), [1, 3, 5]);
  assert.deepEqual(s.list<any>('activity', { where: { taskId: 'odd' }, limit: 2, newest: true }).map(r => r.n), [3, 5]);
  assert.deepEqual(s.list<any>('activity', { limit: 2 }).map(r => r.n), [1, 2]);
  assert.deepEqual(s.list<any>('activity', { where: { flag: true } }).map(r => r.n), [5, 6]);
  assert.equal(s.list('activity', { where: { taskId: "x' OR '1'='1" } }).length, 0);
  assert.throws(() => s.list('activity', { where: { "taskId') OR 1=1 --": 'x' } }), /Invalid record field/);
  assert.equal(s.list('activity').length, 6);
  s.close();
});

test('large tables are searched through expression indexes, not by parsing every row', () => {
  const s = new SqliteStore(':memory:');
  const plan = (sql: string, ...args: string[]) => (s.db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...args) as { detail: string }[]).map(r => r.detail).join(' | ');
  assert.match(plan("SELECT body FROM records WHERE namespace='worker_jobs' AND json_extract(body, '$.status') = ? AND json_extract(body, '$.computerId') = ? ORDER BY updated_at, id LIMIT 1", 'queued', 'c'), /USING INDEX records_worker_jobs_status_computerid/);
  assert.match(plan("SELECT body FROM records WHERE namespace='activity' AND json_extract(body, '$.taskId') = ? ORDER BY updated_at DESC LIMIT 5", 't'), /USING INDEX records_activity_taskid/);
  assert.match(plan("SELECT body FROM records WHERE namespace='events' ORDER BY updated_at DESC, id DESC LIMIT 5"), /records_updated|PRIMARY KEY/);
  s.close();
});

test('stores that ignore list options still answer correctly through query()', () => {
  const rows = [{ id: '1', k: 'a' }, { id: '2', k: 'b' }, { id: '3', k: 'a' }];
  const plain = { get: () => undefined, list: () => structuredClone(rows), put: (_ns: string, v: unknown) => v, delete: () => false, transaction: (fn: () => unknown) => fn() } as unknown as RecordStore;
  assert.deepEqual(query<any>(plain, 'x', { where: { k: 'a' } }).map(r => r.id), ['1', '3']);
  assert.deepEqual(query<any>(plain, 'x', { where: { k: 'a' }, limit: 1, newest: true }).map(r => r.id), ['3']);
});

test('retention trims only replay events, old raw activity and finished payload-heavy jobs', async () => {
  const s = new SqliteStore(':memory:');
  const day = 86400000, now = Date.now(), old = new Date(now - 100 * day).toISOString();
  for (let i = 0; i < RETENTION.events + 50; i++) put(s, 'events', String(i).padStart(16, '0'));
  for (let i = 0; i < 30; i++) put(s, 'activity', 'new' + i, { taskId: 't' });
  s.db.prepare("INSERT INTO records(namespace,id,body,updated_at) VALUES('activity','ancient','{\"id\":\"ancient\"}',?)").run(old);
  // Old finished jobs beyond the newest 100, plus jobs that must survive.
  for (let i = 0; i < RETENTION.finishedJobsKeep + 10; i++) s.db.prepare("INSERT INTO records(namespace,id,body,updated_at) VALUES('worker_jobs',?,?,?)").run('done' + i, JSON.stringify({ id: 'done' + i, status: 'completed', computerId: 'c' }), new Date(now - 3 * day + i).toISOString());
  put(s, 'worker_jobs', 'queued', { status: 'queued', computerId: 'c' });
  s.db.prepare("INSERT INTO records(namespace,id,body,updated_at) VALUES('worker_jobs','running-old','{\"id\":\"running-old\",\"status\":\"running\",\"computerId\":\"c\"}',?)").run(old);
  s.db.prepare("INSERT INTO records(namespace,id,body,updated_at) VALUES('messages','msg-old','{\"id\":\"msg-old\"}',?)").run(old);
  s.db.prepare("INSERT INTO records(namespace,id,body,updated_at) VALUES('tasks','task-old','{\"id\":\"task-old\",\"status\":\"completed\"}',?)").run(old);

  const keep = RETENTION.activityKeep;RETENTION.activityKeep = 10;
  let removed: ReturnType<typeof applyRetention>;
  try { removed = applyRetention(s, now); } finally { RETENTION.activityKeep = keep; }
  assert.equal(removed.events, 50);
  assert.equal(s.list('events').length, RETENTION.events);
  assert.equal(s.get('events', String(RETENTION.events + 49).padStart(16, '0')) !== undefined, true, 'the newest events remain');
  assert.equal(s.get('events', '0000000000000000'), undefined);
  assert.equal(removed.activity, 1, 'only rows that are both beyond the newest ones and older than 90 days go');assert.equal(s.get('activity', 'ancient'), undefined);assert.equal(s.list('activity').length, 30);
  assert.equal(removed.jobs, 10);
  assert.equal(s.list('worker_jobs', { where: { status: 'completed' } }).length, RETENTION.finishedJobsKeep);
  assert.ok(s.get('worker_jobs', 'queued'));assert.ok(s.get('worker_jobs', 'running-old'));
  assert.ok(s.get('messages', 'msg-old'));assert.ok(s.get('tasks', 'task-old'));
  assert.deepEqual(applyRetention(s, now), { events: 0, activity: 0, jobs: 0 });
  s.close();
});
