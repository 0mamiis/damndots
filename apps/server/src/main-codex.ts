import { existsSync, readFileSync } from 'node:fs';
import { win32, posix } from 'node:path';
import type { ToolDefinition, RecordStore, RunnerHooks } from '@dots/contracts';
import { RpcClient, RpcError } from './runtime/runner.js';
import {delegationInput,delegationMessage,delegationText,type CodexSender} from './codex-sender.js';

/**
 * Dot'un, bu sunucudaki ANA Codex'in (Codex uygulamasında "VPS" ortamı olarak görünen) proje sohbetlerini
 * yönetmesini sağlar: proje listesi, sohbet listesi/okuma, yeni sohbet açma, mesaj gönderme, bekleme, durdurma.
 * Bağlantı scripts/codex-main-bridge.cjs köprüsü üzerinden, token ile yapılır. Köprü kurulu değilse araçlar listelenmez.
 */
const str = { type: 'string' };
const num = { type: 'number' };
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const clip = (value: unknown, max: number) => { const text = String(value ?? ''); return text.length > max ? text.slice(0, max) + '…' : text; };
const clamp = (value: unknown, min: number, max: number, fallback: number) => { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback; };
const iso = (seconds: unknown) => typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null;
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
  const timer = setTimeout(done, ms);
  const abort = () => { clearTimeout(timer); reject(signal?.reason ?? new Error('aborted')); };
  signal?.addEventListener('abort', abort, { once: true });
});

export interface MainCodexOptions { url: string; tokenFile: string; enabled: boolean; }
export interface CodexExecution {
  fullAccess:boolean;
  onApproval?:RunnerHooks['onApproval'];
  onUserInput?:RunnerHooks['onUserInput'];
}
export function codexPermissions(fullAccess:boolean){
  return {approvalPolicy:fullAccess?'never':'on-request',sandbox:fullAccess?'danger-full-access':'workspace-write'} as const;
}
export function codexTurnPermissions(fullAccess:boolean,cwd:string){
  return {approvalPolicy:fullAccess?'never':'on-request',sandboxPolicy:fullAccess?{type:'dangerFullAccess'}:{type:'workspaceWrite',writableRoots:[cwd],networkAccess:false,excludeTmpdirEnvVar:false,excludeSlashTmp:false}};
}
export function mainCodexOptions(env: NodeJS.ProcessEnv = process.env): MainCodexOptions {
  return {
    url: env.DOTS_MAIN_CODEX_URL || 'ws://127.0.0.1:9913',
    tokenFile: env.DOTS_MAIN_CODEX_TOKEN_FILE || (process.platform === 'win32' ? 'C:\\ProgramData\\DotsCodexBridge\\token.txt' : '/etc/dots-codex-bridge/token.txt'),
    enabled: env.DOTS_MAIN_CODEX_DISABLE !== '1',
  };
}

const pathApiFor=(path:string)=>/^[a-z]:|^\\\\/i.test(path.replace(/^\\\\\?\\/,'') )?win32:posix;
/** Karşılaştırma için: mutlak, sonda ayraçsuz, Windows'ta küçük harfli yol. */
export function normalizeProjectPath(input: string): string {
  const stripped = String(input).replace(/^\\\\\?\\/, '');
  const pathApi=pathApiFor(stripped);
  const resolved = pathApi.resolve(stripped).replace(/[\\/]+$/, '');
  return pathApi===win32 ? resolved.toLowerCase() : resolved;
}
/** cwd, güvenilen bir proje klasörünün kendisi ya da altındaysa true. */
export function isInsideTrustedProject(cwd: string, trusted: string[]): boolean {
  const pathApi=pathApiFor(cwd);
  if (!pathApi.isAbsolute(cwd) || /^(\\\\|\/\/)/.test(cwd.replace(/^\\\\\?\\/, ''))) return false;
  const target = normalizeProjectPath(cwd), sep = pathApi.sep;
  return trusted.filter(root=>pathApiFor(root)===pathApi).map(normalizeProjectPath).some(root => target === root || target.startsWith(root + sep));
}

