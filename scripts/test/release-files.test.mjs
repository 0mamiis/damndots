import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {collectReleaseFiles,inspectSource,excludedPath} from '../release-files.mjs';
test('source export includes hidden CI/example config while excluding nested secrets, profiles, builds and diagnostics',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dots-release-'));
 try{
  const files=['README.md','.env.example','.github/workflows/ci.yml','apps/server/src/index.ts','apps/server/.data/admin.key','apps/server/.env.production','apps/worker/node_modules/private.json','apps/dashboard/.next/server.js','scripts/live-task.ts'];
  for(const file of files){await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),'example');}
  assert.deepEqual(await collectReleaseFiles(root),['.env.example','.github/workflows/ci.yml','README.md','apps/server/src/index.ts']);
  assert(excludedPath('apps/server/.data/server/dots.sqlite'));assert(excludedPath('private.key'));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('embedded secrets are reported by category without printing their values',()=>{
 const key='sk-'+'a'.repeat(30),text="const token='"+key+"';";
 assert.deepEqual(inspectSource('source.ts',text),['source.ts: provider key']);
 assert(!inspectSource('source.ts',text).join('').includes(key));assert.deepEqual(inspectSource('source.ts','const token=process.env.OPENAI_API_KEY;'),[]);
 assert.deepEqual(inspectSource('fixture.ts','https://admin:password@dots.example.com'),[]);
 const dummy='real-secret';assert(inspectSource('source.ts','https://admin:'+dummy+'@service.invalid').includes('source.ts: credential in URL'));
});
