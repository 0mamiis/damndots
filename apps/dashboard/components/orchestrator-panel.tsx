"use client";
import {useContext,useEffect,useState} from 'react';
import {ApiContext,Check,Form,Loading,Notice,Section,SelectField,useData} from './ui';
type Preferences={mode:string;model:string|null;effort:string|null;fast:boolean;installed:boolean;managedBy:string|null;connected:boolean;applied:boolean};
export function OrchestratorPanel(){
 const {data,error}=useData<Preferences>('orchestrator',3000),{mutate}=useContext(ApiContext);
 const models=useData<{models:{id:string;label?:string;efforts?:string[];fast?:boolean}[]}>('orchestrator/models',10000);
 const [draft,setDraft]=useState({mode:'off',model:'',effort:'',fast:false}),[dirty,setDirty]=useState(false),[saved,setSaved]=useState(false);
 useEffect(()=>{if(data&&!dirty)setDraft({mode:data.mode,model:data.model??'',effort:data.effort??'',fast:data.fast});},[data,dirty]);
 const selected=models.data?.models.find(m=>m.id===draft.model);
 function change(v:Partial<typeof draft>){setDraft(d=>({...d,...v}));setDirty(true);setSaved(false);}
 return <Section title="Orchestrator" description="Defaults for native Codex agents on this PC. Choices made inside a conversation take priority.">
  <Notice error={error}/><Notice error={models.error}/>
  {!data?!error&&<Loading/>:<>
   <Form submit="Save settings" onSubmit={async()=>{await mutate('orchestrator','PATCH',{...draft,model:draft.model||null,effort:draft.effort||null,fast:selected?.fast===true&&draft.fast});setDirty(false);setSaved(true);}}>
    <SelectField label="Default for new conversations" value={draft.mode} onChange={mode=>change({mode})} options={[['off','Off'],['lead','Lead'],['plan','Plan'],['explore','Explore'],['verify','Verify'],['fix','Fix'],['subagents','Subagents']].map(([value,label])=>({value,label}))}/>
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
