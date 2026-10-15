"use client";
import {useEffect,useState} from 'react';
import {Button} from '@heroui/react';
import {Actions,Check,Code,Disclose,Field,Form,FormGrid,Loading,Notice,PageHeading,Section,Status,str,time,SelectField} from './ui';
import {TransportPanel} from './transport-panel';
import {ComputerSetupPanel} from './computer-setup-panel';
import {NetworkPanel,INSTALLER} from './network-panel';
type Options={nativeEnabled:boolean;workerEnabled:boolean;linuxEnabled:boolean;gatewayPort:number;workerRoots:string[];computerMode?:'pc'|'linux'|'host';hostComputerId?:string|null};
type HostComputer={id:string;name:string;platform:string;state:string;capabilities:string[]};
type Host={id:string;name:string;serverUrl:string;local:boolean;hasKey:boolean;options:Options;verifiedAt:string|null;lastError:string|null};
type State={items:Host[];activeId:string;activeOptions:Options;revision:string;controller:null|{profileId:string;revision:string;nativeReady:boolean;workerReady:boolean;linuxReady:boolean;error:string|null;updatedAt:string}};
export function ConnectionPanel(){
 const [state,setState]=useState<State>(),[error,setError]=useState(''),[busy,setBusy]=useState<string|null>(null),[result,setResult]=useState('');
 const request=async(path='',method='GET',body?:unknown)=>{const r=await fetch('/api/connections'+path,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const v=await r.json();if(!r.ok)throw Error(v.error||'The connection operation failed.');return v;};
 const refresh=async()=>{try{setState(await request());setError('');}catch(e){setError((e as Error).message);}};
 useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>clearInterval(timer);},[]);
 const action=async(id:string,kind:'test'|'activate'|'delete')=>{setBusy(id);setError('');try{const r=await request('/'+id+(kind==='delete'?'':'/'+kind),kind==='delete'?'DELETE':'POST',kind==='delete'?undefined:{});if(kind==='activate'){window.location.reload();return;}setResult(kind==='test'?'Connection and admin key verified.':'Host deleted.');await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(null);}};
 return <>
  <PageHeading eyebrow="Connection management" title="Servers" description="Manage the backend your Dots run on and how this PC connects to it."/>
  <Notice error={error}/>{result&&<p role="status" className="text-sm text-success">{result}</p>}
  {!state&&!error&&<Loading/>}
  {state&&<Deployment state={state}/>}
  {state&&<Section title="This computer’s connection" description="This choice changes the main Codex proxy and the local workers. The Codex window is not opened automatically.">
   <div className="flex flex-wrap items-center gap-3"><Status value={state.controller?state.controller.error?'Error':state.controller.revision===state.revision&&(!state.activeOptions.nativeEnabled||state.controller.nativeReady)&&(!state.activeOptions.workerEnabled||state.controller.workerReady)&&(!state.activeOptions.linuxEnabled||state.controller.linuxReady)?'Ready':'Applying':'Waiting for service'}/><span className="text-sm text-muted">Active host: {state.items.find(h=>h.id===state.activeId)?.name}</span></div>
   {state.controller&&<div className="mt-3 flex flex-wrap gap-4 text-sm"><span>Native proxy: {state.controller.nativeReady?'on':'off'}</span><span>Windows worker: {state.controller.workerReady?'running':'off'}</span><span>Linux worker: {state.controller.linuxReady?'running':'off'}</span></div>}
   {state.controller?.error&&<Notice error={state.controller.error}/>}<p className="mt-3 text-sm text-muted">Switching host does not move existing Dot data to another server. Each server keeps its own Dots and task history.</p>
  </Section>}
  {state?.items.map(host=><Section key={host.id} title={host.name} description={host.serverUrl}>
   <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-muted">{host.verifiedAt?'Last verified: '+time(host.verifiedAt):'No connection test yet'}{state.activeId===host.id?' · Active':''}</span><Actions>
    <Button size="sm" variant="secondary" isDisabled={!!busy} onPress={()=>void action(host.id,'test')}>Test connection</Button>
    <Button size="sm" isDisabled={!!busy} onPress={()=>void action(host.id,'activate')}>{state.activeId===host.id?'Apply settings':'Use this host'}</Button>
   </Actions></div><Notice error={host.lastError||''}/>
   <Disclose summary="Edit connection settings"><Form key={JSON.stringify(host)} submit="Save settings" onSubmit={async d=>{await request('/'+host.id,'PATCH',{name:str(d,'name'),...str(d,'adminKey')?{adminKey:str(d,'adminKey')}:{},options:{nativeEnabled:d.has('nativeEnabled'),computerMode:str(d,'computerMode'),hostComputerId:str(d,'hostComputerId')||null,gatewayPort:Number(str(d,'gatewayPort')),workerRoots:str(d,'workerRoots').split(/\r?\n/).map(s=>s.trim()).filter(Boolean)}});setResult('Saved. Press Apply settings to switch the connection.');await refresh();}}>
    <FormGrid><Field name="name" label="Host name" value={host.name} required/><Field name="gatewayPort" label="Native gateway port" type="number" value={host.options.gatewayPort} required/></FormGrid>
    {!host.local&&<Field name="adminKey" label="New admin key" type="password" description="Leave empty to keep the current key. The key is never shown again."/>}
    <Field name="workerRoots" label="Windows worker working directories" type="textarea" value={host.options.workerRoots.join('\n')} description="Task start and output directories. With full access on, terminal commands can also use other files the PC can reach."/>
    <SelectField name="computerMode" label="The Dot’s computer" defaultValue={host.options.computerMode||'pc'} options={[{value:'pc',label:'Connected PC — the real Windows desktop'},{value:'linux',label:'Separate Linux environment — WSL computer'},{value:'host',label:'Computer connected to the server — a VPS or another PC'}]}/>
    <HostComputerSelect host={host}/>
    <Check name="nativeEnabled" label="Run the main Codex proxy" checked={host.options.nativeEnabled}/>
    <p className="text-sm text-muted">If you change the gateway port, close and reopen Codex yourself. The Linux worker needs a WSL computer that is already set up.</p>
   </Form></Disclose>
   {!host.local&&<HostTools host={host}/>}
   {!host.local&&state.activeId!==host.id&&<Disclose summary="Remove host entry"><Button size="sm" variant="danger" onPress={()=>void action(host.id,'delete')}>Delete this host</Button></Disclose>}
  </Section>)}
  {state&&<Section title="Add host" description="Enter the remote damndots server’s HTTPS or Tailscale address (http://100.x.y.z:9340) and its admin key. The key is stored encrypted in this PC’s backend."><Form submit="Save host" onSubmit={async d=>{await request('','POST',{name:str(d,'name'),serverUrl:str(d,'serverUrl'),adminKey:str(d,'adminKey')});await refresh();}}><FormGrid><Field name="name" label="Host name" required/><Field name="serverUrl" label="Backend address" placeholder="https://dots.example.com or http://100.64.0.10:9340" required/></FormGrid><Field name="adminKey" label="Host admin key" type="password" required/></Form></Section>}
  <NetworkPanel/>
  <TransportPanel/>
  <ComputerSetupPanel/>
 </>;
}

