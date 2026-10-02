import { chromium, type Browser, type CDPSession, type Page } from 'playwright';
import { readFile } from 'node:fs/promises';
import { BrowserExecutor, browserExecutable, type Session } from './browser.js';
import { decodeInput, type StreamInput } from './stream-input.js';
import { StreamEventQueue } from './stream-queue.js';
import type { DesktopAppearance } from './desktop.js';
import type {ComputerDesktop} from './desktop-contract.js';

/**
 * Resmi Dots panelinin beklediği canlı bilgisayar görünümü. Panel bir WebRTC teklifi gönderir;
 * burada ayrı, boş bir Chromium sayfası cevabı üretir. Dot'un kalıcı tarayıcı sayfasından
 * alınan kareler bu sayfadaki tuvale çizilir ve video olarak yayınlanır.
 * Dot oturumu kapanıp yeniden açılsa da yayın aynı bağlantıda yeni sayfaya geçer.
 */
const peerPage=readFile(new URL('./stream-peer.html',import.meta.url),'utf8');
interface PeerEvent {kind:string;data:string;input?:StreamInput;}
interface Peer{
  id:string;page:Page;queue?:StreamEventQueue<PeerEvent>;closed:boolean;
  session?:Session;cdp?:CDPSession;blank:boolean;busy:boolean;latest:string|null;
  timer?:ReturnType<typeof setTimeout>;interval?:ReturnType<typeof setInterval>;
  stopCapture?:()=>void;
}
export class BrowserStream {
  private browser:Promise<Browser>|undefined;
  private peers=new Map<string,Peer>();
  constructor(private executor:BrowserExecutor,private executablePath?:string,private desktop?:ComputerDesktop){
    // Dot tarayıcıyı kapattığında panel donmuş son kareyi değil, boş durumu göstermeli; yeniden açınca yeni sayfaya geçmeli.
    executor.on('closed',(id:string)=>{if(this.desktop)return;const peer=this.peers.get(id);if(peer)void this.unbind(peer).then(()=>this.show(peer,null,true));});
    executor.on('opened',(id:string,session:Session)=>{if(this.desktop)return;const peer=this.peers.get(id);if(peer&&peer.session!==session)void this.bind(peer,session).catch(()=>{});});
  }
  get activeCount(){return this.peers.size;}
  private launch(){
    return this.browser??=(async()=>{
      // 127.0.0.1 adayı, ağ bağlantısı olmayan bir bilgisayarda da yerel panelin bağlanmasını sağlar.
      const browser=await chromium.launch({headless:true,executablePath:await browserExecutable(this.executablePath),args:['--disable-features=WebRtcHideLocalIpsWithMdns','--allow-loopback-in-peer-connection','--autoplay-policy=no-user-gesture-required']});
      browser.once('disconnected',()=>{this.browser=undefined;});return browser;
    })();
  }
  private async show(peer:Peer,data:string|null,blank:boolean):Promise<void>{
    if(peer.closed)return;
    peer.blank=blank;
    if(peer.busy){if(data)peer.latest=data;return;}
    peer.busy=true;
    try{await peer.page.evaluate(([d,b])=>(window as any).frame(d,b),[data,blank] as [string|null,boolean]);}catch{}finally{peer.busy=false;}
    if(peer.latest&&!peer.closed){const next=peer.latest;peer.latest=null;await this.show(peer,next,peer.blank);}
  }
  private async unbind(peer:Peer){
    const cdp=peer.cdp;peer.cdp=undefined;peer.session=undefined;
    peer.stopCapture?.();peer.stopCapture=undefined;
    if(cdp){await cdp.send('Page.stopScreencast').catch(()=>{});await cdp.detach().catch(()=>{});}
  }
  private async bind(peer:Peer,session:Session){
    await this.unbind(peer);
    if(peer.closed)return;
    const cdp=await session.context.newCDPSession(session.page);
    peer.session=session;peer.cdp=cdp;
    cdp.on('Page.screencastFrame',(frame:any)=>{
      void cdp.send('Page.screencastFrameAck',{sessionId:frame.sessionId}).catch(()=>{});
      if(peer.cdp!==cdp)return;
      void this.show(peer,frame.data,session.page.url()==='about:blank');
    });
    await cdp.send('Page.startScreencast',{format:'jpeg',quality:70,maxWidth:1280,maxHeight:800,everyNthFrame:1});
    const blank=session.page.url()==='about:blank';
    if(!blank)await session.page.screenshot({type:'jpeg',quality:70}).then(image=>this.show(peer,image.toString('base64'),false)).catch(()=>{});
    else await this.show(peer,null,true);
  }
  /** Panelin SDP teklifini cevaplar ve Dot oturumunu video olarak yayınlamaya başlar. */
  async offer(input:{sessionId:string;offer:string;appearance?:DesktopAppearance;iceServers?:Array<{urls:string[];username?:string;credential?:string}>}):Promise<{sdp:string}>{
    if(typeof input.offer!=='string'||!input.offer.startsWith('v=0')||input.offer.length>65536)throw new Error('Invalid session offer');
    await this.drop(input.sessionId);
    if(this.desktop){await this.desktop.ensure(input.sessionId);if(input.appearance)await this.desktop.appearance(input.sessionId,input.appearance);}
    const session=await this.executor.attach(input.sessionId),browser=await this.launch(),page=await browser.newPage();
    const peer:Peer={id:input.sessionId,page,closed:false,blank:true,busy:false,latest:null};
    try{
      // Click/key/control boundaries stay ordered; obsolete pending mouse positions are replaced.
      peer.queue=new StreamEventQueue(e=>this.event(peer,e.kind,e.data,e.input),e=>e.input?.type==='move');
      await page.exposeFunction('peerEvent',(kind:string,data:string)=>{
        const input=kind==='binary'?decodeInput(Buffer.from(data,'base64')):undefined;
        if(kind==='binary'&&!input)return;
        peer.queue!.push({kind,data,input});
      });
      await page.setContent(await peerPage);
      if(this.desktop){await this.show(peer,await this.desktop.screenshot(input.sessionId),false);peer.stopCapture=await this.desktop.capture(input.sessionId,frame=>{void this.show(peer,frame,false);});}
      const sdp:string=await page.evaluate(({offer,iceServers})=>(window as any).answer(offer,iceServers),{offer:input.offer,iceServers:input.iceServers||[]});
      this.peers.set(input.sessionId,peer);
      if(!this.desktop)await this.bind(peer,session);
      // Sayfa adresi değiştiğinde boş/dolu durumunu güncel tut.
      if(!this.desktop)peer.interval=setInterval(()=>{const now=peer.session?peer.session.page.url()==='about:blank':true;if(now!==peer.blank&&peer.session)void this.show(peer,null,now);},500);
      // Teklif yanıtlandı fakat hiç bağlanılmadıysa kaynakları serbest bırak.
      peer.timer=setTimeout(()=>{void this.drop(input.sessionId,peer);},30000);
      page.once('close',()=>{void this.drop(input.sessionId,peer);});
      return {sdp};
    }catch(error){
      this.peers.delete(input.sessionId);peer.closed=true;peer.queue?.close();await this.unbind(peer);await page.close().catch(()=>{});throw error;
    }
  }
  private async event(peer:Peer,kind:string,data:string,input?:StreamInput){
    if(peer.closed)return;
    const id=peer.id;
    switch(kind){
      case'open':if(peer.timer){clearTimeout(peer.timer);peer.timer=undefined;}break;
      case'state':
        if(data==='connected'&&peer.timer){clearTimeout(peer.timer);peer.timer=undefined;}
        if(data==='failed'||data==='closed')await this.drop(id,peer);
        else if(data==='disconnected'){peer.timer??=setTimeout(()=>{void this.drop(id,peer);},8000);}
        break;
      case'close':await this.drop(id,peer);break;
      case'text':{
        let message:any;try{message=JSON.parse(data);}catch{return;}
        const send=(value:unknown)=>peer.page.evaluate(text=>(window as any).sendText(text),JSON.stringify(value)).catch(()=>{});
        switch(message?.event){
          case'control/request':await this.desktop?.setControl(id,'user');await this.executor.setControl(id,'user',true);await send({event:'control/locked'});break;
          case'control/release':await this.desktop?.setControl(id,'agent');await this.executor.setControl(id,'agent');await peer.page.evaluate(()=>(window as any).setCursor(0,0,false)).catch(()=>{});await send({event:'control/release'});break;
          case'browser/client_outcome':await send({event:'browser/client_outcome/ack'});break;
          case'browser/handoff':await send({event:'browser/handoff/ready'});break;
        }
        break;
      }
      case'binary':{
        if(!input)return;
        if(!this.desktop&&input.type==='move')void peer.page.evaluate(([x,y])=>(window as any).setCursor(x,y,true),[input.x,input.y]).catch(()=>{});
        await (this.desktop?this.desktop.input(id,input):this.executor.input(id,input)).catch(()=>{});
        break;
      }
    }
  }
  /** Paneli kapatınca veya bağlantı kopunca yayını durdurur ve kontrolü Dot'a geri verir. */
  async drop(id:string,only?:Peer){
    const peer=this.peers.get(id);if(!peer||(only&&peer!==only))return;
    this.peers.delete(id);peer.closed=true;peer.queue?.close();
    if(peer.timer)clearTimeout(peer.timer);if(peer.interval)clearInterval(peer.interval);
    await this.unbind(peer);
    await peer.page.evaluate(()=>(window as any).stop()).catch(()=>{});await peer.page.close().catch(()=>{});
    await this.executor.setControl(id,'agent').catch(()=>{});
    await this.desktop?.setControl(id,'agent').catch(()=>{});
  }
  async close(){for(const id of [...this.peers.keys()])await this.drop(id);const browser=await this.browser?.catch(()=>undefined);this.browser=undefined;await browser?.close().catch(()=>{});}
}
