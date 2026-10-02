// Responses API <-> Chat Completions köprüsü.
// Codex yalnızca Responses biçimini konuşur; Chat Completions sağlayıcıları bu dönüştürücüyle kullanılır.
import { randomBytes } from 'node:crypto';

const uid = (prefix: string) => prefix + randomBytes(12).toString('hex');
const flatText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content);
  return content.map((part: any) => (typeof part === 'string' ? part : part?.text ?? '')).filter(Boolean).join('\n');
};
function userContent(content: unknown): unknown {
  if (typeof content === 'string') return content;
  const parts: any[] = [];
  for (const part of Array.isArray(content) ? content : []) {
    if (part?.type === 'input_image') {
      const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
      if (url) parts.push({ type: 'image_url', image_url: { url } });
    } else if (part?.text) parts.push({ type: 'text', text: String(part.text) });
  }
  return parts.every(p => p.type === 'text') ? parts.map(p => p.text).join('\n') : parts;
}
export interface ChatRequest { chat: Record<string, unknown>; customTools: Set<string>; model: string; stream: boolean; }

export function responsesToChat(body: any): ChatRequest {
  const customTools = new Set<string>();
  const messages: any[] = [];
  if (typeof body?.instructions === 'string' && body.instructions.trim()) messages.push({ role: 'system', content: body.instructions });
  const items: any[] = typeof body?.input === 'string' ? [{ type: 'message', role: 'user', content: body.input }] : Array.isArray(body?.input) ? body.input : [];
  const attachCall = (call: Record<string, unknown>) => {
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant') (last.tool_calls ??= []).push(call);
    else messages.push({ role: 'assistant', content: null, tool_calls: [call] });
  };
  for (const item of items) {
    const type = item?.type ?? (item?.role ? 'message' : '');
    if (type === 'message') {
      const role = item.role === 'developer' ? 'system' : item.role;
      if (role === 'assistant') {
        const text = flatText(item.content);
        if (text) messages.push({ role: 'assistant', content: text });
      } else messages.push({ role: role === 'system' ? 'system' : 'user', content: role === 'system' ? flatText(item.content) : userContent(item.content) });
    } else if (type === 'function_call') {
      attachCall({ id: item.call_id ?? uid('call_'), type: 'function', function: { name: item.name, arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}) } });
    } else if (type === 'custom_tool_call') {
      customTools.add(item.name);
      attachCall({ id: item.call_id ?? uid('call_'), type: 'function', function: { name: item.name, arguments: JSON.stringify({ input: item.input ?? '' }) } });
    } else if (type === 'function_call_output' || type === 'custom_tool_call_output') {
      messages.push({ role: 'tool', tool_call_id: item.call_id, content: flatText(item.output) });
    }
    // reasoning, web_search_call, local_shell_call vb. Chat Completions karşılığı olmadığı için atlanır.
  }
  const tools: any[] = [];
  const addTool = (tool: any) => {
    if (tool?.type === 'function' && tool.name) tools.push({ type: 'function', function: { name: tool.name, ...(tool.description ? { description: tool.description } : {}), parameters: tool.parameters ?? { type: 'object', properties: {} } } });
    else if (tool?.type === 'custom' && tool.name) {
      customTools.add(tool.name);
      tools.push({ type: 'function', function: { name: tool.name, description: [tool.description, tool.format?.definition ? 'Girdi biçimi:\n' + tool.format.definition : ''].filter(Boolean).join('\n\n'), parameters: { type: 'object', properties: { input: { type: 'string', description: 'Aracın ham girdisi' } }, required: ['input'] } } });
    } else if (tool?.type === 'namespace' && Array.isArray(tool.tools)) tool.tools.forEach(addTool);
  };
  for (const tool of Array.isArray(body?.tools) ? body.tools : []) addTool(tool);
  const stream = body?.stream !== false;
  const chat: Record<string, unknown> = { model: body.model, messages, stream };
  if (stream) chat.stream_options = { include_usage: true };
  if (tools.length) {
    chat.tools = tools;
    if (typeof body.tool_choice === 'string' && ['auto', 'none', 'required'].includes(body.tool_choice)) chat.tool_choice = body.tool_choice;
    if (typeof body.parallel_tool_calls === 'boolean') chat.parallel_tool_calls = body.parallel_tool_calls;
  }
  const effort = body?.reasoning?.effort;
  if (typeof effort === 'string' && effort !== 'none') chat.reasoning_effort = effort;
  if (typeof body.service_tier === 'string') chat.service_tier = body.service_tier;
  if (typeof body.temperature === 'number') chat.temperature = body.temperature;
  if (typeof body.top_p === 'number') chat.top_p = body.top_p;
  if (typeof body.max_output_tokens === 'number') chat.max_tokens = body.max_output_tokens;
  const format = body?.text?.format;
  if (format?.type === 'json_schema') chat.response_format = { type: 'json_schema', json_schema: { name: format.name ?? 'output', schema: format.schema, strict: format.strict } };
  else if (format?.type === 'json_object') chat.response_format = { type: 'json_object' };
  return { chat, customTools, model: String(body?.model ?? ''), stream };
}

