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
