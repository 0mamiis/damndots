'use strict';
// Finds renderer bundles by content, because Codex 26.1029 replaced the fixed app-initial/app-primary names
// with hashed async chunks. Older builds are still matched by their file-name prefix first.
function jsEntries(meta,prefix){const out=[];(function w(n,p){for(const [k,v] of Object.entries(n.files||{})){if(v.files){if(k==='workers'&&p==='')continue;w(v,p+k+'/');}else if(/\.js$/.test(k)&&v.size<2.5e7)out.push([p+k,v]);}})(prefix?meta.files.webview.files.assets:meta,'');return out;}
function locate(meta,body,{prefix,needles=[],label='bundle',all=false}){
 const assets=meta.files.webview.files.assets.files;
 if(prefix){const byName=Object.keys(assets).filter(n=>n.startsWith(prefix)&&n.endsWith('.js'));if(byName.length===1)return all?[byName[0]]:byName[0];}
 const hits=[];for(const [p,v] of jsEntries(meta,true)){const s=body.subarray(+v.offset,+v.offset+v.size).toString();if(needles.every(x=>s.includes(x)))hits.push(p);}
 if(!hits.length)throw Error('Unsupported Codex '+label+' bundle not found');
 if(all)return hits;if(hits.length!==1)throw Error('Unsupported Codex '+label+' bundle is ambiguous ('+hits.length+')');return hits[0];}
module.exports={locate};
