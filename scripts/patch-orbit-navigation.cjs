'use strict';
// Codex 26.1027 reads the account list through the desktop main process, which talks to
// chatgpt.com directly and therefore never sees the Dots gateway's tbo_available flag.
// The renderer would hide "Your dot" and the whole Orbit surface even though the local
// Dots backend serves the dot. Keep the local Dot reachable: the capability answer comes
// from the local stack, and the destination stays visible in the narrow rail.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=fs.realpathSync(process.argv[2]||''),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const BT=String.fromCharCode(96);
const {locate}=require('./asar-locate.cjs');
if(root.toLowerCase().includes('windowsapps'))throw Error('Only patch a private staged copy');
const file=path.join(root,'resources/app.asar'),archive=fs.readFileSync(file),oldHeader=archive.subarray(16,16+archive.readUInt32LE(12)),meta=JSON.parse(oldHeader),base=8+archive.readUInt32LE(4),body=archive.subarray(base),changed=[];
function patch(entryPath,fn){let entry=meta;for(const part of entryPath.split('/'))entry=entry.files[part];const source=body.subarray(+entry.offset,+entry.offset+entry.size).toString();const result=fn(source);cp.execFileSync(process.execPath,['--input-type=module','--check'],{input:result});const bytes=Buffer.from(result);entry.offset=String(body.length+changed.reduce((n,x)=>n+x.bytes.length,0));entry.size=bytes.length;entry.integrity.hash=hash(bytes);entry.integrity.blocks=[];for(let i=0;i<bytes.length;i+=entry.integrity.blockSize)entry.integrity.blocks.push(hash(bytes.subarray(i,i+entry.integrity.blockSize)));changed.push({entryPath,bytes});}
function once(s,a,b,label){if(s.split(a).length!==2)throw Error('Unsupported Codex '+label);return s.replace(a,()=>b);}
const initial=locate(meta,body,{prefix:'app-initial-',needles:['tbo_available','orbit-navigation'],label:'orbit renderer'}),primary=locate(meta,body,{prefix:'app-primary-',needles:['.cme?e.visibleByDefault:'],label:'orbit rail'});
const rspack=src=>src.includes('export const __webpack_modules__');
patch('webview/assets/'+initial,s=>{
 if(rspack(s)){
  // Codex 26.1029 (Rspack bundles): same capability chain, different expression layout.
  if(!s.includes('/* damndots-orbit-profile-v6 */')){
   const cap=/isCapable:"success"===[\w$]+&&[\w$]+\?\.accounts\[[\w$]+\]\?\.account\.tbo_config\?\.tbo_available===!0/g;
   if([...s.matchAll(cap)].length!==1)throw Error('Unsupported Orbit profile capability');
   s=s.replace(cap,()=>'isCapable:!0/* damndots-orbit-profile-v6 */');
  }
  if(!s.includes('/* damndots-orbit-navigation-v4 */')){
   const pol=/"error"===[\w$]+&&[\w$]+\?\.accounts\[[\w$]+\]\?\.account\.tbo_config\?\.tbo_available===!0&&\(0,[\w$]+\.[\w$]+\)\([\w$]+\)\?\{isLoading:!1,isError:!1,isCapable:!0\}:/g;
   if([...s.matchAll(pol)].length===1)s=s.replace(pol,()=>'!0?{isLoading:!1,isError:!1,isCapable:!0}/* damndots-orbit-navigation-v4 */:');
  }
  if(!s.includes('/* damndots-orbit-eligibility-v7 */')){
   const el='"builtin:orbit"!==e.id&&"builtin:automations"!==e.id';
   if(s.split(el).length!==2)throw Error('Unsupported orbit destination eligibility');
   s=s.replace(el,()=>'/* damndots-orbit-eligibility-v7 */"builtin:automations"!==e.id');
  }
  return s;
 }
 const BT=String.fromCharCode(96);
 if(!s.includes('/* damndots-orbit-capability-v1 */')){
  // Codex 26.1027.6604 gates Orbit through a statsig-backed capability selector; the local Dot is served by the Dots gateway.
  const gate='dO=U(Q,({get:e})=>{if(!e(_g,'+BT+'3085093835'+BT+'))return!1;let t=e(mv);return t.status!=='+BT+'denied'+BT+'||t.reason!=='+BT+'unsupported-auth'+BT+'})';
  if(s.split(gate).length!==2)throw Error('Unsupported orbit capability boundary');
  s=s.replace(gate,()=>'dO=U(Q,()=>!0)/* damndots-orbit-capability-v1 */');
 }
 if(!s.includes('/* damndots-orbit-navigation-v4 */')){
  const policy='DAt=U(Q,({get:e})=>{let t=e(pb),n=e(p_);if(!t.isError||n==null||e(Ndt))return t;let{data:r,error:i,status:a}=e(ev,n);return a==='+BT+'error'+BT+'&&r?.accounts[n]?.account.tbo_config?.tbo_available===!0&&xAt(i)?{isLoading:!1,isError:!1,isCapable:!0}:t})';
  if(s.split(policy).length===2)s=s.replace(policy,()=>'DAt=U(Q,()=>({isLoading:!1,isError:!1,isCapable:!0}))/* damndots-orbit-navigation-v4 */');
  else if(s.includes('"orbit-navigation":DAt'))throw Error('Unsupported orbit navigation policy');
 }
 if(!s.includes('/* damndots-orbit-profile-v6 */')){
  const start=s.indexOf('pb=U(Q,({get:e})=>{let t=e(p_);if(t!=null&&e(Ndt))');
  const end=s.indexOf('}}),DAt=',start);
  if(start<0||end<0)throw Error('Unsupported Orbit profile capability');
  s=s.slice(0,start)+'pb=U(Q,()=>({isLoading:!1,isError:!1,isCapable:!0}))/* damndots-orbit-profile-v6 */'+s.slice(end+3);
 }
 if(!s.includes('/* damndots-orbit-eligibility-v7 */')){
  const eligibility=new RegExp('function ([\\w$]+)\\(e\\)\\{return e\\.id!=='+BT+'builtin:orbit'+BT+'&&e\\.id!=='+BT+'builtin:automations'+BT);
  if(!eligibility.test(s))throw Error('Unsupported orbit destination eligibility');
  s=s.replace(eligibility,(m,name)=>'function '+name+'(e){return /* damndots-orbit-eligibility-v7 */ e.id!=='+BT+'builtin:automations'+BT);
 }
 return s;
});

