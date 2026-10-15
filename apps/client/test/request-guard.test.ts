import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectRequest, requestTarget, guardMode, fingerprint } from '../src/request-guard.js';

const url = (path = '/backend-api/tbo') => new URL(path, 'https://localhost:8000');
test('requests from other websites are refused, even simple ones with no preflight', () => {
  assert.equal(inspectRequest({ origin: 'https://evil.example' }, url()).block, true);
  assert.equal(inspectRequest({ origin: 'http://192.168.1.5' }, url()).block, true);
  assert.equal(inspectRequest({ origin: 'https://chatgpt.com.evil.example' }, url()).block, true);
  assert.equal(inspectRequest({ origin: 'not a url' }, url()).block, true);
  assert.equal(inspectRequest({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' }, url()).block, true);
  assert.equal(inspectRequest({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' }, url()).block, true);
});
test('sandboxed pages (Origin: null) need credentials a page cannot attach without a preflight', () => {
  assert.equal(inspectRequest({ origin: 'null' }, url()).block, true);
  assert.equal(inspectRequest({ origin: 'app://-' }, url()).block, true);
  assert.equal(inspectRequest({ origin: 'null', authorization: 'Bearer app-token' }, url()).block, false);
  assert.equal(inspectRequest({ origin: 'app://-', authorization: 'Bearer app-token' }, url()).block, false);
  assert.equal(inspectRequest({ origin: 'null' }, url('/auth/oauth/token')).block, false);
  assert.equal(inspectRequest({ origin: 'null' }, url('/backend-api/files/content/a?t=signed')).block, false);
});
test('the desktop app, trusted OpenAI pages and direct requests keep working', () => {
  assert.equal(inspectRequest({}, url()).block, false);
  assert.equal(inspectRequest({ authorization: 'Bearer x', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }, url()).block, false);
  assert.equal(inspectRequest({ origin: 'https://chatgpt.com', authorization: 'Bearer x' }, url()).block, false);
  assert.equal(inspectRequest({ origin: 'https://sub.openai.com' }, url()).block, false);
  assert.equal(inspectRequest({ origin: 'https://localhost:8000' }, url()).block, false);
  assert.equal(inspectRequest({ 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate' }, url('/health')).block, false);
});
test('a protocol-relative request target can never redirect the gateway to another host', () => {
  const server = 'http://127.0.0.1:9340';
  assert.equal(requestTarget('//evil.example/backend-api/x', server), undefined);
  assert.equal(requestTarget('/\\evil.example/backend-api/x', server), undefined);
  assert.equal(requestTarget('http://evil.example/backend-api/x', server), undefined);
  assert.equal(requestTarget('', server), undefined);
  assert.equal(requestTarget('/backend-api/tbo?x=1', server)?.href, 'http://127.0.0.1:9340/backend-api/tbo?x=1');
  assert.equal(requestTarget('/backend-api/../auth/token', server)?.pathname, '/auth/token');
});

test('the guard mode defaults to enforcing and the fingerprint never contains credentials', () => {
  assert.equal(guardMode(undefined), 'on');assert.equal(guardMode('log'), 'log');assert.equal(guardMode('off'), 'off');assert.equal(guardMode('nonsense'), 'on');
  const text = fingerprint('GET', { origin: 'app://-', authorization: 'Bearer secret-token', 'sec-fetch-site': 'none' }, url('/backend-api/files/content/private-id?t=signed-secret'));
  assert.ok(!text.includes('secret') && !text.includes('private-id') && !text.includes('signed'));
  assert.match(text, /^GET \/backend-api\/files origin=app:\/\/- site=none .* auth=yes query-token=yes$/);
});
