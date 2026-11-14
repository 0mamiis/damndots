import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {command,isTreeLockError,readListeningPids,releaseLockedTree,retryBuildOnTreeLock,selectTreeLocks} from '../update.mjs';

const root='D:\\work\\dots';
const ports=[4320,9340,9912];
const node='C:\\Program Files\\nodejs\\node.exe';

test('tree lock selection keeps repository processes, port owners and their descendants',()=>{
  const processes=[
    {pid:101,commandLine:'"'+node+'" '+root+'\\apps\\dashboard\\.next\\standalone\\apps\\dashboard\\server.js',exePath:node,listeningPorts:[4320]},
    {pid:102,commandLine:'"'+node+'" --import tsx '+root+'\\scripts\\local-stack.ts --worker',exePath:node,listeningPorts:[]},
    {pid:103,commandLine:'"'+node+'" '+root+'\\scripts\\update.mjs --job '+root+'\\apps\\server\\.data\\server\\updates\\job.json',exePath:node,listeningPorts:[]},
    {pid:104,commandLine:'"'+node+'" '+root+'\\tools\\convert.mjs',exePath:node,listeningPorts:[]},
    {pid:105,commandLine:'"'+node+'" C:\\Other\\project\\dashboard\\server.js',exePath:'C:\\Other\\node.exe',listeningPorts:[]},
    {pid:106,commandLine:'"'+node+'" C:\\Other\\node_modules\\tsx\\dist\\cli.mjs C:\\Other\\app.ts',exePath:'C:\\Other\\node.exe',listeningPorts:[]},
    {pid:107,commandLine:'"'+node+'" --import tsx scripts/local-stack.ts',exePath:node,listeningPorts:[]},
    {pid:108,commandLine:'"'+node+'" '+root+'\\apps\\server\\src\\index.ts',exePath:node,listeningPorts:[]},
    {pid:109,commandLine:'"'+node+'" '+root+'\\apps\\server\\src\\index.ts',exePath:node,listeningPorts:[9340]},
    {pid:110,commandLine:'"'+node+'" '+root+'-other\\apps\\dashboard\\server.js',exePath:node,listeningPorts:[]},
    {pid:111,commandLine:'"'+node+'" '+root.toLowerCase()+'\\apps\\dashboard\\.next\\server.js',exePath:node,listeningPorts:[]},
    {pid:112,commandLine:'"'+node+'" '+root+'\\.data\\local-stack\\native\\native-cli-bridge.mjs',exePath:node,listeningPorts:[]},
    {pid:113,commandLine:root+'\\.data\\local-stack\\native\\desktop-features\\app\\resources\\cua_node\\bin\\node.exe --import file:///C:/Tools/plugins/tool.mjs',exePath:root+'\\.data\\local-stack\\native\\desktop-features\\app\\resources\\cua_node\\bin\\node.exe',listeningPorts:[]},
    {pid:114,parentPid:0,commandLine:'"'+node+'" --import tsx scripts/local-stack.ts --worker --client --main-gateway',exePath:node,listeningPorts:[]},
    {pid:115,parentPid:114,commandLine:'"'+node+'" apps/dashboard/.next/standalone/apps/dashboard/server.js',exePath:node,listeningPorts:[4320]},
    {pid:116,parentPid:117,commandLine:'C:\\Tools\\codex\\codex.exe app-server --listen ws://127.0.0.1:9912',exePath:'C:\\Tools\\codex\\codex.exe',listeningPorts:[9912]},
    {pid:117,parentPid:114,commandLine:'"'+node+'" --import tsx scripts/appserver.ts',exePath:node,listeningPorts:[]},
    {pid:118,commandLine:'"'+node+'" C:\\Other\\scripts\\local-stack.ts',exePath:node,listeningPorts:[]},
    {pid:119,parentPid:101,commandLine:'"'+node+'" server.js',exePath:node,listeningPorts:[]},
    {pid:120,commandLine:'"'+node+'" '+root+') apps\\dashboard\\server.js',exePath:node,listeningPorts:[]},
    {pid:121,parentPid:122,commandLine:'"'+node+'" --import tsx scripts/local-stack.ts --worker',exePath:node,listeningPorts:[]},
    {pid:122,commandLine:'cmd.exe /c "'+root+'\\Start-Dots.cmd"',exePath:'C:\\Windows\\System32\\cmd.exe',listeningPorts:[]}
  ];
  assert.deepEqual(selectTreeLocks({processes,root,ports,platform:'win32'}).map(process=>process.pid),[101,102,109,111,114,115,116,117,119,120,121]);
  assert.deepEqual(selectTreeLocks({processes,root,ports,excludePids:[101,107,114],platform:'win32'}).map(process=>process.pid),[102,109,111,115,116,117,120,121]);
});

