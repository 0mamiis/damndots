import test from 'node:test';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
test('published image downloader verifies parts, assembly and cache, and rejects corrupted downloads',async()=>{
 const good=await mkdtemp(join(tmpdir(),'damndots-image-ok-')),bad=await mkdtemp(join(tmpdir(),'damndots-image-bad-'));
 const script=fileURLToPath(new URL('../download-linux-image.mjs',import.meta.url)),fixture=new URL('./fixtures/linux-image-fetch.mjs',import.meta.url).href;
 const run=(folder,corrupt=false)=>promisify(execFile)(process.execPath,['--import',fixture,script,folder],{env:{...process.env,DAMNDOTS_TEST_CORRUPT:corrupt?'1':'0'}});
 try{await run(good);assert.equal((await readFile(join(good,'damndots-linux-v0.1.tar.gz'))).toString(),'controlled first partcontrolled second part');assert.equal(JSON.parse(await readFile(join(good,'manifest.json'),'utf8')).parts.length,2);await run(good);await assert.rejects(run(bad,true),/SHA256 mismatch/);}finally{await rm(good,{recursive:true,force:true});await rm(bad,{recursive:true,force:true});}
});
