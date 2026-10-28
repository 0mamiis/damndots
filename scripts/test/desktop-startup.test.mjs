import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import patch from '../desktop-startup-patch.cjs';
test('desktop identity is set before the single-instance handshake and first window',()=>{
 const calls=[],app={setAppUserModelId:id=>calls.push(['identity',id]),requestSingleInstanceLock:()=>calls.push(['lock']),createWindow:()=>calls.push(['window'])};
 const source='y.app.setAppUserModelId(n.r(flavor));y.app.requestSingleInstanceLock();y.app.createWindow();';
 const result=patch.patchBootstrap(source);vm.runInNewContext(result,{y:{app}});
 assert.deepEqual(calls,[['identity',patch.APP_ID],['lock'],['window']]);assert.equal(patch.patchBootstrap(result),result);
});
test('a changed bootstrap fails before any distribution file is written',()=>{
 assert.throws(()=>patch.patchBootstrap('app.changedIdentity()'),/Unsupported/);
 assert.throws(()=>patch.patchBootstrap('x.app.setAppUserModelId(n.r(v));y.app.setAppUserModelId(n.r(v))'),/Unsupported/);
});
