'use strict';
const APP_ID='OpenAI.Codex_2p2nqsd0c76g0!App';
const SHUTDOWN_GUARD_MARKER='/* damndots-shutdown-reopen-guard-v1 */';
function patchBootstrap(source){
 if(source.includes('/* damndots-startup-identity-v1 */'))return source;
 const re=/([\w$]+)\.app\.setAppUserModelId\((?:\(0,[\w$]+\.[\w$]+\)\([\w$]+\)|[\w$]+\.[\w$]+\([\w$]+\))\)/g;
 if([...source.matchAll(re)].length!==1)throw Error('Unsupported desktop startup identity boundary');
 return source.replace(re,(_,electron)=>electron+'.app.setAppUserModelId('+JSON.stringify(APP_ID)+')/* damndots-startup-identity-v1 */');
}
function replaceUnique(source,re,fn,label){
 const hits=[...source.matchAll(re)];
 if(hits.length!==1)throw Error('Unsupported desktop shutdown '+label+' boundary ('+hits.length+')');
 return source.replace(re,fn);
}
// Codex keeps Electron's single-instance lock during async will-quit teardown while eVV.dispose() removes the
// "local" app-server connection. Reopening Codex during that window used to spawn a new primary window on top of
// the disposed context and crash in createAppHost -> getConnection("local"). Refuse window creation once quitting
// or disposed, and close any late AppView RPC port cleanly instead of throwing an uncaught main-process error.
function patchShutdownGuard(source){
 if(source.includes(SHUTDOWN_GUARD_MARKER))return source;
 if(!source.includes('createAppHost('))return source;
 let out=source;
 out=replaceUnique(
  out,
  /(async\([\w$]+,[\w$]+\)=>\{try\{)(let ([\w$]+)=([\w$]+)\.getPrimaryWindow\(\)\?\?await [\w$]+\("\/"\);if\(null==\3\)return;)/g,
  (_,head,body,__,win)=>head+'if('+win+'.windowManager?.appQuitting)return;'+body,
  'second-instance'
 );
 out=replaceUnique(
  out,
  /if\(null==([\w$]+)\)return null;let ([\w$]+)=await ([\w$]+)\.createPrimaryWindow\(/g,
  (_,ctx,win,mgr)=>'if(null=='+ctx+'||'+mgr+'.appQuitting||!'+ctx+'.appServerConnectionRegistry?.getMaybeConnection?.("local"))return null;let '+win+'=await '+mgr+'.createPrimaryWindow(',
  'primary-window'
 );
 out=replaceUnique(
  out,
  /(ensureWindow:async\(\{forNavigation:[\w$]+=!1,startupScreen:[\w$]+=!1,background:[\w$]+=!1\}=\{\}\)\=>\{let ([\w$]+)=([\w$]+)\.getPrimaryWindow\(\);if\(\2\)return )null==([\w$]+)\|\|/g,
  (_,head,__,mgr,ctx)=>head+'null=='+ctx+'||'+mgr+'.appQuitting||!'+ctx+'.appServerConnectionRegistry?.getMaybeConnection?.("local")||',
  'ensure-window'
 );
 out=replaceUnique(
  out,
  /([\w$]+)\.ipcMain\.on\(([\w$.]+),([\w$]+)=>\{if\(!([\w$]+)\(\3\)\)return;let\[([\w$]+)\]=\3\.ports,([\w$]+)=([\w$]+)\(\3\.sender\),([\w$]+)=\6\?\.createAppHost\(\3\.sender\),/g,
  (_,electron,ch,ev,trust,port,ctx,getCtx,host)=>electron+'.ipcMain.on('+ch+','+ev+'=>{if(!'+trust+'('+ev+'))return;let['+port+']='+ev+'.ports,'+ctx+'='+getCtx+'('+ev+'.sender);if(null=='+port+'||null!='+ctx+'&&!'+ctx+'.appServerConnectionRegistry?.getMaybeConnection?.("local")){'+port+'?.close();return;}let '+host+'='+ctx+'?.createAppHost('+ev+'.sender),',
  'app-host-ipc'
 );
 return out+'\n'+SHUTDOWN_GUARD_MARKER+'\n';
}
module.exports={APP_ID,SHUTDOWN_GUARD_MARKER,patchBootstrap,patchShutdownGuard};