const THREAD_TOOLS: ToolDefinition[] = [
  { name: 'codex_projects_list', description: 'List the projects (folders) that the main Codex on this server is allowed to work in. These are the projects shown in the Codex app under the VPS environment. Use the returned path as cwd for codex_thread_start.', inputSchema: schema({}) },
  { name: 'codex_threads_list', description: 'List recent Codex chats (threads) on this server, newest first. Optionally filter by project folder (cwd) or a search term. Returns thread ids, titles, project folder and whether each chat is running.', inputSchema: schema({ cwd: str, search: str, limit: num }) },
  { name: 'codex_thread_read', description: 'Read the latest turns of a Codex chat: what was asked, the agent’s last reply, and how many commands/file changes it made.', inputSchema: schema({ threadId: str, turns: num }, ['threadId']) },
  { name: 'codex_thread_start', description: 'Create a NEW Codex chat in a trusted project and send it a first message. Execution follows the Dot owner’s permission setting. The agent works in the background on this server even while a separate client PC is off. waitSeconds (0-60) waits for a quick reply; otherwise use codex_thread_wait later. Only use when the user asked for this work.', inputSchema: schema({ cwd: str, message: str, name: str, model: str, waitSeconds: num }, ['cwd', 'message']) },
  { name: 'codex_thread_send', description: 'Send a follow-up message to an existing Codex chat. If the chat is busy the message is added to the running turn. waitSeconds (0-60) waits for the reply.', inputSchema: schema({ threadId: str, message: str, waitSeconds: num }, ['threadId', 'message']) },
  { name: 'codex_thread_wait', description: 'Wait up to waitSeconds (1-60) for a running Codex chat to finish its current turn and return the result. Call again if status is still running. If needsHuman is true the chat waits for an approval or an answer in the Codex app.', inputSchema: schema({ threadId: str, waitSeconds: num }, ['threadId']) },
  { name: 'codex_thread_interrupt', description: 'Stop the turn that is currently running in a Codex chat.', inputSchema: schema({ threadId: str }, ['threadId']) },
];
export const MAIN_CODEX_TOOL_NAMES = new Set(THREAD_TOOLS.map(t => t.name));

export class MainCodex {
  private background=new Map<string,{rpc:RpcClient;timer:ReturnType<typeof setTimeout>}>();
  constructor(private options: MainCodexOptions = mainCodexOptions(), private store?: RecordStore) {}
  available(): boolean { return this.options.enabled && existsSync(this.options.tokenFile); }
  definitions(): ToolDefinition[] { return this.available() ? THREAD_TOOLS : []; }

