import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const args=process.argv.slice(2),server=process.env.DOTS_SERVER_URL||'http://127.0.0.1:9340';
const key=process.env.DOTS_ADMIN_KEY||await readFile(resolve(args[1]||'apps/server/.data/server/admin.key'),'utf8');
const login=await fetch(new URL('/api/v1/session',server),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:key.trim()})});if(!login.ok)throw new Error('Admin session failed');const session=await login.json();
const api=async(path:string,body?:unknown)=>{const r=await fetch(new URL('/api/v1'+path,server),{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+session.accessToken,...body!==undefined?{'content-type':'application/json'}:{}},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw new Error(path+' HTTP '+r.status);return r.json();};
if(args[0]==='enroll-worker'||args[0]==='enroll-client'){
 const r=await api(args[0]==='enroll-worker'?'/computers/enrollment':'/clients/enrollment',{});await import('node:fs/promises').then(fs=>fs.writeFile(resolve(args[2]||'.data/enrollment.json'),JSON.stringify(r),{mode:0o600}));console.log('Enrollment saved to private file; expires '+r.expiresAt);
}else if(args[0]==='overview'){const r=await api('/overview');console.log(JSON.stringify({dots:r.dots.length,tasks:r.tasks.map((t:any)=>({id:t.id,status:t.status,title:t.title,error:t.error})),computers:r.computers.map((c:any)=>({id:c.id,state:c.state})),outputs:r.outputs.length}));}
else throw new Error('Usage: control.ts enroll-worker|enroll-client|overview [admin-key-file] [enrollment-output-file]');
