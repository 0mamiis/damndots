'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {resolveComposerBindings,bindComposerHelper}=require('./desktop-renderer-bindings.cjs');
const source=fs.realpathSync(process.argv[2]),out=path.resolve(process.argv[3]),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(source.toLowerCase().includes('windowsapps')||out.toLowerCase().includes('windowsapps')||source===out)throw Error('Repair requires a separate private stage');
const a=fs.readFileSync(path.join(source,'resources/app.asar')),old=a.subarray(16,16+a.readUInt32LE(12)),meta=JSON.parse(old),base=8+a.readUInt32LE(4),body=a.subarray(base);
const assets=meta.files.webview.files.assets.files,names=Object.keys(assets).filter(n=>/^app-initial-.*\.js$/.test(n));if(names.length!==1)throw Error('Ambiguous renderer');
const entry=assets[names[0]],text=body.subarray(+entry.offset,+entry.offset+entry.size).toString();
let updated=bindComposerHelper(text,resolveComposerBindings(text));
const helper=fs.readFileSync(path.join(__dirname,'desktop-features/orchestrator-ui.js'),'utf8');
for(const name of ['codexTpsOnTurnStarted','codexTpsOnTurnCompleted']){
 const re=new RegExp('function '+name+'\\([^]*?(?=\\nfunction )');const matches=[...updated.matchAll(new RegExp(re.source,'g'))],replacement=helper.match(re);
 if(matches.length!==1||!replacement)throw Error('TPS function boundary changed: '+name);updated=updated.replace(re,()=>replacement[0]);
}
cp.execFileSync(process.execPath,['--input-type=module','--check'],{input:updated,windowsHide:true});
const bytes=Buffer.from(updated);entry.offset=String(body.length);entry.size=bytes.length;entry.integrity.hash=sha(bytes);entry.integrity.blocks=[];
for(let i=0;i<bytes.length;i+=entry.integrity.blockSize)entry.integrity.blocks.push(sha(bytes.subarray(i,i+entry.integrity.blockSize)));
const json=Buffer.from(JSON.stringify(meta)),size=(4+json.length+3)&~3,pickle=Buffer.alloc(4+size),head=Buffer.alloc(8);pickle.writeUInt32LE(size);pickle.writeUInt32LE(json.length,4);json.copy(pickle,8);head.writeUInt32LE(4);head.writeUInt32LE(pickle.length,4);
const result=Buffer.concat([head,pickle,body,bytes]),exe=fs.readFileSync(path.join(source,'ChatGPT.exe')),needle=Buffer.from(sha(old)),at=exe.indexOf(needle);
if(at<0||exe.indexOf(needle,at+1)>=0)throw Error('EXE integrity boundary changed');Buffer.from(sha(json)).copy(exe,at);
fs.mkdirSync(path.join(out,'resources'),{recursive:true});fs.writeFileSync(path.join(out,'resources/app.asar'),result);fs.writeFileSync(path.join(out,'ChatGPT.exe'),exe);
const rec=JSON.parse(fs.readFileSync(path.join(source,'renewal.json'),'utf8'));Object.assign(rec,{headerHash:sha(json),archiveHash:sha(result),exeHash:sha(exe)});fs.writeFileSync(path.join(out,'renewal.json'),JSON.stringify(rec,null,2));
console.log('TPS composer scope repaired; native timestamp units corrected; complete renderer parsed as ESM.');