patch('webview/assets/'+primary,s=>{
 if(s.includes('/* damndots-orbit-rail-v4 */'))return s;
 // The navigation rail only lists destinations that are pinned in the sidebar customization or marked
 // visible by default, and the Dot is neither. Mark the Dot visible by default so it is always offered.
 const re=/t=e\.id===([\w$]+(?:\.[\w$]+)*\.cme)\?e\.visibleByDefault:/g;
 if([...s.matchAll(re)].length!==1)throw Error('Unsupported orbit destination visibility');
 s=s.replace(re,(m,cme)=>'t=e.id==='+String.fromCharCode(34)+'builtin:orbit'+String.fromCharCode(34)+'?!0:e.id==='+cme+'?e.visibleByDefault:');
 return s+'\n/* damndots-orbit-rail-v4 */';
});

const json=Buffer.from(JSON.stringify(meta)),payload=(4+json.length+3)&~3,pickle=Buffer.alloc(4+payload),head=Buffer.alloc(8);pickle.writeUInt32LE(payload);pickle.writeUInt32LE(json.length,4);json.copy(pickle,8);head.writeUInt32LE(4);head.writeUInt32LE(pickle.length,4);
const result=Buffer.concat([head,pickle,body,...changed.map(x=>x.bytes)]),exe=fs.readFileSync(path.join(root,'ChatGPT.exe')),needle=Buffer.from(hash(oldHeader)),at=exe.indexOf(needle);if(at<0||exe.indexOf(needle,at+1)>=0)throw Error('EXE integrity anchor changed');Buffer.from(hash(json)).copy(exe,at);
fs.writeFileSync(file,result);fs.writeFileSync(path.join(root,'ChatGPT.exe'),exe);
const rec=JSON.parse(fs.readFileSync(path.join(root,'renewal.json'),'utf8'));Object.assign(rec,{headerHash:hash(json),exeHash:hash(exe),archiveHash:hash(result),orbitNavigationPatch:1});fs.writeFileSync(path.join(root,'renewal.json'),JSON.stringify(rec,null,2));fs.writeFileSync(path.join(root,'orbit-navigation-patch.json'),JSON.stringify({version:1}));console.log('Orbit navigation enabled; local Dot stays reachable and visible; archive and executable integrity updated.');
