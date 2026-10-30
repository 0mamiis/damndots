var damndotsTpsPreferences={enabled:true,aggregation:'average',decimals:0,animate:true};
function damndotsWatchTpsPreferences(){
 var stopped=false,pending=false;
 async function refresh(){if(stopped||pending||document.visibilityState==='hidden')return;pending=true;try{var bridge=window.electronBridge&&window.electronBridge.getTokenSpeedPreferences;if(typeof bridge!=='function')return;var value=await bridge();if(!stopped&&value&&JSON.stringify(value)!==JSON.stringify(damndotsTpsPreferences)){damndotsTpsPreferences=value;if(value.measurements&&typeof value.measurements==='object'){try{var key='codex-thread-tps-v3',cur=JSON.parse(localStorage.getItem(key)||'{}');if(!cur||typeof cur!=='object')cur={};for(var k in value.measurements)if(Array.isArray(value.measurements[k]))cur[k]=value.measurements[k];localStorage.setItem(key,JSON.stringify(cur));}catch(e){}}window.dispatchEvent(new Event('codex-tps-change'));}}catch{}finally{pending=false;}}
 var timer=setInterval(refresh,2000);refresh();
 return function(){stopped=true;clearInterval(timer);};
}
