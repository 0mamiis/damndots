"use client";
import {useContext,useEffect,useState} from 'react';
import {ApiContext,Check,Form,Loading,Notice,Section,SelectField,useData} from './ui';
type Preferences={enabled:boolean;model:string|null;effort:string|null;fast:boolean;installed:boolean;connected:boolean;restartRequired:boolean;applied:boolean;remoteEnabled:boolean|null;updatedAt:string|null};
export function ChatSuggestionsPanel(){
 const {data,error}=useData<Preferences>('chat-suggestions',3000),{mutate}=useContext(ApiContext);
 const models=useData<{items?:{id:string;label?:string;efforts?:string[];fast?:boolean}[];models?:{id:string;label?:string;efforts?:string[];fast?:boolean}[]}>('chat-suggestions/models',10000);
 const [enabled,setEnabled]=useState(false),[model,setModel]=useState(''),[effort,setEffort]=useState(''),[fast,setFast]=useState(false),[saved,setSaved]=useState(false);
 const selected=(models.data?.items??models.data?.models??[]).find(m=>m.id===model),supportsFast=selected?.fast===true;
 useEffect(()=>{if(data)setEnabled(data.enabled);},[data?.enabled]);
 useEffect(()=>{if(data)setModel(data.model??'');},[data?.model]);
 useEffect(()=>{if(data)setEffort(data.effort??'');},[data?.effort]);
 useEffect(()=>{if(data)setFast(data.fast===true);},[data?.fast]);
 return <Section title="Composer predictions" description="Settings for suggested next messages inside the Codex chat input on your PC.">
  <Notice error={error}/>
  {!data?error?<p className="text-sm text-muted">Set up the local Codex settings bridge on your PC, then refresh this page.</p>:<Loading/>:<>
   <Form submit="Save settings" onSubmit={async()=>{await mutate('chat-suggestions','PATCH',{enabled,model:model||null,effort:effort||null,fast:supportsFast&&fast});setSaved(true);}}>
    <Check name="enabled" label="Suggest my next message in Codex" isSelected={enabled} onChange={value=>{setEnabled(value);setSaved(false);}} description="After a conversation turn, Codex can show a suggested message in the empty input. Accepting it creates an editable draft; it does not send it."/>
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-start gap-4">
     <SelectField label="Prediction model" value={model} onChange={value=>{setModel(value);setEffort('');setFast(false);setSaved(false);}} options={[{value:'',label:'Same as the conversation'},...(models.data?.items??models.data?.models??[]).map(m=>({value:m.id,label:m.label??m.id}))]}/>
     <SelectField label="Thinking level" value={effort} onChange={value=>{setEffort(value);setSaved(false);}} options={[{value:'',label:'Automatic'},...[...new Set([...(selected?.efforts??['low','medium','high']),...(effort?[effort]:[])])].map(value=>({value,label:({none:'None',minimal:'Minimal',low:'Low',medium:'Medium',high:'High',xhigh:'Extra high',max:'Max',ultra:'Ultra'} as Record<string,string>)[value]??value}))]}/>
    </div>
    <p className="text-sm text-muted">Used only to generate suggestions. The conversation model stays unchanged.</p>
    {supportsFast?<Check label="Fast predictions" isSelected={fast} onChange={value=>{setFast(value);setSaved(false);}} description="Requests priority processing for predictions only. May consume your usage allowance faster."/>:<p className="text-sm text-muted">Select a supported GPT prediction model to enable optional Fast processing.</p>}
    {model&&!selected&&models.data&&<p className="text-sm text-muted">The saved model is no longer active in OpenCodex. Select an active model or use the conversation model.</p>}
    {models.error&&<Notice error={models.error}/> }
   </Form>
   <p role="status" className="text-sm text-muted">{data.restartRequired?'The patch is ready. Close Codex, wait a few seconds, then reopen it to activate these controls.':!data.installed?'The compatible composer settings patch needs to be installed in your private Codex app copy.':!data.connected?'Settings are saved. Open the patched Codex app to apply them.':!data.applied?'Applying to Codex…':!data.enabled?'Disabled in Codex.':data.remoteEnabled===true?'Enabled in Codex.':data.remoteEnabled===false?'Codex reports predictions as unavailable.':'Waiting for Codex prediction configuration.'}</p>
   {saved&&<p role="status" className="text-sm">Settings saved.</p>}
   <p className="text-sm text-muted">Uses Codex’s own prediction feature and conversation context. Availability is controlled by Codex. Once the patch is loaded, changing this setting does not require a restart.</p>
  </>}
 </Section>;
}
