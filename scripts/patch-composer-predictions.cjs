const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const requested=process.argv[2],hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(!requested)throw Error('Usage: node scripts/patch-composer-predictions.cjs <private-staged-app-copy>');
const root=fs.realpathSync(requested);
if(process.platform==='win32'&&root.toLowerCase().split(path.sep).includes('windowsapps'))throw Error('Patch a private staged copy, never the installed WindowsApps package');
const file=path.join(root,'resources/app.asar'),archive=fs.readFileSync(file),oldHeader=archive.subarray(16,16+archive.readUInt32LE(12)),meta=JSON.parse(oldHeader),base=8+archive.readUInt32LE(4),body=archive.subarray(base),all=[];
function walk(n,p=''){for(const[k,v]of Object.entries(n.files||{})){let q=p?p+'/'+k:k;v.files?walk(v,q):all.push([q,v]);}}walk(meta);
const buildEntries={};for(const[n,v]of all)if(n.startsWith('.vite/build/'))buildEntries[n.slice('.vite/build/'.length)]=v;const mainShort=require('./desktop-build-targets.cjs').mainBuildName(buildEntries,k=>body.subarray(+buildEntries[k].offset,+buildEntries[k].offset+buildEntries[k].size).toString());const matches=all.filter(([name])=>name==='.vite/build/'+mainShort);if(matches.length!==1)throw Error('main module not unique');
const [name,entry]=matches[0];let source=body.subarray(+entry.offset,+entry.offset+entry.size).toString();
function replaceOnce(a,b){if(source.split(a).length!==2)throw Error('Anchor changed: '+a);source=source.replace(a,b);}
replaceOnce('this.unsubscribeSettings=n.onDidChange(oA.key,()=>this.clear())','this.damndotsPredictionCleanup=damndotsConnectComposerPredictions(this),this.unsubscribeSettings=n.onDidChange(oA.key,()=>this.clear())');
replaceOnce('dispose(){this.unsubscribeSettings(),this.unsubscribeConnectionChanges();','dispose(){this.damndotsPredictionCleanup?.(),this.unsubscribeSettings(),this.unsubscribeConnectionChanges();');
// Keep plan mode and unsupported-model exclusions. Permit the configured OpenAI-compatible provider.
replaceOnce('v.collaborationMode?.mode===`plan`?y=`plan_mode`:v.modelProvider===`openai`?l?.includes(v.model)&&(y=`unsupported_model`):y=`unsupported_provider`','v.collaborationMode?.mode===`plan`?y=`plan_mode`:l?.includes(v.model)&&(y=`unsupported_model`)');
replaceOnce('configuredReasoningEffort:c,unsupportedModels:l,useThreadSample:u=!1','configuredReasoningEffort:c,predictionModel:damndotsPredictionModel=null,predictionFast:damndotsPredictionFast=false,unsupportedModels:l,useThreadSample:u=!1');
replaceOnce('configuredReasoningEffort:c.prediction_reasoning_effort,unsupportedModels:c.unsupported_models','configuredReasoningEffort:c.prediction_reasoning_effort,predictionModel:c.damndotsPredictionModel,predictionFast:c.damndotsPredictionFast,unsupportedModels:c.unsupported_models');
replaceOnce('if(u&&i.bi(e.appServerVersion,`threadSample`))','if(!damndotsPredictionModel&&!damndotsPredictionFast&&u&&i.bi(e.appServerVersion,`threadSample`))');
replaceOnce('experimentalPredictionMode:!0,experimentalDisablePredictionMcp:i.bi(e.appServerVersion,`predictionDisableMcp`)?d:void 0','experimentalPredictionMode:!damndotsPredictionModel&&!damndotsPredictionFast,experimentalDisablePredictionMcp:i.bi(e.appServerVersion,`predictionDisableMcp`)?d:void 0');
replaceOnce('responseSchema:i.Cs,schema:null,model:null,effort:c','responseSchema:i.Cs,schema:null,model:damndotsPredictionModel??(damndotsPredictionFast?v.model:null),serviceTier:damndotsPredictionFast?"priority":null,effort:c');
source+='\n'+fs.readFileSync(path.join(__dirname,'native-prediction-preferences.js'),'utf8');
cp.execFileSync(process.execPath,['--input-type=module','--check'],{input:source});
const bytes=Buffer.from(source);entry.offset=String(body.length);entry.size=bytes.length;entry.integrity.hash=hash(bytes);entry.integrity.blocks=[];for(let i=0;i<bytes.length;i+=entry.integrity.blockSize)entry.integrity.blocks.push(hash(bytes.subarray(i,i+entry.integrity.blockSize)));
const json=Buffer.from(JSON.stringify(meta)),size=(4+json.length+3)&~3,pickle=Buffer.alloc(4+size),head=Buffer.alloc(8);pickle.writeUInt32LE(size);pickle.writeUInt32LE(json.length,4);json.copy(pickle,8);head.writeUInt32LE(4);head.writeUInt32LE(pickle.length,4);
const result=Buffer.concat([head,pickle,body,bytes]),exe=fs.readFileSync(path.join(root,'ChatGPT.exe')),needle=Buffer.from(hash(oldHeader)),at=exe.indexOf(needle);if(at<0||exe.indexOf(needle,at+1)>=0)throw Error('EXE header integrity anchor changed');Buffer.from(hash(json)).copy(exe,at);
const renewal=path.join(root,'renewal.json');let rec=fs.existsSync(renewal)?JSON.parse(fs.readFileSync(renewal)):{};
fs.writeFileSync(file,result);fs.writeFileSync(path.join(root,'ChatGPT.exe'),exe);fs.writeFileSync(path.join(root,path.basename(name)),bytes);
if(fs.existsSync(renewal)){Object.assign(rec,{headerHash:hash(json),exeHash:hash(exe),archiveHash:hash(result),composerPredictionsPatch:1});fs.writeFileSync(renewal,JSON.stringify(rec,null,2));}
fs.writeFileSync(path.join(root,'composer-predictions-patch.json'),JSON.stringify({version:1,packageVersion:rec.packageVersion??null}));console.log('Private staged app patched: '+name);
