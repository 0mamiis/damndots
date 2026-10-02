import { voiceEffort } from '../voice-text.js';
import { randomUUID, createHash } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';
import Ajv from 'ajv';
import Ajv2019 from 'ajv/dist/2019.js';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { nextRecurrence } from './recurrence.js';
import type { Activity, Approval, CreateTask, Dot, Memory, Message, Output, RecordStore, RunnerHooks, RuntimeEvent, Schedule, SubmitMessage, Task, TaskRunner } from '@dots/contracts';

export { AppServerRunner, RpcClient } from './runner.js';
export type { AppServerRunnerOptions, RpcTransport } from './runner.js';

export class RuntimeError extends Error {
  constructor(message:string, readonly statusCode = 400) { super(message); }
}
export interface RuntimeOptions {
  clock?:()=>Date;
  maxParallelTasks?:number;
  tickMs?:number;
  proactiveEnabled?:boolean;
  defaultCwd?:string;
  defaultComputerId?:()=>string|null;
  /** Read current settings without restarting the runtime. */
  settings?:()=>{maxParallelTasks?:number;proactiveEnabled?:boolean;autoApproveExecution?:boolean;model?:string|null;reasoningEffort?:string|null;serviceTier?:string|null};
}
type DotInput = Partial<Pick<Dot,'model'|'reasoningEffort'|'serviceTier'|'computerId'|'instructions'|'avatarUrl'|'avatarManifest'>> & {name:string};
type ScheduleInput = Omit<Schedule,'id'|'createdAt'|'updatedAt'|'lastRunAt'>;
type ApprovalRequest = Parameters<RunnerHooks['onApproval']>[0];
export interface AttachedThread {
  id:string;dotId:string;threadId:string;computerId:string|null;title:string|null;
  model:string|null;reasoningEffort:string|null;serviceTier:string|null;cwd:string|null;
  createdAt:string;updatedAt:string;
}
const terminal = new Set<Task['status']>(['completed','failed','cancelled']);
const id = () => randomUUID();
function requiredText(value:string, field:string):string {
  if (typeof value !== 'string' || !value.trim()) throw new RuntimeError(`${field} is required`);
  return value.trim();
}
function errorText(e:unknown):string {return e instanceof Error ? e.message : String(e);}

