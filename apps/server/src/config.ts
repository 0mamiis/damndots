import { mkdirSync, existsSync, readFileSync, writeFileSync,linkSync,unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes, createHmac,randomUUID } from 'node:crypto';
export interface ServerConfig {host:string;port:number;dataDir:string;adminKey:string;signingKey:Buffer;modelBaseUrl:string;modelApiKey:string;appServerUrl:string;model:string|null;reasoningEffort:string;serviceTier:string|null;tlsCert?:string;tlsKey?:string;workerOnlineMs:number;}
/** Yerel Codex app-server'ın model ağ geçidine bağlanmak için kullandığı anahtar (imza anahtarından türetilir). */
export const gatewayKey=(signingKey:Buffer)=>createHmac('sha256',signingKey).update('dots-model-gateway').digest('hex');
export function loadConfig(env:NodeJS.ProcessEnv=process.env):ServerConfig {
  const dataDir=resolve(env.DOTS_DATA_DIR||'.data/server');mkdirSync(dataDir,{recursive:true});
  const key=(name:string)=>{
    const file=join(dataDir,name);
    if(!existsSync(file)){
      // Publish only a fully written key. Concurrent server/app-server startup must
      // neither overwrite the winner nor read an empty file after another process opens it.
      const temporary=file+'.'+randomUUID()+'.tmp';
      try{writeFileSync(temporary,randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});try{linkSync(temporary,file);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}}
      finally{if(existsSync(temporary))unlinkSync(temporary);}
    }
    return readFileSync(file,'utf8').trim();
  };
  return {host:env.DOTS_HOST||'127.0.0.1',port:Number(env.DOTS_PORT||9340),dataDir,adminKey:env.DOTS_ADMIN_KEY||key('admin.key'),signingKey:Buffer.from(key('signing.key'),'hex'),modelBaseUrl:env.DOTS_MODEL_BASE||'http://127.0.0.1:10100/v1',modelApiKey:env.DOTS_MODEL_API_KEY||'',appServerUrl:env.DOTS_APPSERVER_URL||'ws://127.0.0.1:9912',model:env.DOTS_MODEL||null,reasoningEffort:env.DOTS_REASONING_EFFORT||'high',serviceTier:env.DOTS_SERVICE_TIER||null,tlsCert:env.DOTS_TLS_CERT,tlsKey:env.DOTS_TLS_KEY,workerOnlineMs:45000};
}
