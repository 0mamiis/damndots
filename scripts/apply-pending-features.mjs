// Waits until the managed desktop app is closed, then activates the pending staged build.
// The app has to stay closed for a moment: the launcher releases the executable a split second after the window
// disappears, and a quick relaunch used to make the swap fail on the first attempt. Failures are retried instead of
// giving up, so the queued build lands the next time the app is fully closed.
// Usage: node scripts/apply-pending-features.mjs   (exits after the swap or after 30 minutes)
//        node scripts/apply-pending-features.mjs --now   (single attempt; used by the desktop launcher before it opens Codex)
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {ensureFeatures} from './desktop-feature-manager.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const nativeDir=path.join(repo,'.data/local-stack/native'),dir=path.join(nativeDir,'desktop-features');
const exe=path.join(dir,'app','ChatGPT.exe'),staging=path.join(dir,'staging'),log=path.join(dir,'apply-pending.log');
const say=m=>{try{fs.appendFileSync(log,new Date().toISOString()+' '+m+'\n');}catch{}console.log(m);};
const closed=()=>{try{const fd=fs.openSync(exe,'r+');fs.closeSync(fd);return true;}catch{return false;}};
if(!fs.existsSync(staging)){say('no pending staged build');process.exit(0);}
if(process.argv.includes('--now')){
 // The launcher only calls this after every managed process has exited, so there is no reason to wait.
 if(!closed()){say('launcher: managed app still running; swap deferred');process.exit(3);}
 try{const r=ensureFeatures({nativeDir});say('launcher: '+JSON.stringify(r));process.exit(r.state==='ready'?0:4);}
 catch(e){say('launcher failed: '+e.message);process.exit(1);}
}
say('waiting for the managed app to close');
const deadline=Date.now()+30*60*1000;
let freeSince=0,attempts=0,lastError='',sameError=0;
while(Date.now()<deadline){
 const isClosed=closed();
 if(isClosed){
  if(!freeSince)freeSince=Date.now();
  // Give the launcher a few seconds to release the copy before touching it.
  if(Date.now()-freeSince>=3000){
   attempts++;
   try{const r=ensureFeatures({nativeDir});say('result: '+JSON.stringify(r));if(r.state==='ready')process.exit(0);freeSince=0;}
   catch(e){sameError=e.message===lastError?sameError+1:1;lastError=e.message;say('attempt '+attempts+' failed: '+e.message);freeSince=0;
    if(fs.existsSync(dir+'/staging')===false){say('no pending staged build left');process.exit(0);}
    if(sameError>=4){say('giving up after '+sameError+' identical failures');process.exit(1);}}
  }
 }else{freeSince=0;}
 await new Promise(r=>setTimeout(r,1500));
}
say('timed out waiting for the app to close'+(lastError?' (last error: '+lastError+')':''));process.exit(2);
