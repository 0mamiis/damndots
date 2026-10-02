import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {appServerProvider} from '../../../scripts/appserver-config.js';
import {gatewayKey,loadConfig} from '../src/config.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
test('a fresh central app-server shares the server signing key and never bypasses dashboard provider settings',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dots-config-'));
 try{
  const env={DOTS_DATA_DIR:dir,DOTS_PORT:'9444',DOTS_MODEL_BASE:'https://provider.example/v1',DOTS_MODEL_API_KEY:'provider-secret'};
  const first=appServerProvider(env),server=loadConfig(env);
  assert.equal(first.base,'http://127.0.0.1:9444/model-gateway');assert.equal(first.key,gatewayKey(server.signingKey));assert.notEqual(first.key,env.DOTS_MODEL_API_KEY);
  const stored=await readFile(join(dir,'signing.key'),'utf8');assert.deepEqual(appServerProvider(env),first);assert.equal(await readFile(join(dir,'signing.key'),'utf8'),stored);
  assert.equal(appServerProvider({...env,DOTS_SERVER_URL:'https://dots.example/'}).base,'https://dots.example/model-gateway');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('simultaneous fresh processes all use the same complete signing key',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dots-config-race-'));
 try{
  const code='const {loadConfig,gatewayKey}=await import(process.env.DOTS_TEST_CONFIG_MODULE); console.log(gatewayKey(loadConfig({DOTS_DATA_DIR:process.env.DOTS_TEST_CONFIG_DIR}).signingKey));';
  const results=await Promise.all(Array.from({length:4},()=>promisify(execFile)(process.execPath,['--import','tsx','--input-type=module','-e',code],{env:{...process.env,DOTS_TEST_CONFIG_MODULE:new URL('../src/config.ts',import.meta.url).href,DOTS_TEST_CONFIG_DIR:dir},timeout:15000})));
  assert.equal(new Set(results.map(r=>r.stdout.trim())).size,1);
  assert.equal((await readFile(join(dir,'signing.key'),'utf8')).length,64);assert.equal(results[0].stdout.trim(),gatewayKey(loadConfig({DOTS_DATA_DIR:dir}).signingKey));
 }finally{await rm(dir,{recursive:true,force:true});}
});
