import { randomBytes } from 'node:crypto';
import type { RecordStore } from '@dots/contracts';
import { SecretVault, endpoint, IntegrationError } from './integrations/security.js';

export type ApiFormat = 'responses' | 'chat';
export const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export interface ModelInfo { id: string; gpt: boolean; fast: boolean; efforts: string[]; defaultEffort: string | null; contextWindow: number | null; manual?: boolean; }
interface StoredProvider { id: string; name: string; baseUrl: string; apiFormat: ApiFormat; sealedKey: string | null; models: ModelInfo[]; modelsFetchedAt: string | null; lastError: string | null; createdAt: string; updatedAt: string; }
export interface PublicProvider { id: string; name: string; baseUrl: string; apiFormat: ApiFormat; hasKey: boolean; builtin: boolean; models: ModelInfo[]; modelsFetchedAt: string | null; lastError: string | null; }
export interface ResolvedProvider { id: string; baseUrl: string; apiKey: string; apiFormat: ApiFormat; }
export const DEFAULT_PROVIDER_ID = 'default';

/** "Hızlı" mod (service_tier=priority) yalnızca GPT model kimliklerinde sunulur. */
export const isGptModel = (id: string | null | undefined) => !!id && /(^|[/_.:-])(gpt|chatgpt)[-_.\d]|(^|[/_.:-])o\d/i.test(id);

