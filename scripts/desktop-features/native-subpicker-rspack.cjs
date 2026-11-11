'use strict';
// Codex 26.1029+ (Rspack): turn the native composer model picker into the orchestrator / subagent picker.
// The primary picker renders a second instance of itself (codexSubagent) next to it, so the instance keeps the
// application's own providers, hooks and styling. The old (Vite) variant lives in native-subpicker.cjs.
module.exports={picker,slider};
function picker(s,lit,sub,textClass){
 const BT=String.fromCharCode(96);
 const head=[...s.matchAll(/([\w$]+:)?function(?: ([\w$]+))?\(e\)\{let [\w$,]+=\(0,[\w$]+\.c\)\(\d+\),\{serviceTierDefaults:[\w$]+,conversationId:[\w$]+,hasThreadResumeFailed:[\w$]+,hideLabel:[\w$]+,home:[\w$]+,isCodexHome:[\w$]+,permissionsCwdOverride:[\w$]+,permissionsHostId:[\w$]+\}=e,/g)];
 if(head.length!==1)throw Error('Unsupported Codex composer model picker header ('+head.length+')');
 const picker=head[0][2],start=head[0].index+(head[0][1]?head[0][1].length:0),anon=!head[0][2];
 const endRe=anon?/,([\w$]+)\}\}\)\},[\w$]+\(e,l,n\)\{/g:/,([\w$]+)\}function [\w$]+\(e\)\{let\{reasoningEffort:[\w$]+\}=e;return"persistent"===[\w$]+\}/g;endRe.lastIndex=start;
 const em=endRe.exec(s);if(!em)throw Error('Unsupported Codex composer model picker end');
 const retVar=em[1],end=em.index+1+retVar.length+1;
 let b=s.slice(start,end);
 const rm=b.match(/\(0,([\w$]+)\.useRef\)\(null\)/);if(!rm)throw Error('Unsupported Codex picker React binding');const R=rm[1];
 b=b.slice(0,b.length-(retVar.length+2))+',codexSubagentWrap('+R+',codexSub,'+retVar+',e)}';
 b=sub(b,/permissionsHostId:([\w$]+)\}=e,/g,(m,x)=>'permissionsHostId:'+x+',codexSubagent:codexSub}=e,',1,'picker props');
 b=sub(b,/let ([\w$]+)=(\(0,[\w$]+\.[\w$]+\)\([\w$]+\)),\{modelSettings:([\w$]+),selectComposerModelAndReasoningEffort:/g,(m,v,call,ms)=>'let '+v+'=codexSubagentSelection('+R+',codexSub,'+call+'),{modelSettings:'+ms+',selectComposerModelAndReasoningEffort:',1,'picker model selection');
 b=sub(b,/(\(0,[\w$]+\.[\w$]+\))\("(composer\.(?:openModelPicker|toggleFastMode|increaseReasoningEffort|decreaseReasoningEffort|cycleReasoningEffort))",([\w$]+),([\w$]+)\)/g,(m,f,k,h,o)=>f+'("'+k+'",codexSubagentHotkey(codexSub,"'+k+'",'+h+'),codexSub?{enabled:!1}:'+o+')',5,'picker hotkeys');
 b=sub(b,/([\w$]+)=(\(0,[\w$]+\.[\w$]+\)\([\w$]+\.[\w$]+,"composer\.openModelPicker"\))/g,(m,v,call)=>v+'=codexSubagentShortcut(codexSub,'+call+')',1,'picker shortcut');
 {const lm=b.match(/serviceTierAccess:[\w$]+\}=\(0,[\w$]+\.[\w$]+\)\([\w$]+\),[\w$]+=\(0,[\w$]+\.[\w$]+\)\([\w$]+\.[\w$]+,[\w$]+\),[\w$]+=\(0,[\w$]+\.[\w$]+\)\(([\w$]+),([\w$]+)\)/);if(!lm)throw Error('Unsupported Codex picker model list');
  b=sub(b,/\{serviceTierSettings:([\w$]+),setServiceTier:([\w$]+)\}=(\(0,[\w$]+\.[\w$]+\)\([\w$]+,[\w$]+(?:\?\?[\w$]+)?\))/g,(m,a,c,call)=>'{serviceTierSettings:'+a+',setServiceTier:'+c+'}=codexSubagentTier(codexSub,'+call+','+lm[1]+','+lm[2]+')',1,'picker service tier');}
 {const dn=b.match(/displayName:([\w$]+\?[\w$]+\?\.displayName:[\w$]+\?\.displayName\?\?[\w$]+),serviceTierIconKind/);if(!dn)throw Error('Unsupported Codex picker model label');
  // The picker's own trigger (modelPickerTriggerConfig) renders selectedLabel; for the subagent instance it becomes the orchestrator label + model.
  b=sub(b,/selectedLabel:([\w$]+)\?(\(0,([\w$]+)\.jsxs\)\("span",\{className:"flex min-w-0 items-center gap-1",children:\[[\w$]+\?null:\(0,[\w$]+\.jsx\)\("span",\{"aria-hidden":"true",children:"🌙"\}\),(\(0,[\w$]+\.jsx\)\(([\w$]+\.P),\{model:([\w$]+),displayName:[\w$]+\?\.displayName,stripGptPrefix:!0\}\)),(\(0,[\w$]+\.jsx\)\([\w$]+\.O,\{collapse:"none",children:\(0,[\w$]+\.jsx\)\([\w$]+\.A,\{\.\.\.[\w$]+\.h\[[\w$]+\]\}\)\}\))\]\}\)):void 0,/g,(m,flag,whole,jsx,modelEl,comp,model,eff)=>'selectedLabel:codexSub?codexSubagentTriggerChild('+R+',(0,'+jsx+'.jsxs)("span",{className:"flex min-w-0 items-center gap-1",children:[(0,'+jsx+'.jsx)("span",{style:{color:"var(--color-text-primary)"},children:(0,'+jsx+'.jsx)('+comp+',{model:'+model+',displayName:'+dn[1]+',stripGptPrefix:!0,labelClassName:"'+textClass+'"})}),'+'codexSubagentEffort('+R+','+eff+')]})):'+flag+'?'+whole+':void 0,',1,'picker trigger label');}
 b=sub(b,/"data-composer-navigation-target":"reasoning"/g,()=>'"data-composer-navigation-target":codexSub?void 0:"reasoning"',3,'picker navigation target');
 b=sub(b,/\(0,([\w$]+)\.jsx\)\(([\w$]+\.[\w$]+),\{align:"end",disabled:/g,(m,j,k)=>'(0,'+j+'.jsx)('+k+',{codexMenuHeader:codexSub?codexSubagentHeader('+R+'):void 0,align:"end",disabled:',1,'picker menu header');
 s=anon?s.slice(0,start)+'codexPickerExport('+b+')'+s.slice(end):s.slice(0,start)+b+'try{window.__codexComposerModelPicker='+picker+'}catch(e){}'+s.slice(end);
 s=sub(s,/(shouldReduceMotion:[\w$]+,triggerButton:[\w$]+,triggerRef:[\w$]+)\}=e,/g,(m,x)=>x+',codexMenuHeader:codexMH}=e,',1,'dropdown header prop');
 s=sub(s,/(\(0,[\w$]+\.jsx\)\([\w$]+\.[\w$]+,\{)(active:[\w$]+,(?:compactAutoModel:"auto",selectedModel:[\w$]+,)?fallbackModelLabel:[\w$]+,isExplicitModelSelection:[\w$]+,menuFooter:)/g,(m,a,x)=>a+'menuHeader:codexMH,'+x,1,'dropdown menu header');
 s=sub(s,/(\(0,[\w$]+\.jsx\)\([\w$]+\.Y,\{)((?:compactAutoModel:"auto",)?contentRef:[\w$]+,disabled:[\w$]+,isExplicitModelSelection:[\w$]+,keepSimpleView:[\w$]+,menuFooter:)/g,(m,a,x)=>a+'menuHeader:codexMH,'+x,1,'dropdown unified menu header');
 return s+'\n'+helpers(BT)+'try{window.__codexModelTextClass="'+textClass+'"}catch(e){}\n';
}
function slider(s){
 if(s.includes('window.__codexNativeOrchPowerSlider'))return s;
 const m=[...s.matchAll(/function ([\w$]+)\(e\)\{let [\w$,]+=\(0,[\w$]+\.c\)\(\d+\),\{active:[\w$]+,disabled:[\w$]+,fastModeEnabled:[\w$]+,initialOptionId:[\w$]+,keyboardControlFocused:/g)];
 if(m.length!==1)throw Error('Unsupported Codex power slider ('+m.length+')');
 s=s.slice(0,m[0].index)+'try{window.__codexNativeOrchPowerSlider='+m[0][1]+'}catch(e){}'+s.slice(m[0].index);
 // The trigger's animated (blur) effort label lives in the same chunk; the orchestrator picker reuses it.
 const el=[...s.matchAll(/function ([\w$]+)\(e\)\{let [\w$,]+=\(0,[\w$]+\.c\)\(\d+\),\{reasoningEffort:[\w$]+,shouldReduceMotion:[\w$]+\}=e,/g)];
 if(el.length===1)s=s.slice(0,el[0].index)+'try{window.__codexNativeEffortLabel='+el[0][1]+'}catch(e){}'+s.slice(el[0].index);
 return s;
}
function helpers(BT){
 const K=BT+'codex-orchestrator-subagent-model-v1'+BT,CH=BT+'codex-orchestrator-change'+BT;
 return 'function codexSubagentHotkey(f,k,h){try{var r=window.__codexPickerHandlers=window.__codexPickerHandlers||{main:{},sub:{}};r[f?"sub":"main"][k]=h}catch(e){}return h}\n'+
 'function codexSubagentEffort(R,el){try{var S=window.__codexPickerSel&&window.__codexPickerSel.sub,e=S&&S.modelSettings&&S.modelSettings.reasoningEffort;var L=window.__codexNativeEffortLabel;if(e&&L){return R.createElement(L,{reasoningEffort:e,shouldReduceMotion:!!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)})}if(e!=="ultra")return el;if(!document.getElementById("damndots-max-effort")){var st=document.createElement("style");st.id="damndots-max-effort";st.textContent="[data-codex-max-effort],[data-codex-max-effort] *{color:var(--color-chart-purple)!important}";document.head.appendChild(st)}return R.createElement("span",{"data-codex-max-effort":"",className:"inline-flex"},el)}catch(x){return el}}'+
 'function codexSubagentShortcut(f,v){if(!f)return v;try{var c=window.__codexScrollControls;if(c&&c.enabled===false)return null}catch(e){}return /^tr/i.test(navigator.language)?"Kaydır · Ctrl+Kaydır":"Scroll · Ctrl+Scroll"}'+
 '\nfunction codexPickerExport(f){try{window.__codexComposerModelPicker=f}catch(e){}return f}'+
 '\nfunction codexSubagentWrap(R,flag,main,props){if(flag||props&&props.hideLabel)return main;let P=window.__codexComposerModelPicker,W=window.__codexOrchNativeWrap;return P&&W?W(R,main,P,props):main}'+
 '\nfunction codexSubagentTriggerChild(R,v){let C=window.__codexOrchTriggerLabel;return C?R.createElement(C,{model:v}):v}'+
 '\nfunction codexSubagentHeader(R){let C=window.__codexOrchMenuHeader;return C?R.createElement(C,null):void 0}'+
 '\nfunction codexSubagentRead(){try{return localStorage.getItem('+K+')||'+BT+BT+'}catch(e){return '+BT+BT+'}}'+
 '\nfunction codexSubagentSubscribe(f){window.addEventListener('+CH+',f);window.addEventListener('+BT+'storage'+BT+',f);return()=>{window.removeEventListener('+CH+',f);window.removeEventListener('+BT+'storage'+BT+',f)}}'+
 '\nfunction codexSubagentParse(){try{let v=JSON.parse(codexSubagentRead()||'+BT+'null'+BT+');return v&&typeof v==='+BT+'object'+BT+'?v:null}catch(e){return null}}'+
 '\nfunction codexSubagentWrite(p){let v={...(codexSubagentParse()??{}),...p};try{v.model||v.fast?localStorage.setItem('+K+',JSON.stringify({model:v.model??null,effort:v.effort??null,fast:!!v.fast})):localStorage.removeItem('+K+')}catch(e){}try{window.dispatchEvent(new Event('+CH+'))}catch(e){}}'+
 '\nfunction codexSubagentTier(flag,res,models,modelId){try{(window.__codexPickerModels=window.__codexPickerModels||{})[flag?"sub":"main"]={models:models,modelId:modelId}}catch(e){}if(!flag||res==null)return res;let s=res.serviceTierSettings,m=models?.find(e=>e.model===modelId),std=s?.availableOptions?.find(e=>e.value==null)??{description:null,iconKind:null,label:null,speedMultiplier:null,tier:null,value:null},opts=[std,...(m?.serviceTiers??[]).map(t=>({description:t.description??null,iconKind:t.id==='+BT+'priority'+BT+'||/fast/i.test(t.name??'+BT+BT+')?'+BT+'fast'+BT+':null,label:t.name??t.id,speedMultiplier:1.5,tier:t,value:t.id}))],v=codexSubagentParse(),fastOpt=opts.find(e=>e.iconKind==='+BT+'fast'+BT+'),sel=v?.fast&&fastOpt?fastOpt.value:null;return{...res,serviceTierSettings:{...s,availableOptions:opts,isLoading:!1,selectedServiceTier:sel,selectedServiceTierForModel:sel,serviceTierForRequest:sel},setServiceTier:e=>{codexSubagentWrite({fast:e!=null});return Promise.resolve(!0)}}}'+
 '\nfunction codexSubagentSelection(R,flag,real){let raw=R.useSyncExternalStore(codexSubagentSubscribe,codexSubagentRead);if(!flag){try{(window.__codexPickerSel=window.__codexPickerSel||{}).main=real}catch(e){}return real}let v=null;try{v=raw?JSON.parse(raw):null}catch(e){}let set=(m,eff,cb)=>{codexSubagentWrite({model:m||null,effort:eff??null});typeof cb==='+BT+'function'+BT+'&&cb();return Promise.resolve(!0)};let ms=v&&v.model?{...real.modelSettings,model:v.model,reasoningEffort:v.effort??null,isLoading:!1}:real.modelSettings;let out={...real,modelSettings:ms,selectComposerModelAndReasoningEffort:set,setModelAndReasoningEffort:(m,eff)=>set(m,eff),setDefaultModelAndReasoningEffort:(m,eff)=>set(m,eff),setModelAndReasoningEffortForNextTurn:(m,eff)=>set(m,eff)};try{(window.__codexPickerSel=window.__codexPickerSel||{}).sub=out}catch(e){}return out}\n';
}
