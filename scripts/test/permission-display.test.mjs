import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),adapter=require('../permission-display-patch.cjs'),helper=fs.readFileSync(new URL('../permission-display-renderer.js',import.meta.url),'utf8');
async function renderDialog({hide,cyber,kind}){
 const slots=[],effects=[];let index=0,confirmed=0,closed=0;
 const R={useState:v=>{const i=index++;if(!(i in slots))slots[i]=v;return[slots[i],v=>slots[i]=v];},useRef:v=>{const i=index++;return slots[i]??(slots[i]={current:v});},useEffect:(f,deps)=>{const i=index++,old=slots[i];if(!old||deps.some((d,j)=>old[j]!==d)){slots[i]=deps;effects.push(f);}},createElement:(type,props)=>({type,props})};
 const Original=()=>{},props={onConfirm:()=>confirmed++,onContinueWithFullAccess:()=>confirmed++,onClose:()=>closed++};
 const ctx=vm.createContext({window:{electronBridge:{getPermissionDisplayPreferences:async()=>({hideInformationDialogs:hide})}},Promise});vm.runInContext(helper,ctx);
 let node;for(let n=0;n<3;n++){index=0;node=ctx.damndotsPermissionInformationDialog(R,props,Original,kind,cyber);while(effects.length)effects.shift()();await new Promise(r=>setImmediate(r));}
 return{node,Original,confirmed,closed};
}
test('only an explicit local preference skips ordinary information dialogs once',async()=>{
 for(const kind of ['full-access','ultra']){const r=await renderDialog({hide:true,cyber:false,kind});assert.equal(r.node,null);assert.equal(r.confirmed,1);assert.equal(r.closed,1);}
});
test('default warning and native cyber-model confirmation remain visible',async()=>{
 for(const options of [{hide:false,cyber:false},{hide:true,cyber:true}]){const r=await renderDialog({...options,kind:'full-access'});assert.equal(r.node.type,r.Original);assert.equal(r.confirmed,0);assert.equal(r.closed,0);}
});
test('custom stays available when identical to a preset while native policy rejection wins',()=>{
 const source='function zlt(e,t,n,r){let i=e?.approval_policy,a=e?.approvals_reviewer,o=e?.sandbox_mode;if(i==null&&a==null&&o==null||o!=null&&!t.some(({allowed:e,id:t})=>e&&t===Hlt[o])||n?.allowedApprovalPolicies!=null&&i!=null&&!n.allowedApprovalPolicies.some(e=>(0,Vlt.default)(e,i)))return!1;let s=n?.allowedApprovalsReviewers,c=s?.some(cY)===!0;if(s!=null&&a!=null&&!s.includes(a)&&!(cY(a)&&c))return!1;let l=plt(dY(`custom`,[],e));return l==null||!r.some(({agentMode:e})=>e===l.agentMode)}';
 const ctx=vm.createContext({Hlt:{'danger-full-access':':danger-full-access'},Vlt:{default:(a,b)=>a===b},cY:()=>false});vm.runInContext(adapter.custom(source),ctx);
 const config={approval_policy:'never',sandbox_mode:'danger-full-access',approvals_reviewer:'user'},profiles=[{allowed:true,id:':danger-full-access'}];
 assert.equal(ctx.zlt(config,profiles,null,[{agentMode:'full-access'}]),true);
 assert.equal(ctx.zlt(config,[{allowed:false,id:':danger-full-access'}],null,[]),false);
 assert.equal(ctx.zlt(config,profiles,{allowedApprovalPolicies:['on-request']},[]),false);
 assert.equal(ctx.zlt(config,profiles,{allowedApprovalsReviewers:['auto_review']},[]),false);
 assert.equal(ctx.zlt({},profiles,null,[]),false);
});
test('permission-display IPC is trusted-origin only and defaults to showing warnings',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dots-permission-display-'));let handler;
 try{const ctx=vm.createContext({require:id=>id==='electron'?{ipcMain:{handle:(_n,f)=>handler=f}}:id==='node:os'?{homedir:()=>dir}:require(id)});vm.runInContext(fs.readFileSync(new URL('../permission-display-runtime.js',import.meta.url),'utf8'),ctx);assert.equal(handler({senderFrame:{url:'https://evil.example'}}),null);assert.equal(handler({senderFrame:{url:'app://-/index.html'}}).hideInformationDialogs,false);fs.mkdirSync(path.join(dir,'.codex/dots-local-bridge'),{recursive:true});fs.writeFileSync(path.join(dir,'.codex/dots-local-bridge/permission-display.json'),JSON.stringify({hideInformationDialogs:true}));assert.equal(handler({senderFrame:{url:'app://-/index.html'}}).hideInformationDialogs,true);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('legacy picker retains Custom beside an equivalent preset without adding policy-denied modes',()=>{
 const source='function Picker({isConfigDataPending:e,allowed:m,equivalent:b,hidden:x}){let S=!e&&b!=null&&m.includes(b)&&!x?m.filter(e=>e!==`custom`):m;return{availableAgentModes:S,canShowCustom:S.includes(`custom`),customEquivalentMode:b,configNonFullAccessMode:"auto"}}';
 const original=vm.createContext({}),fixed=vm.createContext({});vm.runInContext(source,original);vm.runInContext(adapter.legacyCustom(source),fixed);
 const input={isConfigDataPending:false,allowed:['auto','full-access','custom'],equivalent:'full-access',hidden:false};
 assert.equal(original.Picker(input).canShowCustom,false);assert.equal(fixed.Picker(input).canShowCustom,true);
 assert.equal(fixed.Picker({...input,allowed:['read-only'],equivalent:'read-only'}).canShowCustom,false);
 assert.equal(fixed.Picker({...input,allowed:['guardian-approvals'],equivalent:null}).canShowCustom,false);
});
