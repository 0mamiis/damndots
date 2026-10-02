import test from 'node:test';
import assert from 'node:assert/strict';
import {stripAnnotations,isNoiseTranscript,voiceVocabulary,voiceEffort,voiceStyle} from '../src/voice-text.js';
import {cleanTranscript} from '../src/integrations/index.js';

test('sound descriptions never reach the Dot as something the user said',()=>{
 assert.equal(stripAnnotations('[öksürük]'),'');
 assert.equal(cleanTranscript('(laughs) [silence] Merhaba *keyboard* Null'),'Merhaba Null');
 assert.equal(cleanTranscript('[gürültü]'),'');
});
test('credits and lone fillers from short sounds are dropped, real sentences and greetings stay',()=>{
 assert.equal(isNoiseTranscript('Altyazı M.K.',3),true);
 assert.equal(isNoiseTranscript('Izlediğiniz için teşekkürler',3),true);
 assert.equal(isNoiseTranscript('Evet',0.3),true);
 assert.equal(isNoiseTranscript('Evet',0.6),false);
 assert.equal(isNoiseTranscript('Merhaba',0.4),false);
 assert.equal(isNoiseTranscript('Evet, bunu yap',0.3),false);
 assert.equal(isNoiseTranscript('a',2),true);
});
test('recognition gets the Dot names and voice calls use a light effort unless inherited',()=>{
 assert.deepEqual(voiceVocabulary({listDots:()=>[{name:'Null'},{name:'Null'}]}).slice(0,2),['Null','Dot']);
 const previous=process.env.DOTS_VOICE_EFFORT;
 try{delete process.env.DOTS_VOICE_EFFORT;assert.equal(voiceEffort(),'low');process.env.DOTS_VOICE_EFFORT='inherit';assert.equal(voiceEffort(),null);}
 finally{if(previous===undefined)delete process.env.DOTS_VOICE_EFFORT;else process.env.DOTS_VOICE_EFFORT=previous;}
 assert.match(voiceStyle('Null'),/"Null"/);
});
