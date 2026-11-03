// Waits until the managed desktop app is closed, then activates the pending staged build.
// Usage: node scripts/apply-pending-features.mjs   (exits after the swap or after 30 minutes)
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {ensureFeatures} from './desktop-feature-manager.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const nativeDir=path.join(repo,'.data/local-stack/native'),dir=path.join(nativeDir,'desktop-features');
const exe=path.join(dir,'app','ChatGPT.exe'),staging=path.join(dir,'staging'),log=path.join(dir,'apply-pending.log');
const say=m=>{try{fs.appendFileSync(log,new Date().toISOString()+' '+m+'\n');}catch{}console.log(m);};
const closed=()=>{try{const fd=fs.openSync(exe,'r+');fs.closeSync(fd);return true;}catch{return false;}};
if(!fs.existsSync(staging)){say('no pending staged build');process.exit(0);}
say('waiting for the managed app to close');
const deadline=Date.now()+30*60*1000;
while(Date.now()<deadline){
 if(closed()){
  try{const r=ensureFeatures({nativeDir});say('result: '+JSON.stringify(r));if(r.state==='ready')process.exit(0);}catch(e){say('failed: '+e.message);process.exit(1);}
 }
 await new Promise(r=>setTimeout(r,1500));
}
say('timed out waiting for the app to close');process.exit(2);