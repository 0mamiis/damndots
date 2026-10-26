'use strict';
const fs=require('fs'),path=require('path'),os=require('os');
function activeModels(rows,config={}){
 if(!Array.isArray(rows))throw Error('Invalid OpenCodex catalog');
 const order=new Map((config.modelPickerOrder||[]).map((id,i)=>[id,i]));
 return rows.filter(m=>m.disabled===false&&typeof m.namespaced==='string').map(m=>({id:m.namespaced,label:m.displayName||config.providers?.[m.provider]?.modelDisplayNames?.[m.id]||m.namespaced,efforts:Array.isArray(m.reasoningEfforts)?m.reasoningEfforts:[],fast:/(^|\/)gpt[-.]/i.test(m.namespaced)})).sort((a,b)=>(order.get(a.id)??99999)-(order.get(b.id)??99999));
}
async function load(){
 const dir=path.join(os.homedir(),'.opencodex'),config=JSON.parse(fs.readFileSync(path.join(dir,'config.json'),'utf8'));
 const port=Number(config.port||10100);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid OpenCodex port');
 const token=fs.readFileSync(path.join(dir,'admin-api-token'),'utf8').trim();
 const r=await fetch('http://127.0.0.1:'+port+'/api/models',{headers:{authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!r.ok)throw Error('OpenCodex catalog unavailable');
 return {models:activeModels(await r.json(),config)};
}
module.exports={activeModels,load};
