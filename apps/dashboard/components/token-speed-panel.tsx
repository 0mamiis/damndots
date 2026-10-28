"use client";
import {useContext,useEffect,useState} from 'react';
import {ApiContext,Check,Form,Loading,Notice,Section,SelectField,useData} from './ui';
type Preferences={enabled:boolean;aggregation:'latest'|'average';decimals:number;animate:boolean;installed:boolean;managedBy:string|null;connected:boolean;applied:boolean};
export function TokenSpeedPanel(){
 const {data,error}=useData<Preferences>('token-speed',3000),{mutate}=useContext(ApiContext);
 const [draft,setDraft]=useState({enabled:true,aggregation:'average',decimals:0,animate:true}),[dirty,setDirty]=useState(false),[saved,setSaved]=useState(false);
 useEffect(()=>{if(data&&!dirty)setDraft({enabled:data.enabled,aggregation:data.aggregation,decimals:data.decimals,animate:data.animate});},[data,dirty]);
 function change(patch:Partial<typeof draft>){setDraft(d=>({...d,...patch}));setDirty(true);setSaved(false);}
 return <Section title="Token speed" description="Display preferences for the tok/s indicator inside Codex conversations on this PC.">
  <Notice error={error}/>
  {!data?!error&&<Loading/>:<>
   <Form submit="Save settings" onSubmit={async()=>{await mutate('token-speed','PATCH',draft);setDirty(false);setSaved(true);}}>
    <Check label="Show token speed" isSelected={draft.enabled} onChange={enabled=>change({enabled})} description="Show the tok/s indicator beside the conversation controls."/>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
     <SelectField label="Measurement" value={draft.aggregation} onChange={aggregation=>change({aggregation})} options={[{value:'average',label:'Conversation average'},{value:'latest',label:'Latest response'}]}/>
     <SelectField label="Decimal places" value={String(draft.decimals)} onChange={v=>change({decimals:Number(v)})} options={[0,1,2].map(n=>({value:String(n),label:String(n)}))}/>
    </div>
    <Check label="Animate speed changes" isSelected={draft.animate} onChange={animate=>change({animate})} description="Respect reduced-motion preferences when animation is enabled."/>
   </Form>
   {data.managedBy==='damndots'&&<p className="text-sm text-muted">Installed and managed by Damndots.</p>}<p role="status" className="text-sm text-muted">{!data.installed?'The token speed settings patch needs to be loaded in your private Codex app.':!data.connected?'Settings saved. Open or reload the patched Codex app to apply them.':data.applied?'Settings applied in Codex.':'Applying settings…'}</p>
   {saved&&<p role="status" className="text-sm">Settings saved.</p>}
  </>}
  <p className="text-sm text-muted">Speed uses matched OpenCodex output tokens and request duration when available. Otherwise, the tooltip identifies the native turn-duration estimate. This setting does not change the model or its processing speed. Preferences apply without restarting once the patch is loaded.</p>
 </Section>;
}
