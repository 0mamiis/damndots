import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const patcher=fileURLToPath(new URL('../patch-composer-predictions.cjs',import.meta.url));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const source=`
class Controller{constructor(n){this.unsubscribeSettings=n.onDidChange(oA.key,()=>this.clear())}dispose(){this.unsubscribeSettings(),this.unsubscribeConnectionChanges();}}
async function FRe({configuredReasoningEffort:c,unsupportedModels:l,useThreadSample:u=!1}){
 let y;v.collaborationMode?.mode===\`plan\`?y=\`plan_mode\`:v.modelProvider===\`openai\`?l?.includes(v.model)&&(y=\`unsupported_model\`):y=\`unsupported_provider\`;
 if(u&&i.bi(e.appServerVersion,\`threadSample\`)){};
 return s.mt({experimentalPredictionMode:!0,experimentalDisablePredictionMcp:i.bi(e.appServerVersion,\`predictionDisableMcp\`)?d:void 0,responseSchema:i.Cs,schema:null,model:null,effort:c});
}
function call(c){return {configuredReasoningEffort:c.prediction_reasoning_effort,unsupportedModels:c.unsupported_models}}
`;
function fixture(dir,text){
 const bytes=Buffer.from(text),entry={offset:'0',size:bytes.length,integrity:{algorithm:'SHA256',hash:hash(bytes),blockSize:32,blocks:[]}};
 for(let n=0;n<bytes.length;n+=32)entry.integrity.blocks.push(hash(bytes.subarray(n,n+32)));
 const json=Buffer.from(JSON.stringify({files:{'.vite':{files:{build:{files:{'main-test.js':entry}}}}}}));
 const size=(4+json.length+3)&~3,pickle=Buffer.alloc(4+size),head=Buffer.alloc(8);pickle.writeUInt32LE(size);pickle.writeUInt32LE(json.length,4);json.copy(pickle,8);head.writeUInt32LE(4);head.writeUInt32LE(pickle.length,4);
 fs.mkdirSync(path.join(dir,'resources'));fs.writeFileSync(path.join(dir,'resources','app.asar'),Buffer.concat([head,pickle,bytes]));fs.writeFileSync(path.join(dir,'ChatGPT.exe'),'binary-prefix-'+hash(json)+'-binary-suffix');
}
function readArchive(dir){const bytes=fs.readFileSync(path.join(dir,'resources','app.asar')),json=bytes.subarray(16,16+bytes.readUInt32LE(12)),header=JSON.parse(json),entry=header.files['.vite'].files.build.files['main-test.js'],start=8+bytes.readUInt32LE(4)+Number(entry.offset);return {bytes,json,entry,body:bytes.subarray(start,start+entry.size)};}
test('private app patch preserves archive and executable integrity and rejects incompatible versions before writing',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dots-composer-patch-'));
 try{
  const good=path.join(dir,'good'),bad=path.join(dir,'bad');fs.mkdirSync(good);fs.mkdirSync(bad);fixture(good,source);fixture(bad,source.replace('model:null,effort:c','model:other,effort:c'));
  const badBefore=hash(fs.readFileSync(path.join(bad,'resources','app.asar'))),badExe=hash(fs.readFileSync(path.join(bad,'ChatGPT.exe')));
  assert.notEqual(spawnSync(process.execPath,[patcher,bad]).status,0);assert.equal(hash(fs.readFileSync(path.join(bad,'resources','app.asar'))),badBefore);assert.equal(hash(fs.readFileSync(path.join(bad,'ChatGPT.exe'))),badExe);
  const run=spawnSync(process.execPath,[patcher,good],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  const archive=readArchive(good);assert.equal(hash(archive.body),archive.entry.integrity.hash);
  assert.deepEqual(archive.entry.integrity.blocks,Array.from({length:Math.ceil(archive.body.length/32)},(_,n)=>hash(archive.body.subarray(n*32,(n+1)*32))));
  assert.ok(fs.readFileSync(path.join(good,'ChatGPT.exe'),'utf8').includes(hash(archive.json)));
  assert.match(archive.body.toString(),/damndotsConnectComposerPredictions/);assert.match(archive.body.toString(),/damndotsPredictionModel/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(good,'composer-predictions-patch.json'),'utf8')).version,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
