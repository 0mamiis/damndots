import {readFileSync} from 'node:fs';import {join,resolve} from 'node:path';
/** WSL distribution used as the Dot computer. Roll back by writing Dots-Computer into .data/linux-computer/active-distro. */
const root=resolve(import.meta.dirname,'../..');
let name=process.env.DOTS_LINUX_DISTRO||'';
if(!name){try{name=readFileSync(join(root,'.data/linux-computer/active-distro'),'utf8').trim();}catch{}}
if(!/^[A-Za-z0-9._-]{1,64}$/.test(name))name='Dots-Computer-Debian';
export const DISTRO=name;
