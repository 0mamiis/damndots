'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=fs.realpathSync(process.argv[2]||''),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(root.toLowerCase().includes('windowsapps'))throw Error('Only patch a private staged copy');
const file=path.join(root,'resources/app.asar'),archive=fs.readFileSync(file),oldHeader=archive.subarray(16,16+archive.readUInt32LE(12)),meta=JSON.parse(oldHeader),base=8+archive.readUInt32LE(4),body=archive.subarray(base),changed=[];
function patch(entryPath,fn){let entry=meta;for(const part of entryPath.split('/'))entry=entry.files[part];const source=body.subarray(+entry.offset,+entry.offset+entry.size).toString();const result=fn(source);cp.execFileSync(process.execPath,['--input-type=module','--check'],{input:result});const bytes=Buffer.from(result);entry.offset=String(body.length+changed.reduce((n,x)=>n+x.bytes.length,0));entry.size=bytes.length;entry.integrity.hash=hash(bytes);entry.integrity.blocks=[];for(let i=0;i<bytes.length;i+=entry.integrity.blockSize)entry.integrity.blocks.push(hash(bytes.subarray(i,i+entry.integrity.blockSize)));changed.push({entryPath,bytes});}
function rep(s,a,b){if(s.split(a).length!==2)throw Error('Token speed anchor changed: '+a);return s.replace(a,b);}
const assets=meta.files.webview.files.assets.files,initial=Object.keys(assets).find(n=>n.startsWith('app-initial-')&&n.endsWith('.js'));
const BT=String.fromCharCode(96);
function sub(s,re,fn,count,label){const g=re.flags.includes('g')?re:new RegExp(re.source,re.flags+'g');if([...s.matchAll(g)].length!==count)throw Error('Unsupported Codex '+label);return s.replace(g,fn);}
patch('webview/assets/'+initial,s=>{
 if(s.includes('function codexOrchestratorTurn('))return s; // Adopt an existing installation without duplicating hooks.
 const hosts=[...s.matchAll(/(\w+)=(\w+\(\w+\.getHostId\(\)\)\|\|\w+\.mode===\x60durable\x60\?\w+\.request:\w+\(\w+\.request,\w+\.requestClient\.getAppServerVersion\(\)\))/g)];
 if(hosts.length!==1)throw Error('Unsupported native turn request boundary');
 const cv=[...s.slice(Math.max(0,hosts[0].index-1500),hosts[0].index).matchAll(/let (\w+)=\w+\.getConversation\(\w+\),\w+=\1==null\?null:/g)];
 if(cv.length!==1)throw Error('Native conversation boundary missing');
 s=s.replace(hosts[0][0],()=>hosts[0][1]+'=codexOrchestratorTurn('+hosts[0][2]+',(N.mode==='+BT+'durable'+BT+'?true:null),'+cv[0][1]+'?.latestReasoningEffort)');
 const cnt={};for(const x of s.matchAll(/\(0,(\w+)\.(useState|useEffect|useRef)\)/g)){(cnt[x[1]]??={})[x[2]]=(cnt[x[1]][x[2]]||0)+1;}
 const facs={};for(const n of Object.keys(cnt)){const d=s.match(new RegExp('[,;]'+n+'=(\\w+)\\(\\)[,;]'));if(d&&cnt[n].useState&&cnt[n].useEffect&&cnt[n].useRef)facs[n]=d[1];}
 const fc={};Object.values(facs).forEach(f=>fc[f]=(fc[f]||0)+1);const top=Object.entries(fc).sort((a,b)=>b[1]-a[1])[0],rn=top&&Object.keys(facs).find(n=>facs[n]===top[0]);if(!rn||top[1]<3)throw Error('React binding missing');
 s=rep(s,'className:'+BT+'flex min-w-0 flex-1 justify-end'+BT+',children:n}','className:'+BT+'flex min-w-0 flex-1 items-center justify-end'+BT+',children:codexOrchestratorDropdown('+rn+',n)}');
 s=rep(s,'RHt(e,n),e.set(Ax,n,t)','RHt(e,n),codexOrchestratorBind(n,t),e.set(Ax,n,t)');
 const hook="try{if(o.method==='turn/started')window.__codexTpsOnTurnStarted?.(o.params);else if(o.method==='turn/completed')window.__codexTpsOnTurnCompleted?.(o.params);else if(o.method==='item/started')window.__codexTpsOnItemStart?.(o.params);else if(o.method==='item/agentMessage/delta'||o.method==='item/plan/delta'||o.method==='item/reasoning/summaryTextDelta'||o.method==='item/reasoning/textDelta')window.__codexTpsOnDelta?.(o.params);else if(o.method==='thread/tokenUsage/updated')window.__codexTpsOnUsage?.(o.params)}catch(e){}";
 const anchor='u.events.emitNotification(o,i);return}',at=s.indexOf(anchor),sw=s.indexOf('switch(o.method)',at+anchor.length);if(at<0||s.split(anchor).length!==2||sw<0||sw-at>5000)throw Error('Native event notification boundary changed');
 s=s.slice(0,sw)+hook+s.slice(sw);
 return s+'\n'+fs.readFileSync(path.join(__dirname,'desktop-features/orchestrator-ui.js'),'utf8');
});
const primary=Object.keys(assets).find(n=>n.startsWith('app-primary-')&&n.endsWith('.js'));
patch('webview/assets/'+primary,s=>s.includes('function codexSubagentSelection(')?s:require('./desktop-features/native-subpicker.cjs')(s,rep,sub));
const builds=meta.files['.vite'].files.build.files,main=Object.keys(builds).find(n=>n.startsWith('main-')&&n.endsWith('.js'));
patch('.vite/build/'+main,s=>s.includes('/* codex-tps-opencodex-bridge-v2 */')?s:s+'\n'+fs.readFileSync(path.join(__dirname,'desktop-features/opencodex-tps-main.js'),'utf8'));
patch('.vite/build/preload.js',s=>s.includes('getOpenCodexTps:')?s:rep(s,'windowType:T,','windowType:T,getOpenCodexTps:t=>e.ipcRenderer.invoke("codex-tps:opencodex-v2",t),'));
const json=Buffer.from(JSON.stringify(meta)),payload=(4+json.length+3)&~3,pickle=Buffer.alloc(4+payload),head=Buffer.alloc(8);pickle.writeUInt32LE(payload);pickle.writeUInt32LE(json.length,4);json.copy(pickle,8);head.writeUInt32LE(4);head.writeUInt32LE(pickle.length,4);
const result=Buffer.concat([head,pickle,body,...changed.map(x=>x.bytes)]),exe=fs.readFileSync(path.join(root,'ChatGPT.exe')),needle=Buffer.from(hash(oldHeader)),at=exe.indexOf(needle);if(at<0||exe.indexOf(needle,at+1)>=0)throw Error('EXE integrity anchor changed');Buffer.from(hash(json)).copy(exe,at);
fs.writeFileSync(file,result);fs.writeFileSync(path.join(root,'ChatGPT.exe'),exe);
const rec=JSON.parse(fs.readFileSync(path.join(root,'renewal.json'),'utf8'));Object.assign(rec,{headerHash:hash(json),exeHash:hash(exe),archiveHash:hash(result),nativeAgentFeaturesPatch:1});fs.writeFileSync(path.join(root,'renewal.json'),JSON.stringify(rec,null,2));fs.writeFileSync(path.join(root,'native-agent-features-patch.json'),JSON.stringify({version:1}));console.log('Token speed settings staged; three complete ESM modules parsed; archive and executable integrity updated.');
