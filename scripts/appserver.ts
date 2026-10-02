import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { mkdir, writeFile, readdir, stat } from 'node:fs/promises';
import { appServerProvider } from './appserver-config.js';
const dir=resolve(process.env.DOTS_CODEX_HOME||'.data/appserver');await mkdir(dir,{recursive:true});
// Model istekleri Dots sunucusunun ağ geçidinden geçer: sağlayıcı (URL/anahtar/biçim) çalışırken panelden değiştirilebilir, bu süreç yeniden başlamaz.
const {base,key:gatewaySecret}=appServerProvider();
const config=`model_provider = "dots_provider"\n${process.env.DOTS_MODEL?`model = ${JSON.stringify(process.env.DOTS_MODEL)}\n`:''}model_reasoning_effort = "high"\n[model_providers.dots_provider]\nname = "Dots model provider"\nbase_url = ${JSON.stringify(base)}\nwire_api = "responses"\nrequires_openai_auth = false\n${gatewaySecret?'env_key = "DOTS_MODEL_API_KEY"\n':''}`;
await writeFile(join(dir,'config.toml'),config,{mode:0o600});
const env={...process.env,CODEX_HOME:dir,...gatewaySecret?{DOTS_MODEL_API_KEY:gatewaySecret}:{}};for(const key of Object.keys(env))if(key.startsWith('CODEX')&&key!=='CODEX_HOME')delete (env as any)[key];
// Kullanıcının kendi pencere/PATH'inde 'codex' olmayabilir: önce ayar, sonra Codex uygulamasının kendi kurduğu CLI, en son PATH.
async function codexCli():Promise<string>{
  if(process.env.DOTS_CODEX_CLI)return process.env.DOTS_CODEX_CLI;
  const base=process.env.LOCALAPPDATA?join(process.env.LOCALAPPDATA,'OpenAI','Codex','bin'):undefined;
  let best:{file:string;time:number}|undefined;
  if(base)try{for(const name of await readdir(base)){const file=join(base,name,process.platform==='win32'?'codex.exe':'codex');try{const time=(await stat(file)).mtimeMs;if(!best||time>best.time)best={file,time};}catch{}}}catch{}
  return best?.file||'codex';
}
const cli=await codexCli();console.log('Codex CLI: '+cli);
const script=/\.(?:c|m)?js$/i.test(cli);
const child=spawn(script?process.execPath:cli,[...script?[cli]:[],'app-server','--listen',process.env.DOTS_APPSERVER_LISTEN||'ws://127.0.0.1:9912'],{env,stdio:'inherit',windowsHide:true});
child.on('error',err=>{console.error(err.message);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code||0;});
for(const sig of ['SIGINT','SIGTERM'] as const)process.on(sig,()=>child.kill());
