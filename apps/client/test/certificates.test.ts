import test from 'node:test';
import assert from 'node:assert/strict';
import {X509Certificate,createPrivateKey} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {gatewayCertificates} from '../src/certificates.js';
test('gateway leaf is signed by a separate CA, reused, and a broken leaf renews without replacing trust',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'dots-cert-'));
 try{
  const first=await gatewayCertificates(directory),root=await readFile(first.path,'utf8');
  const ca=new X509Certificate(root),leaf=new X509Certificate(first.cert);
  assert.equal(ca.ca,true);assert.equal(leaf.ca,false);assert(leaf.verify(ca.publicKey));assert(leaf.checkPrivateKey(createPrivateKey(first.key)));assert(leaf.checkHost('localhost'));assert(leaf.checkIP('127.0.0.1'));assert(leaf.checkIP('::1'));
  assert.deepEqual(await gatewayCertificates(directory),first);
  await writeFile(join(directory,'server.key'),'broken');const renewed=await gatewayCertificates(directory);
  assert.equal(await readFile(renewed.path,'utf8'),root);assert.notEqual(renewed.cert,first.cert);assert(new X509Certificate(renewed.cert).verify(ca.publicKey));
 }finally{await rm(directory,{recursive:true,force:true});}
});