test('tree lock selection never selects by image name or an unrelated node process',()=>{
  const processes=[
    {pid:201,commandLine:'"'+node+'" C:\\Elsewhere\\server.js',exePath:node,listeningPorts:[]},
    {pid:202,commandLine:'notepad.exe',exePath:'C:\\Windows\\notepad.exe',listeningPorts:[]},
    {pid:203,commandLine:'"'+node+'" C:\\Elsewhere\\dashboard\\server.js',exePath:node,listeningPorts:[]},
    {pid:204,commandLine:'"'+node+'" C:\\Elsewhere\\scripts\\local-stack.ts',exePath:node,listeningPorts:[]}
  ];
  assert.deepEqual(selectTreeLocks({processes,root,ports,platform:'win32'}),[]);
});

test('an editor or explorer with the repo path in its command line is not selected',()=>{
  const processes=[
    {pid:211,name:'Code.exe',commandLine:'"C:\\Program Files\\Microsoft VS Code\\Code.exe" '+root+'\\apps\\dashboard\\server.js',exePath:'C:\\Program Files\\Microsoft VS Code\\Code.exe',listeningPorts:[]},
    {pid:212,name:'explorer.exe',commandLine:'explorer.exe /select,'+root+'\\apps\\dashboard\\.next',exePath:'C:\\Windows\\explorer.exe',listeningPorts:[]},
    {pid:213,name:'powershell.exe',commandLine:'powershell.exe -Command Get-Content '+root+'\\apps\\dashboard\\server.js',exePath:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',listeningPorts:[]}
  ];
  assert.deepEqual(selectTreeLocks({processes,root,ports,platform:'win32'}),[]);
});

test('a node process with the repo path is selected for termination',()=>{
  const processes=[{pid:221,name:'node.exe',commandLine:'"'+node+'" '+root+'\\apps\\dashboard\\server.js',exePath:node,listeningPorts:[]}];
  assert.deepEqual(selectTreeLocks({processes,root,ports,platform:'win32'}).map(process=>process.pid),[221]);
});

test('a non-node process that owns a managed port is selected',()=>{
  const processes=[
    {pid:231,name:'chrome.exe',commandLine:'chrome.exe --remote-debugging-port=4320',exePath:'C:\\Program Files\\Google\\Chrome\\chrome.exe',listeningPorts:[4320]},
    {pid:232,name:'chrome.exe',commandLine:'chrome.exe',exePath:'C:\\Program Files\\Google\\Chrome\\chrome.exe',listeningPorts:[]}
  ];
  assert.deepEqual(selectTreeLocks({processes,root,ports,platform:'win32'}).map(process=>process.pid),[231]);
});

test('a managed port owner is selected even without a repo path in its command line',()=>{
  const processes=[
    {pid:301,commandLine:'"'+node+'" server.js',exePath:node,listeningPorts:[4320]},
    {pid:302,commandLine:'"'+node+'" server.js',exePath:node,listeningPorts:[9912]},
    {pid:303,commandLine:'"'+node+'" dashboard\\server.js',exePath:node,listeningPorts:[]}
  ];
  assert.deepEqual(selectTreeLocks({processes,root,ports,platform:'win32'}).map(process=>process.pid),[301,302]);
});

test('descendants of a selected pid are selected even without their own repo path',()=>{
  const processes=[
    {pid:401,commandLine:'"'+node+'" '+root+'\\apps\\dashboard\\scripts\\start.mjs',exePath:node,listeningPorts:[]},
    {pid:402,parentPid:401,commandLine:'"'+node+'" server.js',exePath:node,listeningPorts:[]},
    {pid:403,parentPid:402,commandLine:'"'+node+'" worker.js',exePath:node,listeningPorts:[]}
  ];
  assert.deepEqual(selectTreeLocks({processes,root,ports,platform:'win32'}).map(process=>process.pid),[401,402,403]);
});

test('a relative repo script outside the repository is not selected',()=>{
  const processes=[
    {pid:501,commandLine:'"'+node+'" --import tsx scripts/local-stack.ts',exePath:node,listeningPorts:[]},
    {pid:502,commandLine:'"'+node+'" --import tsx scripts/appserver.ts',exePath:node,listeningPorts:[]},
    {pid:503,parentPid:0,commandLine:'"'+node+'" --import tsx scripts/local-stack.ts',exePath:node,listeningPorts:[]},
    {pid:504,parentPid:503,commandLine:'"'+node+'" C:\\Other\\dashboard\\server.js',exePath:node,listeningPorts:[]}
  ];
  assert.deepEqual(selectTreeLocks({processes,root,ports,platform:'win32'}),[]);
});

test('a bare relative supervisor is selected only when its tree contains the repo root',()=>{
  const processes=[
    {pid:801,commandLine:'cmd.exe /c "'+root+'\\Start-Dots.cmd"',exePath:'C:\\Windows\\System32\\cmd.exe',listeningPorts:[]},
    {pid:802,parentPid:801,commandLine:'"'+node+'" --import tsx scripts/local-stack.ts',exePath:node,listeningPorts:[]},
    {pid:803,commandLine:'"'+node+'" --import tsx scripts/local-stack.ts',exePath:node,listeningPorts:[]}
  ];
  assert.deepEqual(selectTreeLocks({processes,root,ports,platform:'win32'}).map(process=>process.pid),[802]);
});

test('a locked build is retried once after the tree is released again',async()=>{
  for(const code of ['EBUSY','EPERM']){
    let builds=0,releases=0;
    const result=await retryBuildOnTreeLock(async()=>{
      builds++;
      if(builds===1)throw Object.assign(new Error('Command failed (1)'),{output:'Error: '+code+': resource busy or locked, rmdir ...'});
      return 'built';
    },async()=>{releases++;});
    assert.equal(result,'built');
    assert.equal(builds,2,code+' triggers one retry');
    assert.equal(releases,1,code+' releases the tree once');
  }
});

test('a successful or unrelated build failure is never retried',async()=>{
  let builds=0,releases=0;
  assert.equal(await retryBuildOnTreeLock(async()=>{builds++;return 'built';},async()=>{releases++;}),'built');
  assert.equal(builds,1);assert.equal(releases,0);
  const failure=Object.assign(new Error('Command failed (1)'),{output:'Error: Module not found: Can\'t resolve ./missing'});
  await assert.rejects(retryBuildOnTreeLock(async()=>{builds++;throw failure;},async()=>{releases++;}),error=>error===failure);
  assert.equal(builds,2);assert.equal(releases,0);
});

test('the build wrapper recognises a lock only in the captured build output',()=>{
  assert.equal(isTreeLockError({message:'Command failed (1)',output:"Error: EBUSY: resource busy or locked, rmdir 'C:\\dots\\apps\\dashboard\\.next\\standalone\\apps\\dashboard'"}),true);
  assert.equal(isTreeLockError({message:'Command failed (1)',output:'Error: ENOENT: no such file'}),false);
  assert.equal(isTreeLockError({message:'EBUSY',code:'EBUSY'}),false);
});

test('a process that still owns a managed port fails the tree release',async()=>{
  let inventories=0;
  const inventory=async()=>{inventories++;return [{pid:601,parentPid:0,name:'node.exe',commandLine:'"'+node+'" server.js',exePath:node,listeningPorts:[4320]}];};
  await assert.rejects(releaseLockedTree({root,ports,platform:'win32',inventory,kill:async()=>{},waitForPorts:async()=>[4320],log:()=>{},error:()=>{}}),/Managed ports are still in use/);
  assert.ok(inventories>=2,'the release re-inventories before failing');
});

test('a selected process that survives the kill fails the tree release',async()=>{
  const inventory=async()=>[{pid:701,parentPid:0,name:'node.exe',commandLine:'"'+node+'" '+root+'\\apps\\dashboard\\server.js',exePath:node,listeningPorts:[]}];
  await assert.rejects(releaseLockedTree({root,ports,platform:'win32',inventory,kill:async()=>{},waitForPorts:async()=>[],log:()=>{},error:()=>{}}),/Repository processes are still holding files/);
});

test('a failing process inventory fails the tree release after one retry',async()=>{
  let inventories=0;
  const inventory=async()=>{inventories++;throw Error('powershell unavailable');};
  await assert.rejects(releaseLockedTree({root,ports,platform:'win32',inventory,kill:async()=>{},waitForPorts:async()=>[],log:()=>{},error:()=>{}}),/Could not inspect repository processes: powershell unavailable/);
  assert.equal(inventories,2);
});

test('a failing lsof inventory fails after one retry',async()=>{
  let inventories=0;
  await assert.rejects(readListeningPids(4320,async()=>{inventories++;throw Object.assign(Error('spawn lsof ENOENT'),{code:'ENOENT',stderr:''});}),/Could not inspect processes listening on port 4320/);
  assert.equal(inventories,2);
});

test('command waits for close and captures a trailing lock line for the build retry',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dots-close-'));
  const script=join(dir,'tail.cjs');
  await writeFile(script,"require('node:fs').writeSync(2,'Error: EBUSY: resource busy or locked, rmdir ...\\n');process.exit(1);");
  try{
    let builds=0,releases=0,firstError;
    const result=await retryBuildOnTreeLock(async()=>{
      builds++;
      if(builds>1)return 'built';
      try{return await command(process.execPath,[script],dir,{capture:true});}
      catch(error){firstError=error;throw error;}
    },async()=>{releases++;});
    assert.equal(result,'built');
    assert.equal(builds,2,'the trailing lock line triggered one retry');
    assert.equal(releases,1);
    assert.match(String(firstError&&firstError.output),/EBUSY/);
    assert.equal(isTreeLockError(firstError),true);
  }finally{await rm(dir,{recursive:true,force:true});}
});
