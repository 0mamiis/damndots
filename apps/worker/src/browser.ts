import { chromium, type BrowserContext, type Page } from 'playwright';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { keysymToKey, mouseButtonOf, navigationOf, wheelPixels, type StreamInput } from './stream-input.js';
export async function browserExecutable(configured?:string):Promise<string|undefined>{
  if(configured)return configured;
  // This worker uses its own profile directory. Windows prefers the installed Chrome/Edge: Playwright's side-by-side
  // Chromium can stop starting after the browser cache changes, which leaves the Dot with a blank computer.
  const installed=process.platform==='win32'?[
    join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),
    join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe'),
    join(process.env.ProgramFiles||'C:/Program Files','Microsoft/Edge/Application/msedge.exe'),
    join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe')
  ]:['/usr/bin/chromium','/usr/bin/google-chrome-stable','/usr/bin/google-chrome','/usr/bin/chromium-browser'];
  for(const file of [...installed,chromium.executablePath()]){try{await access(file);return file;}catch{}}
}
export type Session={context:BrowserContext;page:Page;control:'agent'|'user'};
/** Emits 'opened' (id, session) and 'closed' (id) so live views follow the Dot's browser session. */
export interface BrowserDesktopOptions {environment:(id:string)=>Promise<NodeJS.ProcessEnv>;args:(id:string)=>string[];home:(id:string)=>string;control:(id:string)=>'agent'|'user';setControl:(id:string,control:'agent'|'user')=>Promise<void>;}
export class BrowserExecutor extends EventEmitter {
  private sessions=new Map<string,Session>();
  private opening=new Map<string,Promise<Session>>();
  constructor(private dataDir:string,private executablePath?:string,private desktop?:BrowserDesktopOptions){super();}
  private check(id:string){if(!/^[a-f0-9-]{36}$/i.test(id))throw new Error('Invalid browser session id');}
  /** Opens (or restores) the persistent session once, even when panel and agent ask at the same time. */
  private async session(id:string,create:boolean):Promise<Session>{
    this.check(id);
    const live=this.sessions.get(id);if(live)return live;
    const pending=this.opening.get(id);if(pending)return pending;
    const directory=join(this.dataDir,id),metadata=join(directory,'dots-session.json');
    const job=(async()=>{
      if(!create)await access(metadata).catch(()=>{throw new Error('Browser session not found');});
      await mkdir(directory,{recursive:true});
      const environment=this.desktop?await this.desktop.environment(id):undefined;
      if(this.desktop){const prefFile=join(directory,'Default','Preferences');await mkdir(join(directory,'Default'),{recursive:true});let prefs:any={};try{prefs=JSON.parse(await readFile(prefFile,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}prefs.extensions??={};prefs.extensions.theme??={};prefs.extensions.theme.system_theme=1;prefs.translate??={};prefs.translate.enabled=false;prefs.profile??={};prefs.profile.exit_type='Normal';prefs.profile.exited_cleanly=true;await writeFile(prefFile,JSON.stringify(prefs));}
      const context=await chromium.launchPersistentContext(directory,{headless:!this.desktop,executablePath:await browserExecutable(this.executablePath),viewport:this.desktop?null:{width:1280,height:800},acceptDownloads:true,...this.desktop?{env:environment,chromiumSandbox:true,locale:'tr-TR',args:this.desktop.args(id),ignoreDefaultArgs:['--disable-extensions','--enable-automation']}:{}});
      try {
      const page=context.pages()[0]||await context.newPage();let control:'agent'|'user'='agent';
      let target:string|undefined;
      try{const prior=JSON.parse(await readFile(metadata,'utf8'));if(prior.control==='user')control='user';if(prior.url)target=this.desktop&&/^http:\/\/127\.0\.0\.1:\d+\/s\/[a-f0-9-]{36}\/?$/.test(prior.url)?this.desktop.home(id):prior.url;}catch{}
      if(!target&&this.desktop)target=this.desktop.home(id);
      if(target){for(let attempt=0;attempt<3;attempt++){try{await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});break;}catch(error){if(attempt===2&&this.desktop)throw error;await new Promise(r=>setTimeout(r,300));}}}
      const session={context,page,control};this.sessions.set(id,session);
      context.once('close',()=>{if(this.sessions.get(id)===session){this.sessions.delete(id);this.emit('closed',id);}});
      this.emit('opened',id,session);return session;
      } catch(error) {await context.close().catch(()=>{});throw error;}
    })().finally(()=>this.opening.delete(id));
    this.opening.set(id,job);return job;
  }
  private async save(id:string,session:Session){await writeFile(join(this.dataDir,id,'dots-session.json'),JSON.stringify({url:session.page.url(),control:session.control}),{mode:0o600});}
  /** The Dot's live page, used by the native computer view. Creates an empty session when none exists yet. */
  async attach(id:string):Promise<Session>{return this.session(id,true);}
  control(id:string){return this.desktop?.control(id)??this.sessions.get(id)?.control??'agent';}
  /** Releasing control never starts a browser; taking control may open the Dot's empty session. */
  async setControl(id:string,control:'agent'|'user',create=false){await this.desktop?.setControl(id,control);const session=create?await this.session(id,true):this.sessions.get(id);if(!session)return;session.control=control;await this.save(id,session);}
  /** Mouse and keyboard from the native panel; only honored while the user holds control. */
  async input(id:string,event:StreamInput):Promise<void>{
    const session=this.sessions.get(id);if(!session||session.control!=='user')return;
    const {page}=session;
    switch(event.type){
      case'move':await page.mouse.move(Math.min(1279,event.x),Math.min(799,event.y));break;
      case'wheel':await page.mouse.wheel(wheelPixels(event.x),wheelPixels(event.y));break;
      case'keydown':case'keyup':{
        const button=mouseButtonOf(event.keysym);
        if(button){if(event.type==='keydown')await page.mouse.down({button});else await page.mouse.up({button});break;}
        const move=navigationOf(event.keysym);
        if(move){if(event.type==='keydown')await (move==='back'?page.goBack():page.goForward()).catch(()=>null);break;}
        const key=keysymToKey(event.keysym);if(!key)break;
        // Türkçe ç, ş, ğ, ı gibi ABD düzeninde olmayan karakterler tuş basışıyla değil metin olarak eklenir.
        if([...key].length===1&&key.codePointAt(0)!>126){if(event.type==='keydown')await page.keyboard.insertText(key);break;}
        if(event.type==='keydown')await page.keyboard.down(key);else await page.keyboard.up(key);
      }
    }
  }
  async execute(input:Record<string,any>,actor:'user'|'agent'='user'){
    const id=typeof input.sessionId==='string'?input.sessionId:randomUUID();this.check(id);
    const metadata=join(this.dataDir,id,'dots-session.json');
    const session=await this.session(id,!input.sessionId||input.action==='open');
    const {page}=session;const action=input.action||'open';
    if(actor==='agent'&&this.control(id)==='user')throw new Error('Browser is under user control');
    switch(action){
      case'open':case'navigate':if(input.url){const u=new URL(input.url);if(!['http:','https:'].includes(u.protocol))throw new Error('Only HTTP(S) navigation is supported');await page.goto(u.href,{waitUntil:'domcontentloaded',timeout:30000});}break;
      case'click':if(!Number.isFinite(input.x)||!Number.isFinite(input.y))throw new Error('Coordinates required');await page.mouse.click(input.x,input.y);break;
      case'type':await page.keyboard.insertText(String(input.text||''));break;
      case'press':await page.keyboard.press(String(input.key||'Enter'));break;
      case'takeover':if(actor!=='user')throw new Error('User control required');await this.setControl(id,'user');break;
      case'release':if(actor!=='user')throw new Error('User control required');await this.setControl(id,'agent');break;
      case'close':{
        // An explicit close ends this page; reopening the live view must not bring the old site back.
        await writeFile(metadata,JSON.stringify({url:'',control:'agent'}),{mode:0o600});
        this.sessions.delete(id);await session.context.close();this.emit('closed',id);
        return {sessionId:id,closed:true,control:'agent'};
      }
      case'screenshot':break;
      default:throw new Error('Unsupported browser action');
    }
    const screenshot=await page.screenshot({type:'png'});
    await writeFile(metadata,JSON.stringify({url:page.url(),control:session.control}),{mode:0o600});
    return {sessionId:id,url:page.url(),title:await page.title(),control:session.control,width:1280,height:800,screenshot:screenshot.toString('base64')};
  }
  async close(){for(const [id,s] of this.sessions){await this.save(id,s).catch(()=>{});await s.context.close();}this.sessions.clear();}
}
