import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const [kind,file,...args]=process.argv.slice(2),enrollment=JSON.parse(await readFile(resolve(file),'utf8'));
const script=kind==='worker'?'apps/worker/src/index.ts':kind==='client'?'apps/client/src/index.ts':undefined;if(!script)throw new Error('worker or client required');
const env={...process.env,...kind==='worker'?{DOTS_WORKER_ENROLLMENT:enrollment.token}:{DOTS_CLIENT_ENROLLMENT:enrollment.token}};
const child=spawn(process.execPath,['--import','tsx',script,...args],{env,stdio:'inherit',windowsHide:true});for(const sig of ['SIGINT','SIGTERM'] as const)process.once(sig,()=>child.kill());child.on('exit',code=>process.exitCode=code||0);
