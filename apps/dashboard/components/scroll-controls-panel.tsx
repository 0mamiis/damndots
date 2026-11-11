"use client";
import {useContext,useEffect,useState} from 'react';
import {ApiContext,Check,Form,Loading,Notice,Section,useData} from './ui';
type Preferences={enabled:boolean;thinking:boolean;model:boolean;mode:boolean;installed:boolean;managedBy:string|null;connected:boolean;applied:boolean};
export function ScrollControlsPanel(){
 const {data,error}=useData<Preferences>('scroll-controls',3000),{mutate}=useContext(ApiContext);
 const [draft,setDraft]=useState({enabled:true,thinking:true,model:true,mode:true}),[dirty,setDirty]=useState(false),[saved,setSaved]=useState(false);
 useEffect(()=>{if(data&&!dirty)setDraft({enabled:data.enabled,thinking:data.thinking,model:data.model,mode:data.mode});},[data,dirty]);
 function change(patch:Partial<typeof draft>){setDraft(d=>({...d,...patch}));setDirty(true);setSaved(false);}
 return <Section title="Scroll controls" description="Change the thinking level, model and orchestrator mode by scrolling over the pickers in the Codex chat box on this PC.">
  <Notice error={error}/>
  {!data?!error&&<Loading/>:<>
   <Form submit="Save settings" onSubmit={async()=>{await mutate('scroll-controls','PATCH',draft);setDirty(false);setSaved(true);}}>
    <Check label="Enable scroll controls" isSelected={draft.enabled} onChange={enabled=>change({enabled})} description="Master switch. When off, the pickers behave like the original Codex."/>
    <Check label="Scroll changes thinking level" isSelected={draft.thinking} onChange={thinking=>change({thinking})} description="Scroll over the model picker or the orchestrator picker while its menu is closed."/>
    <Check label="Ctrl + Shift + scroll changes model" isSelected={draft.model} onChange={model=>change({model})} description="Switches to the previous or next model in the list for the picker under the pointer."/>
    <Check label="Ctrl + scroll changes orchestrator mode" isSelected={draft.mode} onChange={mode=>change({mode})} description="Works over the orchestrator picker."/>
   </Form>
   {data.managedBy==='damndots'&&<p className="text-sm text-muted">Installed and managed by Damndots.</p>}<p role="status" className="text-sm text-muted">{!data.installed?'The scroll controls need the Damndots-managed Codex app.':!data.connected?'Settings saved. Open or reload the patched Codex app to apply them.':data.applied?'Settings applied in Codex.':'Applying settings…'}</p>
   {saved&&<p role="status" className="text-sm">Settings saved.</p>}
  </>}
  <p className="text-sm text-muted">Scrolling up moves to the next level, model or mode; scrolling down goes back. Preferences apply without restarting once the patch is loaded.</p>
 </Section>;
}
