import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export class IntegrationError extends Error {
  constructor(message:string, public statusCode=400) { super(message); }
}
export function object(value:unknown):Record<string,any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IntegrationError('Expected an object');
  return value as Record<string,any>;
}
export function required(value:unknown,name:string):string {
  if (typeof value !== 'string' || !value.trim()) throw new IntegrationError(`${name} is required`);
  return value;
}
export function endpoint(value:unknown):string {
  const raw=required(value,'URL'); let url:URL;
  try { url=new URL(raw); } catch { throw new IntegrationError('Invalid URL'); }
  if (url.username || url.password || !['http:','https:'].includes(url.protocol)) throw new IntegrationError('URL requires HTTP(S) without embedded credentials');
  for(const key of url.searchParams.keys())if(/token|secret|password|api.?key|authorization|credential/i.test(key))throw new IntegrationError('Provider URL credentials must be supplied as separate secrets or headers');
  if (url.protocol==='http:' && !['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw new IntegrationError('Remote provider URLs require HTTPS');
  return url.toString();
}
export class SecretVault {
  private key:Buffer;
  constructor(key:string|Buffer) {
    this.key=Buffer.isBuffer(key)?key:Buffer.from(key,'base64');
    if (this.key.length!==32) throw new IntegrationError('Encryption key must contain 32 bytes (base64)');
  }
  seal(value:unknown):string {
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);
    const body=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),body.toString('base64')].join('.');
  }
  open(value:string):Record<string,any> {
    const [version,iv,tag,body]=value.split('.');
    if(version!=='v1'||!iv||!tag||!body) throw new IntegrationError('Invalid encrypted configuration',500);
    const cipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(iv,'base64'));
    cipher.setAuthTag(Buffer.from(tag,'base64'));
    return object(JSON.parse(Buffer.concat([cipher.update(Buffer.from(body,'base64')),cipher.final()]).toString('utf8')));
  }
}
export function redact(value:any,key=''):any {
  if (/token|secret|password|api.?key|authorization|headers|credential/i.test(key)) return value ? '[redacted]' : value;
  if (Array.isArray(value)) return value.map(v=>redact(v));
  if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redact(v,k)]));
  return value;
}
export function mergeConfig(old:Record<string,any>,patch:Record<string,any>):Record<string,any> {
  const result={...old};
  for(const [key,value] of Object.entries(patch)) {
    if (value==='[redacted]') continue;
    result[key]=value && typeof value==='object' && !Array.isArray(value) ? mergeConfig(old[key]??{},value) : value;
  }
  return result;
}
export function verifyHmac(secret:string,raw:Buffer,timestamp:string|undefined,signature:string|undefined,now:number,slack=false):void {
  if(!timestamp || !/^\d+$/.test(timestamp) || Math.abs(now/1000-Number(timestamp))>300) throw new IntegrationError('Missing or expired webhook timestamp',401);
  const base=slack?Buffer.concat([Buffer.from(`v0:${timestamp}:`),raw]):Buffer.concat([Buffer.from(`${timestamp}.`),raw]);
  const expected=(slack?'v0=':'sha256=')+createHmac('sha256',secret).update(base).digest('hex');
  const actual=Buffer.from(signature??''), wanted=Buffer.from(expected);
  if(actual.length!==wanted.length || !timingSafeEqual(actual,wanted)) throw new IntegrationError('Invalid webhook signature',401);
}
