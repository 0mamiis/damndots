import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import Fastify from 'fastify';
import { modelProxy } from '../src/model-proxy.js';

/** A provider that streams forever, noting when the proxy stops reading it. */
async function endlessProvider() {
  let closed: () => void;const gone = new Promise<void>(r => (closed = r));
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = 'event: response.output_text.delta\ndata: ' + JSON.stringify({ type: 'response.output_text.delta', delta: 'x'.repeat(60000) }) + '\n\n';
    const timer = setInterval(() => { if (!res.destroyed) res.write(chunk); }, 1);
    res.on('close', () => { clearInterval(timer); closed(); });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return { url: 'http://127.0.0.1:' + (server.address() as net.AddressInfo).port, gone, close: () => { server.closeAllConnections(); server.close(); } };
}

test('a client that disconnects while the socket buffer is full releases the provider stream', async () => {
  const provider = await endlessProvider();
  const app = Fastify();
  const providers = { resolve: () => ({ id: 'p', baseUrl: provider.url, apiKey: '', apiFormat: 'responses' }) } as any;
  app.post('/m/:endpoint', async (req, reply) => modelProxy(req, reply, providers, (req.params as any).endpoint));
  await app.listen({ host: '127.0.0.1', port: 0 });
  const port = (app.server.address() as net.AddressInfo).port;
  try {
    const socket = net.connect(port, '127.0.0.1');
    const body = JSON.stringify({ model: 'm', stream: true, input: 'hi' });
    socket.write('POST /m/responses HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body);
    socket.pause(); // never read: the proxy's write buffer fills and it waits for 'drain'
    await new Promise(r => setTimeout(r, 600));
    socket.destroy();
    const outcome = await Promise.race([provider.gone.then(() => 'released'), new Promise(r => setTimeout(() => r('still open'), 4000))]);
    assert.equal(outcome, 'released');
  } finally { provider.close(); app.server.closeAllConnections(); await app.close(); }
});
