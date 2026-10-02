import {X509Certificate,createPrivateKey} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {generate} from 'selfsigned';

const valid=(cert:X509Certificate)=>Date.parse(cert.validFrom)<=Date.now()&&Date.parse(cert.validTo)>Date.now()+86400000;
/** Native crypto validates existing keys; renewal keeps a still-valid private CA. */
export async function gatewayCertificates(directory:string){
  await mkdir(directory,{recursive:true,mode:0o700});
  const path=join(directory,'ca.pem');
  try{
    const [key,cert,root]=await Promise.all(['server.key','server.pem','ca.pem'].map(f=>readFile(join(directory,f),'utf8')));
    const leaf=new X509Certificate(cert),ca=new X509Certificate(root);
    if(leaf.ca||!ca.ca||!valid(leaf)||!valid(ca)||!leaf.checkHost('localhost')||!leaf.checkIP('127.0.0.1')||!leaf.checkIssued(ca)||!leaf.verify(ca.publicKey)||!leaf.checkPrivateKey(createPrivateKey(key)))throw Error('Invalid gateway certificate');
    return {key,cert,path};
  }catch{ /* Create or renew the private loopback certificate. */ }
  let root:string,rootKey:string;
  try{
    [root,rootKey]=await Promise.all(['ca.pem','ca.key'].map(f=>readFile(join(directory,f),'utf8')));
    const ca=new X509Certificate(root);
    if(!ca.ca||!valid(ca)||!ca.verify(ca.publicKey)||!ca.checkPrivateKey(createPrivateKey(rootKey)))throw Error('Invalid private CA');
  }catch{
    const ca=await generate([{name:'commonName',value:'Dots private gateway CA'}],{keySize:2048,algorithm:'sha256',notBeforeDate:new Date(Date.now()-86400000),notAfterDate:new Date(Date.now()+365*86400000),extensions:[{name:'basicConstraints',cA:true,pathLenConstraint:0,critical:true},{name:'keyUsage',keyCertSign:true,cRLSign:true,critical:true}]});
    root=ca.cert;rootKey=ca.private;
    await writeFile(join(directory,'ca.key'),rootKey,{mode:0o600});await writeFile(path,root,{mode:0o600});
  }
  const leaf=await generate([{name:'commonName',value:'localhost'}],{keySize:2048,algorithm:'sha256',ca:{key:rootKey,cert:root},notBeforeDate:new Date(Date.now()-86400000),notAfterDate:new Date(Math.min(Date.now()+365*86400000,Date.parse(new X509Certificate(root).validTo))),extensions:[{name:'basicConstraints',cA:false,critical:true},{name:'keyUsage',digitalSignature:true,keyEncipherment:true,critical:true},{name:'extKeyUsage',serverAuth:true},{name:'subjectAltName',altNames:[{type:2,value:'localhost'},{type:7,ip:'127.0.0.1'},{type:7,ip:'::1'}]}]});
  await writeFile(join(directory,'server.key'),leaf.private,{mode:0o600});await writeFile(join(directory,'server.pem'),leaf.cert,{mode:0o600});
  return {key:leaf.private,cert:leaf.cert,path};
}
