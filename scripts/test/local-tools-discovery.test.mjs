import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const source=readFileSync(new URL('../codex-local-tools-bridge.cjs',import.meta.url),'utf8');
const begin=source.indexOf('async function resolvePipe(){'),end=source.indexOf('\nlet active=',begin);assert.ok(begin>=0&&end>begin);
function fixture(names,cached){let calls=[];const ctx=vm.createContext({pipe:cached,fs:{readdirSync:()=>names},requestPipe:async path=>{calls.push(path);if(path.includes('stale'))throw Error('closed');return {tools:[{name:'list_threads',namespace:'codex_app'}]};}});vm.runInContext(source.slice(begin,end),ctx);return {ctx,calls};}
test('desktop discovery prefers new Codex app tools pipes and retains older clients',async()=>{
 const f=fixture(['unrelated','codex-browser-use-old','codex-app-tools-new']);assert.match(await f.ctx.resolvePipe(),/codex-app-tools-new$/);assert.equal(f.calls.length,1);
 const old=fixture(['unrelated','codex-browser-use-old']);assert.match(await old.ctx.resolvePipe(),/codex-browser-use-old$/);
 const stale=fixture(['codex-app-tools-new'],'stale');assert.match(await stale.ctx.resolvePipe(),/codex-app-tools-new$/);assert.equal(stale.calls.length,2);
 const none=fixture(['unrelated']);await assert.rejects(none.ctx.resolvePipe(),/not ready/);
});
