import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

/** Runs the real speech detector from the voice peer page against synthetic microphone frames. */
function detector(){
 const html=readFileSync(new URL('../src/voice-peer.html',import.meta.url),'utf8'),script=html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>'));
 const events:{kind:string;ms?:number}[]=[];
 const sandbox:any={window:{voiceEvent:(kind:string,_data:string,ms?:number)=>events.push({kind,ms})},btoa:(x:string)=>x,document:{getElementById:()=>({})},Float32Array,Uint8Array,DataView,ArrayBuffer,Math,AudioContext:class{},RTCPeerConnection:class{},MediaStream:class{},Audio:class{}};
 vm.createContext(sandbox);vm.runInContext(script+';window.__analyse=analyse;',sandbox);
 const frame=(level:number)=>new Float32Array(2048).fill(level);
 return {events,feed:(levels:number[])=>{for(const level of levels)sandbox.window.__analyse(frame(level));}};
}
const repeat=(level:number,count:number)=>Array<number>(count).fill(level);

test('a spoken sentence becomes one utterance with its voiced length',()=>{
 const d=detector();d.feed([...repeat(0.003,10),...repeat(0.12,10),...repeat(0.003,8)]);
 assert.deepEqual(d.events.map(e=>e.kind),['speech','utterance']);assert.ok((d.events[1].ms??0)>=1000);
});
test('a cough, keyboard click or weak hum is not sent for transcription',()=>{
 for(const sound of [repeat(0.2,2),repeat(0.012,30),[0.03,0.03,0.03,0.03,0.03,0.03]]){
  const d=detector();d.feed([...repeat(0.003,10),...sound,...repeat(0.003,12)]);
  assert.equal(d.events.filter(e=>e.kind==='utterance').length,0,JSON.stringify(sound.slice(0,3)));
 }
});
test('a short real answer such as yes is kept when it is clearly voiced',()=>{
 const d=detector();d.feed([...repeat(0.003,10),...repeat(0.15,4),...repeat(0.003,10)]);
 assert.equal(d.events.filter(e=>e.kind==='utterance').length,1);
});
