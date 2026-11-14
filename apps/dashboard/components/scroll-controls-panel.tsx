"use client";
import {useContext,useEffect,useState} from 'react';
import {ApiContext,Check,Form,FormGrid,Loading,Notice,Section,SelectField,useData} from './ui';
type Key='none'|'shift'|'ctrl'|'alt'|'ctrl+shift';
type Zone='any'|'model'|'thinking'|'mode'|'fast';
type Binding={on:boolean;key:Key;zone:Zone};
type Settings={enabled:boolean;thinking:Binding;model:Binding;mode:Binding;fast:Binding};
type Preferences=Settings&{installed:boolean;managedBy:string|null;connected:boolean;applied:boolean};
const actions:{id:'thinking'|'model'|'mode'|'fast';label:string;description:string}[]=[
 {id:'thinking',label:'Change thinking level',description:'Previous or next thinking level of the picker under the pointer.'},
 {id:'model',label:'Change model',description:'Previous or next model in the list of the picker under the pointer.'},
 {id:'mode',label:'Change orchestrator mode',description:'Previous or next orchestrator mode. Works over the orchestrator picker.'},
 {id:'fast',label:'Change Fast mode',description:'Steps through the speed options of the model (Standard, Fast and Ultra fast when the model offers them).'}
];
const keys=[{value:'none',label:'No key (scroll only)'},{value:'shift',label:'Shift'},{value:'ctrl',label:'Ctrl'},{value:'alt',label:'Alt'},{value:'ctrl+shift',label:'Ctrl + Shift'}];
const zones=[{value:'any',label:'Anywhere on the picker'},{value:'model',label:'Model name'},{value:'thinking',label:'Thinking level'},{value:'mode',label:'Orchestrator mode label'},{value:'fast',label:'Fast icon (left of the model name)'}];
const defaults:Settings={enabled:true,thinking:{on:true,key:'none',zone:'any'},model:{on:true,key:'shift',zone:'any'},mode:{on:true,key:'ctrl',zone:'any'},fast:{on:true,key:'alt',zone:'any'}};
const pick=(d:Preferences):Settings=>({enabled:d.enabled,thinking:d.thinking,model:d.model,mode:d.mode,fast:d.fast});
// Two enabled actions that use the same key and overlapping zones would compete for the same scroll.
function conflicts(s:Settings){
 const found:string[]=[];
 for(let i=0;i<actions.length;i++)for(let j=i+1;j<actions.length;j++){
  const a=s[actions[i].id],b=s[actions[j].id];
  if(a.on&&b.on&&a.key===b.key&&(a.zone==='any'||b.zone==='any'||a.zone===b.zone))found.push(actions[i].label+' and '+actions[j].label.toLowerCase()+' share the same key and area. The more specific area wins; otherwise the first one in the list.');
 }
 return found;
}
export function ScrollControlsPanel(){
 const {data,error}=useData<Preferences>('scroll-controls',3000),{mutate}=useContext(ApiContext);
 const [draft,setDraft]=useState<Settings>(defaults),[dirty,setDirty]=useState(false),[saved,setSaved]=useState(false);
 useEffect(()=>{if(data&&!dirty)setDraft(pick(data));},[data,dirty]);
 function change(patch:Partial<Settings>){setDraft(d=>({...d,...patch}));setDirty(true);setSaved(false);}
 function bind(id:keyof Omit<Settings,'enabled'>,patch:Partial<Binding>){change({[id]:{...draft[id],...patch}} as Partial<Settings>);}
 const issues=conflicts(draft);
 return <Section title="Scroll controls" description="Scroll over the pickers in the Codex chat box on this PC to change the thinking level, model, orchestrator mode or Fast mode. Choose the key and the part of the picker for each action.">
  <Notice error={error}/>
  {!data?!error&&<Loading/>:<>
   <Form submit="Save settings" onSubmit={async()=>{await mutate('scroll-controls','PATCH',draft);setDirty(false);setSaved(true);}}>
    <Check label="Enable scroll controls" isSelected={draft.enabled} onChange={enabled=>change({enabled})} description="Master switch. When off, the pickers behave like the original Codex."/>
    {actions.map(action=><div key={action.id} className="space-y-3">
     <Check label={action.label} isSelected={draft[action.id].on} onChange={on=>bind(action.id,{on})} description={action.description}/>
     {draft[action.id].on&&<FormGrid>
      <SelectField label="Key" value={draft[action.id].key} onChange={key=>bind(action.id,{key:key as Key})} options={keys}/>
      <SelectField label="Pointer over" value={draft[action.id].zone} onChange={zone=>bind(action.id,{zone:zone as Zone})} options={action.id==='mode'?zones.filter(z=>z.value==='any'||z.value==='mode'):zones}/>
     </FormGrid>}
    </div>)}
    {issues.map(text=><p key={text} role="alert" className="text-sm text-danger">{text}</p>)}
   </Form>
   {data.managedBy==='damndots'&&<p className="text-sm text-muted">Installed and managed by Damndots.</p>}<p role="status" className="text-sm text-muted">{!data.installed?'The scroll controls need the Damndots-managed Codex app.':!data.connected?'Settings saved. Open or reload the patched Codex app to apply them.':data.applied?'Settings applied in Codex.':'Applying settings…'}</p>
   {saved&&<p role="status" className="text-sm">Settings saved.</p>}
  </>}
  <p className="text-sm text-muted">Scrolling up moves to the next level, model, mode or speed; scrolling down goes back. The thinking level, model and Fast actions work on both the main picker and the orchestrator picker. Preferences apply without restarting once the patch is loaded.</p>
 </Section>;
}
