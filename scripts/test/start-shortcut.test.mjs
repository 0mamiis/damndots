import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const script=path.resolve('scripts/main-codex/install-start-shortcut.ps1');
const run=(desktop,marker)=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Root',path.resolve('.'),'-Marker',marker,'-Desktop',desktop],{encoding:'utf8',windowsHide:true}).trim();

test('creates the Damndots start shortcut once and keeps a deleted shortcut deleted',{skip:process.platform!=='win32'},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dots-shortcut-')),desktop=path.join(dir,'Desktop'),marker=path.join(dir,'marker.json');
 try{
  fs.mkdirSync(desktop);
  assert.match(run(desktop,marker),/^created: /);
  const link=path.join(desktop,'Damndots.lnk');
  assert(fs.existsSync(link));
  fs.rmSync(link);
  assert.equal(run(desktop,marker),'skipped: already handled');
  assert(!fs.existsSync(link));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('does not add a second shortcut when one already starts Start-Dots.cmd',{skip:process.platform!=='win32'},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dots-shortcut-')),desktop=path.join(dir,'Desktop'),marker=path.join(dir,'marker.json');
 try{
  fs.mkdirSync(desktop);
  const own=path.join(desktop,'My Dots.lnk');
  const make='$l=(New-Object -ComObject WScript.Shell).CreateShortcut($env:DOTS_LNK);$l.TargetPath=$env:ComSpec;$l.Arguments=\'/k "\'+$env:DOTS_CMD+\'"\';$l.Save()';
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',make],{env:{...process.env,DOTS_LNK:own,DOTS_CMD:path.resolve('Start-Dots.cmd')},windowsHide:true});
  assert.equal(run(desktop,marker),'existing: My Dots.lnk');
  assert(!fs.existsSync(path.join(desktop,'Damndots.lnk')));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
