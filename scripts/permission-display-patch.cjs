'use strict';
const ts=require('typescript');
function fn(source,label,predicate){const tree=ts.createSourceFile('module.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),found=[];function walk(node){if(ts.isFunctionDeclaration(node)&&predicate(node.getText(tree)))found.push(node);else ts.forEachChild(node,walk);}walk(tree);if(found.length!==1)throw Error('Unsupported '+label+' boundary');const node=found[0];return{name:node.name.text,start:node.getStart(tree),end:node.end,text:node.getText(tree)};}
function one(s,a,b){if(s.split(a).length!==2)throw Error('Ambiguous permission display anchor');return s.replace(a,b);}
function reactFactory(source){const factories=new Map();for(const m of source.matchAll(/\(0,(\w+)\.use(?:Ref|State|Effect)\)/g)){const init=source.match(new RegExp('[,;]'+m[1]+'=(\\w+)\\(\\)[,;]'));if(init)factories.set(init[1],(factories.get(init[1])||0)+1);}const rows=[...factories].sort((a,b)=>b[1]-a[1]);if(!rows.length||rows[1]?.[1]===rows[0][1])throw Error('React factory ambiguous');return rows[0][0];}
function fullAccess(source,helper){
 const target=fn(source,'full-access dialog',s=>s.includes('fullAccessConfirm.warningTitle'));
 const model=target.text.match(/\{modelSettings:(\w+)\}=(\w+)\(n\)/),cyber=target.text.match(/c=(\w+)\(s\.model\)/);
 if(!model||!cyber)throw Error('Native cyber-model check missing');
 const wrapper=`function ${target.name}(e){var model=${model[2]}(e.conversationId).modelSettings;return damndotsPermissionInformationDialog(${reactFactory(source)}(),e,damndotsOriginalFullAccessDialog,"full-access",${cyber[1]}(model.model));}`;
 return source.slice(0,target.start)+target.text.replace('function '+target.name+'(','function damndotsOriginalFullAccessDialog(')+wrapper+source.slice(target.end)+'\n'+helper;
}
function ultra(source,helper){
 const target=fn(source,'Ultra dialog',s=>s.includes('ultraFullAccessConfirm.title'));
 const call=new RegExp('([\\w$]+)\\(([\\w$]+),'+target.name+',\\{canContinue:');
 if(!call.test(source))throw Error('Ultra selection boundary missing');
 const cyber=source.match(/if\(e!==s\.model&&([\w$]+)\(e\)&&g&&f!==`guardian-approvals`\)/);
 if(!cyber)throw Error('Ultra cyber-model restriction missing');
 source=source.slice(0,target.start)+target.text.replace('function '+target.name+'(','function damndotsOriginalUltraDialog(')+`function ${target.name}(e){return damndotsPermissionInformationDialog(${reactFactory(source)}(),e,damndotsOriginalUltraDialog,"ultra",e.damndotsCyber===true);}`+source.slice(target.end);
 source=source.replace(call,(_,open,host)=>open+'('+host+','+target.name+',{damndotsCyber:'+cyber[1]+'(e),canContinue:');
 return source+'\n'+helper;
}
function custom(source){
 const target=fn(source,'custom eligibility',s=>s.includes('allowedApprovalPolicies')&&s.includes('allowedApprovalsReviewers')&&s.includes('`custom`')&&s.includes('r.some(({agentMode:'));
 const tail=target.text.match(/let \w+=\w+\(\w+\(`custom`,\[\],e\)\);return \w+==null\|\|!r\.some\(\(\{agentMode:e\}\)=>e===\w+\.agentMode\)/);
 if(!tail)throw Error('Custom duplicate-profile filter changed');
 return source.slice(0,target.start)+one(target.text,tail[0],'return!0')+source.slice(target.end);
}
function preferredCustom(source){
 const target=fn(source,'current permission selection',s=>s.startsWith('function ')&&s.includes('configuredCustomPermissions:t,cwd:n,permissions:r}'));
 const available=target.text.match(/isAvailable:(\w+)\(e,t\)/),equal=target.text.match(/if\((\w+)\(r,t,n\)\)/);
 if(!available||!equal)throw Error('Permission equivalence checks missing');
 const intro=target.text.indexOf('{let i=');if(intro<0)throw Error('Permission profile identity boundary changed');
 let text=target.text.replace('cwd:n,permissions:r})','cwd:n,permissions:r,preferredPermissionSelection:damndotsPreferred})');
 text=text.replace('{let i=',`{if(damndotsPreferred?.kind===\`custom\`&&${available[1]}(e,damndotsPreferred)&&${equal[1]}(r,t,n))return{isAvailable:!0,isLegacy:!1,permissionSelection:damndotsPreferred};let i=`);
 source=source.slice(0,target.start)+text+source.slice(target.end);
 const call=/cwd:d,permissions:u\}\);return\{availablePermissionSelections:/;
 if([...source.matchAll(new RegExp(call.source,'g'))].length!==1)throw Error('Preferred host selection boundary changed');
 const store=source.match(/permissionSelection:t\((\w+),e\.hostId\)/);if(!store)throw Error('Preferred permission store missing');
 return source.replace(call,()=>`cwd:d,permissions:u,preferredPermissionSelection:t(${store[1]},r)});return{availablePermissionSelections:`);
}
function legacyCustom(source){
 const target=fn(source,'legacy custom display',s=>s.includes('customEquivalentMode:')&&s.includes('canShowCustom:')&&s.includes('configNonFullAccessMode:')&&s.includes('.filter(e=>e!==`custom`)'));
 const filter=/([\w$]+)=![\w$]+&&[\w$]+!=null&&([\w$]+)\.includes\([\w$]+\)&&![\w$]+\?\2\.filter\(e=>e!==`custom`\):\2/;
 if(!filter.test(target.text))throw Error('Legacy custom equivalence filter changed');
 const text=target.text.replace(filter,(_,selection,allowed)=>selection+'='+allowed);
 return source.slice(0,target.start)+text+source.slice(target.end);
}

// Codex 26.1029 (Rspack): the dialogs are opened through a shared host call, (0,X.qf)(host,Component,props).
// Skip the information dialogs at the call site when the local preference says so; the native confirm callback still runs.
function rspackDialogs(source){
 let done=0;
 // Find the call by its head, then take the whole argument list by balancing parentheses.
 const head=/\(0,([\w$]+)\.qf\)\(([\w$]+),([\w$]+)\.O,\{canContinue:[^,]+,onClose:/g;let hm;const spans=[];
 while((hm=head.exec(source))){
  const open=source.indexOf('(',hm.index+hm[0].indexOf(').qf)')+5);let d=0,i=open;
  for(;i<source.length;i++){const c=source[i];if(c==='(')d++;else if(c===')'){d--;if(!d)break;}}
  const call=source.slice(hm.index,i+1);const go=call.match(/onContinueWithFullAccess:([\w$]+),/);
  if(go&&call.includes('onContinueWithFallback:'))spans.push([hm.index,i+1,go[1]]);
 }
 for(const [st,en,go] of spans.reverse()){done++;source=source.slice(0,st)+'(window.__damndotsHideDialogs===true?'+go+'():'+source.slice(st,en)+')'+source.slice(en);}
 // Full-access confirm: (0,X.qf)(host,Cmp,{conversationId:C,onConfirm:HANDLER}); take the whole call by balancing parentheses.
 {const h2=/\(0,([\w$]+)\.qf\)\(([\w$]+),([\w$]+),\{conversationId:([\w$]+),onConfirm:/g;let m2;const sp=[];
  while((m2=h2.exec(source))){
   if(source.slice(Math.max(0,m2.index-40),m2.index).includes('__damndotsHideDialogs===true?'))continue;
   const op=source.indexOf('(',m2.index+m2[0].indexOf(').qf)')+5);let dd=0,j=op;
   for(;j<source.length;j++){const c=source[j];if(c==='(')dd++;else if(c===')'){dd--;if(!dd)break;}}
   const call=source.slice(m2.index,j+1),hs=m2[0].length;
   let body=call.slice(hs,call.length-2);// handler text before closing }) 
   if(!/^(\(\)=>|[\w$]+$)/.test(body))continue;
   sp.push([m2.index,j+1,body]);
  }
  for(const [st,en,body] of sp.reverse()){done++;source=source.slice(0,st)+'(window.__damndotsHideDialogs===true?('+body+')():'+source.slice(st,en)+')'+source.slice(en);}
 }
 if(!done)throw Error('Unsupported permission dialog bundle');
 return source;
}
function rspackCustom(source){
 const filter=/([\w$]+)=![\w$]+&&null!=[\w$]+&&[\w$]+\.includes\([\w$]+\)&&![\w$]+\?([\w$]+)\.filter\(e=>"custom"!==e\):\2/g;
 let n=0;source=source.replace(filter,(m,lhs,all)=>{n++;return lhs+'='+all;});
 return n?source:null;
}
module.exports={fullAccess,ultra,custom,preferredCustom,legacyCustom,rspackDialogs,rspackCustom};
