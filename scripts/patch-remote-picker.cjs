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
const list=/children:\[([\w$]+),([\w$]+),([\w$]+),([\w$]+),([\w$]+),([\w$]+),null,([\w$]+)\]\}\)/;
const cloud=/\(0,([\w$]+)\.jsx\)\(([\w$]+)\.ms\.Item,\{LeftIcon:([\w$]+)\.LL7,leftIconClassName:[\w$]+\?"self-start":void 0,RightIcon:"cloud"===/;
const close=/closeDropdown:([\w$]+),openHandoffDialog:/;
const css='[class*="scrollSection-"]>*{flex-shrink:0}';
const assets=meta.files.webview.files.assets.files.async.files;
const hits=Object.keys(assets).filter(n=>/\.js$/.test(n)&&assets[n].size<2.5e7).filter(n=>{const s=body.subarray(+assets[n].offset,+assets[n].offset+assets[n].size).toString();return s.includes('composer.mode.startTask.header')&&cloud.test(s)&&list.test(s)&&close.test(s);});
if(hits.length!==1)throw Error('Unsupported Codex work location menu ('+hits.length+')');
patch('webview/assets/async/'+hits[0],s=>{
 if(s.includes('/* damndots-remote-picker-v3 */'))return s;
 const c=s.match(cloud),cl=s.match(close),l=s.match(list);
 const label='(/^tr/i.test(navigator.language)?"Uzak makine":"Remote machine")';
 const item='(0,'+c[1]+'.jsx)('+c[2]+'.ms.Item,{LeftIcon:'+c[3]+'.LL7,onClick:()=>{'+cl[1]+'();setTimeout(()=>{const b=document.querySelector(\'[data-composer-navigation-target="workspace-project"]\');b&&b.click()},80)},children:'+label+'},"damndots-remote-machine")';
 s=s.replace(list,()=>'children:['+l.slice(1,7).join(',')+','+item+','+l[7]+']})');
 return s+'\ntry{if(typeof document!=="undefined"&&!document.getElementById("damndots-picker-rows")){const st=document.createElement("style");st.id="damndots-picker-rows";st.textContent='+JSON.stringify(css)+';document.head.appendChild(st)}}catch(e){}\n/* damndots-remote-picker-v3 */';
});
const json=Buffer.from(JSON.stringify(meta)),payload=(4+json.length+3)&~3,pickle=Buffer.alloc(4+payload),head=Buffer.alloc(8);pickle.writeUInt32LE(payload);pickle.writeUInt32LE(json.length,4);json.copy(pickle,8);head.writeUInt32LE(4);head.writeUInt32LE(pickle.length,4);
const result=Buffer.concat([head,pickle,body,...changed.map(x=>x.bytes)]),exe=fs.readFileSync(path.join(root,'ChatGPT.exe')),needle=Buffer.from(hash(oldHeader)),at=exe.indexOf(needle);if(at<0||exe.indexOf(needle,at+1)>=0)throw Error('EXE integrity anchor changed');Buffer.from(hash(json)).copy(exe,at);
fs.writeFileSync(file,result);fs.writeFileSync(path.join(root,'ChatGPT.exe'),exe);
const rec=JSON.parse(fs.readFileSync(path.join(root,'renewal.json'),'utf8'));Object.assign(rec,{headerHash:hash(json),exeHash:hash(exe),archiveHash:hash(result),remotePickerPatch:1});fs.writeFileSync(path.join(root,'renewal.json'),JSON.stringify(rec,null,2));fs.writeFileSync(path.join(root,'remote-picker-patch.json'),JSON.stringify({version:1}));console.log('Remote machine entry added and project picker rows fixed; archive and executable integrity updated.');