/** SQLite records are authoritative. In-memory state only holds live cancellation and approval handles. */
export class OrbitRuntime {
  private active = new Map<string,{controller:AbortController;promise:Promise<void>}>();
  private approvalWaiters = new Map<string,(approved:boolean)=>void>();
  private inputWaiters = new Map<string,(resolution:Record<string,unknown>|null)=>void>();
  private listeners = new Set<(event:RuntimeEvent)=>void>();
  private timer:ReturnType<typeof setInterval>|undefined;
  private started = false;
  private pumping = false;
  constructor(readonly store:RecordStore, readonly runner:TaskRunner, readonly options:RuntimeOptions = {}) {}
  private now():string {return (this.options.clock?.() ?? new Date()).toISOString();}
  private must<T>(namespace:string, recordId:string):T {
    const value=this.store.get<T>(namespace,recordId);
    if(!value) throw new RuntimeError(`${namespace} record not found`,404);
    return value;
  }
  private event(type:string, dotId:string|null, taskId:string|null, data:Record<string,unknown>):RuntimeEvent {
    const counter=this.store.get<{id:string;value:number}>('runtime_meta','event_sequence')?.value ?? 0;
    const next=counter+1;
    this.store.put('runtime_meta',{id:'event_sequence',value:next});
    const event=this.store.put<RuntimeEvent>('events',{id:String(next).padStart(16,'0'),type,dotId,taskId,data,createdAt:this.now()});
    // Consumers cannot mutate stored event data or break task execution.
    const recipients=[...this.listeners];
    queueMicrotask(()=>{for(const listener of recipients) {if(!this.listeners.has(listener)) continue;try {listener(structuredClone(event));} catch { /* an SSE disconnect is not a runtime failure */ }}});
    return event;
  }
  subscribe(listener:(event:RuntimeEvent)=>void):()=>void {this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  replay(afterId?:string):RuntimeEvent[] {return this.store.list<RuntimeEvent>('events').filter(e=>!afterId || e.id>afterId).sort((a,b)=>a.id.localeCompare(b.id));}
  start():void {
    if(this.started) return;
    this.started=true;
    this.store.transaction(()=>{
      for(const approval of this.listApprovals().filter(a=>a.status==='pending')) {
        this.store.put('approvals',{...approval,status:'expired',resolvedAt:this.now()});
        this.event('approval.updated',approval.dotId,approval.taskId,{id:approval.id,status:'expired'});
      }
      for(const task of this.listTasks().filter(t=>t.status==='running'||t.status==='waiting_approval'||t.status==='interrupted')) {
        this.saveTask({...task,status:this.getDot(task.dotId).paused?'paused':'queued',error:null});
        this.activity(task.dotId,task.id,'task.recovered','Task resumed after runtime restart');
      }
    });
    this.tick();
    this.timer=setInterval(()=>this.tick(),this.options.tickMs ?? 1000);
    this.timer.unref?.();
  }
  async stop():Promise<void> {
    this.started=false;
    if(this.timer) clearInterval(this.timer);
    this.timer=undefined;
    for(const [taskId,run] of this.active) {
      const task=this.getTask(taskId);
      if(!terminal.has(task.status)&&task.status!=='paused') this.saveTask({...task,status:'interrupted',error:'Runtime stopped; task will resume on restart'});
      run.controller.abort(new Error('Runtime stopped'));
    }
    await Promise.allSettled([...this.active.values()].map(run=>run.promise));
  }
  listDots():Dot[] {return this.store.list<Dot>('dots');}
  getDot(dotId:string):Dot {return this.must('dots',dotId);}
  createDot(input:DotInput):Dot {
    const now=this.now();
    const dot=this.store.put<Dot>('dots',{id:id(),name:requiredText(input.name,'name'),paused:false,rootThreadId:null,messagingRoomId:id(),model:input.model??null,reasoningEffort:input.reasoningEffort??null,serviceTier:input.serviceTier??null,computerId:input.computerId!==undefined?input.computerId:this.options.defaultComputerId?.()||null,instructions:input.instructions??'',avatarUrl:input.avatarUrl??null,avatarManifest:input.avatarManifest??null,createdAt:now,updatedAt:now});
    this.event('dot.created',dot.id,null,{dot});return dot;
  }
  updateDot(dotId:string,input:Partial<DotInput>):Dot {
    const previous=this.getDot(dotId);
    const patch:Partial<Dot>={};
    for(const key of ['name','model','reasoningEffort','serviceTier','computerId','instructions','avatarUrl','avatarManifest'] as const) if(input[key]!==undefined) Object.assign(patch,{[key]:input[key]});
    if(patch.name!==undefined) patch.name=requiredText(patch.name,'name');
    const dot=this.store.put('dots',{...previous,...patch,updatedAt:this.now()});this.event('dot.updated',dotId,null,{dot});return dot;
  }
  deleteDot(dotId:string):boolean {
    this.getDot(dotId);
    for(const task of this.listTasks({dotId})) if(!terminal.has(task.status)) this.cancelTask(task.id);
    this.store.transaction(()=>{
      for(const ns of ['tasks','messages','activity','outputs','memories','schedules','approvals','attached_threads']) for(const record of this.store.list<{id:string;dotId:string}>(ns)) if(record.dotId===dotId) this.store.delete(ns,record.id);
      for(const record of this.store.list<{id:string;dotId:string}>('submissions')) if(record.dotId===dotId) this.store.delete('submissions',record.id);
      if(this.store.get<{dotId:string}>('native_meta','primary')?.dotId===dotId)this.store.delete('native_meta','primary');
      this.store.delete('native_hidden_dots',dotId);
      this.store.delete('dots',dotId);this.event('dot.deleted',dotId,null,{});
    });return true;
  }
  pauseDot(dotId:string):Dot {
    const dot=this.store.put('dots',{...this.getDot(dotId),paused:true,updatedAt:this.now()});
    for(const task of this.listTasks({dotId}).filter(t=>['queued','running','waiting_approval'].includes(t.status))) {
      this.saveTask({...task,status:'paused'});this.active.get(task.id)?.controller.abort(new Error('Dot paused'));
    }
    this.event('dot.updated',dotId,null,{dot});return dot;
  }
  resumeDot(dotId:string):Dot {
    const dot=this.store.put('dots',{...this.getDot(dotId),paused:false,updatedAt:this.now()});
    for(const task of this.listTasks({dotId}).filter(t=>t.status==='paused')) this.saveTask({...task,status:'queued',error:null,turnId:null});
    this.event('dot.updated',dotId,null,{dot});this.wake();return dot;
  }
  submitMessage(dotId:string,input:SubmitMessage):{message:Message;task:Task} {
    this.getDot(dotId);
    const channel=input.channel??'dashboard';
    const key=input.requestId?createHash('sha256').update(JSON.stringify([dotId,channel,input.requestId])).digest('hex'):null;
    return this.store.transaction(()=>{
      if(key) {
        const original=this.store.get<{messageId:string;taskId:string}>('submissions',key);
        if(original) return {message:this.must<Message>('messages',original.messageId),task:this.getTask(original.taskId)};
      }
      const task=this.createTask({dotId,input:requiredText(input.text,'text'),title:input.text.slice(0,120),attachments:input.attachments,computerId:input.computerId,source:channel==='dashboard'?'chat':'channel',...(channel==='voice'&&voiceEffort()?{reasoningEffort:voiceEffort()}:{})});
      if(channel==='voice')this.store.put('voice_tasks',{id:task.id,callId:String(input.requestId??'').split(':')[0]||'default'});
      const message=this.store.put<Message>('messages',{id:id(),dotId,role:'user',text:input.text,attachments:input.attachments??[],taskId:task.id,channel,requestId:input.requestId??null,createdAt:this.now()});
      if(key) this.store.put('submissions',{id:key,dotId,messageId:message.id,taskId:task.id});
      this.event('message.created',dotId,task.id,{message});return {message,task};
    });
  }
  /** Başarısız görev sohbette sessiz kalmasın: kullanıcı mesajının altına okunur bir hata yazılır. */
  private failureMessage(dotId:string,taskId:string,error:string):void {
    const origin=this.store.list<Message>('messages').find(m=>m.taskId===taskId&&m.role==='user');
    if(!origin) return;
    const reason=/429|too many requests|rate.?limit|usage limit/i.test(error)?'Model sağlayıcısı istek sınırına ulaştı (429). Ayarlar\u2019dan başka bir model seçin veya sınır sıfırlanınca yeniden deneyin.':/ECONNREFUSED|fetch failed|unreachable/i.test(error)?'Model sağlayıcısına veya Codex app-server\u2019a ulaşılamadı. Servislerin çalıştığını kontrol edin.':error;
    const message=this.store.put<Message>('messages',{id:id(),dotId,role:'assistant',text:'⚠ Yanıt alınamadı: '+reason,attachments:[],taskId,channel:origin.channel??'dashboard',requestId:null,createdAt:this.now()});
    this.event('message.created',dotId,taskId,{message});
  }
  listMessages(dotId:string):Message[] {this.getDot(dotId);return this.store.list<Message>('messages').filter(m=>m.dotId===dotId);}
  createTask(input:CreateTask):Task {
    const dot=this.getDot(input.dotId);
    const prompt=requiredText(input.input,'input');
    const threadId=input.threadId==null?null:requiredText(input.threadId,'threadId');
    if(input.parentTaskId&&this.getTask(input.parentTaskId).dotId!==input.dotId) throw new RuntimeError('Parent task must belong to the same dot');
    const now=this.now();
    const computerId=input.computerId===undefined?dot.computerId:input.computerId;
    const cwd=input.cwd===undefined?(computerId?null:this.options.defaultCwd??null):input.cwd;
    const defaults=this.options.settings?.();
    const model=input.model??dot.model??defaults?.model??null;
    const reasoningEffort=input.reasoningEffort??dot.reasoningEffort??defaults?.reasoningEffort??null;
    const serviceTier=input.serviceTier===undefined?dot.serviceTier??(dot.model==null?defaults?.serviceTier:null)??null:input.serviceTier;
    const task=this.store.put<Task>('tasks',{id:id(),dotId:dot.id,parentTaskId:input.parentTaskId??null,title:input.title?.trim()||prompt.slice(0,120),input:prompt,status:dot.paused?'paused':'queued',threadId,turnId:null,computerId,model,reasoningEffort,serviceTier,cwd,result:null,error:null,createdAt:now,updatedAt:now,startedAt:null,completedAt:null,source:input.source??'manual',attachments:input.attachments??[]});
    this.store.put('task_order',{id:task.id,sequence:(this.store.get<{value:number}>('runtime_meta','event_sequence')?.value??0)+1});
    this.event('task.created',dot.id,task.id,{task});this.activity(dot.id,task.id,'task.queued',task.title);this.wake();return task;
  }
  getTask(taskId:string):Task {return this.must('tasks',taskId);}
  listTasks(filter:{dotId?:string;status?:string;parentTaskId?:string}={}):Task[] {return this.store.list<Task>('tasks').filter(t=>(!filter.dotId||t.dotId===filter.dotId)&&(!filter.status||t.status===filter.status)&&(!filter.parentTaskId||t.parentTaskId===filter.parentTaskId));}
  private saveTask(task:Task):Task {const value=this.store.put('tasks',{...task,updatedAt:this.now()});this.event('task.updated',task.dotId,task.id,{task:value});return value;}
  cancelTask(taskId:string):Task {
    const task=this.getTask(taskId);
    if(terminal.has(task.status)) return task;
    const result=this.saveTask({...task,status:'cancelled',completedAt:this.now()});
    this.active.get(taskId)?.controller.abort(new Error('Task cancelled'));
    this.expireApprovals(taskId);
    for(const child of this.listTasks({parentTaskId:taskId})) if(!terminal.has(child.status)) this.cancelTask(child.id);
    this.activity(task.dotId,taskId,'task.cancelled','Task cancelled');this.wake();return result;
  }
  retryTask(taskId:string):Task {
    const task=this.getTask(taskId);
    if(!['failed','cancelled','interrupted'].includes(task.status)) throw new RuntimeError('Only failed, cancelled or interrupted tasks can be retried',409);
    if(this.active.has(taskId)) throw new RuntimeError('Task is still stopping',409);
    const result=this.saveTask({...task,status:this.getDot(task.dotId).paused?'paused':'queued',turnId:null,result:null,error:null,completedAt:null});
    this.wake();return result;
  }
  delegateTask(taskId:string,input:{title?:string;input:string;computerId?:string|null}):Task {
    const parent=this.getTask(taskId);
    if(parent.source==='proactive') throw new RuntimeError('Proactive research cannot delegate work without user approval',403);
    const targetComputer=input.computerId===undefined?parent.computerId:input.computerId;
    const child=this.createTask({...input,computerId:targetComputer,dotId:parent.dotId,parentTaskId:taskId,source:'delegation',model:parent.model,reasoningEffort:parent.reasoningEffort,serviceTier:parent.serviceTier,cwd:targetComputer===parent.computerId?parent.cwd:null});
    this.activity(parent.dotId,taskId,'task.delegated','Task delegated',{childTaskId:child.id});return child;
  }
  continueTask(taskId:string,input:{input:string;title?:string}):Task {
    const original=this.getTask(taskId);
    if(!original.threadId||original.threadId.startsWith('tool:')) throw new RuntimeError('Task has no real execution thread to continue',409);
    const task=this.createTask({dotId:original.dotId,parentTaskId:original.id,threadId:original.threadId,computerId:original.computerId,model:original.model,reasoningEffort:original.reasoningEffort,serviceTier:original.serviceTier,cwd:original.cwd,input:input.input,title:input.title??original.title,source:'manual'});
    this.store.put('task_continuations',{id:task.id,parentTaskId:original.id});
    this.activity(original.dotId,original.id,'task.continued','Follow-up queued on the existing execution thread',{taskId:task.id,threadId:original.threadId});return task;
  }
  /** The caller must verify this id with the owning App Server before attaching.
   * An attachment records a real conversation reference, not fabricated completed work.
   */
  attachThread(dotId:string,input:{threadId:string;computerId?:string|null;title?:string|null;model?:string|null;reasoningEffort?:string|null;serviceTier?:string|null;cwd?:string|null}):AttachedThread {
    const dot=this.getDot(dotId);const threadId=requiredText(input.threadId,'threadId');
    if(threadId.startsWith('tool:')) throw new RuntimeError('Only real execution threads can be attached');
    const key=createHash('sha256').update(JSON.stringify([dotId,threadId])).digest('hex');
    const previous=this.store.get<AttachedThread>('attached_threads',key);const now=this.now();
    const attached=this.store.put<AttachedThread>('attached_threads',{id:key,dotId,threadId,computerId:input.computerId===undefined?previous?.computerId??null:input.computerId,title:input.title===undefined?previous?.title??null:input.title,model:input.model===undefined?previous?.model??dot.model:input.model,reasoningEffort:input.reasoningEffort===undefined?previous?.reasoningEffort??dot.reasoningEffort:input.reasoningEffort,serviceTier:input.serviceTier===undefined?previous?.serviceTier??dot.serviceTier:input.serviceTier,cwd:input.cwd===undefined?previous?.cwd??null:input.cwd,createdAt:previous?.createdAt??now,updatedAt:now});
    this.event('thread.attached',dotId,null,{thread:attached});return attached;
  }
  listAttachedThreads(dotId?:string):AttachedThread[] {return this.store.list<AttachedThread>('attached_threads').filter(thread=>!dotId||thread.dotId===dotId);}
  continueThread(dotId:string,threadId:string,input:{input:string;title?:string}):Task {
    this.getDot(dotId);requiredText(threadId,'threadId');
    const prior=this.listTasks({dotId}).filter(task=>task.threadId===threadId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
    const attached=this.listAttachedThreads(dotId).find(thread=>thread.threadId===threadId);
    if(prior&&(!attached||prior.updatedAt>=attached.updatedAt)) return this.continueTask(prior.id,input);
    if(!attached) throw new RuntimeError('Attach the verified execution thread before continuing it',404);
    const task=this.createTask({dotId,threadId:attached.threadId,computerId:attached.computerId,model:attached.model,reasoningEffort:attached.reasoningEffort,serviceTier:attached.serviceTier,cwd:attached.cwd,input:input.input,title:input.title??attached.title??undefined,source:'manual'});
    this.activity(dotId,task.id,'thread.continued','Follow-up queued on an attached execution thread',{threadId:attached.threadId});return task;
  }
  activity(dotId:string,taskId:string|null,type:string,message:string,data:Record<string,unknown>={}):Activity {
    const activity=this.store.put<Activity>('activity',{id:id(),dotId,taskId,type,message,data,createdAt:this.now()});this.event('activity.created',dotId,taskId,{activity});return activity;
  }
  listActivity(filter:{dotId?:string;taskId?:string}={}):Activity[] {return this.store.list<Activity>('activity').filter(a=>(!filter.dotId||a.dotId===filter.dotId)&&(!filter.taskId||a.taskId===filter.taskId));}
  listOutputs(filter:{dotId?:string;taskId?:string}={}):Output[] {return this.store.list<Output>('outputs').filter(o=>(!filter.dotId||o.dotId===filter.dotId)&&(!filter.taskId||o.taskId===filter.taskId));}
  getOutput(outputId:string):Output {return this.must('outputs',outputId);}
  registerOutput(taskId:string,input:Omit<Output,'id'|'dotId'|'taskId'|'createdAt'>):Output {
    const task=this.getTask(taskId);
    const existing=this.listOutputs({taskId}).find(o=>o.path===input.path&&o.computerId===input.computerId);
    if(existing) return existing;
    const output=this.store.put<Output>('outputs',{...input,id:id(),dotId:task.dotId,taskId,createdAt:this.now()});this.event('output.created',task.dotId,taskId,{output});return output;
  }
  listMemories(dotId?:string):Memory[] {return this.store.list<Memory>('memories').filter(m=>!dotId||m.dotId===dotId);}
  createMemory(input:{dotId:string;title:string;content:string;tags?:string[]}):Memory {
    this.getDot(input.dotId);const now=this.now();
    const memory=this.store.put<Memory>('memories',{id:id(),dotId:input.dotId,title:requiredText(input.title,'title'),content:requiredText(input.content,'content'),tags:input.tags??[],createdAt:now,updatedAt:now});this.event('memory.created',memory.dotId,null,{memory});return memory;
  }
  updateMemory(memoryId:string,input:Partial<Pick<Memory,'title'|'content'|'tags'>>):Memory {
    const previous=this.must<Memory>('memories',memoryId);
    const memory=this.store.put('memories',{...previous,title:input.title===undefined?previous.title:requiredText(input.title,'title'),content:input.content===undefined?previous.content:requiredText(input.content,'content'),tags:input.tags??previous.tags,updatedAt:this.now()});this.event('memory.updated',memory.dotId,null,{memory});return memory;
  }
  deleteMemory(memoryId:string):boolean {const memory=this.must<Memory>('memories',memoryId);this.store.delete('memories',memoryId);this.event('memory.deleted',memory.dotId,null,{id:memoryId});return true;}
  listSchedules(dotId?:string):Schedule[] {return this.store.list<Schedule>('schedules').filter(s=>!dotId||s.dotId===dotId);}
  private nextSchedule(schedule:Pick<Schedule,'kind'|'intervalSeconds'|'cron'|'timezone'|'nextRunAt'|'rrule'>&{createdAt?:string}, from:string):string|null {
    try {new Intl.DateTimeFormat('en',{timeZone:schedule.timezone});} catch {throw new RuntimeError('Invalid timezone');}
    if(schedule.kind==='once') {
      if(!schedule.nextRunAt||!Number.isFinite(Date.parse(schedule.nextRunAt))) throw new RuntimeError('once schedule requires nextRunAt');
      return new Date(schedule.nextRunAt).toISOString();
    }
    if(schedule.kind==='interval') {
      if(!schedule.intervalSeconds||!Number.isFinite(schedule.intervalSeconds)||schedule.intervalSeconds<1) throw new RuntimeError('intervalSeconds must be at least 1');
      return new Date(Date.parse(from)+schedule.intervalSeconds*1000).toISOString();
    }
    if(schedule.kind==='rrule') {
      try {return nextRecurrence(schedule.rrule??'',schedule.timezone,schedule.createdAt??from,from);} catch {throw new RuntimeError('Invalid RRULE, VEVENT or timezone');}
    }
    try {return CronExpressionParser.parse(schedule.cron??'',{currentDate:from,tz:schedule.timezone}).next().toISOString();}
    catch {throw new RuntimeError('Invalid cron expression or timezone');}
  }
  createSchedule(input:Partial<ScheduleInput>&Pick<ScheduleInput,'dotId'|'title'|'prompt'|'kind'>):Schedule {
    this.getDot(input.dotId);const now=this.now();
    const schedule:Schedule={id:id(),dotId:input.dotId,title:requiredText(input.title,'title'),prompt:requiredText(input.prompt,'prompt'),enabled:input.enabled??true,kind:input.kind,intervalSeconds:input.intervalSeconds??null,cron:input.cron??null,rrule:input.rrule,timezone:input.timezone??'UTC',nextRunAt:input.nextRunAt??null,lastRunAt:null,computerId:input.computerId??null,proactive:input.proactive??false,createdAt:now,updatedAt:now};
    // Validate even a disabled schedule so enabling it is safe.
    const next=this.nextSchedule(schedule,now);schedule.nextRunAt=input.nextRunAt?new Date(input.nextRunAt).toISOString():next;
    if(schedule.kind==='rrule'&&!schedule.nextRunAt) schedule.enabled=false;
    this.store.put('schedules',schedule);this.event('schedule.created',schedule.dotId,null,{schedule});return schedule;
  }
  updateSchedule(scheduleId:string,input:Partial<Omit<ScheduleInput,'dotId'>>):Schedule {
    const previous=this.must<Schedule>('schedules',scheduleId);
    const schedule:Schedule={...previous,title:input.title===undefined?previous.title:requiredText(input.title,'title'),prompt:input.prompt===undefined?previous.prompt:requiredText(input.prompt,'prompt'),enabled:input.enabled??previous.enabled,kind:input.kind??previous.kind,intervalSeconds:input.intervalSeconds===undefined?previous.intervalSeconds:input.intervalSeconds,cron:input.cron===undefined?previous.cron:input.cron,rrule:input.rrule===undefined?previous.rrule:input.rrule,timezone:input.timezone??previous.timezone,computerId:input.computerId===undefined?previous.computerId:input.computerId,proactive:input.proactive??previous.proactive,nextRunAt:input.nextRunAt===undefined?previous.nextRunAt:input.nextRunAt,updatedAt:this.now()};
    // Completed one-off schedules remain editable; enabling one requires a new date.
    const next=schedule.kind==='once'&&!schedule.nextRunAt&&!schedule.enabled?null:this.nextSchedule(schedule,this.now());
    if(schedule.kind!=='once'&&(input.kind!==undefined||input.intervalSeconds!==undefined||input.cron!==undefined||input.rrule!==undefined||input.timezone!==undefined||input.enabled===true||!schedule.nextRunAt)) schedule.nextRunAt=next;
    if(schedule.kind==='rrule'&&!schedule.nextRunAt) schedule.enabled=false;
    if(input.nextRunAt) schedule.nextRunAt=new Date(input.nextRunAt).toISOString();
    this.store.put('schedules',schedule);this.event('schedule.updated',schedule.dotId,null,{schedule});return schedule;
  }
  deleteSchedule(scheduleId:string):boolean {const schedule=this.must<Schedule>('schedules',scheduleId);this.store.delete('schedules',scheduleId);this.event('schedule.deleted',schedule.dotId,null,{id:scheduleId});return true;}
  runSchedule(scheduleId:string):Task {
    const schedule=this.must<Schedule>('schedules',scheduleId);
    if(schedule.proactive&&!this.proactiveEnabled()) throw new RuntimeError('Proactive research is disabled',409);
    return this.createTask({dotId:schedule.dotId,title:schedule.title,input:schedule.prompt,computerId:schedule.computerId,source:schedule.proactive?'proactive':'schedule'});
  }
  private proactiveEnabled():boolean {return this.options.settings?.().proactiveEnabled??this.options.proactiveEnabled??false;}
  /** Coalesce missed recurring ticks into one run; never replay a burst of stale executions. */
  tick():void {
    if(!this.started) return;
    const now=this.now();
    for(const schedule of this.listSchedules()) {
      if(!schedule.enabled||!schedule.nextRunAt||schedule.nextRunAt>now||this.getDot(schedule.dotId).paused||(schedule.proactive&&!this.proactiveEnabled())) continue;
      this.store.transaction(()=>{
        const runKey=`${schedule.id}:${schedule.nextRunAt}`;
        if(!this.store.get('schedule_runs',runKey)) {
          const task=this.runSchedule(schedule.id);
          this.store.put('schedule_runs',{id:runKey,taskId:task.id});
          this.activity(schedule.dotId,task.id,'schedule.triggered','Schedule triggered',{scheduleId:schedule.id,dueAt:schedule.nextRunAt,coalesced:schedule.nextRunAt!==now});
        }
        const nextRunAt=schedule.kind==='once'?null:this.nextSchedule(schedule,now);
        const updated={...schedule,lastRunAt:now,nextRunAt,enabled:nextRunAt?schedule.enabled:false,updatedAt:now};
        this.store.put('schedules',updated);this.event('schedule.updated',schedule.dotId,null,{schedule:updated});
      });
    }
    this.pump();
  }
  listApprovals(filter:{dotId?:string;taskId?:string}={}):Approval[] {return this.store.list<Approval>('approvals').filter(a=>(!filter.dotId||a.dotId===filter.dotId)&&(!filter.taskId||a.taskId===filter.taskId));}
  private automaticExecutionApproval(task:Task,request:ApprovalRequest):boolean {
    return this.options.settings?.().autoApproveExecution===true&&task.source!=='proactive'&&!terminal.has(task.status)&&!['user_input','form_input'].includes(request.kind);
  }
  /** Apply a changed setting to already waiting command/file requests, without answering user questions. */
  applyExecutionApprovalSetting():void {
    for(const approval of this.listApprovals().filter(a=>a.status==='pending')){
      const task=this.getTask(approval.taskId);
      if(!this.automaticExecutionApproval(task,approval)||!this.approvalWaiters.has(approval.id))continue;
      this.resolveApproval(approval.id,true);
      this.activity(task.dotId,task.id,'approval.automatic','Execution permission automatically approved',{approvalId:approval.id,kind:approval.kind});
    }
  }
  requestApproval(taskId:string,request:ApprovalRequest):Promise<boolean> {
    const task=this.getTask(taskId);
    if(task.source==='proactive'||terminal.has(task.status)) return Promise.resolve(false);
    const signal=this.active.get(taskId)?.controller.signal;
    if(signal?.aborted) return Promise.resolve(false);
    if(this.automaticExecutionApproval(task,request)){
      const approval=this.store.put<Approval>('approvals',{...request,id:id(),dotId:task.dotId,taskId,status:'approved',createdAt:this.now(),resolvedAt:this.now()});
      this.event('approval.created',task.dotId,taskId,{approval});
      this.activity(task.dotId,taskId,'approval.automatic','Execution permission automatically approved',{approvalId:approval.id,kind:request.kind});
      return Promise.resolve(true);
    }
    const approval=this.store.put<Approval>('approvals',{...request,id:id(),dotId:task.dotId,taskId,status:'pending',createdAt:this.now(),resolvedAt:null});
    this.saveTask({...task,status:'waiting_approval'});this.event('approval.created',task.dotId,taskId,{approval});
    return new Promise(resolve=>{
      const finish=(approved:boolean)=>{signal?.removeEventListener('abort',abort);this.approvalWaiters.delete(approval.id);resolve(approved);};
      const abort=()=>{const current=this.store.get<Approval>('approvals',approval.id);if(current?.status==='pending') {const expired=this.store.put('approvals',{...current,status:'expired',resolvedAt:this.now()});this.event('approval.updated',current.dotId,taskId,{approval:expired});}finish(false);};
      this.approvalWaiters.set(approval.id,finish);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted) abort();
    });
  }
  requestUserInput(taskId:string,request:ApprovalRequest):Promise<Record<string,unknown>|null> {
    const task=this.getTask(taskId);
    const signal=this.active.get(taskId)?.controller.signal;
    if(terminal.has(task.status)||signal?.aborted) return Promise.resolve(null);
    const approval=this.store.put<Approval>('approvals',{...request,kind:request.kind==='form_input'?'form_input':'user_input',id:id(),dotId:task.dotId,taskId,status:'pending',createdAt:this.now(),resolvedAt:null});
    this.saveTask({...task,status:'waiting_approval'});this.event('approval.created',task.dotId,taskId,{approval});
    return new Promise(resolve=>{
      const finish=(resolution:Record<string,unknown>|null)=>{signal?.removeEventListener('abort',abort);this.inputWaiters.delete(approval.id);resolve(resolution);};
      const abort=()=>{const current=this.store.get<Approval>('approvals',approval.id);if(current?.status==='pending') {const expired=this.store.put('approvals',{...current,status:'expired',resolvedAt:this.now()});this.event('approval.updated',current.dotId,taskId,{approval:expired});}finish(null);};
      this.inputWaiters.set(approval.id,finish);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted) abort();
    });
  }
  resolveApproval(approvalId:string,approved:boolean|{approved:boolean;resolution?:Record<string,unknown>}):Approval {
    const previous=this.must<Approval>('approvals',approvalId);
    if(previous.status!=='pending') throw new RuntimeError('Approval has already been resolved',409);
    const decision=typeof approved==='boolean'?approved:approved.approved;
    const resolution=typeof approved==='boolean'?undefined:approved.resolution;
    if(previous.kind==='user_input'&&decision) this.validateUserAnswers(previous.request,resolution);
    if(previous.kind==='form_input'&&decision) this.validateFormInput(previous.request,resolution);
    const approval=this.store.put<Approval>('approvals',{...previous,status:decision?'approved':'denied',resolvedAt:this.now(),...(resolution?{resolution}: {})});
    const task=this.getTask(previous.taskId);
    if(task.status==='waiting_approval'&&this.active.has(task.id)&&!this.listApprovals({taskId:task.id}).some(a=>a.status==='pending')) this.saveTask({...task,status:'running'});
    this.event('approval.updated',previous.dotId,previous.taskId,{approval});this.approvalWaiters.get(approvalId)?.(decision);this.inputWaiters.get(approvalId)?.(decision?resolution??null:null);return approval;
  }
  private validateUserAnswers(request:Record<string,unknown>,resolution:Record<string,unknown>|undefined):void {
    const answers=resolution?.answers;
    if(!answers||typeof answers!=='object'||Array.isArray(answers)) throw new RuntimeError('Question answers are required');
    const questions=Array.isArray(request.questions)?request.questions:[];
    for(const question of questions) {
      const q=question as {id?:string};const answer=q.id?(answers as Record<string,unknown>)[q.id]:undefined;
      const values=answer&&typeof answer==='object'?(answer as {answers?:unknown}).answers:undefined;
      if(!q.id||!Array.isArray(values)||!values.length||values.some(v=>typeof v!=='string'||!v.trim()||v.length>200000)) throw new RuntimeError(`Answer required for question ${q.id??''}`);
    }
  }
  private validateFormInput(request:Record<string,unknown>,resolution:Record<string,unknown>|undefined):void {
    if(!resolution?.content||typeof resolution.content!=='object'||Array.isArray(resolution.content)) throw new RuntimeError('Structured form content is required');
    const schema=request.requestedSchema;
    if(!schema||typeof schema!=='object'||Array.isArray(schema)) throw new RuntimeError('Form schema is missing or invalid');
    try {
      const draft=String((schema as Record<string,unknown>).$schema??'');
      const Validator=draft.includes('2020-12')?Ajv2020:draft.includes('2019-09')?Ajv2019:Ajv;
      const ajv=new Validator({strict:false,allErrors:true});addFormats(ajv);
      const validate=ajv.compile(schema);
      if(!validate(resolution.content)) throw new RuntimeError('Form content does not satisfy its schema: '+validate.errors?.map(error=>`${error.instancePath||'/'} ${error.message}`).join('; '));
    } catch(error) {if(error instanceof RuntimeError) throw error;throw new RuntimeError('Requested form schema is not supported');}
  }
  private expireApprovals(taskId:string):void {
    for(const approval of this.listApprovals({taskId}).filter(a=>a.status==='pending')) {
      this.store.put('approvals',{...approval,status:'expired',resolvedAt:this.now()});this.event('approval.updated',approval.dotId,taskId,{id:approval.id,status:'expired'});this.approvalWaiters.get(approval.id)?.(false);this.inputWaiters.get(approval.id)?.(null);
    }
  }
  private wake():void {queueMicrotask(()=>this.pump());}
  private pump():void {
    if(!this.started||this.pumping) return;
    this.pumping=true;
    try {
      const roomKey=(task:Task)=>{
        const voiceCall=this.store.get<{callId:string}>('voice_tasks',task.id);if(voiceCall)return 'voice:'+task.dotId+':'+voiceCall.callId;
        const chat=task.source==='chat'||task.source==='channel';
        const threadId=task.threadId??(chat?this.getDot(task.dotId).rootThreadId:null);
        return threadId?`thread:${threadId}`:chat?`room:${this.getDot(task.dotId).messagingRoomId}`:`task:${task.id}`;
      };
      const busyRooms=new Set([...this.active.keys()].map(taskId=>this.store.get<Task>('tasks',taskId)).filter((t):t is Task=>Boolean(t)).map(roomKey));
      const max=Math.max(1,Math.floor(this.options.settings?.().maxParallelTasks??this.options.maxParallelTasks??2));
      const order=(task:Task)=>this.store.get<{sequence:number}>('task_order',task.id)?.sequence??0;
      for(const task of this.listTasks().filter(t=>t.status==='queued').sort((a,b)=>order(a)-order(b)||a.createdAt.localeCompare(b.createdAt))) {
        if(this.active.size>=max) break;
        // Thread migration may have completed after a follow-up was submitted.
        // Bind it to the original task's actual latest thread before taking a lock.
        const continuation=this.store.get<{parentTaskId:string}>('task_continuations',task.id);
        const parent=continuation?this.store.get<Task>('tasks',continuation.parentTaskId):undefined;
        if(parent?.threadId&&parent.threadId!==task.threadId) {task.threadId=parent.threadId;task.computerId=parent.computerId;task.cwd=parent.cwd;this.saveTask(task);}
        const dot=this.getDot(task.dotId);
        if(dot.paused||busyRooms.has(roomKey(task))||(task.source==='proactive'&&!this.proactiveEnabled())) continue;
        busyRooms.add(roomKey(task));
        const controller=new AbortController();
        // Install the controller before the runner can synchronously request approval.
        const promise=Promise.resolve().then(()=>this.execute(task.id,controller)).finally(()=>{this.active.delete(task.id);this.wake();});
        this.active.set(task.id,{controller,promise});
      }
    } finally {this.pumping=false;}
  }
  private async execute(taskId:string,controller:AbortController):Promise<void> {
    let task=this.store.get<Task>('tasks',taskId);
    if(!task) return;
    if(controller.signal.aborted||task.status!=='queued') return;
    task=this.saveTask({...task,status:'running',startedAt:task.startedAt??this.now(),error:null});
    const dot=this.getDot(task.dotId);
    const voice=this.store.get<{callId:string}>('voice_tasks',taskId);
    // A voice call keeps its own small thread, so replies do not wait on the large chat history.
    const chatRoom=(task.source==='chat'||task.source==='channel')&&!voice;
    if(voice&&!task.threadId){const known=this.store.get<{threadId:string}>('voice_threads',dot.id+':'+voice.callId);if(known)task=this.saveTask({...task,threadId:known.threadId});}
    if(!task.threadId&&chatRoom&&dot.rootThreadId) task=this.saveTask({...task,threadId:dot.rootThreadId});
    const live=()=>this.store.get<Task>('tasks',taskId);
    const enabled=()=>!controller.signal.aborted&&!!live();
    const hooks:RunnerHooks={
      onThread:threadId=>{if(!enabled()) return;const current=live()!;this.saveTask({...current,threadId});if(voice)this.store.put('voice_threads',{id:current.dotId+':'+voice.callId,threadId});if(chatRoom) {const currentDot=this.getDot(current.dotId);this.store.put('dots',{...currentDot,rootThreadId:threadId,updatedAt:this.now()});}},
      onTurn:turnId=>{if(enabled()) this.saveTask({...live()!,turnId});},
      onDelta:text=>{if(enabled()) this.event('message.delta',task.dotId,taskId,{text});},
      onActivity:(type,message,data)=>{if(enabled()) this.activity(task.dotId,taskId,type,message,data);},
      onOutput:output=>{if(enabled()) this.registerOutput(taskId,output);},
      onApproval:request=>this.requestApproval(taskId,request),
      onUserInput:request=>this.requestUserInput(taskId,request)
    };
    this.activity(task.dotId,taskId,'task.started',task.title);
    try {
      const result=await this.runner.run({task,dot,memories:this.listMemories(task.dotId)},hooks,controller.signal);
      const current=live();
      if(!current||controller.signal.aborted||current.status==='paused'||terminal.has(current.status)) return;
      const completed=this.saveTask({...current,status:'completed',result:result.text,threadId:result.threadId,turnId:result.turnId,completedAt:this.now()});
      const origin=this.store.list<Message>('messages').find(m=>m.taskId===taskId&&m.role==='user');
      const message=this.store.put<Message>('messages',{id:id(),dotId:task.dotId,role:'assistant',text:result.text,attachments:[],taskId,channel:origin?.channel??'dashboard',requestId:null,createdAt:this.now()});
      this.event('message.created',task.dotId,taskId,{message});this.activity(task.dotId,taskId,'task.completed','Task completed',{parentTaskId:completed.parentTaskId});
    } catch(e) {
      const current=live();
      if(!current||controller.signal.aborted||current.status==='paused'||terminal.has(current.status)) return;
      const interrupted=e instanceof Error&&e.name==='AbortError';
      this.saveTask({...current,status:interrupted?'interrupted':'failed',error:errorText(e),completedAt:this.now()});this.activity(task.dotId,taskId,'task.failed',errorText(e));
      if(!interrupted) this.failureMessage(task.dotId,taskId,errorText(e));
    } finally {this.expireApprovals(taskId);}
  }
}
