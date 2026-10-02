import {createHash} from 'node:crypto';
const bytes=[Buffer.from('controlled first part'),Buffer.from('controlled second part')],digest=b=>createHash('sha256').update(b).digest('hex'),archive='damndots-linux-v0.1.tar.gz';
const parts=bytes.map((b,i)=>({name:archive+'.part'+String(i+1).padStart(2,'0'),bytes:b.length,sha256:digest(b)}));
globalThis.fetch=async url=>{if(String(url).endsWith('manifest.json'))return new Response(JSON.stringify({format:1,architecture:'amd64',archive,bytes:Buffer.concat(bytes).length,sha256:digest(Buffer.concat(bytes)),parts}));const n=parts.findIndex(p=>String(url).endsWith(p.name));if(n<0)throw Error('Unexpected download URL');return new Response(process.env.DAMNDOTS_TEST_CORRUPT==='1'?Buffer.from('bad bytes'):bytes[n]);};
