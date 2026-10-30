'use strict';
// Codex 26.1027 Orbit messaging keeps showing "Reconnecting…" while it falls back to HTTP refresh,
// even though messages load and send through the Dots gateway. Keep the real refresh-failure state,
// but do not present the permanent reconnecting banner for a channel Dots does not emulate.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=fs.realpathSync(process.argv[2]||''),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(root.toLowerCase().includes('windowsapps'))throw Error('Only patch a private staged copy');
const file=path.join(root,'resources/app.asar'),archive=fs.readFileSync(file),oldHeader=archive.subarray(16,16+archive.readUInt32LE(12)),meta=JSON.parse(oldHeader),base=8+archive.readUInt32LE(4),body=archive.subarray(base),changed=[];
function patch(entryPath,fn){let entry=meta;for(const part of entryPath.split('/'))entry=entry.files[part];const source=body.subarray(+entry.offset,+entry.offset+entry.size).toString();const result=fn(source);cp.execFileSync(process.execPath,['--input-type=module','--check'],{input:result});const bytes=Buffer.from(result);entry.offset=String(body.length+changed.reduce((n,x)=>n+x.bytes.length,0));entry.size=bytes.length;entry.integrity.hash=hash(bytes);entry.integrity.blocks=[];for(let i=0;i<bytes.length;i+=entry.integrity.blockSize)entry.integrity.blocks.push(hash(bytes.subarray(i,i+entry.integrity.blockSize)));changed.push({entryPath,bytes});}
function once(s,a,b,label){if(s.split(a).length!==2)throw Error('Unsupported Codex '+label);return s.replace(a,()=>b);}
const assets=meta.files.webview.files.assets.files,name=Object.keys(assets).find(n=>n.startsWith('composer-controls-89d0509c296f')&&n.endsWith('.js'));
if(!name)throw Error('Codex messaging composer bundle missing');
patch('webview/assets/'+name,s=>{
 if(s.includes('/* damndots-messaging-status-v1 */'))return s;
 s=once(s,'!tt&&(F||nt)&&','!tt&&nt&&','messaging reconnect banner');
 s=once(s,'children:F||X.loading||!nt?','children:!nt?','messaging failure banner');
 return s+'/* damndots-messaging-status-v1 */';
});
const json=Buffer.from(JSON.stringify(meta)),payload=(4+json.length+3)&~3,pickle=Buffer.alloc(4+payload),head=Buffer.alloc(8);pickle.writeUInt32LE(payload);pickle.writeUInt32LE(json.length,4);json.copy(pickle,8);head.writeUInt32LE(4);head.writeUInt32LE(pickle.length,4);
const result=Buffer.concat([head,pickle,body,...changed.map(x=>x.bytes)]),exe=fs.readFileSync(path.join(root,'ChatGPT.exe')),needle=Buffer.from(hash(oldHeader)),at=exe.indexOf(needle);if(at<0||exe.indexOf(needle,at+1)>=0)throw Error('EXE integrity anchor changed');Buffer.from(hash(json)).copy(exe,at);
fs.writeFileSync(file,result);fs.writeFileSync(path.join(root,'ChatGPT.exe'),exe);
const rec=JSON.parse(fs.readFileSync(path.join(root,'renewal.json'),'utf8'));Object.assign(rec,{headerHash:hash(json),exeHash:hash(exe),archiveHash:hash(result),messagingStatusPatch:1});fs.writeFileSync(path.join(root,'renewal.json'),JSON.stringify(rec,null,2));fs.writeFileSync(path.join(root,'messaging-status-patch.json'),JSON.stringify({version:1}));console.log('Messaging reconnect banner suppressed; refresh failures still report; archive and executable integrity updated.');
