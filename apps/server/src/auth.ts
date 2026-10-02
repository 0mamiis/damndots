import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { RecordStore } from '@dots/contracts';
type Claims={sub:string;role:'admin'|'native'|'worker'|'file'|'pubsub'|'viewer'|'enroll-worker'|'enroll-client';exp:number;jti:string;[key:string]:unknown};
export class AuthService {
  constructor(private key:Buffer,private adminKey:string,private store:RecordStore,private clock:()=>number=Date.now){}
  equals(a:string,b:string):boolean {const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
  issue(role:Claims['role'],sub:string,ttlSeconds:number,extra:Record<string,unknown>={}):string {
    const claims={...extra,sub,role,exp:Math.floor(this.clock()/1000)+ttlSeconds,jti:randomUUID()};
    const p=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url');
    return p+'.'+createHmac('sha256',this.key).update(p).digest('base64url');
  }
  verify(token:string|undefined,roles:Claims['role'][]):Claims|undefined {
    if(!token)return;const parts=token.split('.');if(parts.length!==3)return;
    const expected=createHmac('sha256',this.key).update(parts[0]+'.'+parts[1]).digest('base64url');if(!this.equals(parts[2],expected))return;
    let c:Claims;try{c=JSON.parse(Buffer.from(parts[1],'base64url').toString());}catch{return;}
    if(!roles.includes(c.role)||!Number.isFinite(c.exp)||c.exp<=Math.floor(this.clock()/1000)||typeof c.sub!=='string')return;
    if(this.store.get('revokedTokens',c.jti)||this.store.get('revokedIdentities',c.sub))return;
    return c;
  }
  login(key:string):{accessToken:string;expiresAt:string}|undefined {
    if(!this.equals(key,this.adminKey))return;
    return {accessToken:this.issue('admin','owner',86400),expiresAt:new Date(this.clock()+86400000).toISOString()};
  }
  enroll(kind:'worker'|'client'): {token:string;expiresAt:string} {return {token:this.issue(kind==='worker'?'enroll-worker':'enroll-client',randomUUID(),600),expiresAt:new Date(this.clock()+600000).toISOString()};}
  consume(token:string,role:'enroll-worker'|'enroll-client'):Claims|undefined {return this.store.transaction(()=>{const c=this.verify(token,[role]);if(!c)return;this.store.put('revokedTokens',{id:c.jti});return c;});}
  revokeIdentity(id:string):void {this.store.put('revokedIdentities',{id});}
  nativeTokens(clientId:string): {access_token:string;id_token:string;refresh_token:string} {
    const common={'https://api.openai.com/auth':{chatgpt_account_id:'acct_local_orbit',chatgpt_user_id:'user_local_orbit',user_id:'user_local_orbit',chatgpt_plan_type:'pro',organizations:[{id:'org_local',is_default:true,role:'owner',title:'Personal'}]},'https://api.openai.com/profile':{email:'orbit@local.test',email_verified:true},email:'orbit@local.test',email_verified:true,aud:['app_local_orbit'],iss:'https://localhost:8000/auth',iat:Math.floor(this.clock()/1000),nbf:Math.floor(this.clock()/1000)-5,clientId};
    return {access_token:this.issue('native',clientId,3600,common),id_token:this.issue('native',clientId,3600,common),refresh_token:this.issue('native',clientId,90*86400,{refresh:true,clientId})};
  }
}
export const bearer=(header:unknown)=>typeof header==='string'&&/^Bearer\s+/i.test(header)?header.replace(/^Bearer\s+/i,''):undefined;
