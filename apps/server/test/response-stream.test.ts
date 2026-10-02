import test from 'node:test';
import assert from 'node:assert/strict';
import { guardedResponses } from '../src/response-stream.js';

const collect=async(input:AsyncIterable<string|Uint8Array>,idleMs=50)=>{
  let text='',stopped=false;for await(const c of guardedResponses(input,{idleMs,stop:()=>{stopped=true;}}))text+=typeof c==='string'?c:Buffer.from(c).toString();
  return {text,stopped};
};
test('completed streams pass through even when the terminal event crosses byte boundaries',async()=>{
  const event='event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n';
  const source=(async function*(){yield Buffer.from(event.slice(0,37));yield Buffer.from(event.slice(37));})();
  const result=await collect(source);assert.equal(result.text,event);assert.equal(result.stopped,false);
});
test('truncated streams expose a failure instead of leaving Thinking active',async()=>{
  const source=(async function*(){yield 'event: response.created\ndata: {"type":"response.created"}\n\n';})();
  const result=await collect(source);assert.match(result.text,/"type":"response.failed"/);assert.match(result.text,/akışı tamamlanmadan/);assert.equal(result.stopped,true);
});
test('a provider which never sends bytes is terminated by the idle deadline',async()=>{
  const source={ [Symbol.asyncIterator](){return {next:()=>new Promise<IteratorResult<string>>(()=>{})};}};
  const result=await collect(source,10);assert.match(result.text,/"type":"response.failed"/);assert.match(result.text,/veri göndermedi/);assert.equal(result.stopped,true);
});
