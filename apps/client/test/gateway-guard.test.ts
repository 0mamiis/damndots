import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeGateway } from '../src/gateway.js';

const listen = (handler: http.RequestListener) => new Promise<{ server: http.Server; port: number; seen: { url: string; authorization?: string }[] }>(resolve => {
  const seen: { url: string; authorization?: string }[] = [];
  const server = http.createServer((req, res) => { seen.push({ url: req.url || '', authorization: req.headers.authorization }); handler(req, res); });
  server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as net.AddressInfo).port, seen }));
});
const freePort = () => new Promise<number>(resolve => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });
const jwt = () => 'h.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.s';

test('the local gateway cannot be turned into a credential-forwarding relay by a web page', async () => {
  const dots = await listen((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(req.url === '/client/enroll' ? JSON.stringify({ clientId: 'client-1', tokens: { access_token: jwt(), id_token: jwt(), refresh_token: jwt() } }) : JSON.stringify({ ok: true }));
  });
  const evil = await listen((_req, res) => res.end('{}'));
  const dir = await mkdtemp(join(tmpdir(), 'dots-gateway-')), port = await freePort();
  const gateway = new NativeGateway({ server: 'http://127.0.0.1:' + dots.port, enrollment: 'once', dataDir: dir, port, writeCodexProfile: false });
  try {
    const started = await gateway.start(), ca = await readFile(started.certificate);
    const call = (path: string, headers: Record<string, string> = {}, method = 'GET') => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = https.request({ host: '127.0.0.1', port, path, method, headers, ca, servername: 'localhost', checkServerIdentity: () => undefined }, res => { let body = ''; res.on('data', c => body += c); res.on('end', () => resolve({ status: res.statusCode || 0, body })); });
      req.on('error', reject); req.end(method === 'POST' ? 'x=1' : undefined);
    });
    const before = dots.seen.length;

    // A protocol-relative target is resolved as another host by URL parsing; the gateway must refuse it.
    const stolen = await call('//127.0.0.1:' + evil.port + '/backend-api/anything');
    assert.equal(stolen.status, 400);
    assert.equal(evil.seen.length, 0, 'nothing is sent to another host');

    // Requests a website can make without a preflight carry its Origin and no Authorization header.
    for (const [headers, method] of [[{ origin: 'https://evil.example' }, 'GET'], [{ origin: 'https://evil.example', 'content-type': 'text/plain' }, 'POST'], [{ origin: 'null', 'content-type': 'text/plain' }, 'POST'], [{ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' }, 'GET']] as const) {
      const blocked = await call('/backend-api/messaging/rooms/r/messages', { ...headers }, method);
      assert.equal(blocked.status, 403, JSON.stringify(headers));
    }
    assert.equal(dots.seen.length, before, 'blocked requests never reach the Dots server');

    // The desktop app (an Authorization header, an app origin) still works and the gateway adds its own credentials.
    const app = await call('/backend-api/tbo', { authorization: 'Bearer app-token', origin: 'app://-', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' });
    assert.equal(app.status, 200);
    const forwarded = dots.seen.at(-1)!;
    assert.equal(forwarded.url, '/backend-api/tbo');
    assert.ok(forwarded.authorization?.startsWith('Bearer h.'), 'the gateway uses its own token');
    assert.notEqual(forwarded.authorization, 'Bearer app-token');
  } finally { await gateway.close(); dots.server.closeAllConnections(); dots.server.close(); evil.server.close(); await rm(dir, { recursive: true, force: true }); }
});
