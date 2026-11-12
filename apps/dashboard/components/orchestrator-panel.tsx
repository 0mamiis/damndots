"use client";
import {useContext,useEffect,useState} from 'react';
import {ApiContext,Check,Form,Loading,Notice,Section,SelectField,useData} from './ui';
const MODES:[string,string,string][]=[['lead','Lead','Applies the work with built-in agents and reviews it'],['plan','Plan','Inspects and prepares an actionable plan'],['explore','Explore','Researches the idea and code without changing it'],['verify','Verify','Checks the result with an independent agent'],['fix','Fix','Repairs a bug with a worker and reviews the fix'],['subagents','Subagents','The main agent works and shares tasks with subagents'],['swarm','Swarm','Parallel waves of scoped workers with independent validation and fresh reviews (metaswarm)']];
// Built-in picker colours; a colour saved here replaces it in Codex.
const DEFAULT_COLORS:Record<string,string>={fix:'#E1465A',verify:'#16A34A',explore:'#0891B2',plan:'#22C55E',subagents:'#EAB308',lead:'#EF4444',swarm:'#A855F7'};
const HEX=/^#[0-9a-fA-F]{6}$/;
const DEFAULT_ORDER=['fix','verify','explore','plan','subagents','lead','swarm'];
const modeInfo=(id:string)=>MODES.find(m=>m[0]===id)!;
type Preferences={mode:string;model:string|null;effort:string|null;fast:boolean;disabledModes?:string[];modeOrder?:string[];modeColors?:Record<string,string>;installed:boolean;managedBy:string|null;connected:boolean;applied:boolean};
export function OrchestratorPanel(){
 const {data,error}=useData<Preferences>('orchestrator',3000),{mutate}=useContext(ApiContext);
 const models=useData<{models:{id:string;label?:string;efforts?:string[];fast?:boolean}[]}>('orchestrator/models',10000);
 const [draft,setDraft]=useState<{mode:string;model:string;effort:string;fast:boolean;disabledModes:string[];modeOrder:string[];modeColors:Record<string,string>}>({mode:'off',model:'',effort:'',fast:false,disabledModes:['fix','verify','explore'],modeOrder:DEFAULT_ORDER,modeColors:{}}),[dirty,setDirty]=useState(false),[saved,setSaved]=useState(false);
 useEffect(()=>{if(data&&!dirty)setDraft({mode:data.mode,model:data.model??'',effort:data.effort??'',fast:data.fast,disabledModes:data.disabledModes??['fix','verify','explore'],modeOrder:data.modeOrder??DEFAULT_ORDER,modeColors:data.modeColors??{}});},[data,dirty]);
 const selected=models.data?.models.find(m=>m.id===draft.model);
 const [dragging,setDragging]=useState<string|null>(null);
 function change(v:Partial<typeof draft>){setDraft(d=>({...d,...v}));setDirty(true);setSaved(false);}
 const [hexDraft,setHexDraft]=useState<Record<string,string>>({});
 const colorOf=(id:string)=>draft.modeColors[id]??DEFAULT_COLORS[id];
 function setColor(id:string,value:string|null){const next={...draft.modeColors};if(value===null||value.toUpperCase()===DEFAULT_COLORS[id])delete next[id];else next[id]=value.toUpperCase();setHexDraft(h=>{const c={...h};delete c[id];return c;});change({modeColors:next});}
 function move(id:string,to:number){const order=draft.modeOrder.filter(m=>m!==id);order.splice(Math.max(0,Math.min(order.length,to)),0,id);change({modeOrder:order});}
 return <Section title="Orchestrator" description="Defaults for native Codex agents on this PC. Choices made inside a conversation take priority.">
  <Notice error={error}/><Notice error={models.error}/>
  {!data?!error&&<Loading/>:<>
   <Form submit="Save settings" onSubmit={async()=>{setHexDraft({});await mutate('orchestrator','PATCH',{...draft,model:draft.model||null,effort:draft.effort||null,fast:selected?.fast===true&&draft.fast});setDirty(false);setSaved(true);}}>
    <SelectField label="Default for new conversations" value={draft.mode} onChange={mode=>change({mode})} options={[{value:'off',label:'Off'},...draft.modeOrder.filter(value=>!draft.disabledModes.includes(value)).map(value=>({value,label:modeInfo(value)[1]}))]}/>
    <fieldset className="flex flex-col gap-3"><legend className="mb-1 text-sm font-medium">Modes in the picker</legend>
     <p className="text-sm text-muted">Left to right is the picker order after Off. Drag a card or use the arrows to move it. Switched off modes are hidden from the picker, and chats that use one of them run with the orchestrator off.</p>
     <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
      {draft.modeOrder.map((value,index)=>{const [,label,description]=modeInfo(value),on=!draft.disabledModes.includes(value);return <div key={value} draggable onDragStart={e=>{setDragging(value);e.dataTransfer.effectAllowed='move';}} onDragEnd={()=>setDragging(null)} onDragOver={e=>{if(dragging&&dragging!==value){e.preventDefault();e.dataTransfer.dropEffect='move';}}} onDrop={e=>{e.preventDefault();if(dragging&&dragging!==value)move(dragging,index);setDragging(null);}} className={'flex min-w-0 cursor-grab flex-col gap-2 rounded-xl border border-border bg-surface p-2.5 transition-opacity active:cursor-grabbing'+(dragging===value?' opacity-50':'')+(on?'':' opacity-70')}>
       <div className="flex items-center justify-between gap-2"><span className="text-xs text-muted">{index+1}</span>
        <div className="flex gap-1"><button type="button" aria-label={'Move '+label+' left'} disabled={index===0} onClick={()=>move(value,index-1)} className="rounded-md px-1.5 text-muted hover:bg-default disabled:opacity-30">←</button><button type="button" aria-label={'Move '+label+' right'} disabled={index===draft.modeOrder.length-1} onClick={()=>move(value,index+1)} className="rounded-md px-1.5 text-muted hover:bg-default disabled:opacity-30">→</button></div></div>
       <Check label={label} isSelected={on} onChange={next=>change({disabledModes:next?draft.disabledModes.filter(m=>m!==value):[...draft.disabledModes,value],...(!next&&draft.mode===value?{mode:'off'}:{})})}/>
       <p className="text-xs text-muted">{description}</p>
       <div className="mt-auto flex items-center gap-2" onMouseDown={e=>e.stopPropagation()} draggable={false} onDragStart={e=>{e.preventDefault();e.stopPropagation();}}>
        <input type="color" aria-label={label+' colour'} value={colorOf(value)} onChange={e=>setColor(value,e.target.value)} className="h-7 w-7 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0"/>
        <input aria-label={label+' hex colour'} value={hexDraft[value]??colorOf(value)} maxLength={7} spellCheck={false} onChange={e=>{let v=e.target.value.trim();if(v&&!v.startsWith('#'))v='#'+v;setHexDraft(h=>({...h,[value]:v}));if(HEX.test(v))setColor(value,v);}} onBlur={()=>setHexDraft(h=>{const c={...h};delete c[value];return c;})} className={'h-7 min-w-0 flex-1 rounded-md border bg-transparent px-2 font-mono text-xs uppercase '+(hexDraft[value]!==undefined&&!HEX.test(hexDraft[value])?'border-danger':'border-border')}/>
        {draft.modeColors[value]&&<button type="button" aria-label={'Reset '+label+' colour'} title="Default colour" onClick={()=>setColor(value,null)} className="rounded-md px-1 text-muted hover:bg-default">↺</button>}
       </div>
      </div>;})}
     </div>
     {draft.modeOrder.join()!==DEFAULT_ORDER.join()&&<button type="button" onClick={()=>change({modeOrder:DEFAULT_ORDER})} className="self-start text-sm text-muted underline">Reset to the original order</button>}
    </fieldset>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
     <SelectField label="Default subagent model" value={draft.model} onChange={model=>change({model,effort:'',fast:false})} options={[{value:'',label:'Use Codex default'},...(models.data?.models??[]).map(m=>({value:m.id,label:m.label??m.id}))]}/>
     <SelectField label="Thinking level" value={draft.effort} onChange={effort=>change({effort})} options={[{value:'',label:'Model default'},...(selected?.efforts??[]).map(value=>({value,label:value}))]}/>
    </div>
    {selected?.fast&&<Check label="Fast subagents" isSelected={draft.fast} onChange={fast=>change({fast})} description="Use priority processing for supported native subagents."/>}
    <p className="text-sm text-muted">Changes apply to future messages. Running agents keep their current settings. This does not send a message or start agents.</p>
   </Form>
   {data.managedBy==='damndots'&&<p className="text-sm text-muted">Installed and managed by Damndots.</p>}<p role="status" className="text-sm text-muted">{!data.installed?'The orchestrator settings patch is waiting to be loaded in Codex.':!data.connected?'Open or reload patched Codex to apply saved preferences.':data.applied?'Preferences applied in Codex.':'Applying preferences…'}</p>
   {saved&&<p role="status" className="text-sm">Settings saved.</p>}
  </>}
 </Section>;
}
