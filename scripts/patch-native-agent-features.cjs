'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {resolveComposerBindings,bindComposerHelper}=require('./desktop-renderer-bindings.cjs'),{locate}=require('./asar-locate.cjs');
const root=fs.realpathSync(process.argv[2]||''),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(root.toLowerCase().includes('windowsapps'))throw Error('Only patch a private staged copy');
const file=path.join(root,'resources/app.asar'),archive=fs.readFileSync(file),oldHeader=archive.subarray(16,16+archive.readUInt32LE(12)),meta=JSON.parse(oldHeader),base=8+archive.readUInt32LE(4),body=archive.subarray(base),changed=[];
function patch(entryPath,fn){let entry=meta;for(const part of entryPath.split('/'))entry=entry.files[part];const source=body.subarray(+entry.offset,+entry.offset+entry.size).toString();const result=fn(source);cp.execFileSync(process.execPath,['--input-type=module','--check'],{input:result});const bytes=Buffer.from(result);entry.offset=String(body.length+changed.reduce((n,x)=>n+x.bytes.length,0));entry.size=bytes.length;entry.integrity.hash=hash(bytes);entry.integrity.blocks=[];for(let i=0;i<bytes.length;i+=entry.integrity.blockSize)entry.integrity.blocks.push(hash(bytes.subarray(i,i+entry.integrity.blockSize)));changed.push({entryPath,bytes});}
function rep(s,a,b){if(s.split(a).length!==2)throw Error('Token speed anchor changed: '+a);return s.replace(a,b);}
const assets=meta.files.webview.files.assets.files,initial=locate(meta,body,{prefix:'app-initial-',needles:['requestClient.getAppServerVersion()','orbit.navigation'],label:'renderer'});
const BT=String.fromCharCode(96);
function sub(s,re,fn,count,label){const g=re.flags.includes('g')?re:new RegExp(re.source,re.flags+'g');if([...s.matchAll(g)].length!==count)throw Error('Unsupported Codex '+label);return s.replace(g,fn);}
function wrapTurnRequest(s){
 const BT=String.fromCharCode(96);
 const legacy=[...s.matchAll(/(\w+)=(\w+\(\w+\.getHostId\(\)\)\|\|\w+\.mode===\x60durable\x60\?\w+\.request:\w+\(\w+\.request,\w+\.requestClient\.getAppServerVersion\(\)\))/g)];
 if(legacy.length===1){
  const hosts=legacy;const cv=[...s.slice(Math.max(0,hosts[0].index-1500),hosts[0].index).matchAll(/let (\w+)=\w+\.getConversation\(\w+\),\w+=\1==null\?null:/g)];
  if(cv.length!==1)throw Error('Native conversation boundary missing');
  const durable=hosts[0][2].match(/\|\|(\w+)\.mode===/);if(!durable)throw Error('Native durable boundary missing');
  return s.replace(hosts[0][0],()=>hosts[0][1]+'=codexOrchestratorTurn('+hosts[0][2]+',('+durable[1]+'.mode==='+BT+'durable'+BT+'?true:null),'+cv[0][1]+'?.latestReasoningEffort)');
 }
 const compact=[...s.matchAll(/((?:\(0,[\w$]+\.[\w$]+\)|[\w$]+)\(e\.getHostId\(\)\)\|\|"durable"===([\w$]+)\.mode\?[\w$]+:\(0,[\w$]+\.[\w$]+\)\([\w$]+,e\.requestClient\.getAppServerVersion\(\)\))/g)];
 if(compact.length===1){const full=compact[0][1],conv=compact[0][2];return s.replace(full,()=>'codexOrchestratorTurn('+full+',('+conv+'.mode==="durable"?true:null),'+conv+'?.latestReasoningEffort)');}
 const modern=[...s.matchAll(/(\w+\(e\.getHostId\(\)\)\|\|(\w+)\.mode===\x60durable\x60\?\w+:\w+\(\w+,e\.requestClient\.getAppServerVersion\(\)\))/g)];
 if(modern.length!==1)throw Error('Unsupported native turn request boundary');
 const full=modern[0][1],conv=modern[0][2];
 return s.replace(full,()=>'codexOrchestratorTurn('+full+',('+conv+'.mode==='+BT+'durable'+BT+'?true:null),'+conv+'?.latestReasoningEffort)');
}
function patchRspackRenderer(s){
 // Codex 26.1029 ships Rspack chunks: one module function per feature, no shared top-level scope.
 // The helper lives at chunk level; the module that sends turns also exposes the bundle's require.
 const at=s.indexOf('codexOrchestratorTurn(');
 const starts=[...s.slice(0,at).matchAll(/[,{]([\w$]{3,6})\(e,t,n\)\{/g)];
 if(!starts.length)throw Error('Native module boundary missing');
 const last=starts[starts.length-1],ins=last.index+last[0].length;
 s=s.slice(0,ins)+'window.__dotsRequire=n;'+s.slice(ins);
 // Codex 26.1103 runs the app-server manager in a worker and the page subscribes over RPC: add a page-side subscription for the token speed events.
 const rpcSub=/(let ([\w$]+)=\(\)=>([\w$]+)\.connection===([\w$]+);)("all"===([\w$]+)&&([\w$]+)\.push\(([\w$]+)\.subscribe\(\{type:"notification",key:\{hostId:([\w$]+)\})/g,rpcHits=[...s.matchAll(rpcSub)];
 if(rpcHits.length===1){
  const m=rpcHits[0],guard=m[2],pushList=m[7],client=m[8],host=m[9];
  const body="try{var P=e.params;if(e.method==='turn/started'){try{var sr=document.querySelector('[data-app-action-sidebar-thread-selected]:not([data-app-action-sidebar-thread-selected=false])'),sid=sr&&sr.getAttribute('data-app-action-sidebar-thread-id');if(sid&&/client-new-thread:/.test(sid)&&P&&P.threadId){(window.__dotsThreadMap=window.__dotsThreadMap||{})[String(sid).replace(/^[a-z]+:/,'')]=String(P.threadId);window.dispatchEvent(new Event('codex-orchestrator-change'))}}catch(z){}}if(e.method==='turn/started')window.__codexTpsOnTurnStarted?.(P);else if(e.method==='turn/completed')window.__codexTpsOnTurnCompleted?.(P);else if(e.method==='item/started')window.__codexTpsOnItemStart?.(P);else if(e.method==='item/agentMessage/delta'||e.method==='item/plan/delta'||e.method==='item/reasoning/summaryTextDelta'||e.method==='item/reasoning/textDelta')window.__codexTpsOnDelta?.(P);else if(e.method==='thread/tokenUsage/updated')window.__codexTpsOnUsage?.(P)}catch(x){}";
  s=s.replace(rpcSub,()=>m[1]+pushList+'.push('+client+'.subscribe({type:"notification",key:{hostId:'+host+'},methods:["turn/started","turn/completed","item/started","item/agentMessage/delta","item/plan/delta","item/reasoning/summaryTextDelta","item/reasoning/textDelta","thread/tokenUsage/updated"],listener:e=>{if('+guard+'())'+'{'+body+'}}}));'+m[5]);
  let h2=null;
 }
 const notifyOld=rpcHits.length!==1;
 if(notifyOld){ const notify=[...s.matchAll(/([\w$]+)\.events\.emitNotification\(([\w$]+),([\w$]+)\);return\}switch\(\2\.method\)\{/g)];
 if(notify.length!==1)throw Error('Native event notification boundary changed');
 const v=notify[0][2];
 const hook="try{if(V.method==='turn/started')window.__codexTpsOnTurnStarted?.(V.params);else if(V.method==='turn/completed')window.__codexTpsOnTurnCompleted?.(V.params);else if(V.method==='item/started')window.__codexTpsOnItemStart?.(V.params);else if(V.method==='item/agentMessage/delta'||V.method==='item/plan/delta'||V.method==='item/reasoning/summaryTextDelta'||V.method==='item/reasoning/textDelta')window.__codexTpsOnDelta?.(V.params);else if(V.method==='thread/tokenUsage/updated')window.__codexTpsOnUsage?.(V.params)}catch(e){}".split('V.').join(v+'.');
 s=s.replace(notify[0][0],()=>notify[0][1]+'.events.emitNotification('+v+','+notify[0][3]+');return}'+hook+'switch('+v+'.method){');}
 let helper=fs.readFileSync(path.join(__dirname,'desktop-features/orchestrator-ui.js'),'utf8');
 const scopeRe=/function codexOrchestratorComposerScope\(\)\{[^\n]+\}/;
 if(!scopeRe.test(helper))throw Error('Composer helper identity boundary changed');
 helper=helper.replace(scopeRe,()=>"function codexOrchestratorComposerScope(){try{var cvs=document.querySelectorAll('[data-response-annotation-conversation]');for(var q=0;q<cvs.length;q++){var cid=cvs[q].getAttribute('data-response-annotation-conversation');if(cid&&!/^client-new-thread:/.test(cid)&&(cvs[q].checkVisibility?cvs[q].checkVisibility():cvs[q].getClientRects().length)){var rid=String(cid).replace(/^[a-z]+:/,'');try{var MM=codexOrchestratorReadModes();if(!Object.prototype.hasOwnProperty.call(MM,rid)){var pp=codexOrchestratorReadPending();MM[rid]=pp&&pp.mode&&Date.now()-pp.at<5000?pp.mode:'off';localStorage.setItem(CODEX_ORCH_THREAD_MODES,JSON.stringify(MM))}}catch(e){}return rid}}}catch(e){}try{var r=document.querySelector('[data-app-action-sidebar-thread-selected=\"true\"]'),id=r&&r.getAttribute('data-app-action-sidebar-thread-id');if(id){var raw=String(id).replace(/^[a-z]+:/,'');if(/^client-new-thread:/.test(raw)){var mp=window.__dotsThreadMap&&window.__dotsThreadMap[raw];if(mp){try{var M=codexOrchestratorReadModes();if(!Object.prototype.hasOwnProperty.call(M,mp)){var pd=codexOrchestratorReadPending(),nm=(pd&&pd.mode)||M['draft:new'];if(nm){M[mp]=nm;localStorage.setItem(CODEX_ORCH_THREAD_MODES,JSON.stringify(M))}try{codexOrchestratorSubCopyDraft(mp)}catch(e){}}}catch(e){}}return mp||'draft:new'}return raw}}catch(e){}return 'draft:new'}");
 helper=helper.replace("eco({ hostId: 'local' })","null");
 return s+'\n'+helper+'\n'+fs.readFileSync(path.join(__dirname,'desktop-features/orchestrator-rspack.js'),'utf8');
}

patch('webview/assets/'+initial,s=>{
 if(s.includes('function codexOrchestratorTurn('))return s; // Adopt an existing installation without duplicating hooks.
 s=wrapTurnRequest(s);
 if(s.includes('export const __webpack_modules__'))return patchRspackRenderer(s);
 const cnt={};for(const x of s.matchAll(/\(0,(\w+)\.(useState|useEffect|useRef)\)/g)){(cnt[x[1]]??={})[x[2]]=(cnt[x[1]][x[2]]||0)+1;}
 const facs={};for(const n of Object.keys(cnt)){const d=s.match(new RegExp('[,;]'+n+'=(\\w+)\\(\\)[,;]'));if(d&&cnt[n].useState&&cnt[n].useEffect&&cnt[n].useRef)facs[n]=d[1];}
 const fc={};Object.values(facs).forEach(f=>fc[f]=(fc[f]||0)+1);const top=Object.entries(fc).sort((a,b)=>b[1]-a[1])[0],rn=top&&Object.keys(facs).find(n=>facs[n]===top[0]);if(!rn||top[1]<3)throw Error('React binding missing');
 s=rep(s,'className:'+BT+'flex min-w-0 flex-1 justify-end'+BT+',children:n}','className:'+BT+'flex min-w-0 flex-1 items-center justify-end'+BT+',children:codexOrchestratorDropdown('+rn+',n)}');
 s=sub(s,/(\w+\(e,n\)),e\.set\((\w+),n,t\)/g,(_,call,atom)=>call+',codexOrchestratorBind(n,t),e.set('+atom+',n,t)',1,'draft binding');
 const hook="try{if(o.method==='turn/started')window.__codexTpsOnTurnStarted?.(o.params);else if(o.method==='turn/completed')window.__codexTpsOnTurnCompleted?.(o.params);else if(o.method==='item/started')window.__codexTpsOnItemStart?.(o.params);else if(o.method==='item/agentMessage/delta'||o.method==='item/plan/delta'||o.method==='item/reasoning/summaryTextDelta'||o.method==='item/reasoning/textDelta')window.__codexTpsOnDelta?.(o.params);else if(o.method==='thread/tokenUsage/updated')window.__codexTpsOnUsage?.(o.params)}catch(e){}";
 const legacyAnchor='u.events.emitNotification(o,i);return}';if(s.split(legacyAnchor).length===2){const at=s.indexOf(legacyAnchor),sw=s.indexOf('switch(o.method)',at+legacyAnchor.length);if(sw<0||sw-at>5000)throw Error('Native event notification boundary changed');s=s.slice(0,sw)+hook+s.slice(sw);}else{const modernAnchor='u.events.emitNotification(o,i)}else{switch(o.method){';if(s.split(modernAnchor).length!==2)throw Error('Native event notification boundary changed');s=s.replace(modernAnchor,()=>'u.events.emitNotification(o,i)}else{'+hook+'switch(o.method){');}
 const modelHooks=[...s.matchAll(/function (\w+)\(e\)\{let t=\(0,\w+\.c\)\(\d+\),n=\(0,\w+\.use\)\(\w+\),r=\(\(0,\w+\.use\)\(\w+\),e\?\.hostId\?\?\x60local\x60\)/g)];
 if(modelHooks.length!==1)throw Error('Native model query hook changed');
 const helper=bindComposerHelper(fs.readFileSync(path.join(__dirname,'desktop-features/orchestrator-ui.js'),'utf8'),resolveComposerBindings(s)).replace('eco({ hostId:',modelHooks[0][1]+'({ hostId:');
 return s+'\n'+helper;
});
const primary=Object.keys(assets).find(n=>n.startsWith('app-primary-')&&n.endsWith('.js'));
if(primary)patch('webview/assets/'+primary,s=>s.includes('function codexSubagentSelection(')?s:require('./desktop-features/native-subpicker.cjs')(s,rep,sub));
else{
 const rs=require('./desktop-features/native-subpicker-rspack.cjs');
 const sliderName=locate(meta,body,{needles:['initialOptionId:','keyboardControlFocused:','onDragToMax'],label:'power slider'}),sliderEntry=assets.async.files[sliderName.replace(/^async\//,'')];
 const textClass=(body.subarray(+sliderEntry.offset,+sliderEntry.offset+sliderEntry.size).toString().match(/ModelPickerTriggerModelText-[\w-]+/)||[])[0];if(!textClass)throw Error('Unsupported Codex model label class');
 patch('webview/assets/'+locate(meta,body,{needles:['composer.cycleReasoningEffort','permissionsHostId:','persistent'],label:'model picker'}),s=>s.includes('function codexSubagentSelection(')?s:rs.picker(s,rep,sub,textClass));
 patch('webview/assets/'+sliderName,rs.slider);
}
const builds=meta.files['.vite'].files.build.files,main=require('./desktop-build-targets.cjs').mainBuildName(builds,n=>body.subarray(+builds[n].offset,+builds[n].offset+builds[n].size).toString());
const readBuild=n=>body.subarray(+builds[n].offset,+builds[n].offset+builds[n].size).toString();
// Codex 26.1029+ builds user turns in the Electron main process; the orchestrator context has to be added there.
const turnFiles=Object.keys(builds).filter(n=>/\.js$/.test(n)).filter(n=>{const x=readBuild(n);return x.includes('e.requestClient.getAppServerVersion()')&&/"durable"===[\w$]+\.mode\?/.test(x)});
if(turnFiles.length>1)throw Error('Unsupported Codex turn builder is ambiguous');
if(turnFiles.length===1){
 const ui=fs.readFileSync(path.join(__dirname,'desktop-features/orchestrator-ui.js'),'utf8'),pick=re=>{const m=ui.match(re);if(!m)throw Error('Orchestrator text boundary missing');return m[0]};
 const mainTurn=[pick(/^var CODEX_ORCH_TEXT=.*$/m),pick(/^var CODEX_ORCH_SENT=.*$/m),pick(/^var CODEX_ORCH_OFF_ULTRA=.*$/m),fs.readFileSync(path.join(__dirname,'desktop-features/orchestrator-main.js'),'utf8')].join('\n');
 patch('.vite/build/'+turnFiles[0],s=>s.includes('function codexOrchestratorTurn(')?s:wrapTurnRequest(s)+'\n'+mainTurn);
}
patch('.vite/build/'+main,s=>{if(!s.includes('/* codex-tps-opencodex-bridge-v2 */'))s+='\n'+fs.readFileSync(path.join(__dirname,'desktop-features/opencodex-tps-main.js'),'utf8');if(!s.includes('damndots-orchestrator-main-ipc-v1'))s+='\n'+fs.readFileSync(path.join(__dirname,'desktop-features/orchestrator-main-ipc.js'),'utf8');return s;});
patch('.vite/build/preload.js',s=>{const b=require('./desktop-build-targets.cjs');if(!s.includes('getOpenCodexTps:'))s=b.addPreloadBridge(s,'getOpenCodexTps','t=>{OWNER}.ipcRenderer.invoke("codex-tps:opencodex-v2",t)');if(!s.includes('getScrollControls:'))s=b.addPreloadBridge(s,'getScrollControls','t=>{OWNER}.ipcRenderer.invoke("damndots:scroll-controls",t)');if(!s.includes('syncOrchestrator:'))s=b.addPreloadBridge(s,'syncOrchestrator','t=>{OWNER}.ipcRenderer.invoke("damndots:orchestrator-sync",t)');return s;});
const json=Buffer.from(JSON.stringify(meta)),payload=(4+json.length+3)&~3,pickle=Buffer.alloc(4+payload),head=Buffer.alloc(8);pickle.writeUInt32LE(payload);pickle.writeUInt32LE(json.length,4);json.copy(pickle,8);head.writeUInt32LE(4);head.writeUInt32LE(pickle.length,4);
const result=Buffer.concat([head,pickle,body,...changed.map(x=>x.bytes)]),exe=fs.readFileSync(path.join(root,'ChatGPT.exe')),needle=Buffer.from(hash(oldHeader)),at=exe.indexOf(needle);if(at<0||exe.indexOf(needle,at+1)>=0)throw Error('EXE integrity anchor changed');Buffer.from(hash(json)).copy(exe,at);
fs.writeFileSync(file,result);fs.writeFileSync(path.join(root,'ChatGPT.exe'),exe);
const rec=JSON.parse(fs.readFileSync(path.join(root,'renewal.json'),'utf8'));Object.assign(rec,{headerHash:hash(json),exeHash:hash(exe),archiveHash:hash(result),nativeAgentFeaturesPatch:1});fs.writeFileSync(path.join(root,'renewal.json'),JSON.stringify(rec,null,2));fs.writeFileSync(path.join(root,'native-agent-features-patch.json'),JSON.stringify({version:1}));console.log('Token speed settings staged; three complete ESM modules parsed; archive and executable integrity updated.');
