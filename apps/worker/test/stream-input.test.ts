import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeInput,keysymToKey,mouseButtonOf,navigationOf,wheelPixels} from '../src/stream-input.js';
const packet=(type:number,fill:(view:DataView)=>void,length:number)=>{const bytes=new Uint8Array(3+length),view=new DataView(bytes.buffer);view.setUint8(0,type);view.setUint16(1,length,true);fill(view);return bytes;};
test('data channel packets decode to the official panel protocol',()=>{
 assert.deepEqual(decodeInput(packet(1,v=>{v.setUint16(3,640,true);v.setUint16(5,400,true);},4)),{type:'move',x:640,y:400});
 assert.deepEqual(decodeInput(packet(2,v=>{v.setInt16(3,-10,true);v.setInt16(5,10,true);},4)),{type:'wheel',x:-10,y:10});
 assert.deepEqual(decodeInput(packet(3,v=>v.setBigUint64(3,65293n,true),8)),{type:'keydown',keysym:65293});
 assert.deepEqual(decodeInput(packet(4,v=>v.setBigUint64(3,1n,true),8)),{type:'keyup',keysym:1});
 assert.equal(decodeInput(new Uint8Array([3,8,0,1])),undefined);
 assert.equal(decodeInput(packet(9,()=>{},0)),undefined);
});
test('X11 keysyms become browser keys, mouse buttons and navigation',()=>{
 assert.equal(keysymToKey(97),'a');assert.equal(keysymToKey(65),'A');assert.equal(keysymToKey(0x01000131),'ı');assert.equal(keysymToKey(0xe7),'ç');
 assert.equal(keysymToKey(65293),'Enter');assert.equal(keysymToKey(65362),'ArrowUp');assert.equal(keysymToKey(65507),'Control');assert.equal(keysymToKey(65470),'F1');assert.equal(keysymToKey(65481),'F12');
 assert.equal(keysymToKey(0xffffff),undefined);
 assert.equal(mouseButtonOf(1),'left');assert.equal(mouseButtonOf(3),'right');assert.equal(mouseButtonOf(97),undefined);
 assert.equal(navigationOf(269025062),'back');assert.equal(navigationOf(269025063),'forward');
 assert.equal(wheelPixels(-10),300);assert.equal(wheelPixels(10),-300);
});
