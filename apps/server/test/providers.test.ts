import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../src/app.js';
import { gatewayKey } from '../src/config.js';
import { SqliteStore } from '../src/storage.js';
import { responsesToChat } from '../src/chat-bridge.js';
import { isGptModel, parseModels } from '../src/providers.js';

interface Seen { method: string; url: string; auth?: string; body?: any; }
async function fakeProvider() {
  const seen: Seen[] = [];
  const sse = (res: ServerResponse, chunks: unknown[]) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); for (const c of chunks) res.write('data: ' + JSON.stringify(c) + '\n\n'); res.end('data: [DONE]\n\n'); };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined; seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body });
      if (req.url === '/v1/models') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'gpt-6-astra', reasoning_efforts: [{ value: 'low' }, { value: 'high' }] }, { id: 'claude-x', supports_reasoning_effort: false }] }));
      if (req.url === '/v1/chat/completions') {
        if (!body.stream) return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ model: body.model, choices: [{ message: { role: 'assistant', content: 'tamam' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }));
        const last = body.messages.at(-1);
        if (last.role === 'tool') return sse(res, [{ choices: [{ delta: { content: 'Sonuç: ' + last.content } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } }]);
        return sse(res, [
          { model: body.model, choices: [{ delta: { reasoning_content: 'düşünüyorum' } }] },
          { choices: [{ delta: { content: 'Merhaba ' } }] }, { choices: [{ delta: { content: 'dünya' } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'lookup', arguments: '{"q":' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_b', function: { name: 'apply_patch', arguments: '{"input":"*** patch"}' } }] } }] },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 } },
        ]);
      }
      if (req.url === '/v1/responses' && body?.model === 'dead') return void res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'Provider error 404: No active credentials for provider: antigravity' } }));
      if (req.url === '/v1/responses' && body?.model === 'limited') return void res.writeHead(429, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'You\u2019ve hit your usage limit.' } }));
      if (req.url === '/v1/responses' && body?.model === 'rate') return void res.writeHead(429, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'rate_limit_error: Please try again later.' } }));
      if (req.url === '/v1/responses' && body?.model === 'flaky') return void res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'busy' } }));
      if (req.url === '/v1/responses') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'resp_native', output: [] }));
      res.writeHead(404).end('{}');
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return { seen, url: 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/v1', close: () => new Promise<void>(r => server.close(() => r())) };
}
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'dots-prov-')), store = new SqliteStore(':memory:');
  const config = { host: '127.0.0.1', port: 0, dataDir: dir, adminKey: 'private-test-key', signingKey: Buffer.alloc(32, 7), modelBaseUrl: 'http://127.0.0.1:1/v1', modelApiKey: '', appServerUrl: 'ws://localhost:9912', model: null, reasoningEffort: 'high', serviceTier: null, workerOnlineMs: 45000 };
  const services = await buildServer({ config, store, runner: { run: async () => { throw new Error('no task'); } } });
  await services.app.ready();
  const token = (await services.app.inject({ method: 'POST', url: '/api/v1/session', payload: { token: config.adminKey } })).json().accessToken;
  const request = (method: any, url: string, payload?: any) => services.app.inject({ method, url: '/api/v1' + url, headers: { authorization: 'Bearer ' + token }, ...payload !== undefined ? { payload } : {} });
  const gateway = (payload: any, key = gatewayKey(config.signingKey)) => services.app.inject({ method: 'POST', url: '/model-gateway/responses', headers: { authorization: 'Bearer ' + key }, payload });
  return { ...services, store, request, gateway, config, cleanup: async () => { await services.app.close(); await rm(dir, { recursive: true, force: true }); } };
}
const events = (text: string) => text.split('\n\n').filter(Boolean).map(block => JSON.parse(block.split('\n').find(l => l.startsWith('data: '))!.slice(6)));

