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
function codexTpsScopeFromProps(p){
 if(p&&Object.prototype.hasOwnProperty.call(p,'conversationId')){
  var cid=p.conversationId;
  if(cid==null||cid==='')return null;
  var raw=String(cid);
  if(/^(?:draft|client-new-thread):/.test(raw))return null;
  raw=raw.replace(/^[a-z]+:/,'');
  return raw&&!/^(?:draft|client-new-thread):/.test(raw)?raw:null;
 }
 return codexOrchestratorComposerScope();
}
window.__codexOrchNativeWrap=function(R,main,Picker,props){
 var h=R.createElement;codexOrchestratorEnsureNative(R);
 if(!document.getElementById('codex-orch-layout-style')){var st=document.createElement('style');st.id='codex-orch-layout-style';st.textContent='span:has(> [data-codex-orchestrator-host]),[data-codex-orchestrator-host]{display:contents}[data-codex-orchestrator-host] > [data-codex-tps]{order:-1}[data-codex-orchestrator-host] > button:last-child{margin-inline-start:-6px}[data-codex-subagent-trigger] [class*="ModelPickerTriggerModelGroup"] > span:has(> [data-codex-orchestrator-label]),[data-codex-subagent-trigger] [data-codex-orchestrator-label]{display:contents}[data-codex-subagent-trigger] [class*="ModelPickerTriggerInlineModeIcon"]{order:1;margin-inline-start:2px}[data-codex-subagent-trigger] [data-codex-orchestrator-label] > span:not([class*="ModelPickerTriggerEffortLabel"]){order:2}[data-codex-subagent-trigger] [class*="ModelPickerTriggerModelGroup"]:has([data-codex-orchestrator-label="off"]) > [class*="ModelPickerTriggerInlineModeIcon"]{display:none}[data-codex-subagent-trigger][data-dots-off="1"][aria-expanded="true"] > span[class*="ComposerDropdownLabel"]{display:none}[data-codex-subagent-trigger][data-dots-off="1"][aria-expanded="true"]::before{content:attr(data-dots-label);white-space:nowrap;color:inherit}';document.head.appendChild(st)}
 if(!codexOrchestratorTpsComponent)codexOrchestratorTpsComponent=function(p){return codexThreadTpsBadge(codexTpsScopeFromProps(p),R)};
 var tpsProps=props&&Object.prototype.hasOwnProperty.call(props,'conversationId')?{conversationId:props.conversationId}:null;
 return h('span',{className:'flex min-w-0 items-center','data-codex-orchestrator-host':''},h(codexOrchestratorTpsComponent,tpsProps),main,h(Picker,Object.assign({},props,{codexSubagent:true})));
};
function codexRspackBoot(){
 if(window.__codexRspackBooted)return;window.__codexRspackBooted=true;
 var last=null,timer=0,syncedAt=0;
 window.addEventListener('codex-orchestrator-change',function(){syncedAt=Date.now();try{codexOrchestratorSync()}catch(e){}schedule()});
 window.addEventListener('focus',function(){syncedAt=Date.now();try{codexOrchestratorSync()}catch(e){}});
 document.addEventListener('focusin',function(e){
  try{
   var n=e.target;
   for(var d=0;d<14&&n&&n!==document.body;d++,n=n.parentElement){
    var bs=n.querySelectorAll&&n.querySelectorAll('button[data-codex-subagent-trigger]');
    if(bs&&bs.length===1){
     var sc=(bs[0].__codexInst&&bs[0].__codexInst.scope)||bs[0].getAttribute('data-codex-scope');
     if(sc&&sc!==window.__codexFocusedScope){window.__codexFocusedScope=sc;syncedAt=Date.now();codexOrchestratorSync();}
     break;
    }
    if(bs&&bs.length>1)break;
   }
  }catch(err){}
 },true);
 function tick(){
  timer=0;
  try{if(Date.now()-syncedAt>1000){syncedAt=Date.now();codexOrchestratorSync()}}catch(e){}
  try{
   var scope=codexOrchestratorComposerScope();if(scope!==last){last=scope;window.dispatchEvent(new Event('codex-orchestrator-change'));}
   try{var sbs=document.querySelectorAll('button[data-codex-subagent-trigger]');for(var q=0;q<sbs.length;q++){var sb=sbs[q],sc=(sb.__codexInst&&sb.__codexInst.scope)||sb.getAttribute('data-codex-scope')||scope,lbl=window.__codexOrchShortLabel?window.__codexOrchShortLabel(sc):'';if(lbl&&sb.getAttribute('data-dots-label')!==lbl)sb.setAttribute('data-dots-label',lbl);var offFlag=window.__codexOrchIsOff&&window.__codexOrchIsOff(sc)?'1':'';if(sb.getAttribute('data-dots-off')!==offFlag)sb.setAttribute('data-dots-off',offFlag)}}catch(e){}
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
