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
test('shutdown reopen guard blocks window creation while quitting and avoids createAppHost crash when local connection is disposed',async()=>{
 const source=[
  "let created=0,shown=0,appHostCalls=0,registered=0;",
  "let P={appQuitting:!1,primary:null,getPrimaryWindow(){return this.primary},async createPrimaryWindow(){created++;return{id:created,isDestroyed:()=>!1,isMinimized:()=>!1,show(){shown++},focus(){},once(){}}},async getOrCreateNavigationWindow(w){return w}};",
  "let localConn={id:'local'};",
  "let C={appServerConnectionRegistry:{getMaybeConnection(id){return id==='local'?localConn:null}},createAppHost(s){if(!localConn)throw Error('Connection for host ID local not found');appHostCalls++;return{sender:s}},async registerAppView(){registered++}};",
  "let eM={windowManager:P,getPrimaryWindow:()=>P.getPrimaryWindow(),ensureWindow:async({forNavigation:e=!1,startupScreen:t=!1,background:r=!1}={})=>{let n=P.getPrimaryWindow();if(n)return null==C||e&&((n=await P.getOrCreateNavigationWindow(n)).isDestroyed()||n.webContents?.isDestroyed())?null:(r||(n.isMinimized()&&n.restore(),n.show(),n.focus()),n.isDestroyed()?null:n);return L({show:!1,background:r,startupScreen:t})}};",
  "let L=async({show:e,initialRoute:t,opener:r,startupScreen:n,background:i=!1})=>{if(null==C)return null;let s=await P.createPrimaryWindow({title:tf.app.getName()});return s};",
  "let eB=async()=>L({show:!0});",
  "let e7=w=>{w.show()};",
  "let te=async(e,t)=>{try{let r=eM.getPrimaryWindow()??await eB(\"/\");if(null==r)return;e7(r)}catch(e){throw e}};",
  "let handlers={};",
  "let tf={app:{getName:()=>'Codex'},ipcMain:{on(ch,fn){handlers[ch]=fn}}};",
  "let cr={QT:'app-view:connect'};",
  "let A=()=>!0,l=()=>C,exO=()=>()=>{},ha={L:(p,h)=>({p,h})},tC={tZQ:()=>({warning(){}})};",
  "tf.ipcMain.on(cr.QT,e=>{if(!A(e))return;let[t]=e.ports,r=l(e.sender),n=r?.createAppHost(e.sender),i=exO(e.sender,()=>t.close());t.once('close',i);let s=(0,ha.L)(t,n);null!=r&&r.registerAppView(e.sender,s).catch(e=>{(0,tC.tZQ)().warning('fail')})});",
  "({te,eM,P,setLocal(v){localConn=v},emitConnect(port){handlers[cr.QT]({ports:[port],sender:{id:1}})},stats:()=>({created,shown,appHostCalls,registered})})"
 ].join('\n');
 const patched=patch.patchShutdownGuard(source);
 assert.equal(patch.patchShutdownGuard(patched),patched);
 const runtime=vm.runInNewContext(patched,{});
 // Normal launch + connect works.
 await runtime.te();
 let closed=0;
 const port1={once(){},close(){closed++}};
 runtime.emitConnect(port1);
 assert.deepEqual({...runtime.stats()},{created:1,shown:1,appHostCalls:1,registered:1});
 assert.equal(closed,0);
 // While quitting, second-instance and ensureWindow must not open or resurface a window.
 runtime.P.appQuitting=!0;
 await runtime.te();
 assert.equal(await runtime.eM.ensureWindow(),null);
 assert.equal(runtime.stats().created,1);
 // After eVV.dispose() removes the local connection, late AppView connect closes the port without throwing.
 runtime.setLocal(null);
 const port2={once(){},close(){closed++}};
 assert.doesNotThrow(()=>runtime.emitConnect(port2));
 assert.equal(closed,1);
 assert.equal(runtime.stats().appHostCalls,1);
});
test('shutdown reopen guard leaves older builds without createAppHost untouched and fails closed on partial matches',()=>{
 assert.equal(patch.patchShutdownGuard('console.log(1);'),'console.log(1);');
 assert.throws(()=>patch.patchShutdownGuard('function x(){createAppHost(e)}'),/Unsupported desktop shutdown/);
});
