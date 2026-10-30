// Codex 26.1027+ reduces app-server notifications in the main process. Measure turns here and hand results to windows.
const damndotsTpsFile=()=>require('node:path').join(require('node:os').homedir(),'.codex','dots-local-bridge','token-speed-measurements.json');
let damndotsTpsStore=null;
function damndotsTpsMeasurements(){if(damndotsTpsStore)return damndotsTpsStore;try{const v=JSON.parse(require('node:fs').readFileSync(damndotsTpsFile(),'utf8'));damndotsTpsStore=v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch{damndotsTpsStore={};}return damndotsTpsStore;}
function damndotsTpsCommit(id,tokens,ms,source){if(!(tokens>0)||!(ms>=16))return;const all=damndotsTpsMeasurements();const list=Array.isArray(all[id])?all[id]:[];list.push({tokens:Math.round(tokens),ms:Math.round(ms),source,at:Date.now()});all[id]=list.slice(-50);const ids=Object.keys(all);if(ids.length>200){ids.sort((a,b)=>(all[a].at(-1)?.at||0)-(all[b].at(-1)?.at||0));for(const k of ids.slice(0,ids.length-200))delete all[k];}try{const fs=require('node:fs'),f=damndotsTpsFile(),t=f+'.tmp-'+process.pid;fs.mkdirSync(require('node:path').dirname(f),{recursive:true});fs.writeFileSync(t,JSON.stringify(all),{mode:0o600});fs.renameSync(t,f);}catch{}}
const damndotsTpsActive=new Map();
function damndotsTpsNum(v){const n=Number(v);return Number.isFinite(n)&&n>0?n:0;}
globalThis.__damndotsTpsMain=(method,params)=>{try{
 if(!params||params.threadId==null)return;const id=String(params.threadId),now=Date.now();
 const turnId=params.turnId!=null?String(params.turnId):params.turn&&params.turn.id!=null?String(params.turn.id):null;
 let a=damndotsTpsActive.get(id);
 if(method==='turn/started'){damndotsTpsActive.set(id,{turnId,first:now,tokens:0,counts:[],model:params.model||params.turn?.model||null,lastTokens:0,lastAt:0});return;}
 if(method==='thread/tokenUsage/updated'){const u=params.tokenUsage||{},last=u.last||u.lastTokenUsage||u.last_token_usage;const t=damndotsTpsNum(last&&(last.outputTokens??last.output_tokens));if(!t)return;if(!a||(turnId&&a.turnId&&turnId!==a.turnId)){a={turnId,first:now,tokens:0,counts:[],model:null,lastTokens:0,lastAt:0};damndotsTpsActive.set(id,a);}if(a.lastTokens===t&&now-a.lastAt<250)return;a.tokens+=t;a.counts.push(t);a.lastTokens=t;a.lastAt=now;return;}
 if(method==='turn/completed'){const turn=params.turn||{};if(!a||(turnId&&a.turnId&&turnId!==a.turnId))return;damndotsTpsActive.delete(id);if(turn.status&&turn.status!=='completed')return;
  let ms=damndotsTpsNum(turn.durationMs??turn.duration_ms);
  if(!ms&&turn.startedAt!=null&&turn.completedAt!=null){const s=typeof turn.startedAt==='number'?turn.startedAt:Date.parse(turn.startedAt),e=typeof turn.completedAt==='number'?turn.completedAt:Date.parse(turn.completedAt);if(Number.isFinite(s)&&Number.isFinite(e))ms=Math.max(0,e-s)*(typeof turn.startedAt==='number'&&turn.startedAt<1e12?1000:1);}
  if(!ms)ms=now-a.first;if(!(a.tokens>0)||ms<16)return;
  const fin=a,until=now,since=until-ms-15000,native=()=>damndotsTpsCommit(id,fin.tokens,ms,'native');
  const oc=globalThis.__codexTpsOpenCodex;if(typeof oc!=='function'){native();return;}
  Promise.resolve(oc({sinceMs:since,untilMs:until,model:fin.model,tokenCounts:fin.counts.slice()})).then(r=>{if(r&&r.tokens>0&&r.durationMs>=16&&r.matchedTokenEvents===fin.counts.length)damndotsTpsCommit(id,r.tokens,r.durationMs,'opencodex');else native();}).catch(native);
 }
}catch{}};
// Read-only, trusted-renderer bridge for Codex TPS display preferences.
try {
 const electron=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
 electron.ipcMain.handle('damndots:token-speed',event=>{
  const url=String(event.senderFrame?.url||'');
  if(!url.startsWith('app://-/'))return null;
  const dir=path.join(os.homedir(),'.codex','dots-local-bridge');
  let value={enabled:true,aggregation:'average',decimals:0,animate:true};
  try{const saved=JSON.parse(fs.readFileSync(path.join(dir,'token-speed.json'),'utf8'));if(typeof saved.enabled==='boolean'&&['latest','average'].includes(saved.aggregation)&&[0,1,2].includes(saved.decimals)&&typeof saved.animate==='boolean')value={enabled:saved.enabled,aggregation:saved.aggregation,decimals:saved.decimals,animate:saved.animate};}catch{}
  try{fs.mkdirSync(dir,{recursive:true});const target=path.join(dir,'token-speed-status.json'),temp=target+'.tmp-'+process.pid;fs.writeFileSync(temp,JSON.stringify({pid:process.pid,preferences:value,updatedAt:new Date().toISOString()}),{mode:0o600});fs.renameSync(temp,target);}catch{}
  return {...value,measurements:damndotsTpsMeasurements()};
 });
}catch{}
