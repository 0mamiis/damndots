'use strict';
// Codex 26.1029 (Rspack): the "Work in" menu of a new chat has no way to pick a remote machine, and the project
// picker's list rows have no minimum height here, so a long list collapses into overlapping rows.
//  1. Add a "Remote machine" entry to the menu. Remote machines are the remote projects, so it opens the project picker.
//  2. Keep list rows at their natural height.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=fs.realpathSync(process.argv[2]||''),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(root.toLowerCase().includes('windowsapps'))throw Error('Only patch a private staged copy');
const file=path.join(root,'resources/app.asar'),archive=fs.readFileSync(file),oldHeader=archive.subarray(16,16+archive.readUInt32LE(12)),meta=JSON.parse(oldHeader),base=8+archive.readUInt32LE(4),body=archive.subarray(base),changed=[];
function patch(entryPath,fn){let entry=meta;for(const part of entryPath.split('/'))entry=entry.files[part];const source=body.subarray(+entry.offset,+entry.offset+entry.size).toString();const result=fn(source);cp.execFileSync(process.execPath,['--input-type=module','--check'],{input:result});const bytes=Buffer.from(result);entry.offset=String(body.length+changed.reduce((n,x)=>n+x.bytes.length,0));entry.size=bytes.length;entry.integrity.hash=hash(bytes);entry.integrity.blocks=[];for(let i=0;i<bytes.length;i+=entry.integrity.blockSize)entry.integrity.blocks.push(hash(bytes.subarray(i,i+entry.integrity.blockSize)));changed.push({entryPath,bytes});}
const listOld=/children:\[([\w$]+),([\w$]+),([\w$]+),([\w$]+),([\w$]+),([\w$]+),null,([\w$]+)\]\}\)/,listNew=/(className:"flex max-w-78 min-w-\[175px\] flex-col",children:\[)([\w$]+,[\w$]+,[\w$]+,[\w$]+,[\w$]+),null,([\w$]+)\]\}\)/;
const list={test:s=>listOld.test(s)||listNew.test(s)};
const cloud=/\(0,([\w$]+)\.jsx\)\(([\w$]+)\.ms\.Item,\{LeftIcon:([\w$]+)\.LL7[,}]/;
const close=/closeDropdown:([\w$]+),openHandoffDialog:/;
const css='[class*="scrollSection-"]>*{flex-shrink:0}';
const assets=meta.files.webview.files.assets.files.async.files;
// Codex 26.1103: the unified project/remote-host picker sits behind rollout gate 1678134557, which is off for this account.
const gateRe=/\(0,[\w$]+\._U\)\([\w$]+\.JW,"(?:1678134557|4114442250)"\)|(?<![\w$.])e\([\w$]+\.JW,"(?:1678134557|4114442250)"\)/g;
const gateHits=Object.keys(assets).filter(n=>/\.js$/.test(n)&&assets[n].size<2.5e7&&body.subarray(+assets[n].offset,+assets[n].offset+assets[n].size).toString().includes('"1678134557"')||body.subarray(+assets[n].offset,+assets[n].offset+assets[n].size).toString().includes('"4114442250"'));

const hits=Object.keys(assets).filter(n=>/\.js$/.test(n)&&assets[n].size<2.5e7).filter(n=>{const s=body.subarray(+assets[n].offset,+assets[n].offset+assets[n].size).toString();return s.includes('composer.mode.startTask.header')&&cloud.test(s)&&list.test(s)&&close.test(s);});
if(hits.length!==1)throw Error('Unsupported Codex work location menu ('+hits.length+')');
patch('webview/assets/async/'+hits[0],s=>{
 if(s.includes('/* damndots-remote-picker-v3 */'))return s;
 s=s.replace(gateRe,'!0');
 const c=s.match(cloud),cl=s.match(close);
 const label='(/^tr/i.test(navigator.language)?"Uzak makine":"Remote machine")';
 const item='(0,'+c[1]+'.jsx)('+c[2]+'.ms.Item,{LeftIcon:'+c[3]+'.LL7,onClick:()=>{'+cl[1]+'();setTimeout(()=>{const b=document.querySelector(\'[data-composer-navigation-target="workspace-project"]\');b&&b.click()},80)},children:'+label+'},"damndots-remote-machine")';
 if(listOld.test(s)){const l=s.match(listOld);s=s.replace(listOld,()=>'children:['+l.slice(1,7).join(',')+','+item+','+l[7]+']})');}
 // 26.1103 has the unified location picker (opened by the gates above) instead of this menu; leave this menu unchanged there.
 return s+'\ntry{if(typeof document!=="undefined"&&!document.getElementById("damndots-picker-rows")){const st=document.createElement("style");st.id="damndots-picker-rows";st.textContent='+JSON.stringify(css)+';document.head.appendChild(st)}}catch(e){}\n/* damndots-remote-picker-v3 */';
});
// Codex 26.1103: the "Work in" location menu lists only This computer and Cloud; add "Remote machine" that opens the project picker.
const menuHits=Object.keys(assets).filter(n=>/\.js$/.test(n)&&assets[n].size<2.5e7&&n!==hits[0]).filter(n=>{const s=body.subarray(+assets[n].offset,+assets[n].offset+assets[n].size).toString();return s.includes('composer.newTask.searchCloudPlaceholder')&&s.includes(',!eU&&et?.onDefaultSelected!=null&&!eR&&');});
if(menuHits.length>1)throw Error('Ambiguous Work in location menu');
for(const n of menuHits)patch('webview/assets/async/'+n,s=>{
 if(s.includes('/* damndots-remote-menu */'))return s;
 const anchor=',!eU&&et?.onDefaultSelected!=null&&!eR&&';
 const j=s.match(/\(0,([\w$]+)\.jsx\)\(([\w$]+)\.ms\.Item,\{leftIconAsset:[\w$]+\.g,RightIcon:"local"/),r=s.match(/remote:([\w$]+)\.t,computer:/);
 if(!j||!r||s.split(anchor).length!==2)throw Error('Work in location menu changed');
 const label='(/^tr/i.test(navigator.language)?"Uzak makine":"Remote machine")';
 const item=',(0,'+j[1]+'.jsx)('+j[2]+'.ms.Item,{leftIconAsset:'+r[1]+'.t,onSelect:()=>{const q=()=>document.querySelector(\'[data-composer-navigation-target="workspace-project"]\'),go=()=>{const b=q();b&&b.getAttribute(\'aria-expanded\')!==\'true\'&&b.click()};setTimeout(go,250);setTimeout(go,700)},children:'+label+'},"damndots-remote-machine")';
 return s.replace(gateRe,'!0').replace(anchor,item+anchor)+'\n/* damndots-remote-menu */';
});
for(const n of gateHits)if(n!==hits[0]&&!menuHits.includes(n))patch('webview/assets/async/'+n,s=>s.includes('/* damndots-remote-gate */')?s:s.replace(gateRe,'!0')+'\n/* damndots-remote-gate */');
const json=Buffer.from(JSON.stringify(meta)),payload=(4+json.length+3)&~3,pickle=Buffer.alloc(4+payload),head=Buffer.alloc(8);pickle.writeUInt32LE(payload);pickle.writeUInt32LE(json.length,4);json.copy(pickle,8);head.writeUInt32LE(4);head.writeUInt32LE(pickle.length,4);
const result=Buffer.concat([head,pickle,body,...changed.map(x=>x.bytes)]),exe=fs.readFileSync(path.join(root,'ChatGPT.exe')),needle=Buffer.from(hash(oldHeader)),at=exe.indexOf(needle);if(at<0||exe.indexOf(needle,at+1)>=0)throw Error('EXE integrity anchor changed');Buffer.from(hash(json)).copy(exe,at);
fs.writeFileSync(file,result);fs.writeFileSync(path.join(root,'ChatGPT.exe'),exe);
const rec=JSON.parse(fs.readFileSync(path.join(root,'renewal.json'),'utf8'));Object.assign(rec,{headerHash:hash(json),exeHash:hash(exe),archiveHash:hash(result),remotePickerPatch:1});fs.writeFileSync(path.join(root,'renewal.json'),JSON.stringify(rec,null,2));fs.writeFileSync(path.join(root,'remote-picker-patch.json'),JSON.stringify({version:1}));console.log('Remote machine entry added and project picker rows fixed; archive and executable integrity updated.');
