'use strict';
// Codex 26.1027 reads the account list through the desktop main process, which talks to
// chatgpt.com directly and therefore never sees the Dots gateway's tbo_available flag.
// The renderer would hide "Your dot" and the whole Orbit surface even though the local
// Dots backend serves the dot. Keep the local Dot reachable: the capability answer comes
// from the local stack, and the destination stays visible in the narrow rail.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=fs.realpathSync(process.argv[2]||''),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(root.toLowerCase().includes('windowsapps'))throw Error('Only patch a private staged copy');
const file=path.join(root,'resources/app.asar'),archive=fs.readFileSync(file),oldHeader=archive.subarray(16,16+archive.readUInt32LE(12)),meta=JSON.parse(oldHeader),base=8+archive.readUInt32LE(4),body=archive.subarray(base),changed=[];
function patch(entryPath,fn){let entry=meta;for(const part of entryPath.split('/'))entry=entry.files[part];const source=body.subarray(+entry.offset,+entry.offset+entry.size).toString();const result=fn(source);cp.execFileSync(process.execPath,['--input-type=module','--check'],{input:result});const bytes=Buffer.from(result);entry.offset=String(body.length+changed.reduce((n,x)=>n+x.bytes.length,0));entry.size=bytes.length;entry.integrity.hash=hash(bytes);entry.integrity.blocks=[];for(let i=0;i<bytes.length;i+=entry.integrity.blockSize)entry.integrity.blocks.push(hash(bytes.subarray(i,i+entry.integrity.blockSize)));changed.push({entryPath,bytes});}
function once(s,a,b,label){if(s.split(a).length!==2)throw Error('Unsupported Codex '+label);return s.replace(a,()=>b);}
const assets=meta.files.webview.files.assets.files,initial=Object.keys(assets).find(n=>n.startsWith('app-initial-')&&n.endsWith('.js')),primary=Object.keys(assets).find(n=>n.startsWith('app-primary-')&&n.endsWith('.js'));
if(!initial||!primary)throw Error('Codex webview bundles missing');
patch('webview/assets/'+initial,s=>{
 if(s.includes('/* damndots-orbit-capability-v1 */'))return s;
 const start=s.indexOf('Db=U(Q,({get:e})=>{let t=e(S_);'),end=start<0?-1:s.indexOf('}),pAt=U(Q',start);
 if(start<0||end<0)throw Error('Unsupported orbit capability boundary');
 return s.slice(0,start)+'Db=U(Q,()=>({isLoading:!1,isError:!1,isCapable:!0}))/* damndots-orbit-capability-v1 */'+s.slice(end+2);
});
patch('webview/assets/'+primary,s=>{
 if(s.includes('/* damndots-orbit-rail-v3 */'))return s;
 if(!s.includes("'builtin:orbit':!0"))s=once(s,"nvn=z(Z,({get:e})=>({[Yh.sites]:!0,","nvn=z(Z,({get:e})=>({'builtin:orbit':!0,[Yh.sites]:!0,",'orbit destination visibility');
 // The 3384 sidebar keeps "Your dot" behind the sidebar_monothread statsig layer. Pin the local Dot as a
 // standalone primary destination instead of enabling that whole sidebar experiment for the account.
 if(s.includes("||r&&e.id===$O.orbit.destinationId||"))s=once(s,"||r&&e.id===$O.orbit.destinationId||","||e.id===$O.orbit.destinationId||",'orbit standalone destination');
 // "/dots/home" redirects to "/" when the workspace access is not "continue", so the rail Dot looked dead.
 // Open the primary dot's Thread route directly; the route resolves the dot and opens its conversation.
 s=once(s,"}),e.get(SC).navigate(t)}function Thn(){}","});let r=null;try{let a=e.query.getData([`primary-aeon`,e.get(S_),e.get($)]);r=a?.selection?.thread_id??null}catch{}e.get(SC).navigate(r?`/dots/thread/`+encodeURIComponent(r):t)}function Thn(){}",'orbit primary thread navigation');
 return s+'/* damndots-orbit-rail-v3 */';
});
const json=Buffer.from(JSON.stringify(meta)),payload=(4+json.length+3)&~3,pickle=Buffer.alloc(4+payload),head=Buffer.alloc(8);pickle.writeUInt32LE(payload);pickle.writeUInt32LE(json.length,4);json.copy(pickle,8);head.writeUInt32LE(4);head.writeUInt32LE(pickle.length,4);
const result=Buffer.concat([head,pickle,body,...changed.map(x=>x.bytes)]),exe=fs.readFileSync(path.join(root,'ChatGPT.exe')),needle=Buffer.from(hash(oldHeader)),at=exe.indexOf(needle);if(at<0||exe.indexOf(needle,at+1)>=0)throw Error('EXE integrity anchor changed');Buffer.from(hash(json)).copy(exe,at);
fs.writeFileSync(file,result);fs.writeFileSync(path.join(root,'ChatGPT.exe'),exe);
const rec=JSON.parse(fs.readFileSync(path.join(root,'renewal.json'),'utf8'));Object.assign(rec,{headerHash:hash(json),exeHash:hash(exe),archiveHash:hash(result),orbitNavigationPatch:1});fs.writeFileSync(path.join(root,'renewal.json'),JSON.stringify(rec,null,2));fs.writeFileSync(path.join(root,'orbit-navigation-patch.json'),JSON.stringify({version:1}));console.log('Orbit navigation enabled; local Dot stays reachable and visible; archive and executable integrity updated.');
