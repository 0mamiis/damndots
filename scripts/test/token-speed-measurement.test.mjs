import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import bindings from '../desktop-renderer-bindings.cjs';
const helper=fs.readFileSync(new URL('../desktop-features/orchestrator-ui.js',import.meta.url),'utf8');
test('composer bindings follow renamed native scope, hook and conversation resolver',()=>{
 for(const [scope,hook,id] of [['pS','bs','DGt'],['qS','Or','Pzt']]){
  const source=`var ${scope}=pr(\`ComposerScope\`,{key:e=>e});function ${id}(e){if(e.value.kind!==\`local\`)return e.get(lS);let{conversationId:t,clientThreadId:n}=e.value;return t??(pn(n)?e.get(cS,n):null)}let x=${hook}(${scope}),y=${hook}(${scope}),z=${hook}(${scope});`;
  const resolved=bindings.resolveComposerBindings(source);assert.deepEqual(resolved,{scope,hook,id});
  const adapted=bindings.bindComposerHelper(helper,resolved),fn=adapted.match(/function codexOrchestratorComposerScope\(\)\{[^\n]+\}/)[0];
  let current={value:{conversationId:'thread-current'}};
  const context=vm.createContext({[scope]:{},[hook]:()=>current,[id]:v=>v.value.conversationId,String});vm.runInContext(fn,context);
  assert.equal(context.codexOrchestratorComposerScope(),'thread-current');current={value:{clientThreadId:'new-draft'}};assert.equal(context.codexOrchestratorComposerScope(),'draft:new-draft');
 }
 assert.throws(()=>bindings.resolveComposerBindings('old names are no longer valid'),/Unsupported/);
});
function fixture(bridge){
 const data=new Map(),window={electronBridge:bridge?{getOpenCodexTps:bridge}:undefined,dispatchEvent:()=>{}};
 const context=vm.createContext({localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},window,performance:{now:()=>10000},Event:class{},Date,JSON,Math,Number,String,Promise,Object});
 const start=helper.indexOf('var CODEX_ORCH_TPS_KEY'),end=helper.indexOf('function codexOrchestratorDropdown');vm.runInContext(helper.slice(start,end),context);return context;
}
test('native token notifications produce a visible badge for the current chat and use seconds correctly',()=>{
 const c=fixture();c.codexTpsOnTurnStarted({threadId:'thread-current',turn:{id:'turn-1',model:'gpt-test'}});
 c.codexTpsOnUsage({threadId:'thread-current',turnId:'turn-1',tokenUsage:{last:{outputTokens:153}}});
 c.codexTpsOnTurnCompleted({threadId:'thread-current',turn:{id:'turn-1',status:'completed',startedAt:1793220000,completedAt:1793220002.493}});
 assert.equal(c.codexTpsMetric('thread-current').count,1);assert(Math.abs(c.codexTpsMetric('thread-current').tps-153/2.493)<0.02);
 assert.equal(c.codexTpsMetric('other-chat').count,0);
 const react={createElement:(tag,props,text)=>({tag,props,text}),useState:v=>[v,()=>{}],useRef:v=>({current:v}),useEffect:()=>{}};
 const badge=c.codexThreadTpsBadge('thread-current',react);assert.equal(badge.props['data-codex-tps-scope'],'thread-current');assert.match(badge.text,/61.* tok\/s/);
});
test('matched provider duration takes priority without inventing or duplicating usage',async()=>{
 let request;const c=fixture(async q=>{request=q;return{tokens:153,durationMs:2493,matchedTokenEvents:1}});
 c.codexTpsOnTurnStarted({threadId:'thread-current',turn:{id:'turn-2',model:'gpt-test'}});
 const usage={threadId:'thread-current',turnId:'turn-2',tokenUsage:{last:{outputTokens:153}}};c.codexTpsOnUsage(usage);c.codexTpsOnUsage(usage);
 c.codexTpsOnTurnCompleted({threadId:'thread-current',turn:{id:'turn-2',status:'completed',durationMs:3784}});
 await new Promise(r=>setImmediate(r));assert.equal(request.model,'gpt-test');assert.equal(request.tokenCounts.length,1);assert.equal(c.codexTpsRead()['thread-current'][0].source,'opencodex');assert.equal(c.codexTpsRead()['thread-current'][0].ms,2493);
});