test('model discovery reads per-model reasoning ladders; Fast is only offered for GPT ids', () => {
  assert.ok(isGptModel('gpt-6.1-sol') && isGptModel('9Router/cx/gpt-6-luna') && isGptModel('o4-mini'));
  assert.ok(!isGptModel('claude-opus-5-5') && !isGptModel('9Router/oc/mimo-v2.6-flash-free') && !isGptModel('gemini-3.8-flash'));
  const models = parseModels({ data: [{ id: 'gpt-x', reasoning_efforts: [{ value: 'low' }, { value: 'ultra' }], reasoning_effort: 'low' }, { id: 'plain', supports_reasoning_effort: false }, { id: 'unknown-shape' }, 'bare-string'] });
  const by = Object.fromEntries(models.map(m => [m.id, m]));
  assert.deepEqual(by['gpt-x'].efforts, ['low', 'ultra']); assert.equal(by['gpt-x'].fast, true); assert.equal(by['gpt-x'].defaultEffort, 'low');
  assert.deepEqual(by.plain.efforts, []); assert.deepEqual(by['unknown-shape'].efforts, ['low', 'medium', 'high']); assert.equal(by['bare-string'].fast, false);
});

test('Responses requests become Chat Completions with tools, tool results and reasoning effort', () => {
  const { chat, customTools } = responsesToChat({ model: 'm', instructions: 'Kurallar', reasoning: { effort: 'high' }, stream: true, tools: [{ type: 'function', name: 'lookup', description: 'd', parameters: { type: 'object', properties: { q: { type: 'string' } } } }, { type: 'custom', name: 'apply_patch', description: 'patch' }, { type: 'web_search' }], input: [
    { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'dev' }] }, { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'merhaba' }, { type: 'input_image', image_url: 'data:image/png;base64,AA' }] },
    { type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'bakıyorum' }] },
    { type: 'function_call', call_id: 'c1', name: 'lookup', arguments: '{"q":"x"}' }, { type: 'function_call_output', call_id: 'c1', output: 'bulundu' },
    { type: 'custom_tool_call', call_id: 'c2', name: 'apply_patch', input: 'P' }, { type: 'custom_tool_call_output', call_id: 'c2', output: 'ok' }] }) as any;
  assert.equal(chat.reasoning_effort, 'high'); assert.equal(chat.tools.length, 2); assert.ok(customTools.has('apply_patch'));
  assert.deepEqual(chat.messages.map((m: any) => m.role), ['system', 'system', 'user', 'assistant', 'tool', 'assistant', 'tool']);
  assert.equal(chat.messages[3].content, 'bakıyorum'); assert.equal(chat.messages[3].tool_calls[0].function.name, 'lookup');
  assert.equal(chat.messages[2].content[1].image_url.url, 'data:image/png;base64,AA');
  assert.equal(JSON.parse(chat.messages[5].tool_calls[0].function.arguments).input, 'P');
});

test('provider keys are encrypted at rest, never returned or logged; models are fetched with the key', async () => {
  const fake = await fakeProvider(), f = await fixture();
  try {
    const created = (await f.request('POST', '/providers', { name: 'Test', baseUrl: fake.url, apiKey: 'sk-very-secret-value', apiFormat: 'chat' })).json();
    assert.equal(created.hasKey, true); assert.ok(!JSON.stringify(created).includes('sk-very-secret-value'));
    assert.deepEqual(created.models.map((m: any) => m.id), ['claude-x', 'gpt-6-astra']);
    assert.equal(fake.seen.find(s => s.url === '/v1/models')?.auth, 'Bearer sk-very-secret-value');
    const stored = JSON.stringify(f.store.get('providers', created.id)); assert.ok(!stored.includes('sk-very-secret-value'));
    const listed = (await f.request('GET', '/providers')).json(); assert.ok(!JSON.stringify(listed).includes('sk-very-secret-value')); assert.equal(listed.items[0].id, 'default');
    await f.request('PATCH', '/providers/' + created.id, { name: 'Yeni ad', apiKey: '[redacted]' });
    assert.equal(f.providers.resolve(created.id).apiKey, 'sk-very-secret-value');
    await f.request('PATCH', '/providers/' + created.id, { apiKey: null }); assert.equal(f.providers.get(created.id).hasKey, false);
    assert.equal((await f.request('DELETE', '/providers/default')).statusCode, 400);
    assert.equal((await f.request('POST', '/providers', { name: 'Kötü', baseUrl: 'http://evil.example.com/v1', apiFormat: 'chat' })).statusCode, 400);
  } finally { await f.cleanup(); await fake.close(); }
});

