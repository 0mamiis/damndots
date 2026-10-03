import type { RecordStore, RunInput, ToolDefinition } from '@dots/contracts';
import type { OrbitRuntime } from './runtime/index.js';
import type { IntegrationService } from './integrations/index.js';
import type { WorkerBroker } from './workers.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import {dotBrowserSession} from './browser-session.js';
import type {BlobStore} from './blobs.js';
import {MainCodex,MAIN_CODEX_TOOL_NAMES} from './main-codex.js';
import {LocalCodex,LOCAL_CODEX_TOOL_NAMES} from './local-codex.js';
import {codexSender} from './codex-sender.js';
export const toolContext=new AsyncLocalStorage<RunInput>();
const schema=(properties:Record<string,unknown>,required:string[]=[])=>({type:'object',properties,required,additionalProperties:false});
const str={type:'string'};
export class DotTools {
  static VERSION=8;
  private codex:MainCodex;
  private localCodex=new LocalCodex();
  constructor(private runtime:()=>OrbitRuntime,private integrations:()=>IntegrationService,private workers:WorkerBroker,private store:RecordStore,private blobs?:BlobStore){this.codex=new MainCodex(undefined,store);}
  close(){this.codex.close();}
  async list(input:RunInput):Promise<ToolDefinition[]>{
    const tools:ToolDefinition[]=[
      {name:'dot_memory_list',description:'Read the dot’s persistent notes.',inputSchema:schema({})},
      {name:'dot_memory_save',description:'Save a durable note or decision for this dot.',inputSchema:schema({title:str,content:str,tags:{type:'array',items:str}},['title','content'])},
      {name:'dot_task_delegate',description:'Delegate a separate task and track its result.',inputSchema:schema({title:str,input:str,computerId:str},['title','input'])},
      {name:'dot_tasks_list',description:'Inspect delegated work and results.',inputSchema:schema({})},
      {name:'dot_task_continue',description:'Continue an existing tracked task in its real conversation.',inputSchema:schema({taskId:str,input:str,title:str},['taskId','input'])},
      {name:'dot_schedule_create',description:'Create a confirmed recurring or one-off task.',inputSchema:schema({title:str,prompt:str,kind:{type:'string',enum:['interval','once','cron']},intervalSeconds:{type:'number'},cron:str,timezone:str,nextRunAt:str,computerId:str},['title','prompt','kind'])},
      {name:'dot_apps_list',description:'Discover configured apps and their currently available tools.',inputSchema:schema({})},
      {name:'dot_app_call',description:'Call a configured app tool using the owner’s granted scopes and execution policy.',inputSchema:schema({connectorId:str,tool:str,arguments:{type:'object',additionalProperties:true}},['connectorId','tool','arguments'])},
      {name:'dot_computers_list',description:'List actual connected computers and supported operations.',inputSchema:schema({})},
      {name:'dot_browser_action',description:'Use this Dot’s browser, shared with its computer panel. Omit sessionId to reuse the current session. Respects user takeover. Start with open before other actions.',inputSchema:schema({computerId:str,sessionId:str,action:{type:'string',enum:['open','navigate','click','type','press','screenshot','close']},url:str,x:{type:'number'},y:{type:'number'},text:str,key:str},['computerId','action'])},
      {name:'dot_desktop_action',description:'Control the selected computer’s actual desktop: connected PC or isolated Linux. Screenshot coordinates cover the complete scaled 1280x800 primary display. Use list for environment/apps, launch for an app, screenshot/click/type/press for native desktop control. Respects user takeover. In PC mode this controls the owner’s real screen.',inputSchema:schema({computerId:str,action:{type:'string',enum:['list','launch','screenshot','click','type','press']},app:str,x:{type:'number'},y:{type:'number'},button:{type:'number'},text:str,key:str},['computerId','action'])},
      ...this.codex.definitions(),
      ...this.localCodex.definitions(),
    ];
    this.store.put('task_tools',{id:input.task.id,tools});return tools;
  }
  async call(name:string,args:Record<string,any>,input:RunInput,signal:AbortSignal):Promise<unknown>{
    signal.throwIfAborted();const runtime=this.runtime(),dotId=input.dot.id;
    if(input.task.source==='proactive'&&!['dot_memory_list','dot_memory_save','dot_tasks_list','dot_computers_list','dot_apps_list','dot_app_call'].includes(name))throw new Error('Proactive research may only read sources and save private notes');
    return toolContext.run(input,async()=>{
      if(MAIN_CODEX_TOOL_NAMES.has(name))return this.codex.call(name,args,signal,codexSender(this.store,input),{fullAccess:input.fullAccess===true,onApproval:request=>runtime.requestApproval(input.task.id,request),onUserInput:request=>runtime.requestUserInput(input.task.id,request)});
      if(LOCAL_CODEX_TOOL_NAMES.has(name)){
        if(['local_codex_thread_start','local_codex_thread_send'].includes(name)&&input.fullAccess!==true){
          const approved=await runtime.requestApproval(input.task.id,{kind:'codex_chat_dispatch',title:'Send this request to local Codex?',detail:'The target chat follows the Codex desktop permission setting. '+JSON.stringify(args),request:{tool:name,arguments:args}});
          if(!approved)throw new Error('Local Codex dispatch was not approved');
        }
        return this.localCodex.call(name,args,signal,codexSender(this.store,input));
      }
      switch(name){
        case'dot_memory_list':return runtime.listMemories(dotId);
        case'dot_memory_save':return runtime.createMemory({dotId,title:args.title,content:args.content,tags:args.tags||[]});
        case'dot_task_delegate':return runtime.delegateTask(input.task.id,{title:args.title,input:args.input,computerId:args.computerId});
        case'dot_tasks_list':return runtime.listTasks({dotId});
        case'dot_task_continue':{const task=runtime.getTask(args.taskId);if(task.dotId!==dotId)throw new Error('Task belongs to a different dot');return runtime.continueTask(task.id,{input:args.input,title:args.title});}
        case'dot_apps_list':return Promise.all(this.integrations().list().map(async c=>({...c,tools:c.enabled&&c.state!=='needs_configuration'?await this.integrations().tools(c.id).catch(()=>[]):[]})));
        case'dot_app_call':return this.integrations().call(args.connectorId,args.tool,args.arguments||{},{readOnly:input.task.source==='proactive'});
        case'dot_schedule_create':return runtime.createSchedule({dotId,title:args.title,prompt:args.prompt,kind:args.kind,enabled:true,intervalSeconds:args.intervalSeconds??null,cron:args.cron??null,timezone:args.timezone||'UTC',nextRunAt:args.nextRunAt??null,lastRunAt:null,computerId:args.computerId??null,proactive:false} as any);
        case'dot_computers_list':return this.workers.list();
        case'dot_browser_action':{const session=dotBrowserSession(this.store,dotId,args.computerId,args.sessionId);return this.workers.execute(args.computerId,'browser',{...args,sessionId:session.sessionId,dotId,actor:'agent'},undefined,signal);}
        case'dot_desktop_action':{const session=dotBrowserSession(this.store,dotId,args.computerId);const result=await this.workers.execute(args.computerId,'desktop',{...args,sessionId:session.sessionId,dotId,actor:'agent'},undefined,signal);const {screenshot,...metadata}=result;const bytes=typeof screenshot==='string'&&screenshot.length<=8*1024*1024?Buffer.from(screenshot,'base64'):result.screenshotId&&this.blobs?await this.blobs.read(result.screenshotId):null;if(bytes&&bytes.length<=6*1024*1024&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){return {success:true,contentItems:[{type:'inputText',text:JSON.stringify(metadata)},{type:'inputImage',imageUrl:'data:image/png;base64,'+bytes.toString('base64')}]};}return metadata;}
        default:{const all=this.store.get<{id:string;tools:ToolDefinition[]}>('task_tools',input.task.id)?.tools||[];const t=all.find(t=>t.name===name);if(!t?.connectorId)throw new Error('Unknown or unavailable tool');const prefix='app_'+t.connectorId.replaceAll('-','')+'_';return this.integrations().call(t.connectorId,name.slice(prefix.length),args,{readOnly:input.task.source==='proactive'});}
      }
    });
  }
}
