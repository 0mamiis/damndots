'use strict';
// Resolve native composer bindings from semantics, never from a previous build's minified names.
function resolveComposerBindings(source){
 const scopes=[...source.matchAll(/([\w$]+)=[\w$]+\(`ComposerScope`,\{key:/g)];
 const ids=[...source.matchAll(/function ([\w$]+)\(e\)\{if\(e\.value\.kind!==`local`\)return e\.get\([\w$]+\);let\{conversationId:t,clientThreadId:n\}=e\.value;return t\?\?\([^}]+\}/g)];
 if(scopes.length!==1||ids.length!==1)throw Error('Unsupported composer scope identity');
 const scope=scopes[0][1],counts=new Map();
 for(const m of source.matchAll(new RegExp('(?:=|,)('+String.raw`[\w$]+`+')\\('+scope+'\\)','g')))counts.set(m[1],(counts.get(m[1])||0)+1);
 const hooks=[...counts].sort((a,b)=>b[1]-a[1]);
 if(!hooks.length||hooks[0][1]<3||hooks[1]?.[1]===hooks[0][1])throw Error('Ambiguous native composer hook');
 return {scope,hook:hooks[0][0],id:ids[0][1]};
}
function bindComposerHelper(helper,bindings){
 const re=/function codexOrchestratorComposerScope\(\)\{[^\n]+\}/g;
 if([...helper.matchAll(re)].length!==1)throw Error('Composer helper identity boundary changed');
 return helper.replace(re,()=>`function codexOrchestratorComposerScope(){var source=${bindings.hook}(${bindings.scope}),id=${bindings.id}(source);return id!=null?String(id):source.value.clientThreadId!=null?"draft:"+String(source.value.clientThreadId):null;}`);
}
module.exports={resolveComposerBindings,bindComposerHelper};
