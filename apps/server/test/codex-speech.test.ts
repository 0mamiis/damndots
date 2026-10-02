import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CodexSpeech,codexVoiceSlug} from '../src/codex-speech.js';

test('desktop account voice names map to the actual voice identifiers, with no substitutions',()=>{
  assert.equal(codexVoiceSlug('fathom'),'arbor');assert.equal(codexVoiceSlug('orbit'),'spruce');assert.equal(codexVoiceSlug('glimmer'),'sol');assert.equal(codexVoiceSlug('sky'),'juniper');
  for(const v of ['arbor','juniper','maple','spruce','ember','vale','breeze','sol','cove'])assert.equal(codexVoiceSlug(v),v);
  assert.throws(()=>codexVoiceSlug('en-US-AvaMultilingualNeural'));
});
test('each speech lookup uses the current Codex selection and login without changing or caching either',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'codex-voice-'));let value='fathom';const requests:any[]=[];
  const auth={auth_mode:'chatgpt',tokens:{access_token:'private-access',account_id:'actual-account'}};
  await writeFile(join(dir,'auth.json'),JSON.stringify(auth));await writeFile(join(dir,'codex-speech-headers.json'),JSON.stringify({'user-agent':'original-app','oai-did':'device','chatgpt-account-id':'old-account'}));
  const speech=new CodexSpeech({host:{} as any,mainHome:dir,nativeDir:dir,fetch:async(url,init)=>{requests.push({url:String(url),init});return new Response(JSON.stringify({selected:value}),{headers:{'content-type':'application/json'}});}});
  try{
    assert.equal(await speech.selectedVoice(new AbortController().signal),'arbor');value='juniper';assert.equal(await speech.selectedVoice(new AbortController().signal),'juniper');
    assert.equal(requests.length,2);for(const r of requests){assert.match(r.url,/^https:\/\/chatgpt\.com\/backend-api\/settings\/voices\?/);assert.equal(r.init.headers.authorization,'Bearer private-access');assert.equal(r.init.headers['chatgpt-account-id'],'actual-account');assert.equal(r.init.headers['user-agent'],'original-app');assert.equal(r.init.redirect,'error');}
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('an unavailable official voice reports the failure instead of impersonating it with a different speaker',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'codex-voice-'));await writeFile(join(dir,'auth.json'),JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'private-access',account_id:'actual-account'}}));await writeFile(join(dir,'codex-speech-headers.json'),'{}');
  const speech=new CodexSpeech({host:{} as any,mainHome:dir,nativeDir:dir,fetch:async()=>new Response('not available',{status:403})});
  try{await assert.rejects(speech.selectedVoice(new AbortController().signal),/403/);}finally{await rm(dir,{recursive:true,force:true});}
});