const ladder = (value: unknown): string[] => {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map((v: any) => String(typeof v === 'string' ? v : v?.value ?? v?.effort ?? '').toLowerCase()).filter(v => (EFFORTS as readonly string[]).includes(v)))];
};
export function parseModels(json: any): ModelInfo[] {
  const rows: any[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
  const seen = new Set<string>(), models: ModelInfo[] = [];
  for (const row of rows) {
    const id = typeof row === 'string' ? row : row?.id ?? row?.slug ?? row?.model ?? row?.name;
    if (typeof id !== 'string' || !id.trim() || seen.has(id)) continue;
    seen.add(id);
    const listed = ladder(row?.reasoning_efforts ?? row?.capabilities?.reasoning_effort ?? row?.supported_reasoning_levels ?? row?.supported_reasoning_efforts);
    const off = row?.supports_reasoning_effort === false || row?.capabilities?.supports_reasoning === false;
    const efforts = listed.length ? listed : off ? [] : ['low', 'medium', 'high'];
    const preferred = typeof row?.reasoning_effort === 'string' ? row.reasoning_effort : row?.default_reasoning_level ?? row?.default_reasoning_effort;
    models.push({ id, gpt: isGptModel(id), fast: isGptModel(id), efforts, defaultEffort: efforts.includes(preferred) ? preferred : null, contextWindow: Number(row?.context_window ?? row?.context_length ?? row?.capabilities?.context_length) || null });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}
const manualModel = (id: string): ModelInfo => ({ id, gpt: isGptModel(id), fast: isGptModel(id), efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: null, contextWindow: null, manual: true });
const cleanBase = (url: string) => endpoint(url).replace(/\/+$/, '');
const now = () => new Date().toISOString();
const short = (value: unknown) => String(value instanceof Error ? value.message : value).replace(/\s+/g, ' ').slice(0, 300);

export const MODEL_REFRESH_MS = 30000;
export interface ProviderOptions { vault: SecretVault; fallback: { baseUrl: string; apiKey: string }; activeId: () => string | null; fetch?: typeof fetch; clock?: () => number; }
export class ProviderService {
  private fetcher: typeof fetch;
  private refreshing = new Map<string, Promise<PublicProvider>>();
  private attemptedAt = new Map<string, number>();
  constructor(private store: RecordStore, private options: ProviderOptions) { this.fetcher = options.fetch ?? fetch; }
  private builtin(): StoredProvider {
    const saved = this.store.get<StoredProvider>('providers', DEFAULT_PROVIDER_ID);
    return { ...(saved ?? { models: [], modelsFetchedAt: null, lastError: null, createdAt: now() }), id: DEFAULT_PROVIDER_ID, name: 'Sunucu varsayılanı', baseUrl: this.options.fallback.baseUrl, apiFormat: 'responses', sealedKey: null, updatedAt: saved?.updatedAt ?? now() };
  }
  private raw(id: string): StoredProvider {
    if (id === DEFAULT_PROVIDER_ID) return this.builtin();
    const found = this.store.get<StoredProvider>('providers', id);
    if (!found) throw new IntegrationError('Sağlayıcı bulunamadı', 404);
    return found;
  }
  private view(p: StoredProvider): PublicProvider {
    const builtin = p.id === DEFAULT_PROVIDER_ID;
    return { id: p.id, name: p.name, baseUrl: p.baseUrl, apiFormat: p.apiFormat, hasKey: builtin ? !!this.options.fallback.apiKey : !!p.sealedKey, builtin, models: p.models, modelsFetchedAt: p.modelsFetchedAt, lastError: p.lastError };
  }
  private key(p: StoredProvider): string { return p.id === DEFAULT_PROVIDER_ID ? this.options.fallback.apiKey : p.sealedKey ? String(this.options.vault.open(p.sealedKey).apiKey ?? '') : ''; }
  list(): PublicProvider[] {
    const custom = this.store.list<StoredProvider>('providers').filter(p => p.id !== DEFAULT_PROVIDER_ID).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return [this.builtin(), ...custom].map(p => this.view(p));
  }
  get(id: string): PublicProvider { return this.view(this.raw(id)); }
  async listFresh(): Promise<PublicProvider[]> {
    return Promise.all(this.list().map(p => this.fresh(p.id)));
  }
  private async fresh(id: string): Promise<PublicProvider> {
    const p = this.get(id), time = (this.options.clock ?? Date.now)();
    const fetchedAt = p.modelsFetchedAt ? Date.parse(p.modelsFetchedAt) : NaN;
    const attemptedAt = this.attemptedAt.get(id);
    const last = Math.max(Number.isFinite(fetchedAt) ? fetchedAt : -Infinity, attemptedAt ?? -Infinity);
    if (this.refreshing.has(id) || time - last >= MODEL_REFRESH_MS) {
      try { return await this.refreshModels(id); } catch { /* Keep the last good catalog and expose lastError. */ }
    }
    return this.get(id);
  }
  activeId(): string { const id = this.options.activeId(); return id && (id === DEFAULT_PROVIDER_ID || this.store.get('providers', id)) ? id : DEFAULT_PROVIDER_ID; }
  resolve(id?: string): ResolvedProvider {
    const p = this.raw(id ?? this.activeId());
    return { id: p.id, baseUrl: p.baseUrl.replace(/\/+$/, ''), apiKey: this.key(p), apiFormat: p.apiFormat };
  }
  async create(input: { name: string; baseUrl: string; apiKey?: string | null; apiFormat: ApiFormat; manualModels?: string[] }): Promise<PublicProvider> {
    const at = now();
    const provider: StoredProvider = { id: 'prov_' + randomBytes(8).toString('hex'), name: input.name.trim(), baseUrl: cleanBase(input.baseUrl), apiFormat: input.apiFormat, sealedKey: input.apiKey ? this.options.vault.seal({ apiKey: input.apiKey }) : null, models: (input.manualModels ?? []).map(manualModel), modelsFetchedAt: null, lastError: null, createdAt: at, updatedAt: at };
    this.store.put('providers', provider);
    try { return await this.refreshModels(provider.id); } catch { return this.get(provider.id); }
  }
  update(id: string, patch: { name?: string; baseUrl?: string; apiKey?: string | null; apiFormat?: ApiFormat; manualModels?: string[] }): PublicProvider {
    if (id === DEFAULT_PROVIDER_ID) throw new IntegrationError('Sunucu varsayılanı değiştirilemez; yeni bir sağlayıcı ekleyin', 400);
    const p = this.raw(id), next = { ...p, updatedAt: now() };
    if (patch.name !== undefined) next.name = patch.name.trim();
    if (patch.baseUrl !== undefined) next.baseUrl = cleanBase(patch.baseUrl);
    if (patch.apiFormat !== undefined) next.apiFormat = patch.apiFormat;
    if (patch.apiKey !== undefined && patch.apiKey !== '[redacted]') next.sealedKey = patch.apiKey ? this.options.vault.seal({ apiKey: patch.apiKey }) : null;
    if (next.baseUrl !== p.baseUrl || next.sealedKey !== p.sealedKey) { next.modelsFetchedAt = null; this.attemptedAt.delete(id); }
    if (patch.manualModels) { const fetched = next.models.filter(m => !m.manual); const ids = new Set(fetched.map(m => m.id)); next.models = [...fetched, ...patch.manualModels.filter(m => !ids.has(m)).map(manualModel)]; }
    this.store.put('providers', next);
    return this.view(next);
  }
  remove(id: string): boolean {
    if (id === DEFAULT_PROVIDER_ID) throw new IntegrationError('Sunucu varsayılanı silinemez', 400);
    return this.store.delete('providers', id);
  }
  private async call(url: string, key: string, init: RequestInit = {}, timeout = 20000): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) };
    if (key) headers.authorization = 'Bearer ' + key;
    return this.fetcher(url, { ...init, headers, redirect: 'error', signal: AbortSignal.timeout(timeout) });
  }
  async refreshModels(id: string): Promise<PublicProvider> {
    const pending = this.refreshing.get(id);
    if (pending) return pending;
    this.attemptedAt.set(id, (this.options.clock ?? Date.now)());
    const work = this.fetchModels(id).finally(() => this.refreshing.delete(id));
    this.refreshing.set(id, work);
    return work;
  }
  private async fetchModels(id: string): Promise<PublicProvider> {
    const p = this.raw(id), key = this.key(p);
    let base = p.baseUrl.replace(/\/+$/, ''), json: any, failure = '';
    for (const candidate of [base, base.endsWith('/v1') ? '' : base + '/v1'].filter(Boolean)) {
      try {
        const response = await this.call(candidate + '/models', key);
        if (response.ok) { json = await response.json(); base = candidate; failure = ''; break; }
        failure = 'Sağlayıcı /models için ' + response.status + ' döndürdü';
        if (response.status === 401 || response.status === 403) break;
      } catch (error) { failure = 'Sağlayıcıya ulaşılamadı: ' + short(error); }
    }
    const saved = this.store.get<StoredProvider>('providers', id);
    if (id !== DEFAULT_PROVIDER_ID && (!saved || saved.baseUrl !== p.baseUrl || saved.sealedKey !== p.sealedKey)) return this.get(id);
    const target = saved ?? p;
    if (json === undefined) {
      this.store.put('providers', { ...target, lastError: failure || 'Model listesi alınamadı' });
      throw new IntegrationError(failure || 'Model listesi alınamadı', 502);
    }
    const fetched = parseModels(json), ids = new Set(fetched.map(m => m.id));
    const manual = target.models.filter(m => m.manual && !ids.has(m.id));
    const next: StoredProvider = { ...target, baseUrl: id === DEFAULT_PROVIDER_ID ? target.baseUrl : base, models: [...fetched, ...manual], modelsFetchedAt: new Date((this.options.clock ?? Date.now)()).toISOString(), lastError: null, updatedAt: now() };
    this.store.put('providers', next);
    return this.view(id === DEFAULT_PROVIDER_ID ? { ...next, baseUrl: this.options.fallback.baseUrl } : next);
  }
  async models(id?: string): Promise<{ providerId: string; models: ModelInfo[] }> {
    const pid = id ?? this.activeId();
    const p = await this.fresh(pid);
    return { providerId: pid, models: p.models };
  }
  /** Her iki API biçimini küçük bir istekle dener; hangisinin çalıştığını raporlar. */
  async test(id: string, model?: string): Promise<{ models: { ok: boolean; count?: number; error?: string }; responses?: { ok: boolean; status?: number; ms?: number; error?: string }; chat?: { ok: boolean; status?: number; ms?: number; error?: string }; suggestedFormat: ApiFormat | null }> {
    const p = this.raw(id), key = this.key(p), base = p.baseUrl.replace(/\/+$/, '');
    const out: any = { models: { ok: false }, suggestedFormat: null };
    try { const fresh = await this.refreshModels(id); out.models = { ok: true, count: fresh.models.length }; model ??= fresh.models[0]?.id; } catch (error) { out.models = { ok: false, error: short(error) }; model ??= p.models[0]?.id; }
    if (!model) return out;
    const probe = async (path: string, body: unknown) => {
      const started = Date.now();
      try {
        const response = await this.call(base + path, key, { method: 'POST', body: JSON.stringify(body) }, 45000);
        const text = response.ok ? '' : short(await response.text());
        return { ok: response.ok, status: response.status, ms: Date.now() - started, ...(response.ok ? {} : { error: text }) };
      } catch (error) { return { ok: false, ms: Date.now() - started, error: short(error) }; }
    };
    out.responses = await probe('/responses', { model, input: 'Sadece "tamam" yaz.', max_output_tokens: 32, stream: false });
    out.chat = await probe('/chat/completions', { model, messages: [{ role: 'user', content: 'Sadece "tamam" yaz.' }], max_tokens: 32, stream: false });
    out.suggestedFormat = out.responses.ok ? 'responses' : out.chat.ok ? 'chat' : null;
    return out;
  }
}
