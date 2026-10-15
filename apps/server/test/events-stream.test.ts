import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../src/app.js';
import { SqliteStore } from '../src/storage.js';
import type { RunInput, RunResult, TaskRunner } from '@dots/contracts';

async function fixture(runner: TaskRunner = { run: async () => { throw new Error('No task expected'); } }) {
  const dir = await mkdtemp(join(tmpdir(), 'dots-events-')), store = new SqliteStore(':memory:');
  const config = { host: '127.0.0.1', port: 0, dataDir: dir, adminKey: 'private-test-key', signingKey: Buffer.alloc(32, 1), modelBaseUrl: 'http://localhost:10100/v1', modelApiKey: '', appServerUrl: 'ws://localhost:9912', model: null, reasoningEffort: 'high', serviceTier: null, workerOnlineMs: 45000 };
  const services = await buildServer({ config, store, runner });
  await services.app.listen({ host: '127.0.0.1', port: 0 });
  const port = (services.app.server.address() as { port: number }).port, token = services.auth.issue('admin', 'owner', 300);
  const request = (method: any, url: string, payload?: any) => services.app.inject({ method, url: '/api/v1' + url, headers: { authorization: 'Bearer ' + token }, ...(payload !== undefined ? { payload } : {}) });
  /** Reads the live stream for a short window. */
  const stream = async (headers: Record<string, string> = {}, during?: () => void, ms = 400) => {
    const abort = new AbortController(), response = await fetch('http://127.0.0.1:' + port + '/api/v1/events', { headers: { authorization: 'Bearer ' + token, ...headers }, signal: abort.signal });
    let text = '';const reader = response.body!.getReader(), decoder = new TextDecoder();
    const timer = setTimeout(() => abort.abort(), ms);
    if (during) setTimeout(during, 100);
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; text += decoder.decode(value, { stream: true }); } } catch { /* window elapsed */ } finally { clearTimeout(timer); }
    return text;
  };
  return { ...services, dir, request, stream, cleanup: async () => { services.app.server.closeAllConnections(); await services.app.close(); await rm(dir, { recursive: true, force: true }); } };
}
const names = (text: string) => [...text.matchAll(/^event: (.+)$/gm)].map(m => m[1]);

test('a new dashboard connection follows live events instead of replaying the whole history', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 50; i++) f.external.publish('history.event', { i });
    const idle = await f.stream();
    assert.deepEqual(names(idle).filter(n => n === 'history.event'), [], 'no historical events on a fresh connection');
    const live = await f.stream({}, () => f.external.publish('live.event', {}));
    assert.deepEqual(names(live).filter(n => n.endsWith('.event')), ['live.event']);
  } finally { await f.cleanup(); }
});

test('a reconnecting dashboard receives exactly the events it missed, or an explicit resync when too many', async () => {
  const f = await fixture();
  try {
    const sent = Array.from({ length: 20 }, (_, i) => f.external.publish('missed.event', { i }));
    const resumed = await f.stream({ 'last-event-id': sent[14].id });
    const ids = [...resumed.matchAll(/^id: (.+)$/gm)].map(m => m[1]);
    assert.deepEqual(ids, sent.slice(15).map(e => e.id));
    for (let i = 0; i < 1100; i++) f.external.publish('burst.event', { i });
    const stale = await f.stream({ 'last-event-id': sent[0].id });
    assert.ok(names(stale).includes('resync'), 'too large a gap asks the client to refresh');
    assert.equal(names(stale).filter(n => n === 'burst.event').length, 0);
  } finally { await f.cleanup(); }
});

test('overview and activity endpoints return bounded, chronological slices', async () => {
  const f = await fixture();
  try {
    const dot = (await f.request('POST', '/dots', { name: 'Busy' })).json();
    for (let i = 0; i < 250; i++) f.runtime.activity(dot.id, i < 200 ? 'task-a' : 'task-b', 'x', 'm' + i);
    const overview = (await f.request('GET', '/overview')).json();
    assert.equal(overview.activity.length, 100);
    assert.deepEqual(overview.activity.map((a: any) => a.message).slice(-2), ['m248', 'm249']);
    assert.equal(overview.activity[0].message, 'm150');
    const filtered = (await f.request('GET', '/activity?taskId=task-b')).json().items;
    assert.deepEqual(filtered.map((a: any) => a.message), Array.from({ length: 50 }, (_, i) => 'm' + (200 + i)));
    const limited = (await f.request('GET', '/activity?limit=3')).json().items;
    assert.deepEqual(limited.map((a: any) => a.message), ['m247', 'm248', 'm249']);
    assert.equal((await f.request('GET', '/activity?limit=999999')).json().items.length, 250);
  } finally { await f.cleanup(); }
});
