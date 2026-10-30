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
module.exports={fullAccess,ultra,custom,preferredCustom,legacyCustom};
