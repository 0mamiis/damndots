'use strict';
// Codex 26.1027 sends the dot computer's WebRTC offer to OpenAI's cloud CUA endpoint. Dots serves the
// same SDP exchange from its own worker at /backend-api/tbo/{dot}/computer/sessions. Point the viewer at
// the local gateway so the dot's live computer panel works with the Dots backend.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const port=Number(process.env.DOTS_NATIVE_PORT||8000);
const BT=String.fromCharCode(96);
const root=fs.realpathSync(process.argv[2]||''),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(root.toLowerCase().includes('windowsapps'))throw Error('Only patch a private staged copy');
const file=path.join(root,'resources/app.asar'),archive=fs.readFileSync(file),oldHeader=archive.subarray(16,16+archive.readUInt32LE(12)),meta=JSON.parse(oldHeader),base=8+archive.readUInt32LE(4),body=archive.subarray(base),changed=[];
function patch(entryPath,fn){let entry=meta;for(const part of entryPath.split('/'))entry=entry.files[part];const source=body.subarray(+entry.offset,+entry.offset+entry.size).toString();const result=fn(source);cp.execFileSync(process.execPath,['--input-type=module','--check'],{input:result});const bytes=Buffer.from(result);entry.offset=String(body.length+changed.reduce((n,x)=>n+x.bytes.length,0));entry.size=bytes.length;entry.integrity.hash=hash(bytes);entry.integrity.blocks=[];for(let i=0;i<bytes.length;i+=entry.integrity.blockSize)entry.integrity.blocks.push(hash(bytes.subarray(i,i+entry.integrity.blockSize)));changed.push({entryPath,bytes});}
function once(s,a,b,label){if(s.split(a).length!==2)throw Error('Unsupported Codex '+label);return s.replace(a,()=>b);}
const assets=meta.files.webview.files.assets.files;
const assetText=n=>body.subarray(+assets[n].offset,+assets[n].offset+assets[n].size).toString();
const pick=needle=>{const hits=Object.keys(assets).filter(n=>/.js$/.test(n)&&assetText(n).includes(needle));if(hits.length!==1)throw Error("Codex computer viewer bundle not unique: "+hits.length);return hits[0];};
let view=null,panel=null,unified=null;
try{view=pick("function g(e="+BT+"https://chatgpt.com/backend-api"+BT+"){");panel=pick("function K({apiBaseUrl:e="+BT+"https://chatgpt.com/backend-api"+BT);}
catch(error){unified=require('./asar-locate.cjs').locate(meta,body,{needles:['Unsupported computer backend','useChatGptRouting'],label:'computer viewer'});}
if(!unified&&(!view||!panel))throw Error('Codex computer viewer bundles missing');
if(unified)patch('webview/assets/'+unified,s=>{
 if(s.includes('/* damndots-cua-computer-v2 */'))return s;
 // Codex 26.1029 inlines the endpoint builder and the host allow-list in one connect function.
 const re=/let ([\w$]+)=new URL\(([\w$]+)\);if\([^;]*?Unsupported computer backend"\);let ([\w$]+)=new URL\(\(0,[\w$]+\.[\w$]+\)\(\2,[\w$]+\)\);/;
 const m=s.match(re);if(!m)throw Error('Unsupported computer endpoint builder');
 return s.replace(re,()=>'let '+m[3]+'=new URL("https://localhost:'+port+'/backend-api/tbo/computer/sessions");/* damndots-cua-computer-v2 */');
});
else{
patch('webview/assets/'+view,s=>{
 if(s.includes('/* damndots-cua-computer-v1 */'))return s;
 const start=s.indexOf('function g(e=`https://chatgpt.com/backend-api`){'),end=start<0?-1:s.indexOf('var _;function v()',start);
 if(start<0||end<0)throw Error('Unsupported computer endpoint builder');
 return s.slice(0,start)+'function g(){return `https://localhost:'+port+'/backend-api/tbo/computer/sessions`}/* damndots-cua-computer-v1 */'+s.slice(end);
});
patch('webview/assets/'+panel,s=>{
 if(s.includes('/* damndots-local-cua-v1 */'))return s;
 const start=s.indexOf('function K({apiBaseUrl:e=`https://chatgpt.com/backend-api`'),bad=start<0?-1:s.indexOf('throw Error(`Unsupported computer backend`);',start);
 if(start<0||bad<0)throw Error('Unsupported computer backend check');
 return s.slice(0,bad)+'/* damndots-local-cua-v1 */'+s.slice(bad);
});
}
const json=Buffer.from(JSON.stringify(meta)),payload=(4+json.length+3)&~3,pickle=Buffer.alloc(4+payload),head=Buffer.alloc(8);pickle.writeUInt32LE(payload);pickle.writeUInt32LE(json.length,4);json.copy(pickle,8);head.writeUInt32LE(4);head.writeUInt32LE(pickle.length,4);
const result=Buffer.concat([head,pickle,body,...changed.map(x=>x.bytes)]),exe=fs.readFileSync(path.join(root,'ChatGPT.exe')),needle=Buffer.from(hash(oldHeader)),at=exe.indexOf(needle);if(at<0||exe.indexOf(needle,at+1)>=0)throw Error('EXE integrity anchor changed');Buffer.from(hash(json)).copy(exe,at);
fs.writeFileSync(file,result);fs.writeFileSync(path.join(root,'ChatGPT.exe'),exe);
const rec=JSON.parse(fs.readFileSync(path.join(root,'renewal.json'),'utf8'));Object.assign(rec,{headerHash:hash(json),exeHash:hash(exe),archiveHash:hash(result),computerViewerPatch:1});fs.writeFileSync(path.join(root,'renewal.json'),JSON.stringify(rec,null,2));fs.writeFileSync(path.join(root,'computer-viewer-patch.json'),JSON.stringify({version:1}));console.log('Dot computer viewer routed to the local gateway; archive and executable integrity updated.');
