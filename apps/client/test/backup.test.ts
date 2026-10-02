import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

test('backup reuse, corruption checks and retention keep the selected recovery snapshot',{skip:process.platform!=='win32'},async()=>{
  const root=await mkdtemp(join(tmpdir(),'dots-backups-')),ch=join(root,'home'),app=join(root,'app'),backups=join(root,'backups');
  const script=fileURLToPath(new URL('../../../scripts/main-codex/backup.ps1',import.meta.url));
  await mkdir(ch);await mkdir(app);
  const set=async(model:string)=>{await writeFile(join(ch,'config.toml'),'model = "'+model+'"\n');};
  const run=async(keep=2)=>promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-CodexHome',ch,'-AppData',app,'-Keep',String(keep)],{env:{...process.env,PSModulePath:undefined,DOTS_BACKUP_ROOT:backups}});
  const path=(output:string)=>/BACKUP_DIR=(.+)/.exec(output)![1].trim();
  try{
    await set('a');await writeFile(join(ch,'auth.json'),'{"test":true}');await writeFile(join(ch,'.codex-global-state.json'),'{"first":1}');
    const first=await run();assert.match(first.stdout,/BACKUP_NEW=1/);
    const original=path(first.stdout);assert.ok((await readFile(join(original,'manifest.json'),'utf8')).includes('config.toml'));
    await writeFile(join(ch,'.codex-global-state.json'),'{"changed":2}');
    const repeated=await run();assert.match(repeated.stdout,/BACKUP_NEW=0/);assert.equal(path(repeated.stdout),original);
    await new Promise(r=>setTimeout(r,1100));await set('b');const second=await run();assert.match(second.stdout,/BACKUP_NEW=1/);
    await set('a');const restored=await run();assert.equal(path(restored.stdout),original);
    await writeFile(join(original,'codex-home','config.toml'),'BROKEN');
    await new Promise(r=>setTimeout(r,1100));const repaired=await run();assert.match(repaired.stdout,/BACKUP_NEW=1/);assert.notEqual(path(repaired.stdout),original);
    const dirs=(await readdir(backups)).filter(n=>n.startsWith('main-'));assert.equal(dirs.length,2);
    assert.equal((await readFile(join(path(repaired.stdout),'codex-home','config.toml'),'utf8')),'model = "a"\n');
    assert.ok(!(await readdir(backups)).includes('.main-pending'),'successful staging is committed, not left behind');
  }finally{await rm(root,{recursive:true,force:true});}
});
