import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {ensureFeatures,verifyApp} from '../desktop-feature-manager.mjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
test('unsupported Codex version fails closed without creating or activating a patched app',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dots-desktop-version-'));
 try{const result=ensureFeatures({nativeDir:dir,sourcePackage:{version:'999.0',root:path.join(dir,'missing')}});assert.equal(result.state,'unsupported-version');assert.equal(fs.existsSync(path.join(dir,'desktop-features','active.json')),false);assert.equal(fs.existsSync(path.join(dir,'desktop-features','app')),false);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('full archive and executable verification rejects changed blocks',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dots-desktop-integrity-'));const data=Buffer.from('feature fixture'),meta={files:{'fixture.js':{offset:'0',size:data.length,integrity:{hash:sha(data),blockSize:data.length,blocks:[sha(data)]}}}};
 const json=Buffer.from(JSON.stringify(meta)),size=(4+json.length+3)&~3,pickle=Buffer.alloc(4+size),head=Buffer.alloc(8);pickle.writeUInt32LE(size);pickle.writeUInt32LE(json.length,4);json.copy(pickle,8);head.writeUInt32LE(4);head.writeUInt32LE(pickle.length,4);
 try{fs.mkdirSync(path.join(dir,'resources'));const file=path.join(dir,'resources','app.asar');fs.writeFileSync(file,Buffer.concat([head,pickle,data]));fs.writeFileSync(path.join(dir,'ChatGPT.exe'),'fixture '+sha(json));assert.equal(verifyApp(dir).checked,1);const changed=fs.readFileSync(file);changed[changed.length-1]^=1;fs.writeFileSync(file,changed);assert.throws(()=>verifyApp(dir),/integrity mismatch/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('managed integration has no runtime dependency on manual patch task folders',()=>{
 const files=['desktop-feature-manager.mjs','patch-native-agent-features.cjs','desktop-features/orchestrator-ui.js','desktop-features/native-subpicker.cjs','desktop-features/opencodex-tps-main.js'];
 for(const file of files){const text=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');assert.doesNotMatch(text,/\.codex[\\/]orchestrators[\\/]native-codex|Documents[\\/]Codex|C:[\\/]Users[\\/]memin/);}
});
