import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ProviderService } from './providers.js';
import { chatToResponse, responsesToChat, translateStream } from './chat-bridge.js';
import { guardedResponses } from './response-stream.js';

const hopByHop = new Set(['content-length', 'transfer-encoding', 'content-encoding', 'connection', 'set-cookie']);
async function pipe(reply: FastifyReply, chunks: AsyncIterable<Uint8Array | string>, status: number, headers: Record<string, string>) {
  reply.hijack(); reply.raw.writeHead(status, headers);
  try { for await (const chunk of chunks) if (!reply.raw.write(typeof chunk === 'string' ? chunk : Buffer.from(chunk))) await new Promise<void>(r => reply.raw.once('drain', r)); }
  catch { /* kesilen akış: bağlantıyı kapat */ }
  finally { reply.raw.end(); }
}
/**
 * Codex 404/401 veya kota (429) hatalarını "geçici" sayıp tekrar dener ve arayüz uzun süre "Thinking / Reconnecting"de kalır.
 * Tekrar denemenin işe yaramayacağı hatalar akış içinde response.failed olayı olarak verilir; Codex bunu hemen ve okunur biçimde gösterir.
 */
function fatalProviderError(status: number, detail: string): { code: string; message: string } | undefined {
  let message = detail;
  try { const j = JSON.parse(detail); message = String(j?.error?.message ?? j?.error ?? j?.message ?? detail); } catch { /* düz metin */ }
  message = message.replace(/\s+/g, ' ').slice(0, 400);
  if (status === 429 && /usage limit|quota|cooling down|exhaust|hit your/i.test(message)) return { code: 'insufficient_quota', message };
  if (status === 429) return { code: 'rate_limit_exceeded', message: 'Model sağlayıcısının hız sınırı doldu (429). Bir süre sonra yeniden deneyin. '+message };
  if (status === 401 || status === 403 || status === 404) return { code: 'invalid_prompt', message: 'Model sağlayıcısı isteği reddetti (' + status + '): ' + message };
  return undefined;
}
/** Etkin model sağlayıcısına istek iletir; Chat Completions sağlayıcıları için Responses biçimini çevirir. */
export async function modelProxy(req: FastifyRequest, reply: FastifyReply, providers: ProviderService, path: string) {
  if (!['responses', 'models'].includes(path)) return reply.code(404).send({ error: 'Unsupported model endpoint' });
  const provider = providers.resolve();
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: req.headers.accept ?? '*/*' };
  if (provider.apiKey) headers.authorization = 'Bearer ' + provider.apiKey;
  const controller = new AbortController();
  reply.raw.on('close', () => { if (!reply.raw.writableEnded) controller.abort(); });
  const translate = path === 'responses' && provider.apiFormat === 'chat' && req.method === 'POST';
  const bridge = translate ? responsesToChat(req.body) : undefined;
  const target = provider.baseUrl + '/' + (translate ? 'chat/completions' : path);
  let response: Response;
  const headerTimeout=setTimeout(()=>controller.abort(new Error('provider_timeout')),60000);
  try {
    response = await fetch(target, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(bridge ? bridge.chat : req.body), redirect: 'error', signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && reply.raw.destroyed) return reply;
    return reply.code(502).send({ error: { message: 'Model sağlayıcısına ulaşılamadı: ' + (error instanceof Error ? error.message : 'bilinmeyen hata'), type: 'provider_unreachable' } });
  }finally{clearTimeout(headerTimeout);}
  if (!response.ok) {
    // Anahtar, istek metni ve sağlayıcının ham hata gövdesi günlüklere yazılmaz.
    req.log.warn({ status: response.status, provider: provider.id, model: (req.body as any)?.model }, 'model provider returned an error');
  }
  if (!response.ok && path === 'responses' && req.method === 'POST' && (req.body as any)?.stream !== false) {
    const fatal = fatalProviderError(response.status, (await response.clone().text().catch(() => '')).slice(0, 2000));
    if (fatal) {
      const failed = { type: 'response.failed', sequence_number: 0, response: { id: 'resp_provider_error', object: 'response', status: 'failed', error: fatal } };
      return pipe(reply, (async function* () { yield 'event: response.failed\ndata: ' + JSON.stringify(failed) + '\n\n'; })(), 200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
    }
  }
  const out: Record<string, string> = {};
  response.headers.forEach((v, k) => { if (!hopByHop.has(k)) out[k] = v; });
  if (!bridge || !response.ok) {
    const body=(response.body ?? (async function* () {})()) as AsyncIterable<Uint8Array>;
    const guarded=response.ok&&path==='responses'&&response.headers.get('content-type')?.includes('text/event-stream');
    return pipe(reply,guarded?guardedResponses(body,{stop:()=>controller.abort()}):body,response.status,out);
  }
  if (!bridge.stream) return reply.code(200).send(chatToResponse(await response.json(), bridge));
  return pipe(reply, guardedResponses(translateStream((response.body ?? (async function* () {})()) as AsyncIterable<Uint8Array>, bridge),{stop:()=>controller.abort()}), 200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
}
