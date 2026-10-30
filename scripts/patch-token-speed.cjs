'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=fs.realpathSync(process.argv[2]||''),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(root.toLowerCase().includes('windowsapps'))throw Error('Only patch a private staged copy');
const file=path.join(root,'resources/app.asar'),archive=fs.readFileSync(file),oldHeader=archive.subarray(16,16+archive.readUInt32LE(12)),meta=JSON.parse(oldHeader),base=8+archive.readUInt32LE(4),body=archive.subarray(base),changed=[];
function patch(entryPath,fn){let entry=meta;for(const part of entryPath.split('/'))entry=entry.files[part];const source=body.subarray(+entry.offset,+entry.offset+entry.size).toString();const result=fn(source);cp.execFileSync(process.execPath,['--input-type=module','--check'],{input:result});const bytes=Buffer.from(result);entry.offset=String(body.length+changed.reduce((n,x)=>n+x.bytes.length,0));entry.size=bytes.length;entry.integrity.hash=hash(bytes);entry.integrity.blocks=[];for(let i=0;i<bytes.length;i+=entry.integrity.blockSize)entry.integrity.blocks.push(hash(bytes.subarray(i,i+entry.integrity.blockSize)));changed.push({entryPath,bytes});}
function rep(s,a,b){if(s.split(a).length!==2)throw Error('Token speed anchor changed: '+a);return s.replace(a,b);}
const assets=meta.files.webview.files.assets.files,initial=Object.keys(assets).find(n=>n.startsWith('app-initial-')&&n.endsWith('.js'));
patch('webview/assets/'+initial,s=>{
 if(s.includes('damndotsTpsPreferences'))throw Error('Token speed settings already patched');
 s=rep(s,'var tokens=0,ms=0,count=0;','if(damndotsTpsPreferences.aggregation==="latest")list=list.slice(-1);var tokens=0,ms=0,count=0;');
 s=rep(s,'var m=codexTpsMetric(scopeId),s=R.useState(0)','var m=codexTpsMetric(scopeId),s=R.useState(0)');
 s=rep(s,'R.useEffect(function(){function update(){bump','R.useEffect(damndotsWatchTpsPreferences,[]);R.useEffect(function(){function update(){bump');
 s=rep(s,'if(reduce){setShown(m.tps);return;}','if(reduce||!damndotsTpsPreferences.animate){setShown(m.tps);return;}');
 s=rep(s,'},[m.tps,m.count,scopeId]);','},[m.tps,m.count,scopeId,damndotsTpsPreferences.animate]);');
 s=rep(s,'if(!m.count)return null;','if(!m.count||!damndotsTpsPreferences.enabled)return null;');
 s=rep(s,'number=visible>=100?Math.round(visible):visible>=10?visible.toFixed(0):visible.toFixed(1);','number=visible.toFixed(damndotsTpsPreferences.decimals);');
 return s+'\n'+fs.readFileSync(path.join(__dirname,'token-speed-renderer.js'),'utf8');
});
const builds=meta.files['.vite'].files.build.files,main=require('./desktop-build-targets.cjs').mainBuildName(builds,n=>body.subarray(+builds[n].offset,+builds[n].offset+builds[n].size).toString());
patch('.vite/build/'+main,s=>s+'\n'+fs.readFileSync(path.join(__dirname,'token-speed-runtime.js'),'utf8'));
const notifyRe=/onNotification\(([\w$]+),([\w$]+),([\w$]+)=null,([\w$]+),([\w$]+)=Date\.now\(\)\)\{/;
const notifyBuild=Object.keys(builds).filter(n=>/\.js$/.test(n)&&notifyRe.test(body.subarray(+builds[n].offset,+builds[n].offset+builds[n].size).toString()));
if(notifyBuild.length===1)patch('.vite/build/'+notifyBuild[0],s=>{if((s.match(new RegExp(notifyRe.source,'g'))||[]).length!==1)throw Error('Notification entry ambiguous');return s.replace(notifyRe,(m,a,b)=>m+'try{globalThis.__damndotsTpsMain?.('+a+','+b+')}catch{}');});
else if(notifyBuild.length>1)throw Error('Notification entry ambiguous');
patch('.vite/build/preload.js',s=>{const b=require('./desktop-build-targets.cjs');if(!s.includes('getTokenSpeedPreferences'))s=b.addPreloadBridge(s,'getTokenSpeedPreferences','()=>{OWNER}.ipcRenderer.invoke("damndots:token-speed")');return s;});
const json=Buffer.from(JSON.stringify(meta)),payload=(4+json.length+3)&~3,pickle=Buffer.alloc(4+payload),head=Buffer.alloc(8);pickle.writeUInt32LE(payload);pickle.writeUInt32LE(json.length,4);json.copy(pickle,8);head.writeUInt32LE(4);head.writeUInt32LE(pickle.length,4);
const result=Buffer.concat([head,pickle,body,...changed.map(x=>x.bytes)]),exe=fs.readFileSync(path.join(root,'ChatGPT.exe')),needle=Buffer.from(hash(oldHeader)),at=exe.indexOf(needle);if(at<0||exe.indexOf(needle,at+1)>=0)throw Error('EXE integrity anchor changed');Buffer.from(hash(json)).copy(exe,at);
fs.writeFileSync(file,result);fs.writeFileSync(path.join(root,'ChatGPT.exe'),exe);
const rec=JSON.parse(fs.readFileSync(path.join(root,'renewal.json'),'utf8'));Object.assign(rec,{headerHash:hash(json),exeHash:hash(exe),archiveHash:hash(result),tokenSpeedSettingsPatch:1});fs.writeFileSync(path.join(root,'renewal.json'),JSON.stringify(rec,null,2));fs.writeFileSync(path.join(root,'token-speed-patch.json'),JSON.stringify({version:1}));console.log('Token speed settings staged; three complete ESM modules parsed; archive and executable integrity updated.');
