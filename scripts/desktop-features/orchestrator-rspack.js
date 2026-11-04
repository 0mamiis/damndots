// Codex 26.1029+ (Rspack) glue: finds React through the bundle's own require, then mounts the orchestrator
// controls beside the composer's model picker (data-composer-navigation-target="reasoning").
function codexRspackParts(){
 if(window.__dotsParts)return window.__dotsParts;
 var req=window.__dotsRequire;if(!req)return null;
 var R=null,RD=null,cache=req.c||null;
 function ok(ex,keys){try{return ex&&keys.every(function(k){return typeof ex[k]==='function'})}catch(e){return false}}
 if(cache){for(var id in cache){var ex=cache[id]&&cache[id].exports;if(!R&&ok(ex,['useState','useEffect','createElement']))R=ex;if(!RD&&ok(ex,['createRoot']))RD=ex;if(R&&RD)break;}}
 if((!R||!RD)&&req.m){
  for(var mid in req.m){var src;try{src=Function.prototype.toString.call(req.m[mid])}catch(e){continue}
   if(!R&&src.indexOf('useSyncExternalStore')>=0&&src.indexOf('createElement')>=0&&src.indexOf('useState')>=0&&src.length<400000){try{var c1=req(mid);if(ok(c1,['useState','createElement']))R=c1}catch(e){}}
   if(!RD&&src.indexOf('createRoot')>=0&&src.indexOf('hydrateRoot')>=0&&src.length<400000){try{var c2=req(mid);if(ok(c2,['createRoot']))RD=c2}catch(e){}}
   if(R&&RD)break;}
 }
 if(!R||!RD)return null;
 return window.__dotsParts={R:R,RD:RD};
}
// Rendered by the native model picker (inside the app's own React tree): tok/s badge, primary picker and the orchestrator/subagent picker.
window.__codexOrchNativeWrap=function(R,main,Picker,props){
 var h=R.createElement;codexOrchestratorEnsureNative(R);
 if(!codexOrchestratorTpsComponent)codexOrchestratorTpsComponent=function(){return codexThreadTpsBadge(codexOrchestratorComposerScope(),R)};
 return h('span',{className:'flex min-w-0 items-center','data-codex-orchestrator-host':''},h(codexOrchestratorTpsComponent),main,h(Picker,Object.assign({},props,{codexSubagent:true})));
};
function codexRspackBoot(){
 if(window.__codexRspackBooted)return;window.__codexRspackBooted=true;
 var last=null,timer=0;
 function tick(){
  timer=0;
  try{
   var scope=codexOrchestratorComposerScope();if(scope!==last){last=scope;window.dispatchEvent(new Event('codex-orchestrator-change'));}
   if(typeof window.__codexComposerModelPicker==='function')return; // native picker integration renders the orchestrator itself
   var btn=document.querySelector('[data-composer-navigation-target="reasoning"]');if(!btn)return;
   var bar=btn.parentElement&&btn.parentElement.parentElement;if(!bar)return;
   if(bar.querySelector(':scope > [data-dots-orch-root]'))return;
   var parts=codexRspackParts();if(!parts)return;
   var host=document.createElement('span');host.setAttribute('data-dots-orch-root','');host.style.display='contents';
   bar.insertBefore(host,bar.firstChild);
   parts.RD.createRoot(host).render(codexOrchestratorDropdown(parts.R,null));
  }catch(e){try{console.warn('Dots orchestrator mount failed',e)}catch(_){}}
 }
 function schedule(){if(!timer)timer=setTimeout(tick,150)}
 new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
 setInterval(tick,1000);schedule();
}
codexRspackBoot();