  close(){for(const {rpc,timer}of this.background.values()){clearTimeout(timer);rpc.close();}this.background.clear();}
  private async withClient<T>(fn: (rpc: RpcClient,bind:(id:string)=>void) => Promise<T>, execution:CodexExecution, target?:string, keepRunning=false): Promise<T> {
    if (!this.available()) throw new Error('Main Codex bridge is not installed on this server');
    const token = readFileSync(this.options.tokenFile, 'utf8').trim();
    const endpoint=new URL(this.options.url);
    if(endpoint.protocol!=='wss:'&&!(endpoint.protocol==='ws:'&&['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)))throw new Error('Main Codex requires a loopback tunnel or WSS');
    const rpc = new RpcClient({ url: this.options.url, token, requestTimeoutMs: 60_000 });
    let retained=false,completed=false;
    const release=()=>{const item=target?this.background.get(target):undefined;if(item?.rpc===rpc){clearTimeout(item.timer);this.background.delete(target!);}rpc.close();};
    rpc.subscribe(message=>{if(message.method==='turn/completed'&&message.params?.threadId===target){completed=true;if(retained)release();}});
    rpc.onFailure(()=>{const item=target?this.background.get(target):undefined;if(item?.rpc===rpc){clearTimeout(item.timer);this.background.delete(target!);}});
    rpc.onRequest(async(method,params)=>{
      if(!target||params.threadId!==target)throw new RpcError('Request is not owned by this Codex chat',-32602);
      if(['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval'].includes(method)){
        const approved=execution.fullAccess||await execution.onApproval?.({kind:method,title:params.command??params.reason??'Codex permission request',detail:JSON.stringify(params),request:params})===true;
        return method==='item/permissions/requestApproval'?{permissions:approved?params.permissions??{}:{},scope:'turn'}:{decision:approved?'accept':'decline'};
      }
      if(method==='item/tool/requestUserInput'||method==='tool/requestUserInput'){
        const answer=await execution.onUserInput?.({kind:'user_input',title:'Codex needs an answer',detail:JSON.stringify(params.questions??[]),request:params});
        return answer??{answers:{}};
      }
      if(method==='mcpServer/elicitation/request'&&(params.mode==='form'||params.mode==='openai/form')){
        const answer=await execution.onUserInput?.({kind:'form_input',title:params.message??'Codex needs form input',detail:JSON.stringify(params.requestedSchema),request:params});
        return {action:answer?.content?'accept':'decline',content:answer?.content??null};
      }
      throw new RpcError('Answer this interactive request in the target Codex chat: '+method,-32601);
    });
    try {
      await rpc.connect();
      await rpc.request('initialize', { clientInfo: { name: 'dots_main_codex', title: 'Dots', version: '0.1.0' }, capabilities: { experimentalApi: true } });
      rpc.notify('initialized');
      const result=await fn(rpc,id=>{target=id;});
      if(keepRunning&&target&&!completed&&(result as any)?.finished===false&&!this.background.has(target)){
        retained=true;
        const timer=setTimeout(release,30*60_000);timer.unref();
        this.background.set(target,{rpc,timer});
      }
      return result;
    } finally { if(!retained)rpc.close(); }
  }

  private async trustedRoots(rpc: RpcClient): Promise<string[]> {
    const response = await rpc.request<any>('config/read', { includeLayers: false });
    const projects = (response.config ?? response).projects ?? {};
    return Object.entries<any>(projects).filter(([, v]) => v?.trust_level === 'trusted').map(([path]) => path);
  }
  private async assertTrusted(rpc: RpcClient, cwd: unknown): Promise<string> {
    if (typeof cwd !== 'string' || !cwd.trim()) throw new Error('cwd is required');
    const roots = await this.trustedRoots(rpc);
    if (!isInsideTrustedProject(cwd, roots)) throw new Error('This folder is not a trusted Codex project on this server. Use codex_projects_list.');
    // The selected app-server validates its own filesystem when starting the thread.
    return pathApiFor(cwd).resolve(cwd.replace(/^\\\\\?\\/, ''));
  }

  private statusOf(thread: any): { status: string; needsHuman: boolean } {
    const s = thread?.status;
    if (s?.type === 'active') { const waiting = (s.activeFlags ?? []).length > 0; return { status: waiting ? 'waiting_for_human' : 'running', needsHuman: waiting }; }
    if (s?.type === 'systemError') return { status: 'error', needsHuman: false };
    return { status: 'idle', needsHuman: false };
  }
  private threadView(thread: any) {
    const { status, needsHuman } = this.statusOf(thread);
    return { threadId: thread.id, title: thread.name || clip(thread.preview, 80) || null, cwd: thread.cwd, status, needsHuman, model: thread.model ?? null, updatedAt: iso(thread.updatedAt), createdAt: iso(thread.createdAt) };
  }
  private turnView(turn: any) {
    const items: any[] = turn.items ?? [];
    const user = items.find(i => i.type === 'userMessage');
    const delegated = items.find(i => i.type === 'functionCallOutput' && i.namespace==='codex_app' && ['create_thread','send_message_to_thread'].includes(i.name) && typeof i.output==='string');
    const replies = items.filter(i => i.type === 'agentMessage');
    const last = replies[replies.length - 1];
    const asked = user ? delegationText((user.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')) : delegated ? delegationText(delegated.output) : undefined;
    return { turnId: turn.id, status: turn.status, error: turn.error ?? undefined, asked: asked ? clip(asked, 600) : undefined, reply: last ? clip(last.text, 3000) : undefined, commands: items.filter(i => i.type === 'commandExecution').length, fileChanges: items.filter(i => i.type === 'fileChange').length, startedAt: iso(turn.startedAt), completedAt: iso(turn.completedAt) };
  }
  private async readThread(rpc: RpcClient, threadId: unknown, withTurns: boolean): Promise<any> {
    if (typeof threadId !== 'string' || !threadId.trim()) throw new Error('threadId is required');
    const result = await rpc.request<any>('thread/read', { threadId, includeTurns: withTurns });
    await this.assertTrusted(rpc, result.thread.cwd);
    return result.thread;
  }
  /** Turu bitene, insan girdisi gerekene ya da süre dolana kadar bekler. */
  private async settle(rpc: RpcClient, threadId: string, turnId: string | undefined, seconds: number, signal?: AbortSignal) {
    const deadline = Date.now() + seconds * 1000;
    for (;;) {
      const thread = (await rpc.request<any>('thread/read', { threadId, includeTurns: true })).thread;
      const turns: any[] = thread.turns ?? [];
      const turn = turnId ? turns.find(t => t.id === turnId) : turns[turns.length - 1];
      const { status, needsHuman } = this.statusOf(thread);
      const finished = !!turn && turn.status !== 'inProgress';
      if (finished || needsHuman || Date.now() >= deadline) {
        return { ...this.threadView(thread), turn: turn ? this.turnView(turn) : undefined, finished, running: !finished && !needsHuman, ...(status === 'error' ? { error: 'Codex reported a system error for this chat' } : {}) };
      }
      await sleep(2000, signal);
    }
  }

  async call(name: string, args: Record<string, any>, signal?: AbortSignal, sender?:CodexSender, execution:CodexExecution={fullAccess:false}): Promise<unknown> {
    signal?.throwIfAborted();
    return this.withClient(async (rpc,bind) => {
      switch (name) {
        case 'codex_projects_list': {
          const roots = await this.trustedRoots(rpc);
          return roots.map(path => ({ name: pathApiFor(path).basename(path), path }));
        }
        case 'codex_threads_list': {
          const params: Record<string, unknown> = { limit: clamp(args.limit, 1, 30, 15), sortKey: 'updated_at', sortDirection: 'desc', archived: false };
          if (typeof args.cwd === 'string' && args.cwd.trim()) params.cwd = args.cwd;
          if (typeof args.search === 'string' && args.search.trim()) params.searchTerm = args.search;
          const list = await rpc.request<any>('thread/list', params);
          return (list.data ?? []).map((t: any) => this.threadView(t));
        }
        case 'codex_thread_read': {
          const thread = await this.readThread(rpc, args.threadId, true);
          const count = clamp(args.turns, 1, 10, 2), turns: any[] = thread.turns ?? [];
          return { ...this.threadView(thread), turns: turns.slice(-count).map(t => this.turnView(t)) };
        }
        case 'codex_thread_start': {
          if (typeof args.message !== 'string' || !args.message.trim()) throw new Error('message is required');
          const cwd = await this.assertTrusted(rpc, args.cwd);
          const started = await rpc.request<any>('thread/start', { cwd, ...codexPermissions(execution.fullAccess), ...(typeof args.model === 'string' && args.model.trim() ? { model: args.model.trim() } : {}) });
          const threadId: string = started.thread.id;
          bind(threadId);
          this.store?.put('main_codex_threads', {id:threadId,cwd,createdAt:new Date().toISOString()});
          await rpc.request('thread/name/set', { threadId, name: 'Dot · ' + clip((typeof args.name === 'string' && args.name.trim()) || args.message.replace(/\s+/g, ' '), 60) });
          const turn = await rpc.request<any>('turn/start', { threadId, ...codexTurnPermissions(execution.fullAccess,cwd), ...(sender?{...delegationInput(args.message,sender,'create_thread'),turnTrigger:'create_thread'}:{input:[{type:'text',text:args.message,text_elements:[]}]}) });
          return this.settle(rpc, threadId, turn.turn.id, clamp(args.waitSeconds, 0, 60, 20), signal);
        }
        case 'codex_thread_send': {
          if (typeof args.message !== 'string' || !args.message.trim()) throw new Error('message is required');
          const thread = await this.readThread(rpc, args.threadId, true);
          const dotOwned = !!this.store?.get('main_codex_threads', thread.id);
          const input = [{ type: 'text', text: sender?delegationMessage(args.message,sender):args.message, text_elements: [] }];
          const running = (thread.turns ?? []).find((t: any) => t.status === 'inProgress');
          let turnId: string;
          if (running && thread.status?.type === 'active') {
            if(!execution.fullAccess)throw new Error('Restricted execution cannot steer an active chat with unknown permissions; wait for it to finish first');
            await rpc.request('turn/steer', { threadId: thread.id, input, expectedTurnId: running.id });
            turnId = running.id;
          } else {
            if (thread.status?.type === 'notLoaded') {
              await rpc.request<any>('thread/resume', { threadId: thread.id, excludeTurns: true, ...(dotOwned||!execution.fullAccess?codexPermissions(execution.fullAccess):{}) });
            }
            turnId = (await rpc.request<any>('turn/start', { threadId: thread.id, ...(sender?{...delegationInput(args.message,sender,'send_message_to_thread'),turnTrigger:'send_message_to_thread'}:{input}), ...(dotOwned||!execution.fullAccess?codexTurnPermissions(execution.fullAccess,thread.cwd):{}) })).turn.id;
          }
          return this.settle(rpc, thread.id, turnId, clamp(args.waitSeconds, 0, 60, 20), signal);
        }
        case 'codex_thread_wait': {
          const thread = await this.readThread(rpc, args.threadId, false);
          return this.settle(rpc, thread.id, undefined, clamp(args.waitSeconds, 1, 60, 30), signal);
        }
        case 'codex_thread_interrupt': {
          const thread = await this.readThread(rpc, args.threadId, true);
          const running = (thread.turns ?? []).find((t: any) => t.status === 'inProgress');
          if (!running) return { threadId: thread.id, interrupted: false, message: 'No turn is running in this chat' };
          await rpc.request('turn/interrupt', { threadId: thread.id, turnId: running.id });
          return { threadId: thread.id, interrupted: true, turnId: running.id };
        }
        default: throw new Error('Unknown Codex tool');
      }
    },execution,typeof args.threadId==='string'?args.threadId:undefined,['codex_thread_start','codex_thread_send'].includes(name));
  }
}