const usageOf = (u: any) => u ? { input_tokens: u.prompt_tokens ?? 0, input_tokens_details: { cached_tokens: u.prompt_tokens_details?.cached_tokens ?? 0 }, output_tokens: u.completion_tokens ?? 0, output_tokens_details: { reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? 0 }, total_tokens: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0) } : undefined;
const callItem = (call: { id: string; callId: string; name: string; args: string }, custom: boolean) => {
  if (!custom) return { type: 'function_call', id: call.id, call_id: call.callId, name: call.name, arguments: call.args || '{}', status: 'completed' };
  let input = call.args;
  try { const parsed = JSON.parse(call.args); if (typeof parsed?.input === 'string') input = parsed.input; } catch { /* ham girdi korunur */ }
  return { type: 'custom_tool_call', id: call.id, call_id: call.callId, name: call.name, input, status: 'completed' };
};
const messageItem = (id: string, text: string) => ({ type: 'message', id, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] });

/** Akışsız Chat Completions yanıtını Responses nesnesine çevirir. */
export function chatToResponse(json: any, request: ChatRequest): Record<string, unknown> {
  const message = json?.choices?.[0]?.message ?? {};
  const output: any[] = [];
  const reasoning = message.reasoning_content ?? message.reasoning;
  if (typeof reasoning === 'string' && reasoning) output.push({ type: 'reasoning', id: uid('rs_'), summary: [], content: [{ type: 'reasoning_text', text: reasoning }] });
  if (typeof message.content === 'string' && message.content) output.push(messageItem(uid('msg_'), message.content));
  for (const call of message.tool_calls ?? []) output.push(callItem({ id: uid('fc_'), callId: call.id ?? uid('call_'), name: call.function?.name ?? '', args: call.function?.arguments ?? '' }, request.customTools.has(call.function?.name)));
  return { id: uid('resp_'), object: 'response', created_at: Math.floor(Date.now() / 1000), status: json?.choices?.[0]?.finish_reason === 'length' ? 'incomplete' : 'completed', model: json?.model ?? request.model, output, usage: usageOf(json?.usage) };
}

