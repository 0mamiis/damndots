import WebSocket from 'ws';
import { stat, realpath, readdir } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve } from 'node:path';
import type { Output, RunInput, RunResult, RunnerHooks, TaskRunner, ToolDefinition } from '@dots/contracts';

type Wire = {id?:string|number;method?:string;params?:Record<string,any>;result?:any;error?:{code:number;message:string;data?:unknown}};
export interface RpcTransport {
  readyState:number;
  on(event:string,listener:(...args:any[])=>void):unknown;
  off(event:string,listener:(...args:any[])=>void):unknown;
  send(data:string):unknown;
  close():unknown;
  terminate?():unknown;
}
export interface RpcClientOptions {
  url:string;
  token?:string;
  requestTimeoutMs?:number;
  transportFactory?:(url:string,headers:Record<string,string>)=>RpcTransport;
}
export class RpcError extends Error {
  constructor(message:string,readonly code:number,readonly data?:unknown) {super(message);}
}
/** The App Server protocol intentionally omits the jsonrpc header. */
export class RpcClient {
  private socket:RpcTransport|undefined;
  private connecting:Promise<void>|undefined;
  private sequence=0;
  private pending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private listeners=new Set<(message:Wire)=>void>();
  private failureListeners=new Set<(error:Error)=>void>();
  private requestHandler:((method:string,params:Record<string,any>,id:string|number)=>Promise<unknown>)|undefined;
  constructor(readonly options:RpcClientOptions) {}
  connect():Promise<void> {
    if(this.socket?.readyState===WebSocket.OPEN) return Promise.resolve();
    if(this.connecting) return this.connecting;
    this.connecting=new Promise<void>((resolveConnect,rejectConnect)=>{
      const headers:Record<string,string>=this.options.token?{Authorization:`Bearer ${this.options.token}`} : {};
      const socket=this.options.transportFactory?.(this.options.url,headers)??new WebSocket(this.options.url,{headers});
      this.socket=socket;
      let opened=false;
      const timer=setTimeout(()=>{socket.terminate?.();rejectConnect(new Error('Codex App Server connection timed out'));},this.options.requestTimeoutMs??30_000);
      const onOpen=()=>{opened=true;clearTimeout(timer);resolveConnect();};
      socket.on('open',onOpen);
      socket.on('message',(data:any)=>{try {this.receive(JSON.parse(String(data)) as Wire);} catch(e) {this.fail(e instanceof Error?e:new Error(String(e)));}});
      socket.on('error',(error:Error)=>{clearTimeout(timer);if(!opened) rejectConnect(error);this.fail(error);});
      socket.on('close',()=>{clearTimeout(timer);const error=new Error('Codex App Server disconnected');if(!opened) rejectConnect(error);this.fail(error);this.socket=undefined;this.connecting=undefined;});
      if(socket.readyState===WebSocket.OPEN) onOpen();
    });
    return this.connecting;
  }
  private fail(error:Error):void {
    for(const p of this.pending.values()) {clearTimeout(p.timer);p.reject(error);}this.pending.clear();
    for(const listener of this.failureListeners) listener(error);
  }
  onFailure(listener:(error:Error)=>void):()=>void {this.failureListeners.add(listener);return ()=>this.failureListeners.delete(listener);}
  private receive(message:Wire):void {
    if(message.id!==undefined&&!message.method) {
      const pending=this.pending.get(String(message.id));
      if(pending) {this.pending.delete(String(message.id));clearTimeout(pending.timer);if(message.error) pending.reject(new RpcError(message.error.message,message.error.code,message.error.data));else pending.resolve(message.result);}return;
    }
    if(message.id!==undefined&&message.method) {
      const requestId=message.id;
      Promise.resolve().then(()=>{
        if(!this.requestHandler) throw new RpcError('Client does not support this server request',-32601);
        return this.requestHandler(message.method!,message.params??{},requestId);
      }).then(result=>this.send({id:requestId,result}),error=>this.send({id:requestId,error:{code:error instanceof RpcError?error.code:-32603,message:error instanceof Error?error.message:String(error)}})).catch(()=>{});return;
    }
    for(const listener of this.listeners) {try {listener(message);} catch(e) {this.fail(e instanceof Error?e:new Error(String(e)));}}
  }
  private send(message:Wire):void {if(this.socket?.readyState!==WebSocket.OPEN) throw new Error('Codex App Server is not connected');this.socket.send(JSON.stringify(message));}
  async request<T=any>(method:string,params:Record<string,unknown>={}):Promise<T> {
    await this.connect();
    const requestId=String(++this.sequence);
    return new Promise<T>((resolveRequest,rejectRequest)=>{
      const timer=setTimeout(()=>{this.pending.delete(requestId);rejectRequest(new Error(`Codex RPC ${method} timed out`));},this.options.requestTimeoutMs??30_000);
      this.pending.set(requestId,{resolve:resolveRequest,reject:rejectRequest,timer});
      try {this.send({id:requestId,method,params});} catch(e) {clearTimeout(timer);this.pending.delete(requestId);rejectRequest(e);}
    });
  }
  notify(method:string,params:Record<string,unknown>={}):void {this.send({method,params});}
  subscribe(listener:(message:Wire)=>void):()=>void {this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  onRequest(handler:(method:string,params:Record<string,any>,id:string|number)=>Promise<unknown>):void {this.requestHandler=handler;}
  close():void {this.fail(new Error('Codex RPC client closed'));this.socket?.close();this.socket=undefined;this.connecting=undefined;this.listeners.clear();this.failureListeners.clear();}
}
export interface AppServerRunnerOptions extends RpcClientOptions {
  model?:string|null;
  reasoningEffort?:string|null;
  serviceTier?:string|null;
  cwd?:string;
  /** Absolute roots allowed for actual artifacts. Defaults to the task cwd. */
  outputRoots?:string[]|((input:RunInput)=>string[]);
  attachmentRoots?:string[];
  tools?:(input:RunInput)=>ToolDefinition[]|Promise<ToolDefinition[]>;
  onToolCall?:(name:string,args:Record<string,unknown>,input:RunInput,signal:AbortSignal)=>Promise<unknown>;
  clientFactory?:()=>RpcClient;
  turnTimeoutMs?:number;
  interruptTimeoutMs?:number;
  approvalPolicy?:'on-request'|'untrusted'|'never';
  sandbox?:'read-only'|'workspace-write'|'danger-full-access';
  threadHasTools?:(threadId:string)=>boolean|Promise<boolean>;
  onToolsThread?:(threadId:string)=>void;
  contextHistory?:(input:RunInput)=>string|Promise<string>;
}
function abortError():Error {const error=new Error('Codex turn interrupted');error.name='AbortError';return error;}
function within(root:string,path:string):boolean {const rel=relative(root,path);return !rel||(!rel.startsWith(`..${process.platform==='win32'?'\\':'/'}`)&&rel!=='..'&&!isAbsolute(rel));}
const mimes:Record<string,string>={'.md':'text/markdown','.txt':'text/plain','.json':'application/json','.html':'text/html','.csv':'text/csv','.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.mp3':'audio/mpeg','.wav':'audio/wav','.mp4':'video/mp4','.zip':'application/zip'};
export async function inspectOutput(path:string,roots:string[],computerId:string|null=null):Promise<Omit<Output,'id'|'dotId'|'taskId'|'createdAt'>> {
  if(!isAbsolute(path)) throw new Error('Artifact path must be absolute');
  const canonical=await realpath(path);
  const canonicalRoots=await Promise.all(roots.map(root=>realpath(root)));
  if(!canonicalRoots.some(root=>within(root,canonical))) throw new Error('Artifact path escapes the allowed workspace');
  const info=await stat(canonical);
  if(!info.isFile()) throw new Error('Artifact must be a file');
  return {path:canonical,name:basename(canonical),mimeType:mimes[extname(canonical).toLowerCase()]??'application/octet-stream',size:info.size,computerId};
}
async function snapshotArtifacts(cwd:string):Promise<Map<string,string>> {
  const result=new Map<string,string>();
  async function scan(directory:string,depth:number):Promise<void> {
    if(depth>8||result.size>=1000) return;
    let entries;try {entries=await readdir(directory,{withFileTypes:true});} catch {return;}
    for(const entry of entries) {
      if(entry.isSymbolicLink()) continue;
      const path=resolve(directory,entry.name);
      if(entry.isDirectory()) await scan(path,depth+1);
      else if(entry.isFile()) {const info=await stat(path);result.set(path,`${info.size}:${info.mtimeMs}`);}
    }
  }
  for(const folder of ['outputs','output','artifacts']) await scan(resolve(cwd,folder),0);
  return result;
}

/** One WebSocket per execution isolates concurrent rooms and server request ownership. */
export class AppServerRunner implements TaskRunner {
  constructor(readonly options:AppServerRunnerOptions) {}
  async run(input:RunInput,hooks:RunnerHooks,signal:AbortSignal):Promise<RunResult> {
    if(signal.aborted) throw abortError();
    const client=this.options.clientFactory?.()??new RpcClient(this.options);
    const cwd=resolve(input.task.cwd??this.options.cwd??process.cwd());
    const roots=typeof this.options.outputRoots==='function'?this.options.outputRoots(input):this.options.outputRoots??[cwd];
    const baseline=await snapshotArtifacts(cwd);
    const candidates=new Set<string>();
    const emitted=new Set<string>();
    const finalMessages=new Map<string,{text:string;phase?:string}>();
    const streamed=new Map<string,string>();
    let threadId=input.task.threadId??'';
    let turnId:string|null=null;
    let pendingComplete:Record<string,any>|undefined;
    let settled=false;
    let interruption:Promise<void>|undefined;
    let interruptionFailure:Error|undefined;
    let resolveCompletion!:(value:Record<string,any>)=>void;
    let rejectCompletion!:(reason:Error)=>void;
    const completion=new Promise<Record<string,any>>((resolveDone,rejectDone)=>{resolveCompletion=resolveDone;rejectCompletion=rejectDone;});
    // Errors can arrive during thread/start, before completion is awaited.
    void completion.catch(()=>{});
    const fail=(error:Error)=>{if(!settled) {settled=true;rejectCompletion(error);}};
    const complete=(turn:Record<string,any>)=>{if(!settled) {settled=true;resolveCompletion(turn);}};
    const interrupt=()=>{
      if(!threadId||!turnId||interruption||settled) return;
      hooks.onActivity('turn.interrupt.requested','Interrupting Codex turn',{threadId,turnId});
      interruption=client.request('turn/interrupt',{threadId,turnId}).then(()=>{hooks.onActivity('turn.interrupt.acknowledged','Codex acknowledged interruption',{threadId,turnId});}).catch(error=>{interruptionFailure=error instanceof Error?error:new Error(String(error));fail(interruptionFailure);});
    };
    const onAbort=()=>interrupt();
    signal.addEventListener('abort',onAbort);
    const unsubscribeFailure=client.onFailure(fail);
    const unsubscribe=client.subscribe(message=>{
      const p=message.params??{};
      if(p.threadId!==threadId) return;
      if(p.turnId&&turnId&&p.turnId!==turnId) return;
      if(message.method==='turn/started'&&p.turn?.id) {turnId=p.turn.id;hooks.onTurn(turnId!);if(signal.aborted) interrupt();}
      else if(message.method==='item/agentMessage/delta') {const key=p.itemId??'message';streamed.set(key,(streamed.get(key)??'')+String(p.delta??''));hooks.onDelta(String(p.delta??''));}
      else if(message.method==='item/started'||message.method==='item/completed') {
        const item=p.item??{};
        hooks.onActivity(message.method,item.type??'Codex activity',{item});
        if(message.method==='item/completed'&&item.type==='agentMessage') finalMessages.set(item.id??'message',{text:item.text??'',phase:item.phase});
        if(message.method==='item/completed'&&item.type==='fileChange'&&item.status==='completed') for(const change of item.changes??[]) if(typeof change.path==='string') candidates.add(resolve(cwd,change.path));
      }
      else if(message.method==='turn/completed') {
        const turn=p.turn??{};
        if(turnId&&turn.id!==turnId) return;
        if(!turnId) pendingComplete=turn;else complete(turn);
      }
      else if(message.method==='error') hooks.onActivity('codex.error',p.error?.message??'Codex error',p);
      else if(message.method) hooks.onActivity(message.method,message.method,p);
    });
    client.onRequest(async(method,p)=>{
      if(p.threadId!==threadId||(p.turnId&&turnId&&p.turnId!==turnId)) throw new RpcError('Server request is not owned by this task',-32602);
      if(method==='item/tool/call') {
        if(signal.aborted) return {success:false,contentItems:[{type:'inputText',text:'Task cancelled'}]};
        if(!this.options.onToolCall) return {success:false,contentItems:[{type:'inputText',text:'Dynamic tool adapter is not configured'}]};
        try {
          const args=typeof p.arguments==='string'?JSON.parse(p.arguments):p.arguments??{};
          const result=await this.options.onToolCall(p.namespace?`${p.namespace}.${p.tool}`:p.tool,args,input,signal);
          if(result&&typeof result==='object'&&'contentItems' in result&&'success' in result) return result;
          return {success:true,contentItems:[{type:'inputText',text:typeof result==='string'?result:JSON.stringify(result??null)}]};
        } catch(e) {return {success:false,contentItems:[{type:'inputText',text:e instanceof Error?e.message:String(e)}]};}
      }
      if(method==='item/commandExecution/requestApproval'||method==='item/fileChange/requestApproval'||method==='item/permissions/requestApproval') {
        const approved=!signal.aborted&&input.task.source!=='proactive'&&(input.fullAccess===true||await hooks.onApproval({kind:method,title:p.command??p.reason??'Codex permission request',detail:JSON.stringify(p,null,2),request:p}));
        if(method==='item/permissions/requestApproval') return {permissions:approved?p.permissions??{}:{},scope:'turn'};
        return {decision:approved?'accept':'decline'};
      }
      if(method==='mcpServer/elicitation/request') {
        if(p.mode==='form'||p.mode==='openai/form') {
          if(!hooks.onUserInput) throw new RpcError('Structured user input is not configured',-32601);
          if(signal.aborted||input.task.source==='proactive') return {action:'decline',content:null};
          const resolution=await hooks.onUserInput({kind:'form_input',title:p.message??'MCP needs structured input',detail:JSON.stringify(p.requestedSchema),request:p});
          return {action:resolution?.content?'accept':'decline',content:resolution?.content??null};
        }
        const approved=!signal.aborted&&input.task.source!=='proactive'&&await hooks.onApproval({kind:method,title:p.message??'MCP approval',detail:JSON.stringify(p),request:p});
        return {action:approved&&p.mode==='url'?'accept':'decline',content:null};
      }
      if(method==='item/tool/requestUserInput'||method==='tool/requestUserInput') {
        if(!hooks.onUserInput) throw new RpcError('Interactive user input is not configured',-32601);
        const resolution=await hooks.onUserInput({kind:'user_input',title:'Codex needs a user answer',detail:JSON.stringify(p.questions??[]),request:p});
        if(!resolution) return {answers:{}};
        return resolution;
      }
      throw new RpcError(`Unsupported Codex server request: ${method}`,-32601);
    });
    const timer=setTimeout(()=>{interrupt();fail(new Error('Codex turn timed out'));},this.options.turnTimeoutMs??30*60_000);
    let abortTimer:ReturnType<typeof setTimeout>|undefined;
    const boundAbort=()=>{abortTimer=setTimeout(()=>fail(new Error('Codex did not confirm turn interruption')),this.options.interruptTimeoutMs??15_000);};
    signal.addEventListener('abort',boundAbort,{once:true});
    try {
      await client.connect();
      if(signal.aborted) throw abortError();
      await client.request('initialize',{clientInfo:{name:'dots_self_hosted',title:'Dots Self Hosted',version:'0.1.0'},capabilities:{experimentalApi:true}});
      client.notify('initialized');
      const model=input.task.model??input.dot.model??this.options.model??null;
      const effort=input.task.reasoningEffort??input.dot.reasoningEffort??this.options.reasoningEffort??null;
      const serviceTier=input.task.serviceTier??input.dot.serviceTier??this.options.serviceTier??null;
      const proactive=input.task.source==='proactive';
      const tools=await this.options.tools?.(input)??[];
      const incompatibleThread=threadId&&tools.length&&this.options.threadHasTools?!(await this.options.threadHasTools(threadId)):false;
      let migratedThread:string|null=null;
      let history='';
      if(incompatibleThread&&!input.task.turnId) {
        if(!this.options.contextHistory) throw new Error('Thread tool migration requires durable conversation context');
        history=await this.options.contextHistory(input);
        migratedThread=threadId;threadId='';
        hooks.onActivity('thread.migration.started','Migrating the conversation to a thread with configured tools',{previousThreadId:migratedThread});
      }
      const fullAccess=input.fullAccess===true&&!proactive;
      const threadParams:Record<string,unknown>={model,cwd,approvalPolicy:proactive||fullAccess?'never':this.options.approvalPolicy??'on-request',sandbox:proactive?'read-only':fullAccess?'danger-full-access':this.options.sandbox??'workspace-write',serviceTier,config:effort?{model_reasoning_effort:effort}:{},developerInstructions:input.dot.instructions||undefined};
      if(tools.length&&!threadId) threadParams.dynamicTools=tools.map(tool=>({type:'function',name:tool.name,description:tool.description,inputSchema:tool.inputSchema}));
      if(threadId) threadParams.threadId=threadId;
      const thread=await client.request(threadId?'thread/resume':'thread/start',threadParams);
      threadId=thread.thread?.id;
      if(!threadId) throw new Error('Codex App Server did not return a thread id');
      if(tools.length&&!threadParams.threadId) this.options.onToolsThread?.(threadId);
      hooks.onThread(threadId);
      if(migratedThread) hooks.onActivity('thread.migrated','Conversation continued in a thread with configured tools',{previousThreadId:migratedThread,threadId,historyPreserved:true});
      let turns=thread.thread?.turns??[];
      let prior=input.task.turnId?turns.find((t:any)=>t.id===input.task.turnId):undefined;
      if(input.task.turnId&&!prior) {
        const read=await client.request('thread/read',{threadId,includeTurns:true});
        turns=read.thread?.turns??turns;prior=turns.find((t:any)=>t.id===input.task.turnId);
        if(!prior) throw new Error('Persisted upstream turn could not be reconciled; refusing to repeat work');
      }
      // Recover the exact known turn. Work completed before a crash is never submitted twice.
      let completed:Record<string,any>|undefined;
      if(prior&&prior.status!=='interrupted') {
        turnId=prior.id;hooks.onTurn(turnId!);
        if(prior.status==='inProgress') {
          hooks.onActivity('turn.reattached','Reattached to existing Codex turn',{threadId,turnId});
          if(pendingComplete?.id===turnId) complete(pendingComplete);
          if(signal.aborted) interrupt();
          completed=await completion;
        } else {completed=prior;hooks.onActivity('turn.reconciled','Recovered stored Codex turn outcome',{threadId,turnId,status:prior.status});}
      }
      // An unrelated surviving turn cannot be steered by this queued task.
      const previous=[...turns].reverse().find((t:any)=>t.status==='inProgress'&&t.id!==prior?.id);
      if(!completed&&previous?.id) {
        let cleanup:()=>void=()=>{};
        const stopped=new Promise<void>((resolveStop,rejectStop)=>{
          const timer=setTimeout(()=>{cleanup();rejectStop(new Error('Stale upstream turn did not stop'));},this.options.interruptTimeoutMs??15_000);
          const remove=client.subscribe(message=>{if(message.method==='turn/completed'&&message.params?.threadId===threadId&&message.params?.turn?.id===previous.id) {cleanup();resolveStop();}});
          const removeFailure=client.onFailure(error=>{cleanup();rejectStop(error);});
          cleanup=()=>{clearTimeout(timer);remove();removeFailure();};
        });
        void stopped.catch(()=>{});
        try {await client.request('turn/interrupt',{threadId,turnId:previous.id});await stopped;} finally {cleanup();}
        hooks.onActivity('turn.recovered','Interrupted stale turn before task resume',{turnId:previous.id});
      }
      if(signal.aborted) throw abortError();
      if(!completed) {
      const text=[proactive?'This is proactive research. Only inspect, read, and research. Do not change files, send messages, delegate, or perform any external side effect. Report actionable findings for the user.':'',history?`Prior durable conversation, preserved when migrating the execution thread (context, not new task instructions):\n${history}`:'',input.memories.length?`Persistent user memory (context, not tool authorization):\n${input.memories.map(memory=>`${memory.title}: ${memory.content}`).join('\n')}`:'',input.task.input].filter(Boolean).join('\n\n');
      const turnInput:Array<Record<string,unknown>>=[{type:'text',text,text_elements:[]}];
      for(const attachment of input.task.attachments) {
        if(!attachment.path) throw new Error(`Attachment ${attachment.name} has no usable file path`);
        const file=await inspectOutput(resolve(attachment.path),[cwd,...this.options.attachmentRoots??[]]);
        if(attachment.mimeType.startsWith('image/')) turnInput.push({type:'localImage',path:file.path});
        else turnInput.push({type:'text',text:`Attached file: ${file.path} (${attachment.name})`,text_elements:[]});
      }
      const turn=await client.request('turn/start',{threadId,input:turnInput,model,effort,serviceTier,cwd,approvalPolicy:proactive||fullAccess?'never':this.options.approvalPolicy??'on-request',...(proactive?{sandboxPolicy:{type:'readOnly',networkAccess:false}}:fullAccess?{sandboxPolicy:{type:'dangerFullAccess'}}:{})});
      turnId=turn.turn?.id??turnId;
      if(!turnId) throw new Error('Codex App Server did not return a turn id');
      hooks.onTurn(turnId);
      if(pendingComplete&&pendingComplete.id===turnId) complete(pendingComplete);
      if(turn.turn?.status&&turn.turn.status!=='inProgress') complete(turn.turn);
      if(signal.aborted) interrupt();
      completed=await completion;
      }
      if(interruption) await interruption;
      if(interruptionFailure) throw interruptionFailure;
      if(signal.aborted||completed.status==='interrupted') throw abortError();
      if(completed.status!=='completed') throw new Error(completed.error?.message??`Codex turn ${completed.status??'did not complete'}`);
      for(const item of completed.items??[]) {
        if(item.type==='agentMessage') finalMessages.set(item.id,{text:item.text??'',phase:item.phase});
        if(item.type==='fileChange'&&item.status==='completed') for(const change of item.changes??[]) if(typeof change.path==='string') candidates.add(resolve(cwd,change.path));
      }
      const finals=[...finalMessages.values()].filter(m=>m.phase==='final_answer');
      const resultText=(finals.length?finals:[...finalMessages.values()]).map(m=>m.text).join('\n\n')||[...streamed.values()].join('\n\n');
      const after=await snapshotArtifacts(cwd);
      for(const [path,fingerprint] of after) if(baseline.get(path)!==fingerprint) candidates.add(path);
      for(const match of resultText.matchAll(/\]\(<?([^\n)]+?)>?\)/g)) {
        let path=match[1].trim();if(/^[a-z]+:\/\//i.test(path)||path.startsWith('#')) continue;
        path=path.replace(/:\d+(?::\d+)?$/,'');candidates.add(resolve(cwd,path));
      }
      for(const candidate of candidates) {
        try {const output=await inspectOutput(candidate,roots,input.task.computerId);if(!emitted.has(output.path)) {emitted.add(output.path);hooks.onOutput(output);}}
        catch(e) {hooks.onActivity('output.rejected','Artifact was not registered',{path:candidate,reason:e instanceof Error?e.message:String(e)});}
      }
      return {text:resultText,threadId,turnId};
    } finally {
      clearTimeout(timer);if(abortTimer) clearTimeout(abortTimer);
      signal.removeEventListener('abort',onAbort);signal.removeEventListener('abort',boundAbort);unsubscribe();unsubscribeFailure();client.close();
    }
  }
}