const LAYOUTS=[
 {key:'local-local',title:'Dot and computer on this PC',text:'Default layout. The backend, the Dot and the computer all run on the same Windows PC.'},
 {key:'local-remote',title:'Dot on this PC, computer remote',text:'In the Computers section, install a worker on the remote Windows PC or VPS, then set this host’s computer to “Computer connected to the server”.'},
 {key:'remote-local',title:'Dot on a remote server, computer on this PC',text:'Add and use the remote server below. If the computer mode stays “Connected PC”, this PC’s screen is attached to the Dot.'},
 {key:'remote-remote',title:'Dot and computer remote',text:'Add the remote server and set the computer mode to “Computer connected to the server”. This PC only runs the Codex proxy.'},
];
function Deployment({state}:{state:State}){
 const active=state.items.find(h=>h.id===state.activeId),mode=state.activeOptions.computerMode||'pc',current=(active?.local?'local':'remote')+'-'+(mode==='host'?'remote':'local');
 const computer=mode==='host'?'the computer connected to the server':mode==='linux'?'Linux (WSL) on this PC':'this PC’s Windows screen';
 return <Section title="Deployment layout" description="Choose where the Dot runs and which computer it uses. The active layout is marked.">
  <div className="grid gap-3 sm:grid-cols-2">{LAYOUTS.map(l=><div key={l.key} aria-current={l.key===current?'true':undefined} className={'rounded-2xl border p-4 '+(l.key===current?'border-accent bg-surface-secondary':'border-border')}>
   <div className="flex items-center justify-between gap-2"><strong className="text-sm">{l.title}</strong>{l.key===current&&<span className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">Active</span>}</div>
   <p className="mt-1 text-sm text-muted">{l.text}</p></div>)}</div>
  <p className="text-sm text-muted">Right now: Dot runs {active?.local?'on this PC':'on the server '+active?.name}; computer: {computer}.</p>
 </Section>;
}
function HostComputerSelect({host}:{host:Host}){
 const [items,setItems]=useState<HostComputer[]>([]),[error,setError]=useState('');
 useEffect(()=>{let live=true;fetch('/api/connections/'+host.id+'/computers').then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error||'Could not load computers.');if(live){setItems(v.items||[]);setError('');}}).catch(e=>{if(live)setError((e as Error).message);});return()=>{live=false;};},[host.id]);
 return <>
  <SelectField name="hostComputerId" label="Computer on the server" defaultValue={host.options.hostComputerId||''} options={[{value:'',label:'Automatic — first online computer'},...items.map(c=>({value:c.id,label:c.name+' · '+c.platform+' · '+(c.state==='online'?'online':'offline')}))]} description="Only used in the “Computer connected to the server” mode. Lists the computers registered on this host."/>
  {error&&<p className="text-sm text-muted">Could not load the computer list: {error}</p>}
 </>;
}

