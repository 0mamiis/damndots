import {spawn} from 'node:child_process';
const env={...process.env,DOTS_APPSERVER_URL:'ws://127.0.0.1:9912',DOTS_APPSERVER_LISTEN:'ws://127.0.0.1:9912',DOTS_CODEX_HOME:process.env.DOTS_CODEX_HOME||'/data/codex-home'};
const children=[spawn(process.execPath,['--import','tsx','scripts/appserver.ts'],{env,stdio:'inherit'}),spawn(process.execPath,['--import','tsx','apps/server/src/index.ts'],{env,stdio:'inherit'})];
for(const child of children){child.once('error',e=>{console.error(e.message);for(const c of children)c.kill();process.exitCode=1;});child.once('exit',()=>{for(const c of children)c.kill();});}
for(const sig of ['SIGINT','SIGTERM'] as const)process.once(sig,()=>{for(const c of children)c.kill();});
