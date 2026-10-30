'use strict';
const APP_ID='OpenAI.Codex_2p2nqsd0c76g0!App';
function patchBootstrap(source){
 if(source.includes('/* damndots-startup-identity-v1 */'))return source;
 const re=/([\w$]+)\.app\.setAppUserModelId\((?:\(0,[\w$]+\.[\w$]+\)\([\w$]+\)|[\w$]+\.[\w$]+\([\w$]+\))\)/g;
 if([...source.matchAll(re)].length!==1)throw Error('Unsupported desktop startup identity boundary');
 return source.replace(re,(_,electron)=>electron+'.app.setAppUserModelId('+JSON.stringify(APP_ID)+')/* damndots-startup-identity-v1 */');
}
module.exports={APP_ID,patchBootstrap};
