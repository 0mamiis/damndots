const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const requested=process.argv[2],hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(!requested)throw Error('Usage: node scripts/patch-composer-predictions.cjs <private-staged-app-copy>');
const root=fs.realpathSync(requested);
if(process.platform==='win32'&&root.toLowerCase().split(path.sep).includes('windowsapps'))throw Error('Patch a private staged copy, never the installed WindowsApps package');
const file=path.join(root,'resources/app.asar'),archive=fs.readFileSync(file),oldHeader=archive.subarray(16,16+archive.readUInt32LE(12)),meta=JSON.parse(oldHeader),base=8+archive.readUInt32LE(4),body=archive.subarray(base),all=[];
function walk(n,p=''){for(const[k,v]of Object.entries(n.files||{})){let q=p?p+'/'+k:k;v.files?walk(v,q):all.push([q,v]);}}walk(meta);
const buildEntries={};for(const[n,v]of all)if(n.startsWith('.vite/build/'))buildEntries[n.slice('.vite/build/'.length)]=v;
const readBuild=k=>body.subarray(+buildEntries[k].offset,+buildEntries[k].offset+buildEntries[k].size).toString();
/* The prediction controller has its own main-process chunk on newer Codex builds; pick it by content. */
const predCandidates=Object.keys(buildEntries).filter(k=>{const t=readBuild(k);return t.includes('unsubscribeSettings=')&&t.includes('experimentalPredictionMode');});
const mainShort=predCandidates.length===1?predCandidates[0]:require('./desktop-build-targets.cjs').mainBuildName(buildEntries,readBuild);
const matches=all.filter(([name])=>name==='.vite/build/'+mainShort);if(matches.length!==1)throw Error('main module not unique');
const [name,entry]=matches[0];let source=body.subarray(+entry.offset,+entry.offset+entry.size).toString();
const BT=String.fromCharCode(96);
function must(label,patterns,make){
 for(const re of patterns){
  const g=new RegExp(re.source,re.flags.includes("g")?re.flags:re.flags+"g");
  const hits=[...source.matchAll(g)];
  if(hits.length===1){source=source.replace(g,make);return;}
  if(hits.length>1)throw Error("Anchor ambiguous: "+label);
 }
 throw Error("Anchor changed: "+label);
}
// Codex 26.1027 renamed the prediction controller locals; match by shape instead of exact identifiers.
must("prediction settings hook",[/this\.unsubscribeSettings=([\w$]+)\.onDidChange\(([\w$.]+),\(\)=>this\.clear\(\)\)/],function(){return "this.damndotsPredictionCleanup=damndotsConnectComposerPredictions(this),"+arguments[0];});
must("prediction dispose hook",[/dispose\(\)\{(?=(?:for\(let [\w$]+ of\()?this\.unsubscribeSettings\(\))/],function(){return "dispose(){this.damndotsPredictionCleanup?.();";});
must("prediction provider gate",
[/"openai"!==([\w$]+)\.modelProvider\?([\w$]+)="unsupported_provider":([\w$]+)\?\.includes\(\1\.model\)&&\(([\w$]+)="unsupported_model"\)/,
/([\w$]+)\.modelProvider===\x60openai\x60\?([\w$]+)\?\.includes\(\1\.model\)&&\(([\w$]+)=\x60unsupported_model\x60\):([\w$]+)=\x60unsupported_provider\x60/],
function(m,thread,providerOut,list,modelOut){return list+"?.includes("+thread+".model)&&("+modelOut+"=\x22unsupported_model\x22)";});
must("prediction parameters",[/configuredReasoningEffort:([\w$]+),unsupportedModels:/],function(m,name){return "configuredReasoningEffort:"+name+",predictionModel:damndotsPredictionModel=null,predictionFast:damndotsPredictionFast=false,unsupportedModels:";});
must("prediction call site",[/configuredReasoningEffort:([\w$]+)\.prediction_reasoning_effort,unsupportedModels:([\w$]+)\.unsupported_models/],function(m,cfg,models){return "configuredReasoningEffort:"+cfg+".prediction_reasoning_effort,predictionModel:damndotsPredictionModel,predictionFast:damndotsPredictionFast,unsupportedModels:"+models+".unsupported_models";});
must("thread sample gate",
[/if\(([\w$]+)&&([\w$]+)\.(\w+)\(([\w$]+)\.appServerVersion,"threadSample"\)\)/,
/if\(([\w$]+)&&(\w+)\(([\w$]+)\.appServerVersion,"threadSample"\)\)/,
/if\(([\w$]+)&&([\w$]+)\.(\w+)\(([\w$]+)\.appServerVersion,\x60threadSample\x60\)\)/],
function(m){return "if(!damndotsPredictionModel&&!damndotsPredictionFast&&"+m.slice(3);});
must("native prediction switch",[/experimentalPredictionMode:!0,experimentalDisablePredictionMcp:/],function(){return "experimentalPredictionMode:!damndotsPredictionModel&&!damndotsPredictionFast,experimentalDisablePredictionMcp:";});
must("prediction request model",[/responseSchema:([\w$]+)\.([\w$]+),schema:null,model:null,effort:([\w$]+)/],function(m,ns,schema,effort){return "responseSchema:"+ns+"."+schema+",schema:null,model:damndotsPredictionModel??null,serviceTier:damndotsPredictionFast?\"priority\":null,effort:"+effort;});
source+='\n'+fs.readFileSync(path.join(__dirname,'native-prediction-preferences.js'),'utf8');
cp.execFileSync(process.execPath,['--input-type=module','--check'],{input:source});
const bytes=Buffer.from(source);entry.offset=String(body.length);entry.size=bytes.length;entry.integrity.hash=hash(bytes);entry.integrity.blocks=[];for(let i=0;i<bytes.length;i+=entry.integrity.blockSize)entry.integrity.blocks.push(hash(bytes.subarray(i,i+entry.integrity.blockSize)));
const json=Buffer.from(JSON.stringify(meta)),size=(4+json.length+3)&~3,pickle=Buffer.alloc(4+size),head=Buffer.alloc(8);pickle.writeUInt32LE(size);pickle.writeUInt32LE(json.length,4);json.copy(pickle,8);head.writeUInt32LE(4);head.writeUInt32LE(pickle.length,4);
const result=Buffer.concat([head,pickle,body,bytes]),exe=fs.readFileSync(path.join(root,'ChatGPT.exe')),needle=Buffer.from(hash(oldHeader)),at=exe.indexOf(needle);if(at<0||exe.indexOf(needle,at+1)>=0)throw Error('EXE header integrity anchor changed');Buffer.from(hash(json)).copy(exe,at);
const renewal=path.join(root,'renewal.json');let rec=fs.existsSync(renewal)?JSON.parse(fs.readFileSync(renewal)):{};
fs.writeFileSync(file,result);fs.writeFileSync(path.join(root,'ChatGPT.exe'),exe);fs.writeFileSync(path.join(root,path.basename(name)),bytes);
if(fs.existsSync(renewal)){Object.assign(rec,{headerHash:hash(json),exeHash:hash(exe),archiveHash:hash(result),composerPredictionsPatch:1});fs.writeFileSync(renewal,JSON.stringify(rec,null,2));}
fs.writeFileSync(path.join(root,'composer-predictions-patch.json'),JSON.stringify({version:1,packageVersion:rec.packageVersion??null}));console.log('Private staged app patched: '+name);
