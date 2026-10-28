// Subagent model picker: reuse the native composer model picker component with subagent-scoped storage.
module.exports=function(s,lit,sub){
 const BT=String.fromCharCode(96);
 const head=[...s.matchAll(/function ([\w$]+)\(e\)\{let t=\(0,[\w$]+\.c\)\(\d+\),\{serviceTierDefaults:n,conversationId:r,hideLabel:i,home:a,permissionsCwdOverride:o,permissionsHostId:s\}=e,c=[\w$]+\([\w$]+\),(?:[\w$]+=\(0,[\w$]+\.use\)\([\w$]+\)!=null,)?[\w$]+=\(0,([\w$]+)\.useRef\)\(null\)/g)];
 if(head.length!==1)throw Error('composer model picker header matched '+head.length);
 const [hm,picker,R]=head[0];const start=head[0].index;
 const endRe=/return [\w$]+\}function Wet\(|,([\w$]+)\}function [\w$]+\(e\)\{let\{reasoningEffort:t\}=e;return t===\x60persistent\x60\}/g;endRe.lastIndex=start;const em=endRe.exec(s);if(!em)throw Error('composer model picker end missing');
 const end=em.index;let b=s.slice(start,end);
 b=lit(b,'permissionsHostId:s}=e,','permissionsHostId:s,codexSubagent:codexSub,codexConversationId:codexConv}=e,','picker props');
 b=sub(b,/let ([\w$]+)=([\w$]+)\(([\w$]+)\),\{modelSettings:([\w$]+),selectComposerModelAndReasoningEffort:/g,(m,v,f,a,ms)=>'let '+v+'=codexSubagentSelection('+R+',codexSub,'+f+'('+a+')),{modelSettings:'+ms+',selectComposerModelAndReasoningEffort:',1,'picker model selection');
 b=sub(b,/([\w$]+)\((\x60composer\.(?:openModelPicker|toggleFastMode|increaseReasoningEffort|decreaseReasoningEffort|cycleReasoningEffort)\x60),([\w$]+),([\w$]+)\)/g,(m,f,k,h,o)=>f+'('+k+','+h+',codexSub?{enabled:!1}:'+o+')',5,'picker hotkeys');
 b=sub(b,/([\w$]+)=([\w$]+)\(([\w$]+),\x60composer\.openModelPicker\x60\)/g,(m,v,f,a)=>v+'=codexSubagentShortcut(codexSub,'+f+'('+a+','+BT+'composer.openModelPicker'+BT+'))',1,'picker shortcut');
 {const lm=b.match(/,([\w$]+)=[\w$]+\?[\w$]+\?\.filter\([\w$]+\):[\w$]+;[\w$]+&&\(\1=[\w$]+==null\?\[\]:\[[\w$]+\]\);/);if(!lm)throw Error('picker model list missing');
  const im=b.match(/,([\w$]+)=[\w$]+\?[\w$]+\?\.model\?\?[\w$]+:[\w$]+,[\w$]+=[\w$]+\?[\w$]+\?\.filter\(/);if(!im)throw Error('picker model id missing');
  b=sub(b,/\{serviceTierSettings:([\w$]+),setServiceTier:([\w$]+)\}=([\w$]+)\(([\w$]+),([\w$]+)\)/g,(m,a,c,f,r,t)=>'{serviceTierSettings:'+a+',setServiceTier:'+c+'}=codexSubagentTier(codexSub,'+f+'('+r+','+t+'),'+lm[1]+','+im[1]+')',1,'picker service tier scope');}
 b=sub(b,/\(([\w$]+)=([\w$]+)\?\{availableAccess:/g,(m,v,l)=>'('+v+'='+l+'&&!codexSub?{availableAccess:',1,'picker daybreak');
 b=sub(b,/(onAnimationEnd:[\w$]+,children:\[[\w$]+,[\w$]+,[\w$]+,[\w$]+,)([\w$]+)\]/g,(m,pre,v)=>pre+'codexSub?codexSubagentTriggerChild('+R+','+v+'):'+v+']',1,'picker trigger label');
 b=sub(b,/\(0,([\w$]+)\.jsx\)\(([\w$]+),\{align:\x60end\x60,disabled:/g,(m,j,k)=>'(0,'+j+'.jsx)('+k+',{codexMenuHeader:codexSub?codexSubagentHeader('+R+'):void 0,align:'+BT+'end'+BT+',disabled:',1,'picker menu header');
 b=sub(b,/([\w$]+=[\w$]+\?\{)(openLabel:[\w$]+===\x60model\x60&&![\w$]+\?)/g,(m,a,x)=>a+'codexLeading:codexSub?codexSubagentTriggerChild('+R+',null):void 0,'+x,1,'picker trigger leading');
 const helper='\nfunction codexSubagentShortcut(f,v){return f?null:v}'+
 '\nfunction codexSubagentTriggerChild(R,v){let C=window.__codexOrchTriggerLabel;return C?R.createElement(C,{model:v}):v}'+
 '\nfunction codexSubagentHeader(R){let C=window.__codexOrchMenuHeader;return C?R.createElement(C,null):void 0}'+
 '\nfunction codexSubagentRead(){try{return localStorage.getItem('+BT+'codex-orchestrator-subagent-model-v1'+BT+')||'+BT+BT+'}catch(e){return '+BT+BT+'}}'+
 '\nfunction codexSubagentSubscribe(f){window.addEventListener('+BT+'codex-orchestrator-change'+BT+',f);window.addEventListener('+BT+'storage'+BT+',f);return()=>{window.removeEventListener('+BT+'codex-orchestrator-change'+BT+',f);window.removeEventListener('+BT+'storage'+BT+',f)}}'+
 '\nfunction codexSubagentParse(){try{let v=JSON.parse(codexSubagentRead()||'+BT+'null'+BT+');return v&&typeof v==='+BT+'object'+BT+'?v:null}catch(e){return null}}'+
'\nfunction codexSubagentWrite(p){let v={...(codexSubagentParse()??{}),...p};try{v.model||v.fast?localStorage.setItem('+BT+'codex-orchestrator-subagent-model-v1'+BT+',JSON.stringify({model:v.model??null,effort:v.effort??null,fast:!!v.fast})):localStorage.removeItem('+BT+'codex-orchestrator-subagent-model-v1'+BT+')}catch(e){}try{window.dispatchEvent(new Event('+BT+'codex-orchestrator-change'+BT+'))}catch(e){}}'+
'\nfunction codexSubagentTier(flag,res,models,modelId){if(!flag||res==null)return res;let s=res.serviceTierSettings,m=models?.find(e=>e.model===modelId),std=s?.availableOptions?.find(e=>e.value==null)??{description:null,iconKind:null,label:null,speedMultiplier:null,tier:null,value:null},opts=[std,...(m?.serviceTiers??[]).map(t=>({description:t.description??null,iconKind:t.id==='+BT+'priority'+BT+'||/fast/i.test(t.name??'+BT+BT+')?'+BT+'fast'+BT+':null,label:t.name??t.id,speedMultiplier:1.5,tier:t,value:t.id}))],v=codexSubagentParse(),fastOpt=opts.find(e=>e.iconKind==='+BT+'fast'+BT+'),sel=v?.fast&&fastOpt?fastOpt.value:null;return{...res,serviceTierSettings:{...s,availableOptions:opts,isLoading:!1,selectedServiceTier:sel,selectedServiceTierForModel:sel,serviceTierForRequest:sel},setServiceTier:e=>{codexSubagentWrite({fast:e!=null});return Promise.resolve(!0)}}}'+
'\nfunction codexSubagentSelection(R,flag,real){let raw=R.useSyncExternalStore(codexSubagentSubscribe,codexSubagentRead);if(!flag)return real;let v=null;try{v=raw?JSON.parse(raw):null}catch(e){}let set=(m,eff,cb)=>{codexSubagentWrite({model:m||null,effort:eff??null});typeof cb==='+BT+'function'+BT+'&&cb();return Promise.resolve(!0)};let ms=v&&v.model?{...real.modelSettings,model:v.model,reasoningEffort:v.effort??null,isLoading:!1}:real.modelSettings;return{...real,modelSettings:ms,selectComposerModelAndReasoningEffort:set,setModelAndReasoningEffort:(m,eff)=>set(m,eff),setDefaultModelAndReasoningEffort:(m,eff)=>set(m,eff),setModelAndReasoningEffortForNextTurn:(m,eff)=>set(m,eff)}}'+
 '\ntry{window.__codexComposerModelPicker='+picker+'}catch(e){}';
 s=s.slice(0,start)+b+s.slice(end);
 s=sub(s,/(serviceTierOptionsLoading:[\w$]+,showReasoningEffortControls:[\w$]+,shouldReduceMotion:[\w$]+,triggerButton:[\w$]+)\}=e,/g,(m,x)=>x+',codexMenuHeader:codexMH}=e,',1,'dropdown header prop');
 s=sub(s,/(\(0,[\w$]+\.jsx\)\([\w$]+,\{)(active:[\w$]+,fallbackModelLabel:[\w$]+,isExplicitModelSelection:[\w$]+,menuFooter:[\w$]+,)/g,(m,a,x)=>a+'menuHeader:codexMH,'+x,1,'dropdown menu header');
 s=sub(s,/(\(0,[\w$]+\.jsx\)\([\w$]+,\{)(contentRef:[\w$]+,disabled:[\w$]+,isExplicitModelSelection:[\w$]+,menuFooter:[\w$]+,menuView:)/g,(m,a,x)=>a+'menuHeader:codexMH,'+x,1,'dropdown legacy header');
 s=sub(s,/(\{color:[\w$]+,contentRef:[\w$]+,daybreakAnimation:[\w$]+,hideChevron:[\w$]+,hideLabel:[\w$]+,isOpen:[\w$]+,limited:[\w$]+,minimumContentWidth:[\w$]+,openLabel:[\w$]+,placeholderMeasurementRef:[\w$]+,selectedLabel:[\w$]+,selectedLabelCandidate:[\w$]+,selectedServiceTierIconKind:[\w$]+,shortcut:[\w$]+,shouldReduceMotion:[\w$]+,showDaybreakIndicator:[\w$]+,showOpenLabel:[\w$]+,size:[\w$]+,tooltipContent:[\w$]+,tooltipOpen:[\w$]+,triggerRef:[\w$]+,)(\.\.\.[\w$]+\}=e)/g,(m,a,x)=>a+'codexLeading:codexLead,'+x,1,'trigger leading prop');
 s=sub(s,/,([\w$]+==null\?\(0,[\w$]+\.jsx\)\(\x60span\x60,\{className:[\w$]+\.ModelPickerTriggerModelLabel,)/g,(m,x)=>',codexLead??null,'+x,1,'trigger leading slot');
 return s+helper;
};


// Expose the same native Ultra slider for the orchestrator header.
const codexBaseSubpicker=module.exports;module.exports=function(...args){let s=codexBaseSubpicker(...args);const m=[...s.matchAll(/function (\w+)\(e\)\{let t=\(0,\w+\.c\)\(\d+\),\{active:n,disabled:r,fastModeEnabled:i,initialOptionId:a,keyboardControlFocused:o,/g)];if(m.length!==1)throw Error('native power slider anchor mismatch');return s+'\ntry{window.__codexNativeOrchPowerSlider='+m[0][1]+'}catch(e){}\n';};

const codexLabelBase=module.exports;function moveLabel(s){
 const before=',codexLead??null,';
 if(s.split(before).length!==2)throw Error('leading label anchor');
 s=s.replace(before,',');
 const re=/(reasoningEffort:[\w$]+\.reasoningEffort,shouldReduceMotion:[\w$]+\}\):null)(\]\},\x60selection\x60)/g;
 if([...s.matchAll(re)].length!==1)throw Error('trailing label anchor');
 return s.replace(re,(_,a,b)=>a+',codexLead??null'+b);
};module.exports=function(...a){return moveLabel(codexLabelBase(...a))};
