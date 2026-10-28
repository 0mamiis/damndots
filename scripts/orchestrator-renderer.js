var damndotsOrchestratorPreferences={mode:'off',model:null,effort:null,fast:false};
function damndotsWatchOrchestratorPreferences(){
 var stopped=false,pending=false;
 async function refresh(){if(stopped||pending||document.visibilityState==='hidden')return;pending=true;try{var bridge=window.electronBridge&&window.electronBridge.getOrchestratorPreferences;if(typeof bridge!=='function')return;var value=await bridge();if(!stopped&&value&&JSON.stringify(value)!==JSON.stringify(damndotsOrchestratorPreferences)){damndotsOrchestratorPreferences=value;window.__damndotsOrchestratorDefaults=value;window.dispatchEvent(new Event('codex-orchestrator-change'));}}catch{}finally{pending=false;}}
 var timer=setInterval(refresh,2000);refresh();return function(){stopped=true;clearInterval(timer);};
}
