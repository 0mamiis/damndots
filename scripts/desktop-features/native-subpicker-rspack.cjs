'use strict';
// Codex 26.1029+ (Rspack): turn the native composer model picker into the orchestrator / subagent picker.
// The primary picker renders a second instance of itself (codexSubagent) next to it, so the instance keeps the
// application's own providers, hooks and styling. The old (Vite) variant lives in native-subpicker.cjs.
module.exports={picker,slider};
function picker(s,lit,sub,textClass){
 const BT=String.fromCharCode(96);
 const head=[...s.matchAll(/([\w$]+:)?function(?: ([\w$]+))?\(e\)\{let [\w$,]+=\(0,[\w$]+\.c\)\(\d+\),\{serviceTierDefaults:[\w$]+,conversationId:[\w$]+,hasThreadResumeFailed:[\w$]+,hideLabel:[\w$]+,home:[\w$]+,(?:isCodexHome|surfacePlacement):[\w$]+,permissionsCwdOverride:[\w$]+,permissionsHostId:[\w$]+\}=e,/g)];
 if(head.length!==1)throw Error('Unsupported Codex composer model picker header ('+head.length+')');
 const picker=head[0][2],start=head[0].index+(head[0][1]?head[0][1].length:0),anon=!head[0][2];
 const endRe=anon?/,([\w$]+)\}\}\)\},[\w$]+(?::\(function)?\(e,[\w$]+,[\w$]+\)\{/g:/,([\w$]+)\}function [\w$]+\(e\)\{let\{reasoningEffort:[\w$]+\}=e;return"persistent"===[\w$]+\}/g;endRe.lastIndex=start;
 const em=endRe.exec(s);if(!em)throw Error('Unsupported Codex composer model picker end');
 const retVar=em[1],end=em.index+1+retVar.length+1;
 let b=s.slice(start,end);
 const rm=b.match(/\(0,([\w$]+)\.useRef\)\(null\)/);if(!rm)throw Error('Unsupported Codex picker React binding');const R=rm[1];
 b=b.slice(0,b.length-(retVar.length+2))+',codexSubagentWrap('+R+',codexSub,'+retVar+',e)}';
 b=sub(b,/permissionsHostId:([\w$]+)\}=e,/g,(m,x)=>'permissionsHostId:'+x+',codexSubagent:codexSub}=e,',1,'picker props');
 b=sub(b,/let ([\w$]+)=(\(0,[\w$]+\.[\w$]+\)\([\w$]+\)),\{modelSettings:([\w$]+),selectComposerModelAndReasoningEffort:/g,(m,v,call,ms)=>'let '+v+'=codexSubagentSelection('+R+',codexSub,'+call+',e.conversationId),{modelSettings:'+ms+',selectComposerModelAndReasoningEffort:',1,'picker model selection');
 b=wrapHotkeys(b);
 b=sub(b,/([\w$]+)=(\(0,[\w$]+\.[\w$]+\)\([\w$]+\.[\w$]+,"composer\.openModelPicker"\))/g,(m,v,call)=>v+'=codexSubagentShortcut(codexSub,'+call+')',1,'picker shortcut');
 {const lm=b.match(/serviceTierAccess:[\w$]+\}=\(0,[\w$]+\.[\w$]+\)\([\w$]+\),[\w$]+=\(0,[\w$]+\.[\w$]+\)\([\w$]+\.[\w$]+,[\w$]+\),[\w$]+=\(0,[\w$]+\.[\w$]+\)\(([\w$]+),([\w$]+)\)/);if(!lm)throw Error('Unsupported Codex picker model list');
  b=sub(b,/\{serviceTierSettings:([\w$]+),setServiceTier:([\w$]+)\}=(\(0,[\w$]+\.[\w$]+\)\([\w$.,?\s]+\))/g,(m,a,c,call)=>'{serviceTierSettings:'+a+',setServiceTier:'+c+'}=codexSubagentTier(codexSub,'+call+','+lm[1]+','+lm[2]+')',1,'picker service tier');}
 {const dn=b.match(/displayName:([\w$]+\?[\w$]+\?\.displayName:[\w$]+\?\.displayName\?\?[\w$]+),serviceTierIconKind/)||b.match(/\{model:[\w$]+,displayName:([\w$]+),serviceTierIconKind:[\w$]+,stripGptPrefix:!0\}/);if(!dn)throw Error('Unsupported Codex picker model label');
  // The picker's own trigger (modelPickerTriggerConfig) renders selectedLabel; for the subagent instance it becomes the orchestrator label + model.
  b=sub(b,/selectedLabel:([\w$]+)\?(\(0,([\w$]+)\.jsxs\)\("span",\{className:"flex min-w-0 items-center gap-1",children:\[[\w$]+\?null:\(0,[\w$]+\.jsx\)\("span",\{"aria-hidden":"true",children:(?:"🌙"|"\\u\{1F319\}")\}\),(\(0,[\w$]+\.jsx\)\(([\w$]+\.P),\{model:([\w$]+),displayName:[\w$]+\?\.displayName,stripGptPrefix:!0\}\)),(\(0,[\w$]+\.jsx\)\([\w$]+\.O,\{collapse:"none",children:\(0,[\w$]+\.jsx\)\([\w$]+\.A,\{\.\.\.[\w$]+\.h\[([\w$]+)\]\}\)\}\))\]\}\)):void 0,/g,(m,flag,whole,jsx,modelEl,comp,model,eff,effVar)=>'selectedLabel:codexSub?codexSubagentTriggerChild('+R+',(0,'+jsx+'.jsxs)("span",{className:"flex min-w-0 items-center gap-1",children:[(0,'+jsx+'.jsx)("span",{style:{color:"var(--color-text-primary)"},children:codexSubagentModel('+R+','+comp+',{model:'+model+',displayName:'+dn[1]+',stripGptPrefix:!0,labelClassName:"'+textClass+'"})}),'+'codexSubagentEffort('+R+','+eff+','+effVar+')]})):'+flag+'?'+whole+':void 0,',1,'picker trigger label');}
 b=sub(b,/"data-composer-navigation-target":"reasoning"/g,()=>'"data-composer-navigation-target":codexSub?void 0:"reasoning"',3,'picker navigation target');
 b=sub(b,/\(0,([\w$]+)\.jsx\)\(([\w$]+\.[\w$]+),\{((?:openTiming:[\w$]+,)?align:"end",disabled:[\w$]+,headerShortcut:[\w$]+,daybreak:[\w$]+,contentRef:[\w$]+,triggerRef:([\w$]+),)/g,(m,j,k,rest,tref)=>'(0,'+j+'.jsx)('+k+',{codexMenuHeader:(codexBindTrigger('+tref+'),codexSub?codexSubagentHeader('+R+'):void 0),'+rest,1,'picker menu header');
 s=anon?s.slice(0,start)+'codexPickerExport('+b+')'+s.slice(end):s.slice(0,start)+b+'try{window.__codexComposerModelPicker='+picker+'}catch(e){}'+s.slice(end);
 s=sub(s,/(shouldReduceMotion:[\w$]+,triggerButton:[\w$]+,triggerRef:[\w$]+)\}=e,/g,(m,x)=>x+',codexMenuHeader:codexMH}=e,',1,'dropdown header prop');
 s=sub(s,/(\(0,[\w$]+\.jsx\)\([\w$]+\.[\w$]+,\{)(active:[^,]+,(?:openTiming:[^,]+,selectionTiming:[^,]+,triggerRef:[\w$]+,)?(?:compactAutoModel:"auto",selectedModel:[\w$]+,)?fallbackModelLabel:[\w$]+,isExplicitModelSelection:(?:[\w$]+|"model"===[\w$]+),menuFooter:)/g,(m,a,x)=>a+'menuHeader:codexMH,'+x,1,'dropdown menu header');
 s=sub(s,/(\(0,[\w$]+\.jsx\)\([\w$]+\.Y,\{)((?:openTiming:[\w$]+,selectionTiming:[\w$]+,)?(?:compactAutoModel:"auto",)?contentRef:[\w$]+,disabled:[\w$]+,isExplicitModelSelection:(?:[\w$]+|"model"===[\w$]+),keepSimpleView:(?:[\w$]+|null!=[\w$]+),menuFooter:)/g,(m,a,x)=>a+'menuHeader:codexMH,'+x,1,'dropdown unified menu header');
 return s+'\n'+helpers(BT)+'try{window.__codexModelTextClass="'+textClass+'"}catch(e){}\n';
}
function wrapHotkeys(src){
 const startRe=/(\(0,[\w$]+\.[\w$]+\))\("(composer\.(?:openModelPicker|toggleFastMode|increaseReasoningEffort|decreaseReasoningEffort|cycleReasoningEffort))",/g;
 const matches=[...src.matchAll(startRe)];
 if(matches.length!==5)throw Error('Unsupported Codex picker hotkeys');
 let out='',pos=0;
 for(const m of matches){
  const argStart=m.index+m[0].length;
  let i=argStart,depth=0,q=null,esc=false,comma1=-1,end=-1;
  for(;i<src.length;i++){
   const c=src[i];
   if(q){if(esc)esc=false;else if(c==='\\')esc=true;else if(c===q)q=null;continue;}
   if(c==='"'||c==='\''||c==='`'){q=c;continue;}
   if(c==='('||c==='{'||c==='[')depth++;
   else if(c===')'||c==='}'||c===']'){if(depth===0&&c===')'){end=i;break;}depth--;}
   else if(c===','&&depth===0&&comma1<0)comma1=i;
  }
  if(comma1<0||end<0)throw Error('Unsupported Codex picker hotkeys');
  out+=src.slice(pos,m.index)+m[1]+'("'+m[2]+'",codexSubagentHotkey(codexSub,"'+m[2]+'",'+src.slice(argStart,comma1)+'),codexSub?{enabled:!1}:'+src.slice(comma1+1,end)+')';
  pos=end+1;
 }
 return out+src.slice(pos);
}
function slider(s){
 if(s.includes('window.__codexNativeOrchPowerSlider'))return s;
 const m=[...s.matchAll(/function ([\w$]+)\(e\)\{let [\w$,]+=\(0,[\w$]+\.c\)\(\d+\),\{active:[\w$]+,disabled:[\w$]+,(?:fastModeEnabled|serviceTier):[\w$]+,initialOptionId:[\w$]+,keyboardControlFocused:/g)];
 if(m.length!==1)throw Error('Unsupported Codex power slider ('+m.length+')');
 s=s.slice(0,m[0].index)+'try{window.__codexNativeOrchPowerSlider='+m[0][1]+'}catch(e){}'+s.slice(m[0].index);
 // The trigger's animated (blur) effort label lives in the same chunk; the orchestrator picker reuses it.
 const el=[...s.matchAll(/function ([\w$]+)\(e\)\{let [\w$,]+=\(0,[\w$]+\.c\)\(\d+\),\{(?:className:[\w$]+,)?reasoningEffort:[\w$]+,shouldReduceMotion:[\w$]+\}=e,/g)];
 if(el.length===1)s=s.slice(0,el[0].index)+'try{window.__codexNativeEffortLabel='+el[0][1]+'}catch(e){}'+s.slice(el[0].index);
 // The label animates with this spring timing; the orchestrator mode text reuses the exact same options.
 const an=[...s.matchAll(/,([\w$]+)=\{duration:[\w$]+,easing:\(0,[\w$]+\.[\w$]+\)\(e=>[\w$]+\.next\(e\*[\w$]+\)\.value,[\w$]+\),fill:"both"\};/g)];
 if(an.length===1){const at=an[0].index+an[0][0].length;s=s.slice(0,at)+'try{window.__codexNativeEffortAnim='+an[0][1]+'}catch(e){}'+s.slice(at);}
 s=patchAnimatedModelLabel(s);
 return s;
}
function patchAnimatedModelLabel(s){
 const legacyEffRe=/function ([\w$]+)\(e\)\{let [\w$,]+=\(0,[\w$]+\.c\)\(\d+\),\{reasoningEffort:[\w$]+,shouldReduceMotion:[\w$]+\}=e,[\w$]+=\(0,([\w$]+\.[\w$]+)\)\(\),[\w$]+=\(0,([\w$]+)\.useRef\)\(null\)[\s\S]{1,1200}?!\(0,([\w$]+\.[\w$]+)\)\(\)\?\{\.\.\.([\w$]+),easing:"ease-out"\}:[\w$]+;[\s\S]{1,400}?useEffectEvent\)\([\w$]+\);[\s\S]{1,200}?=\(0,([\w$]+\.[\w$]+)\)\([\w$]+\);[\s\S]{1,900}?=\(0,([\w$]+\.[\w$]+)\)\([\w$]+,[\w$]+\)[\s\S]{1,400}?className:"(ModelPickerTriggerEffortViewport-[\w-]+)",children:\(0,([\w$]+)\.jsx\)\("span",\{ref:[\w$]+,className:"(ModelPickerTriggerEffortLayers-[\w-]+)"[\s\S]{1,300}?\(0,[\w$]+\.jsxs\)\(([\w$]+\.[\w$]+),\{ref:[\w$]+,className:"(ModelPickerTriggerEffortLabel-[\w-]+)",collapse:"none"[\s\S]{1,300}?function [\w$]+\(e\)\{let\[[\w$]+,[\w$]+\]=e;return\(0,[\w$]+\.jsx\)\("span",\{className:"(ModelPickerTriggerEffortText-[\w-]+)"[\s\S]{1,300}?function ([\w$]+)\(e\)\{return e\.cancel\(\)\}function ([\w$]+)\(e\)\{e\.onfinish=null;[\s\S]{1,300}?e\.cancel\(\)\}/;
 // 26.1111 moved the trigger classes into a css-module namespace: className:y.A.ModelPickerTriggerEffortViewport
 const modernEffRe=/function ([\w$]+)\(e\)\{let [\w$,]+=\(0,[\w$]+\.c\)\(\d+\),\{(?:className:[\w$]+,)?reasoningEffort:[\w$]+,shouldReduceMotion:[\w$]+\}=e,[\w$]+=\(0,([\w$]+\.[\w$]+)\)\(\),[\w$]+=\(0,([\w$]+)\.useRef\)\(null\),[\w$]+=\(0,[\w$]+\.useRef\)\(null\)[\s\S]{1,2600}?!\(0,([\w$]+\.[\w$]+)\)\(\)\?\{\.\.\.([\w$]+),easing:"ease-out"\}:[\w$]+;[\s\S]{1,1000}?useEffectEvent\)\([\w$]+\);[\s\S]{1,1000}?=\(0,([\w$]+\.[\w$]+)\)\([\w$]+\);[\s\S]{1,1000}?=\(0,([\w$]+\.[\w$]+)\)\([\w$]+,[\w$]+\)[\s\S]{1,2600}?className:[\w$]+\.A\.ModelPickerTriggerEffortViewport,children:\(0,([\w$]+)\.jsx\)\("span",\{ref:[\w$]+,className:[\w$]+\.A\.ModelPickerTriggerEffortLayers,children:[\w$]+\}\)\}\)[\s\S]{1,800}?=\(0,[\w$]+\.jsxs\)\(([\w$]+\.[\w$]+),\{ref:[\w$]+,className:(?:[\w$]+\.A\.ModelPickerTriggerEffortLabel|[\w$]+),collapse:"none"[\s\S]{1,800}?function [\w$]+\(e\)\{let\[[\w$]+,[\w$]+\]=e;return\(0,[\w$]+\.jsx\)\("span",\{className:[\w$]+\.A\.ModelPickerTriggerEffortText[\s\S]{1,800}?function ([\w$]+)\(e\)\{return e\.cancel\(\)\}function ([\w$]+)\(e\)\{e\.onfinish=null;/;
 const legacyMatch=s.match(legacyEffRe),modernMatch=legacyMatch?null:s.match(modernEffRe);
 if(!legacyMatch&&!modernMatch)throw Error('Unsupported Codex animated effort label');
 const cls=n=>{const x=s.match(new RegExp(n+':"([^"]+)"'));if(!x)throw Error('Unsupported Codex effort class '+n);return x[1]};
 let effFn,useIntl,R,linEasing,animOpts,useRO,mergeRefs,viewportCls,jsxMod,layersCls,collapseComp,labelCls,textCls,cancelFn,commitFn;
 if(legacyMatch){[,effFn,useIntl,R,linEasing,animOpts,useRO,mergeRefs,viewportCls,jsxMod,layersCls,collapseComp,labelCls,textCls,cancelFn,commitFn]=legacyMatch;}
 else{[,effFn,useIntl,R,linEasing,animOpts,useRO,mergeRefs,jsxMod,collapseComp,cancelFn,commitFn]=modernMatch;
  viewportCls=cls('ModelPickerTriggerEffortViewport');layersCls=cls('ModelPickerTriggerEffortLayers');labelCls=cls('ModelPickerTriggerEffortLabel');textCls=cls('ModelPickerTriggerEffortText');}
 const legacyTrigRe=/(className:"(ModelPickerTriggerModelLabel-[\w-]+)",children:\(0,[\w$]+\.jsx\)\()([\w$]+\.P)(,\{model:([\w$]+)\.model,displayName:[\w$]+\.modelLabel,labelClassName:"(ModelPickerTriggerModelText-[\w-]+)",stripGptPrefix:!0)(\}\)\}\):\(0,[\w$]+\.jsx\)\("span",\{className:\(0,[\w$]+\.[\w$]+\)\("min-w-0 truncate",null!=[\w$]+&&[\w$]+\.[\w$]+\.Foreground\),children:[\w$]+\}\)\]\}\),null==[\w$]+&&[\w$]+\?\(0,[\w$]+\.jsx\)\([\w$]+,\{reasoningEffort:[\w$]+\.reasoningEffort,shouldReduceMotion:([\w$]+)\}\):null)/;
 let modelComp,modelLabelWrapCls,srmVar;
 const legacyTrigger=s.match(legacyTrigRe);
 if(legacyTrigger){modelComp=legacyTrigger[3];modelLabelWrapCls=legacyTrigger[2];srmVar=legacyTrigger[8];
  s=s.replace(legacyTrigRe,(_,p1,_c1,_mc,p4,_w,_mt,p7,srm)=>p1+'codexNativeModelLabel'+p4+',shouldReduceMotion:'+srm+p7);}
 else{
  const lt=s.match(/(className:(?:([\w$]+)\.A\.ModelPickerTriggerModelLabel|\(0,[\w$]+\.[\w$]+\)\(([\w$]+)\.A\.ModelPickerTriggerModelLabel,[^}]+?\))(?:,"data-model-selection-label":[\w$]+\.model)?,children:\(0,([\w$]+)\.jsx\)\()([\w$]+\.P)(,\{model:[\w$]+\.model,displayName:[\w$]+\.modelLabel,labelClassName:[\w$]+\.A\.ModelPickerTriggerModelText,stripGptPrefix:!0\})/);
  if(!lt)throw Error('Unsupported Codex trigger model label');
  const near=s.slice(lt.index,lt.index+1800).match(/\(0,[\w$]+\.jsx\)\(([\w$]+),\{(?:className:[^,]+,)?reasoningEffort:[\w$]+\.reasoningEffort,shouldReduceMotion:([\w$]+)\}\)/);
  if(!near)throw Error('Unsupported Codex trigger effort call');
  modelComp=lt[5];modelLabelWrapCls=cls('ModelPickerTriggerModelLabel');srmVar=near[2];
  s=s.replace(lt[0],lt[1]+'codexNativeModelLabel'+lt[6].replace(/\}$/,',shouldReduceMotion:'+srmVar+'}'));}
 const css='.'+labelCls+'[data-codex-model-blur-label]{color:var(--daybreak-text,var(--color-text))}.'+modelLabelWrapCls+':has([data-codex-model-blur-label]),span.truncate:has([data-codex-orchestrator-label]),[data-codex-orchestrator-label]{overflow:visible}';
 const compCode='function codexNativeModelLabel(e){'+
  'if(typeof document!=="undefined"&&!document.getElementById("damndots-model-blur")){var st=document.createElement("style");st.id="damndots-model-blur";st.textContent='+JSON.stringify(css)+';document.head.appendChild(st)}'+
  'let $m=String(e.model??""),$rm=!!(e.shouldReduceMotion??(typeof window!=="undefined"&&window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)),$intl=(0,'+useIntl+')(),$el=(0,'+R+'.useRef)(null),$layers=(0,'+R+'.useRef)(null),$anims=(0,'+R+'.useRef)([]),$last=(0,'+R+'.useRef)(null),$prev=(0,'+R+'.useRef)(null),$knownRef=(0,'+R+'.useRef)(null),[,setTick]=(0,'+R+'.useState)(0);'+
  'if(!$knownRef.current)$knownRef.current=new Map();'+
  'let $known=$knownRef.current,$cat=(typeof window!=="undefined"&&window.__codexPickerModels&&(window.__codexPickerModels.main?.models||window.__codexPickerModels.sub?.models))||[];'+
  'for(let $mi of $cat){if($mi&&$mi.model&&!$mi.hidden){let $id=String($mi.model),$prevItem=$known.get($id);$known.set($id,{model:$mi.model,displayName:$mi.displayName??($id===$m?e.displayName:$prevItem?.displayName),serviceTierIconKind:$id===$m?(e.serviceTierIconKind??null):($prevItem?.serviceTierIconKind??null)});}}'+
  'let $disp=$known.get($m)?.displayName??e.displayName;$known.set($m,{model:e.model,displayName:$disp,serviceTierIconKind:e.serviceTierIconKind??null});'+
  'let $sync=()=>{let $root=$el.current,$layerEl=$layers.current;if(null==$root||null==$layerEl)return;let $nodes=Array.from($layerEl.querySelectorAll("[data-codex-model-slug]")),$active=$nodes.find($node=>$node.dataset.codexModelSlug===$m);if(null==$active)return;let $width=parseFloat(getComputedStyle($active).width);if(!($width>0)){for(let $node of $nodes){$node.style.opacity=$node===$active?"1":"0";$node.style.filter=$node===$active?"blur(0px)":"";}return;}let $key=$m+":"+$width+":"+$rm+":"+($disp??"")+":"+(e.serviceTierIconKind??"");if($last.current?.key===$key)return;let $animate=null!=$last.current&&$last.current.model!==$m&&!$rm;$last.current={key:$key,model:$m},$anims.current.forEach('+commitFn+');let $blur=getComputedStyle($layerEl).getPropertyValue("--blur-xs")||"4px",$targets=[[$root,{width:$width+"px"}],...$nodes.map($node=>[$node,{opacity:$node===$active?"1":"0",filter:$node===$active?"blur(0px)":"blur("+$blur+")"}])],$opts=$animate&&!(0,'+linEasing+')()?{...'+animOpts+',easing:"ease-out"}:'+animOpts+';$anims.current=$targets.flatMap($pair=>{let[$node,$style]=$pair;if(!$animate)return Object.assign($node.style,$style),[];let $cs=getComputedStyle($node);if($style.opacity==="0"&&parseFloat($cs.getPropertyValue("opacity"))===0)return Object.assign($node.style,$style),[];let $from=Object.fromEntries(Object.keys($style).map($k=>[$k,$cs.getPropertyValue($k)])),$anim=$node.animate([$from,$style],$opts);return $anim.onfinish=()=>'+commitFn+'($anim),[$anim]});};'+
  'let $effect=(0,'+R+'.useEffectEvent)($sync),$ro=(0,'+useRO+')(()=>$sync());'+
  '(0,'+R+'.useLayoutEffect)(()=>{($prev.current?.model!==$m||$prev.current.displayName!==$disp||$prev.current.icon!==(e.serviceTierIconKind??null)||$prev.current.shouldReduceMotion!==$rm||$prev.current.intl!==$intl)&&($prev.current={model:$m,displayName:$disp,icon:e.serviceTierIconKind??null,shouldReduceMotion:$rm,intl:$intl},$effect())},[$m,$disp,e.serviceTierIconKind,$rm,$intl]);'+
  '(0,'+R+'.useLayoutEffect)(()=>{let $fn=()=>setTick($x=>$x+1);window.addEventListener("codex-models-loaded",$fn);return()=>{window.removeEventListener("codex-models-loaded",$fn);$anims.current.forEach('+cancelFn+');$last.current=null}},[]);'+
  'let $items=Array.from($known.entries()).map(([$mid,$item])=>(0,'+jsxMod+'.jsx)("span",{className:"'+textCls+'","aria-hidden":!0,"data-codex-model-slug":$mid,children:(0,'+jsxMod+'.jsx)('+modelComp+',{model:$item.model,displayName:$item.displayName,labelClassName:e.labelClassName,serviceTierIconKind:$item.serviceTierIconKind,stripGptPrefix:e.stripGptPrefix})},$mid));'+
  'return(0,'+jsxMod+'.jsxs)('+collapseComp+',{ref:$el,className:"'+labelCls+'","data-codex-model-blur-label":"",collapse:"none",children:[(0,'+jsxMod+'.jsx)("span",{className:"sr-only",children:(0,'+jsxMod+'.jsx)('+modelComp+',{model:e.model,displayName:$disp,stripGptPrefix:e.stripGptPrefix})}),(0,'+jsxMod+'.jsx)("span",{className:"'+viewportCls+'",children:(0,'+jsxMod+'.jsx)("span",{ref:(0,'+mergeRefs+')($layers,$ro),className:"'+layersCls+'",children:$items})})]})'+
 '}try{window.__codexNativeModelLabel=codexNativeModelLabel;window.__codexNativeEffortClasses={Label:"'+labelCls+'",Viewport:"'+viewportCls+'",Layers:"'+layersCls+'",Text:"'+textCls+'"}}catch(e){}';
 const at=(modernMatch||legacyMatch).index;
 s=s.slice(0,at)+compCode+s.slice(at);
 return s;
}
function helpers(BT){
 const CH=BT+'codex-orchestrator-change'+BT;
 return 'function codexSubScope(cid){if(typeof window.__codexScopeFromConvId==="function")return window.__codexScopeFromConvId(cid);if(cid==null||cid==="")return "draft:new";var r=String(cid).trim().replace(/^codex:thread:/i,"").replace(/^(?:local|cloud|chatgpt|remote):/i,"");if(!r||r==="home"||r==="panel"||/^(?:draft|client-new-thread|gpt-draft|preview|library-preview|new):/i.test(r))return "draft:new";return r}\n'+
 'function codexSubKey(sc){var s=sc||window.__codexSubScopeOverride;if(!s){try{s=window.__codexOrchScope&&window.__codexOrchScope()}catch(e){}}return "codex-orchestrator-subagent-model-v2:"+(s||"draft:new")}\n'+
 'function codexBindTrigger(tk){try{var inst=window.__codexCurrentInst;if(inst&&tk){inst.tk=tk;if(tk.current){tk.current.__codexInst=inst;if(inst.scope)tk.current.setAttribute("data-codex-scope",inst.scope)}(window.__codexInstList=window.__codexInstList||new Set()).add(inst)}}catch(e){}}\n'+
 'function codexSubagentHotkey(f,k,h){try{var r=window.__codexPickerHandlers=window.__codexPickerHandlers||{main:{},sub:{}};r[f?"sub":"main"][k]=h;if(window.__codexCurrentInst)window.__codexCurrentInst.handlers[k]=h}catch(e){}return h}\n'+
 'function codexSubagentModelView(p){var M=window.__codexNativeModelLabel||p.Comp;return p.R.createElement(M,p)}\n'+
 'function codexSubagentModel(R,Comp,props){return R.createElement(codexSubagentModelView,{...props,Comp:Comp,R:R})}\n'+
 'function codexSubagentEffortView(p){var L=window.__codexNativeEffortLabel;if(p.eff&&L)return p.R.createElement(L,{reasoningEffort:p.eff,shouldReduceMotion:!!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)});return p.el}\n'+
 'function codexSubagentEffort(R,el,eff){try{var inst=window.__codexCurrentInst,S=(inst&&inst.sel)||(window.__codexPickerSel&&window.__codexPickerSel.sub),e=eff||(S&&S.modelSettings&&S.modelSettings.reasoningEffort);return R.createElement(codexSubagentEffortView,{R:R,el:el,eff:e})}catch(x){return el}}'+
 'function codexSubagentShortcut(f,v){if(!f)return v;try{var c=window.__codexScrollControls;if(c&&c.enabled===false)return null}catch(e){}return /^tr/i.test(navigator.language)?"Ctrl+Kaydır":"Ctrl+Scroll"}'+
 '\nfunction codexPickerExport(f){try{window.__codexComposerModelPicker=f}catch(e){}return f}'+
 '\nfunction codexSubagentWrap(R,flag,main,props){window.__codexCurrentInst=null;if(flag||props&&props.hideLabel)return main;let P=window.__codexComposerModelPicker,W=window.__codexOrchNativeWrap;return P&&W?W(R,main,P,props):main}'+
 '\nfunction codexSubagentTriggerChild(R,v){let C=window.__codexOrchTriggerLabel;return C?R.createElement(C,{model:v,inst:window.__codexCurrentInst}):v}'+
 '\nfunction codexSubagentHeader(R){let C=window.__codexOrchMenuHeader;return C?R.createElement(C,{inst:window.__codexCurrentInst}):void 0}'+
 '\nfunction codexSubagentDefaultStr(){try{let d=window.__damndotsOrchestratorDefaults;if(d&&(d.model||d.fast))return JSON.stringify({model:d.model||null,effort:d.effort||null,fast:d.fast===true})}catch(e){}return '+BT+BT+'}'+
 '\nfunction codexSubagentRead(sc){try{let raw=localStorage.getItem(codexSubKey(sc));if(raw!=null&&raw!=='+BT+BT+')return raw;return codexSubagentDefaultStr()}catch(e){return '+BT+BT+'}}'+
 '\nfunction codexSubagentSubscribe(f){window.addEventListener('+CH+',f);window.addEventListener('+BT+'storage'+BT+',f);return()=>{window.removeEventListener('+CH+',f);window.removeEventListener('+BT+'storage'+BT+',f)}}'+
 '\nfunction codexSubagentParse(sc){try{let v=JSON.parse(codexSubagentRead(sc)||'+BT+'null'+BT+');return v&&typeof v==='+BT+'object'+BT+'&&v.explicit!==true?v:null}catch(e){return null}}'+
 '\nfunction codexSubagentWrite(p,sc){let v={...(codexSubagentParse(sc)??{}),...p},k=codexSubKey(sc);try{v.model||v.effort||v.fast?localStorage.setItem(k,JSON.stringify({model:v.model??null,effort:v.effort??null,fast:!!v.fast})):codexSubagentDefaultStr()?localStorage.setItem(k,JSON.stringify({explicit:!0})):localStorage.removeItem(k)}catch(e){}try{window.dispatchEvent(new Event('+CH+'))}catch(e){}}'+
 '\nfunction codexSubagentTier(flag,res,models,modelId){var out=codexSubagentTierBase(flag,res,models,modelId);try{if(window.__codexCurrentInst)window.__codexCurrentInst.tier=out}catch(e){}return out}'+
 '\nfunction codexSubagentTierBase(flag,res,models,modelId){var sc=window.__codexCurrentInst&&window.__codexCurrentInst.scope;try{var pm=(window.__codexPickerModels||{})[flag?"sub":"main"],had=pm&&Array.isArray(pm.models)&&pm.models.length>0,entry={models:models,modelId:modelId};(window.__codexPickerModels=window.__codexPickerModels||{})[flag?"sub":"main"]=entry;if(window.__codexCurrentInst)window.__codexCurrentInst.models=entry;if(!had&&Array.isArray(models)&&models.length>0){window.dispatchEvent(new Event("codex-models-loaded"));if(typeof window.__codexOrchSyncSoon==="function")window.__codexOrchSyncSoon()}}catch(e){}if(!flag||res==null)return res;let s=res.serviceTierSettings,m=models?.find(e=>e.model===modelId),std=s?.availableOptions?.find(e=>e.value==null)??{description:null,iconKind:null,label:null,speedMultiplier:null,tier:null,value:null},opts=[std,...(m?.serviceTiers??[]).map(t=>({description:t.description??null,iconKind:t.id==='+BT+'priority'+BT+'||/fast/i.test(t.name??'+BT+BT+')?'+BT+'fast'+BT+':null,label:t.name??t.id,speedMultiplier:1.5,tier:t,value:t.id}))],v=codexSubagentParse(sc),fastOpt=opts.find(e=>e.iconKind==='+BT+'fast'+BT+'),sel=v?.fast&&fastOpt?fastOpt.value:null;return{...res,serviceTierSettings:{...s,availableOptions:opts,isLoading:!1,selectedServiceTier:sel,selectedServiceTierForModel:sel,serviceTierForRequest:sel},setServiceTier:e=>{codexSubagentWrite({fast:e!=null},sc);return Promise.resolve(!0)}}}'+
 '\nfunction codexSubagentSelection(R,flag,real,convId){let scope=codexSubScope(convId),raw=R.useSyncExternalStore(codexSubagentSubscribe,()=>codexSubagentRead(scope)),instRef=R.useRef(null);if(!instRef.current)instRef.current={which:flag?"sub":"main",handlers:{},scope:scope,listeners:new Set()};instRef.current.scope=scope;window.__codexCurrentInst=instRef.current;R.useLayoutEffect(()=>{let inst=instRef.current;if(!inst)return;(window.__codexInstList=window.__codexInstList||new Set()).add(inst);return()=>{try{window.__codexInstList&&window.__codexInstList.delete(inst)}catch(e){}}},[]);R.useLayoutEffect(()=>{let inst=instRef.current;if(!inst)return;try{if(inst.tk&&inst.tk.current){inst.tk.current.__codexInst=inst;inst.tk.current.setAttribute("data-codex-scope",scope)}}catch(e){}if(inst.listeners)inst.listeners.forEach(fn=>{try{fn()}catch(e){}});if(flag&&typeof window.__codexOrchSyncSoon==="function")window.__codexOrchSyncSoon()},[scope]);if(!flag){try{(window.__codexPickerSel=window.__codexPickerSel||{}).main=real;instRef.current.sel=real}catch(e){}return real}let v=null;try{v=raw?JSON.parse(raw):null;if(v&&v.explicit===true)v=null}catch(e){}let set=(m,eff,cb)=>{codexSubagentWrite({model:m||null,effort:eff??null},scope);typeof cb==='+BT+'function'+BT+'&&cb();return Promise.resolve(!0)};let cat=(window.__codexPickerModels&&(window.__codexPickerModels.sub?.models||window.__codexPickerModels.main?.models))||[],defM=v&&v.model?cat.find(x=>x&&x.model===v.model):null;let ms=v&&(v.model||v.effort)?{...real.modelSettings,model:v.model||real.modelSettings.model,reasoningEffort:v.effort??defM?.defaultReasoningEffort??real.modelSettings.reasoningEffort,isLoading:!1}:real.modelSettings;let out={...real,modelSettings:ms,selectComposerModelAndReasoningEffort:set,setModelAndReasoningEffort:(m,eff)=>set(m,eff),setDefaultModelAndReasoningEffort:(m,eff)=>set(m,eff),setModelAndReasoningEffortForNextTurn:(m,eff)=>set(m,eff)};try{(window.__codexPickerSel=window.__codexPickerSel||{}).sub=out;instRef.current.sel=out}catch(e){}return out}\n';
}