/** Chat Completions SSE akışını Responses SSE olaylarına çevirir. */
export async function* translateStream(upstream: AsyncIterable<Uint8Array>, request: ChatRequest): AsyncGenerator<string> {
  let seq = 0;
  const ev = (type: string, data: Record<string, unknown>) => 'event: ' + type + '\ndata: ' + JSON.stringify({ type, sequence_number: seq++, ...data }) + '\n\n';
  const respId = uid('resp_'), created = Math.floor(Date.now() / 1000);
  let model = request.model, usage: any, finish: string | undefined, gotChunk = false, index = 0;
  const output: any[] = [];
  const base = (status: string) => ({ id: respId, object: 'response', created_at: created, status, model, output: [] as any[] });
  yield ev('response.created', { response: base('in_progress') });
  yield ev('response.in_progress', { response: base('in_progress') });
  let reasoning: { id: string; index: number; text: string } | undefined, thoughtAll = '';
  let text: { id: string; index: number; text: string } | undefined;
  const calls = new Map<number, { id: string; callId: string; name: string; args: string; index: number; custom: boolean; started: boolean }>();
  function* closeReasoning() {
    if (!reasoning) return;
    const item = { type: 'reasoning', id: reasoning.id, summary: [], content: [{ type: 'reasoning_text', text: reasoning.text }] };
    yield ev('response.reasoning_text.done', { item_id: reasoning.id, output_index: reasoning.index, content_index: 0, text: reasoning.text });
    yield ev('response.output_item.done', { output_index: reasoning.index, item });
    output[reasoning.index] = item; reasoning = undefined;
  }
  function* closeText() {
    if (!text) return;
    yield ev('response.output_text.done', { item_id: text.id, output_index: text.index, content_index: 0, text: text.text });
    yield ev('response.content_part.done', { item_id: text.id, output_index: text.index, content_index: 0, part: { type: 'output_text', text: text.text, annotations: [] } });
    const item = messageItem(text.id, text.text);
    yield ev('response.output_item.done', { output_index: text.index, item });
    output[text.index] = item; text = undefined;
  }
  function* closeCalls() {
    for (const call of [...calls.values()].sort((a, b) => a.index - b.index)) {
      const item = callItem(call, call.custom);
      if (!call.custom) yield ev('response.function_call_arguments.done', { item_id: call.id, output_index: call.index, arguments: call.args || '{}' });
      yield ev('response.output_item.done', { output_index: call.index, item });
      output[call.index] = item;
    }
    calls.clear();
  }
  const decoder = new TextDecoder();
  let buffer = '';
  const handle = function* (payload: string): Generator<string> {
    if (!payload || payload === '[DONE]') return;
    let chunk: any;
    try { chunk = JSON.parse(payload); } catch { return; }
    if (chunk.error) throw new Error(typeof chunk.error === 'string' ? chunk.error : chunk.error.message ?? 'Sağlayıcı hatası');
    gotChunk = true; model = chunk.model ?? model;
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0]; if (!choice) return;
    if (choice.finish_reason) finish = choice.finish_reason;
    const delta = choice.delta ?? {};
    const thought = delta.reasoning_content ?? delta.reasoning;
    if (typeof thought === 'string' && thought) {
      if (!reasoning) { reasoning = { id: uid('rs_'), index: index++, text: '' }; yield ev('response.output_item.added', { output_index: reasoning.index, item: { type: 'reasoning', id: reasoning.id, summary: [] } }); }
      reasoning.text += thought; thoughtAll += thought;
      yield ev('response.reasoning_text.delta', { item_id: reasoning.id, output_index: reasoning.index, content_index: 0, delta: thought });
    }
    if (typeof delta.content === 'string' && delta.content) {
      yield* closeReasoning();
      if (!text) {
        text = { id: uid('msg_'), index: index++, text: '' };
        yield ev('response.output_item.added', { output_index: text.index, item: { type: 'message', id: text.id, role: 'assistant', status: 'in_progress', content: [] } });
        yield ev('response.content_part.added', { item_id: text.id, output_index: text.index, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
      }
      text.text += delta.content;
      yield ev('response.output_text.delta', { item_id: text.id, output_index: text.index, content_index: 0, delta: delta.content });
    }
    for (const part of delta.tool_calls ?? []) {
      yield* closeReasoning(); yield* closeText();
      const key = Number.isInteger(part.index) ? part.index : calls.size;
      let call = calls.get(key);
      if (!call) {
        call = { id: uid('fc_'), callId: part.id ?? uid('call_'), name: '', args: '', index: index++, custom: false, started: false };
        calls.set(key, call);
      }
      if (part.id && !call.started) call.callId = part.id;
      if (part.function?.name) { call.name += part.function.name; call.custom = request.customTools.has(call.name); }
      if (!call.started && call.name) {
        call.started = true;
        yield ev('response.output_item.added', { output_index: call.index, item: call.custom ? { type: 'custom_tool_call', id: call.id, call_id: call.callId, name: call.name, input: '', status: 'in_progress' } : { type: 'function_call', id: call.id, call_id: call.callId, name: call.name, arguments: '', status: 'in_progress' } });
      }
      const piece = part.function?.arguments;
      if (typeof piece === 'string' && piece) {
        call.args += piece;
        if (call.started && !call.custom) yield ev('response.function_call_arguments.delta', { item_id: call.id, output_index: call.index, delta: piece });
      }
    }
  };
  try {
    for await (const bytes of upstream) {
      buffer += decoder.decode(bytes, { stream: true });
      let cut: number;
      while ((cut = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const block = buffer.slice(0, cut); buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, '');
        const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        yield* handle(data);
      }
    }
    if (buffer.trim()) yield* handle(buffer.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n'));
    if (!gotChunk) throw new Error('Sağlayıcı boş yanıt döndürdü');
    // Bazı küçük modeller yanıtı yalnızca akıl yürütme alanına yazar; boş tur yerine bu metni yanıt olarak göster.
    if (!text && !calls.size && thoughtAll.trim() && !output.some(o => o?.type === 'message')) {
      yield* closeReasoning();
      text = { id: uid('msg_'), index: index++, text: thoughtAll };
      yield ev('response.output_item.added', { output_index: text.index, item: { type: 'message', id: text.id, role: 'assistant', status: 'in_progress', content: [] } });
      yield ev('response.content_part.added', { item_id: text.id, output_index: text.index, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
      yield ev('response.output_text.delta', { item_id: text.id, output_index: text.index, content_index: 0, delta: thoughtAll });
    }
    yield* closeReasoning(); yield* closeText(); yield* closeCalls();
    const final = { ...base(finish === 'length' ? 'incomplete' : 'completed'), output: output.filter(Boolean), usage: usageOf(usage), ...(finish === 'length' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}) };
    yield ev(finish === 'length' ? 'response.incomplete' : 'response.completed', { response: final });
  } catch (error) {
    yield ev('response.failed', { response: { ...base('failed'), error: { code: 'provider_error', message: error instanceof Error ? error.message : 'Sağlayıcı akışı kesildi' } } });
  }
}