test('gateway: Chat Completions provider is translated to Responses events; Responses provider is passed through', async () => {
  const fake = await fakeProvider(), f = await fixture();
  try {
    assert.equal((await f.gateway({ model: 'gpt-6-astra', input: 'x' }, 'wrong')).statusCode, 401);
    const prov = (await f.request('POST', '/providers', { name: 'Chat', baseUrl: fake.url, apiKey: 'k1', apiFormat: 'chat' })).json();
    await f.request('PATCH', '/settings', { activeProviderId: prov.id, model: 'gpt-6-astra' });
    const reply = await f.gateway({ model: 'gpt-6-astra', stream: true, reasoning: { effort: 'low' }, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'selam' }] }], tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object' } }, { type: 'custom', name: 'apply_patch' }] });
    assert.equal(reply.statusCode, 200); assert.match(String(reply.headers['content-type']), /event-stream/);
    const ev = events(reply.body), types = ev.map(e => e.type);
    assert.equal(types[0], 'response.created'); assert.equal(types.at(-1), 'response.completed');
    assert.equal(ev.filter(e => e.type === 'response.output_text.delta').map(e => e.delta).join(''), 'Merhaba dünya');
    const done = ev.at(-1).response; assert.deepEqual(done.output.map((o: any) => o.type), ['reasoning', 'message', 'function_call', 'custom_tool_call']);
    assert.equal(done.output[2].arguments, '{"q":"x"}'); assert.equal(done.output[2].call_id, 'call_a'); assert.equal(done.output[3].input, '*** patch');
    assert.equal(done.usage.input_tokens, 9); assert.equal(done.usage.total_tokens, 13);
    const sent = fake.seen.find(s => s.url === '/v1/chat/completions')!; assert.equal(sent.auth, 'Bearer k1'); assert.equal(sent.body.reasoning_effort, 'low'); assert.equal(sent.body.messages[0].content, 'selam');
    // araç sonucu ile ikinci tur
    const second = await f.gateway({ model: 'gpt-6-astra', stream: true, input: [{ type: 'function_call', call_id: 'call_a', name: 'lookup', arguments: '{}' }, { type: 'function_call_output', call_id: 'call_a', output: 'cevap' }] });
    assert.equal(events(second.body).filter(e => e.type === 'response.output_text.delta').map(e => e.delta).join(''), 'Sonuç: cevap');
    const plain = await f.gateway({ model: 'gpt-6-astra', stream: false, input: 'ping' }); assert.equal(plain.json().output[0].content[0].text, 'tamam');
    // Responses biçimi: olduğu gibi iletilir
    await f.request('PATCH', '/providers/' + prov.id, { apiFormat: 'responses' });
    assert.equal((await f.gateway({ model: 'gpt-6-astra', input: 'x' })).json().id, 'resp_native');
    assert.ok(fake.seen.some(s => s.url === '/v1/responses'));
  } finally { await f.cleanup(); await fake.close(); }
});

