import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Codex'in WebRTC aramasını sunucu tarafında karşılayan Chrome eşi. Gerçek zamanlı ses API'si olmayan
 * sağlayıcılarda konuşmayı bölümlere ayırıp bu sınıfın dışına verir, cevap sesini aynı bağlantıdan geri çalar.
 */
export interface VoicePeerEvents {
  onUtterance(wav:Buffer,voicedMs?:number):void;
  onSpeechStart():void;
  onState(state:string):void;
}
interface Peer {page:any;events:VoicePeerEvents;closed:boolean;officialEvent?:(event:Record<string,any>)=>void;timer?:ReturnType<typeof setTimeout>;}
const peerPage=readFile(new URL('./voice-peer.html',import.meta.url),'utf8');

async function chromeExecutable(configured?:string,playwright?:any):Promise<string|undefined> {
  if(configured) return configured;
  const files=process.platform==='win32'?[
    join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),
    join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe'),
    join(process.env.ProgramFiles||'C:/Program Files','Microsoft/Edge/Application/msedge.exe'),
    join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe')
  ]:['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser','/snap/bin/chromium'];
  for(const file of [...files,playwright?.chromium?.executablePath?.()]){if(!file)continue;try{await access(file);return file;}catch{}}
}

export class VoicePeerHost {
  private browser:Promise<any>|undefined;
  private peers=new Map<string,Peer>();
  private idle?:ReturnType<typeof setTimeout>;
  constructor(private options:{executablePath?:string;launchArgs?:string[]}={}) {}
  get activeCount():number {return this.peers.size;}
  private launch():Promise<any> {
    return this.browser??=(async()=>{
      let playwright:any;
      try {playwright=await import('playwright');} catch {throw new Error('Voice calls need the playwright package and Chrome or Chromium on the server');}
      const executablePath=await chromeExecutable(this.options.executablePath,playwright);
      // mDNS gizleme kapalı: uygulama ve eş aynı bilgisayarda doğrudan 127.0.0.1/yerel adaylarla bağlanır.
      const browser=await playwright.chromium.launch({headless:true,executablePath,args:['--disable-features=WebRtcHideLocalIpsWithMdns','--allow-loopback-in-peer-connection','--autoplay-policy=no-user-gesture-required',...this.options.launchArgs??[]]});
      browser.once('disconnected',()=>{this.browser=undefined;});
      return browser;
    })().catch(error=>{this.browser=undefined;throw error;});
  }
  /** Aramanın SDP teklifini cevaplar. Konuşma bölümleri ve durum olayları events üzerinden gelir. */
  async offer(id:string,sdp:string,events:VoicePeerEvents):Promise<string> {
    if(typeof sdp!=='string'||!sdp.startsWith('v=0')||sdp.length>262144) throw new Error('Invalid audio offer');
    await this.close(id);
    if(this.idle){clearTimeout(this.idle);this.idle=undefined;}
    const browser=await this.launch(),page=await browser.newPage();
    const peer:Peer={page,events,closed:false};
    if(process.env.DOTS_VOICE_DEBUG){page.on('console',(m:any)=>console.log('[voice-peer]',m.text()));page.on('pageerror',(e:any)=>console.log('[voice-peer error]',String(e)));}
    try {
      await page.exposeFunction('voiceEvent',(kind:string,data:string,extra?:number)=>{
        if(peer.closed) return;
        try {
          if(kind==='utterance') events.onUtterance(Buffer.from(data,'base64'),Number(extra)||undefined);
          else if(kind==='speech') events.onSpeechStart();
          else if(kind==='state') {
            if(data==='connected'&&peer.timer){clearTimeout(peer.timer);peer.timer=undefined;}
            events.onState(data);
          }
        } catch { /* consumers cannot break the audio loop */ }
      });
      await page.exposeFunction('officialEvent',(event:Record<string,any>)=>{if(!peer.closed)peer.officialEvent?.(event);});
      await page.setContent(await peerPage);
      const answer:string=await page.evaluate((offer:string)=>(window as any).answer(offer),sdp);
      this.peers.set(id,peer);
      // Teklif cevaplandı ama bağlantı hiç kurulmadıysa kaynakları bırak.
      peer.timer=setTimeout(()=>{if(!peer.closed) events.onState('failed');},30000);
      page.once('close',()=>{if(!peer.closed) events.onState('closed');});
      return answer;
    } catch(error) {
      peer.closed=true;await page.close().catch(()=>{});this.scheduleIdle();throw error;
    }
  }
  /** Ses dosyasını aramaya çalar; çalma bitince veya kesilince döner. */
  async play(id:string,audio:Buffer,signal?:AbortSignal):Promise<void> {
    const peer=this.peers.get(id);if(!peer||peer.closed) return;
    const onAbort=()=>{void this.stopPlayback(id);};
    signal?.addEventListener('abort',onAbort,{once:true});
    try {if(signal?.aborted) return;await peer.page.evaluate((data:string)=>(window as any).play(data),audio.toString('base64'));}
    finally {signal?.removeEventListener('abort',onAbort);}
  }
  async stopPlayback(id:string):Promise<void> {
    const peer=this.peers.get(id);if(!peer||peer.closed) return;
    await peer.page.evaluate(()=>(window as any).stopPlay()).catch(()=>{});
    await peer.page.evaluate(()=>(window as any).muteOfficial(true)).catch(()=>{});
  }
  async officialOffer(id:string,handler:(event:Record<string,any>)=>void):Promise<string>{
    const peer=this.peers.get(id);if(!peer||peer.closed)throw new Error('Voice call is no longer available');
    peer.officialEvent=handler;return peer.page.evaluate(()=>(window as any).officialOffer());
  }
  async officialAnswer(id:string,sdp:string):Promise<void>{
    const peer=this.peers.get(id);if(!peer||peer.closed)throw new Error('Voice call is no longer available');
    await peer.page.evaluate((sdp:string)=>(window as any).officialAnswer(sdp),sdp);
  }
  async muteOfficial(id:string,muted:boolean):Promise<void>{
    const peer=this.peers.get(id);if(peer&&!peer.closed)await peer.page.evaluate((muted:boolean)=>(window as any).muteOfficial(muted),muted);
  }
  async closeOfficial(id:string):Promise<void>{
    const peer=this.peers.get(id);if(!peer||peer.closed)return;peer.officialEvent=undefined;
    await peer.page.evaluate(()=>(window as any).closeOfficial()).catch(()=>{});
  }
  async close(id:string):Promise<void> {
    const peer=this.peers.get(id);if(!peer) return;
    this.peers.delete(id);peer.closed=true;if(peer.timer) clearTimeout(peer.timer);
    await peer.page.evaluate(()=>(window as any).stop()).catch(()=>{});await peer.page.close().catch(()=>{});
    this.scheduleIdle();
  }
  private scheduleIdle():void {
    if(this.peers.size||this.idle) return;
    this.idle=setTimeout(()=>{this.idle=undefined;if(!this.peers.size) void this.shutdown();},60_000);this.idle.unref?.();
  }
  async shutdown():Promise<void> {
    for(const id of [...this.peers.keys()]) await this.close(id);
    const browser=await this.browser?.catch(()=>undefined);this.browser=undefined;await browser?.close().catch(()=>{});
  }
}
