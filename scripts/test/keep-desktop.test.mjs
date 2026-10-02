import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const source=readFileSync(new URL('../enable-keep-desktop.ps1',import.meta.url),'utf8');
const match=/Set-Content -Path \$handler -Encoding ASCII -Value @'\r?\n([\s\S]*?)\r?\n'@/.exec(source);
assert(match,'installed handler found');
const liveCommand='& "$env:windir\\System32\\tscon.exe" $id /dest:console';
assert.equal(match[1].split(liveCommand).length,2,'only one console transfer call');
const handler=match[1].replace(liveCommand, "Write-Output 'TRANSFER'");

function simulate(states, newer=false, noEvent=false) {
 const folder=mkdtempSync(join(tmpdir(),'dots-session-test-'));
 const file=join(folder,'check.ps1');
 const mock=[
 "$ErrorActionPreference='Stop'",
 "Add-Type -TypeDefinition 'using System; public static class DotsSessionState { public static int[] Values = new int[] { "+states.join(',')+" }; static int index=0; public static int Read(int id) { return Values[Math.Min(index++,Values.Length-1)]; } }'",
 "function Add-Type { param($TypeDefinition) }",
 "function Start-Sleep { param($Seconds) }",
 "$event=[pscustomobject]@{RecordId=10;TimeCreated=[datetime]::Now}",
 "$event|Add-Member ScriptMethod ToXml { '<Event><UserData><EventXML><SessionID>2</SessionID></EventXML></UserData></Event>' }",
 "function Get-WinEvent {",
 " param($FilterHashtable,$MaxEvents,$ErrorAction)",
 " if($FilterHashtable.Id.Count -eq 1) { if(-not "+(noEvent?'$true':'$false')+"){return $event}; return }",
 " if("+(newer?'$true':'$false')+"){$next=$event.PSObject.Copy();$next.RecordId=11;return $next}",
 "}"
 ].join('\n');
 try {
  writeFileSync(file,mock+'\n'+handler);
  const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',file],{encoding:'utf8',timeout:10000,env:{...process.env,PSModulePath:undefined}});
  assert.equal(result.status,0,result.stderr);
  return result.stdout.includes('TRANSFER');
 } finally {rmSync(folder,{recursive:true,force:true});}
}

test('desktop keeper never transfers an active, reconnected, closed or unknown session', {skip:process.platform!=='win32'},()=>{
 for(const state of [0,1,3,6,-1])assert.equal(simulate([state]),false,'WTS state '+state);
 assert.equal(simulate([4,0]),false,'reconnected between state checks');
 assert.equal(simulate([4,4],true),false,'newer event for the same session');
 assert.equal(simulate([4,4],false,true),false,'no disconnect event');
});
test('desktop keeper transfers only a session that remains disconnected with no newer event', {skip:process.platform!=='win32'},()=>{
 assert.equal(simulate([4,4]),true);
});
