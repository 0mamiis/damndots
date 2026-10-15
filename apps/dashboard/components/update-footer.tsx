"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {Button,toast} from '@heroui/react';
import {Disclose} from './ui';
import pkg from '../../../package.json';
type Release={tag:string;version:string;url:string;notes:string;publishedAt:string};
type Job={id:string;target:string;status:string;step:string};
type State={current:string;latest:Release|null;available:boolean;error:string|null;checkedAt:string|null;blocked:string|null;job:Job|null};
const working=new Set(['preparing','ready','applying','restarting','rolling_back']);
export async function updateRequest(path='',body?:unknown,signal?:AbortSignal){
  const r=await fetch('/api/updates'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal});
  const value=await r.json();if(!r.ok)throw Error(value.error||'Update request failed');return value;
}
export function useReleaseUpdates(enabled:boolean){
  const [state,setState]=useState<State>(),[error,setError]=useState(''),[pending,setPending]=useState(false);
  const last=useRef<State|undefined>(undefined),inFlight=useRef(false),alive=useRef(false),requested=useRef<Set<string>>(new Set());
  const refresh=useCallback(async(force=false,signal?:AbortSignal)=>{
    if(inFlight.current)return;
    inFlight.current=true;
    try{
      const value:State=await updateRequest(force?'?refresh=1':'',undefined,signal);
      if(!alive.current)return;last.current=value;setState(value);setError('');
      const tag=value.latest?.tag;
      // A tab nobody is looking at (for example restored in the background) must not use up the one-time notice.
      if(value.available&&tag&&!requested.current.has(tag)&&document.visibilityState==='visible'){
        requested.current.add(tag);
        try {
          const notice=await updateRequest('/notice',{tag},signal);
          if(alive.current&&notice.show){
            window.dispatchEvent(new Event('dots-toast'));
            setTimeout(()=>toast.info('damndots '+tag+' is available. Open the version control at the bottom of the sidebar to update.'),0);
          }
        }catch{requested.current.delete(tag);}
      }
    }catch(e){if(alive.current&&!signal?.aborted)setError((e as Error).message);}
    finally{inFlight.current=false;}
  },[]);
  useEffect(()=>{
    if(!enabled)return;
    alive.current=true;const controller=new AbortController();
    void refresh(false,controller.signal);
    const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh(false,controller.signal);},5000);
    const focus=()=>{if(document.visibilityState==='visible')void refresh(false,controller.signal);};
    window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
    return()=>{alive.current=false;controller.abort();clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
  },[enabled,refresh]);
  const install=async()=>{
    const tag=last.current?.latest?.tag;if(!tag||pending)return;
    setPending(true);setError('');
    try{await updateRequest('/apply',{tag});await refresh();}
    catch(e){setError((e as Error).message);}
    finally{setPending(false);}
  };
  return {state,error,pending,refresh,install};
}
export function UpdateFooter({updates}:{updates:ReturnType<typeof useReleaseUpdates>}){
  const {state,error,pending,refresh,install}=updates;
  const busy=!!state?.job&&working.has(state.job.status),current=state?.current||pkg.version;
  return <div className="min-w-0 text-xs" aria-label="Version and updates">
    <Disclose summary={<span className="flex w-full items-center gap-2"><span className="text-muted">damndots v{current}</span>{state?.available&&<span className="ml-auto rounded-full bg-accent/15 px-2 py-0.5 text-accent">Update</span>}</span>}>
      <div className="flex flex-col gap-3 py-2">
        <p className="text-muted">This dashboard installation. Remote backends are updated separately.</p>
        {busy?<p role="status">{state?.job?.step}{error?' — reconnecting…':''}</p>:<>
          {state?.available&&state.latest?<><strong>{state.latest.tag} is available</strong><a href={state.latest.url} target="_blank" rel="noreferrer" className="text-accent underline">Release notes</a><p className="text-muted">Dots will check and build the release, restart its services, and restore the previous version if startup fails. Your data and settings stay in place.</p>{state.blocked&&<p>{state.blocked}</p>}<Button size="sm" isPending={pending} isDisabled={!!state.blocked||pending} onPress={()=>void install()}>Install update</Button></>:<p>{state?.latest?'You are up to date.':state?.error?'Release status unavailable.':'Checking for releases…'}</p>}
          {state?.job&&<p role="status">{state.job.step}</p>}
          {state?.error&&<p className="text-warning">{state.error}</p>}
          {error&&<p role="alert" className="text-danger">{error}</p>}
          {current!==pkg.version&&<Button size="sm" variant="secondary" onPress={()=>window.location.reload()}>Reload panel</Button>}
          <Button size="sm" variant="ghost" onPress={()=>void refresh(true)}>Check for updates</Button>
        </>}
      </div>
    </Disclose>
  </div>;
}
