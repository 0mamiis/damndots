import test from 'node:test';
import assert from 'node:assert/strict';
import {StreamEventQueue} from '../src/stream-queue.js';
const tick=()=>new Promise<void>(r=>setImmediate(r));
test('pointer bursts use the latest position without moving a click or keyboard boundary',async()=>{
 let unblock!:()=>void;const blocked=new Promise<void>(r=>unblock=r),seen:string[]=[];
 const queue=new StreamEventQueue<string>(async e=>{seen.push(e);if(e==='control')await blocked;},e=>e.startsWith('move:'));
 queue.push('control');for(let i=0;i<200;i++)queue.push('move:'+i);
 queue.push('mousedown');queue.push('move:300');queue.push('move:400');queue.push('mouseup');queue.push('keydown');queue.push('keyup');
 unblock();await tick();assert.deepEqual(seen,['control','move:199','mousedown','move:400','mouseup','keydown','keyup']);queue.close();
});
test('input failures allow a key release to run, closing discards pending input',async()=>{
 let unblock!:()=>void;const blocked=new Promise<void>(r=>unblock=r),seen:string[]=[];
 const queue=new StreamEventQueue<string>(async e=>{seen.push(e);if(e==='bad')throw Error('failed');if(e==='block')await blocked;},()=>false);
 queue.push('bad');queue.push('keyup');await tick();assert.deepEqual(seen,['bad','keyup']);
 queue.push('block');queue.push('stale');queue.close();queue.push('after-close');unblock();await tick();assert.deepEqual(seen,['bad','keyup','block']);
});