test('provider test reports which wire formats work; Fast tier is rejected for non-GPT models', async () => {
  const fake = await fakeProvider(), f = await fixture();
  try {
    const prov = (await f.request('POST', '/providers', { name: 'P', baseUrl: fake.url.replace('/v1', ''), apiFormat: 'responses' })).json();
    assert.equal(f.providers.get(prov.id).baseUrl, fake.url, 'kök adres /v1 ile tamamlanır');
    const result = (await f.request('POST', '/providers/' + prov.id + '/test', { model: 'gpt-6-astra' })).json();
    assert.equal(result.models.ok, true); assert.equal(result.responses.ok, true); assert.equal(result.chat.ok, true); assert.equal(result.suggestedFormat, 'responses');
    const list = (await f.request('GET', '/models?providerId=' + prov.id)).json(); assert.equal(list.models.length, 2);
    assert.equal((await f.request('PATCH', '/settings', { model: 'claude-x', serviceTier: 'priority' })).statusCode, 400);
    const ok = (await f.request('PATCH', '/settings', { model: 'gpt-6-astra', serviceTier: 'priority' })).json(); assert.equal(ok.serviceTier, 'priority');
    const switched = (await f.request('PATCH', '/settings', { model: 'claude-x' })).json(); assert.equal(switched.serviceTier, null, 'GPT olmayan modele geçince Hızlı mod kapanır');
    assert.equal((await f.request('POST', '/dots', { name: 'd', model: 'claude-x', serviceTier: 'priority' })).statusCode, 400);
    const dot = (await f.request('POST', '/dots', { name: 'd', model: 'gpt-6-astra', serviceTier: 'priority', reasoningEffort: 'low' })).json(); assert.equal(dot.serviceTier, 'priority');
    assert.equal((await f.request('PATCH', '/dots/' + dot.id, { model: 'claude-x' })).json().serviceTier, null);
    assert.equal((await f.request('PATCH', '/settings', { activeProviderId: 'nope' })).statusCode, 404);
  } finally { await f.cleanup(); await fake.close(); }
});


test('gateway accepts zstd/gzip compressed request bodies (Codex compresses model requests)', async () => {
  const fake = await fakeProvider(), f = await fixture();
  try {
    const { zstdCompressSync, gzipSync } = await import('node:zlib');
    const prov = (await f.request('POST', '/providers', { name: 'Z', baseUrl: fake.url, apiFormat: 'chat' })).json();
    await f.request('PATCH', '/settings', { activeProviderId: prov.id });
    const body = JSON.stringify({ model: 'gpt-6-astra', stream: false, input: 'ping' });
    for (const [encoding, payload] of [['zstd', zstdCompressSync(Buffer.from(body))], ['gzip', gzipSync(Buffer.from(body))]] as const) {
      const reply = await f.app.inject({ method: 'POST', url: '/model-gateway/responses', headers: { authorization: 'Bearer ' + gatewayKey(f.config.signingKey), 'content-type': 'application/json', 'content-encoding': encoding }, payload });
      assert.equal(reply.statusCode, 200, encoding); assert.equal(reply.json().output[0].content[0].text, 'tamam');
    }
  } finally { await f.cleanup(); await fake.close(); }
});

test('non-retryable provider errors become an immediate response.failed event; transient ones pass through', async () => {
  const fake = await fakeProvider(), f = await fixture();
  try {
    const prov = (await f.request('POST', '/providers', { name: 'E', baseUrl: fake.url, apiFormat: 'responses' })).json();
    await f.request('PATCH', '/settings', { activeProviderId: prov.id });
    const dead = await f.gateway({ model: 'dead', stream: true, input: 'x' });
    assert.equal(dead.statusCode, 200); assert.match(String(dead.headers['content-type']), /event-stream/);
    const e1 = events(dead.body)[0]; assert.equal(e1.type, 'response.failed'); assert.equal(e1.response.error.code, 'invalid_prompt'); assert.match(e1.response.error.message, /antigravity/);
    const limited = events((await f.gateway({ model: 'limited', stream: true, input: 'x' })).body)[0]; assert.equal(limited.response.error.code, 'insufficient_quota');
    const rate = events((await f.gateway({ model: 'rate', stream: true, input: 'x' })).body)[0]; assert.equal(rate.response.error.code, 'rate_limit_exceeded'); assert.match(rate.response.error.message,/hız sınırı/);
    const flaky = await f.gateway({ model: 'flaky', stream: true, input: 'x' }); assert.equal(flaky.statusCode, 503, '5xx Codex tarafından yeniden denenebilir kalır');
  } finally { await f.cleanup(); await fake.close(); }
});
