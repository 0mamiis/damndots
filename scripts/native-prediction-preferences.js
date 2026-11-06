// Connect the owner dashboard to Codex's native composer-predictions-enabled setting.
function damndotsConnectComposerPredictions(controller) {
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
 const directory=process.env.DAMNDOTS_PREDICTION_TEST_DIR||path.join(os.homedir(),'.codex','dots-local-bridge');
 const preferenceFile=path.join(directory,'composer-predictions.json'),statusFile=path.join(directory,'composer-predictions-status.json');
 let closed=false,refreshing=false,lastRevision=null,remoteEnabled=null,lastConfigAt=0;
 let predictionModel=null,predictionEffort=null,predictionFast=false;
 const getConfig=controller.getConfig.bind(controller);
 controller.getConfig=async()=>{const config=await getConfig();return config?{...config,damndotsPredictionModel:predictionModel,damndotsPredictionFast:predictionFast,...predictionEffort?{prediction_reasoning_effort:predictionEffort}:{}}:config;};
 const inferenceOptions=controller.getInferenceOptions?.bind(controller);
 if(inferenceOptions)controller.getInferenceOptions=()=>({...inferenceOptions(),disableMcp:true});
 fs.mkdirSync(directory,{recursive:true});
 async function tick(){
  if(closed||refreshing)return;refreshing=true;
  try{
   let requested=null,revision=null;
   try{const value=JSON.parse(fs.readFileSync(preferenceFile,'utf8'));if(typeof value.enabled==='boolean'){requested=value.enabled;revision=value.revision;}const nextModel=typeof value.model==='string'&&value.model.trim()?value.model.trim():null,nextEffort=['none','minimal','low','medium','high','xhigh','max','ultra'].includes(value.effort)?value.effort:null,nextFast=value.fast===true;if(nextModel!==predictionModel||nextEffort!==predictionEffort||nextFast!==predictionFast){predictionModel=nextModel;predictionEffort=nextEffort;predictionFast=nextFast;controller.clear();}}catch{}
   if(requested!==null&&controller.settings.getEffective('composer-predictions-enabled')!==requested){
    await controller.settings.set('composer-predictions-enabled',requested);
   }
   if(revision!==lastRevision||Date.now()-lastConfigAt>60000){
    lastRevision=revision;lastConfigAt=Date.now();
    Promise.resolve(controller.getConfig()).then(config=>{remoteEnabled=typeof config?.is_enabled==='boolean'?config.is_enabled:null;}).catch(()=>{remoteEnabled=null;});
   }
   if(!closed){const value={pid:process.pid,executable:process.execPath,enabled:controller.settings.getEffective('composer-predictions-enabled')===true,model:predictionModel,effort:predictionEffort,fast:predictionFast,remoteEnabled,updatedAt:new Date().toISOString()};
    const temporary=statusFile+'.tmp-'+process.pid;fs.writeFileSync(temporary,JSON.stringify(value),{mode:0o600});fs.renameSync(temporary,statusFile);}
  }catch{/* A temporary settings/file lock must not break Codex. */}finally{refreshing=false;}
 }
 const timer=setInterval(()=>void tick(),2000);timer.unref();void tick();
 return ()=>{closed=true;clearInterval(timer);};
}
// Codex 26.1103: thread/sample always uses the chat model. With a custom prediction model, sample the transcript through the local OpenCodex endpoint instead.
async function damndotsSampleThread(client,model,fast,params,signal){
 if(!model&&!fast)return client.sampleThread(params,signal);
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
 let base='http://127.0.0.1:10100/v1';
 try{const toml=fs.readFileSync(path.join(os.homedir(),'.codex','config.toml'),'utf8'),m=toml.match(/^\s*openai_base_url\s*=\s*"([^"]+)"/m);if(m&&/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(m[1]))base=m[1].replace(/\/$/,'');}catch{}
 const thread=await client.readThread(params.threadId,{includeTurns:true});
 const lines=[];
 for(const turn of (thread&&thread.turns)||[]){
  for(const item of turn.items||[]){
   let text='',role=null;
   if(item.type==='userMessage'){role='User';text=(item.content||[]).map(c=>c&&c.type==='text'?c.text:'').join('');}
   else if(item.type==='agentMessage'){role='Assistant';text=item.text||'';}
   if(role&&text.trim())lines.push(role+': '+text.trim().slice(0,2000));
  }
 }
 const transcript=lines.slice(-24).join('\n\n').slice(-24000);
 const body={model:model||undefined,stream:false,store:false,input:[{role:'user',content:[{type:'input_text',text:'Conversation so far:\n\n'+transcript}]},{role:'user',content:[{type:'input_text',text:params.prompt}]}]};
 if(params.effort)body.reasoning={effort:params.effort};
 if(fast)body.service_tier='priority';
 const res=await fetch(base+'/responses',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(25000)])});
 if(!res.ok)throw Error('Prediction request failed ('+res.status+')');
 const data=await res.json();
 let text=null;
 for(const o of data.output||[])if(o.type==='message')for(const c of o.content||[])if(c.type==='output_text'&&typeof c.text==='string')text=(text||'')+c.text;
 text=text&&text.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'');
 const u=data.usage||{};
 return {text,responseId:data.id||null,inputTokens:u.input_tokens??null,cachedInputTokens:(u.input_tokens_details&&u.input_tokens_details.cached_tokens)??null};
}