function HostTools({host}:{host:Host}){
 const [enrollment,setEnrollment]=useState<{token:string;expiresAt:string}>(),[dots,setDots]=useState<{id:string;name:string}[]>([]),[dotId,setDotId]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;fetch('/api/connections/local-dots').then(async r=>{const v=await r.json();if(r.ok&&live){setDots(v.items||[]);setDotId(v.items?.[0]?.id||'');}}).catch(()=>{});return()=>{live=false;};},[]);
 const call=async(path:string,body?:unknown)=>{const r=await fetch('/api/connections/'+host.id+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})});const v=await r.json();if(!r.ok)throw Error(v.error||'Operation failed.');return v;};
 const run=async(task:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await task();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 let address=host.serverUrl;try{const u=new URL(host.serverUrl);address=u.protocol==='https:'?u.origin:u.hostname+' -ServerPort '+(u.port||'80');}catch{}
 const install='irm '+INSTALLER+' -OutFile $env:TEMP\\install-dots-worker.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\\install-dots-worker.ps1 -ServerAddress '+address;
 return <>
  <Disclose summary="Connect a computer to this server"><div className="flex flex-col gap-3">
   <p className="text-sm text-muted">Open an administrator PowerShell on the Windows PC or VPS you want to connect and run these in order. The enrollment key is single-use and valid for 10 minutes.</p>
   <Actions><Button size="sm" isDisabled={busy} onPress={()=>void run(async()=>{setEnrollment(await call('/enrollment'));})}>Create enrollment key</Button></Actions>
   {enrollment&&<><Code>{install}</Code><Code>{'C:\\Dots\\start-worker.cmd --enrollment '+enrollment.token}</Code><p className="text-xs text-muted">Valid until: {time(enrollment.expiresAt)}</p></>}
  </div></Disclose>
  <Disclose summary="Copy a Dot to this server"><div className="flex flex-col gap-3">
   <p className="text-sm text-muted">The Dot’s name, model, instructions and avatar are copied to this server. Chat history is not moved. The settings of a Dot with the same name are kept; a missing avatar from an earlier copy is completed.</p>
   {dots.length>0?<SelectField label="Dot on this PC" value={dotId} onChange={setDotId} options={dots.map(d=>({value:d.id,label:d.name}))}/>:<p className="text-sm text-muted">No Dot to copy was found on this PC.</p>}
   <Actions><Button size="sm" isDisabled={busy||!dotId} onPress={()=>void run(async()=>{const v=await call('/copy-dot',{dotId});setNotice(v.existing?'“'+v.name+'” already exists on this server; it was not changed.':'“'+v.name+'” was copied to this server.');})}>Copy</Button></Actions>
  </div></Disclose>
  <Notice error={error}/>{notice&&<p role="status" className="text-sm text-success">{notice}</p>}
 </>;
}

