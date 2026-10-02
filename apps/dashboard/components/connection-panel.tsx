"use client";
import {useEffect,useState} from 'react';
import {Button} from '@heroui/react';
import {Actions,Check,Code,Disclose,Field,Form,FormGrid,Loading,Notice,PageHeading,Section,Status,str,time,SelectField} from './ui';
import {TransportPanel} from './transport-panel';
import {ComputerSetupPanel} from './computer-setup-panel';
import {NetworkPanel,INSTALLER} from './network-panel';
type Options={nativeEnabled:boolean;workerEnabled:boolean;linuxEnabled:boolean;gatewayPort:number;workerRoots:string[];computerMode?:'pc'|'linux'|'host';hostComputerId?:string|null};
type HostComputer={id:string;name:string;platform:string;state:string;capabilities:string[]};
type Host={id:string;name:string;serverUrl:string;local:boolean;hasKey:boolean;options:Options;verifiedAt:string|null;lastError:string|null};
type State={items:Host[];activeId:string;activeOptions:Options;revision:string;controller:null|{profileId:string;revision:string;nativeReady:boolean;workerReady:boolean;linuxReady:boolean;error:string|null;updatedAt:string}};
export function ConnectionPanel(){
 const [state,setState]=useState<State>(),[error,setError]=useState(''),[busy,setBusy]=useState<string|null>(null),[result,setResult]=useState('');
 const request=async(path='',method='GET',body?:unknown)=>{const r=await fetch('/api/connections'+path,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const v=await r.json();if(!r.ok)throw Error(v.error||'Bağlantı işlemi başarısız.');return v;};
 const refresh=async()=>{try{setState(await request());setError('');}catch(e){setError((e as Error).message);}};
 useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>clearInterval(timer);},[]);
 const action=async(id:string,kind:'test'|'activate'|'delete')=>{setBusy(id);setError('');try{const r=await request('/'+id+(kind==='delete'?'':'/'+kind),kind==='delete'?'DELETE':'POST',kind==='delete'?undefined:{});if(kind==='activate'){window.location.reload();return;}setResult(kind==='test'?'Bağlantı ve yönetici anahtarı doğrulandı.':'Host silindi.');await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(null);}};
 return <>
  <PageHeading eyebrow="Bağlantı yönetimi" title="Sunucular" description="Dot’ların çalıştığı backend’i ve bu PC’nin ona nasıl bağlandığını yönet."/>
  <Notice error={error}/>{result&&<p role="status" className="text-sm text-success">{result}</p>}
  {!state&&!error&&<Loading/>}
  {state&&<Deployment state={state}/>}
  {state&&<Section title="Bu bilgisayarın bağlantısı" description="Buradaki seçim ana Codex proxy’sini ve yerel worker’ları değiştirir. Codex penceresi otomatik açılmaz.">
   <div className="flex flex-wrap items-center gap-3"><Status value={state.controller?state.controller.error?'Hata':state.controller.revision===state.revision&&(!state.activeOptions.nativeEnabled||state.controller.nativeReady)&&(!state.activeOptions.workerEnabled||state.controller.workerReady)&&(!state.activeOptions.linuxEnabled||state.controller.linuxReady)?'Hazır':'Uygulanıyor':'Servis bekleniyor'}/><span className="text-sm text-muted">Aktif host: {state.items.find(h=>h.id===state.activeId)?.name}</span></div>
   {state.controller&&<div className="mt-3 flex flex-wrap gap-4 text-sm"><span>Native proxy: {state.controller.nativeReady?'açık':'kapalı'}</span><span>Windows worker: {state.controller.workerReady?'çalışıyor':'kapalı'}</span><span>Linux worker: {state.controller.linuxReady?'çalışıyor':'kapalı'}</span></div>}
   {state.controller?.error&&<Notice error={state.controller.error}/>}<p className="mt-3 text-sm text-muted">Host değişimi mevcut Dot verilerini başka sunucuya taşımaz. Her sunucunun kendi Dot’ları ve görev geçmişi vardır.</p>
  </Section>}
  {state?.items.map(host=><Section key={host.id} title={host.name} description={host.serverUrl}>
   <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-muted">{host.verifiedAt?'Son doğrulama: '+time(host.verifiedAt):'Henüz bağlantı testi yapılmadı'}{state.activeId===host.id?' · Aktif':''}</span><Actions>
    <Button size="sm" variant="secondary" isDisabled={!!busy} onPress={()=>void action(host.id,'test')}>Bağlantıyı test et</Button>
    <Button size="sm" isDisabled={!!busy} onPress={()=>void action(host.id,'activate')}>{state.activeId===host.id?'Ayarları uygula':'Bu hostu kullan'}</Button>
   </Actions></div><Notice error={host.lastError||''}/>
   <Disclose summary="Bağlantı ayarlarını düzenle"><Form key={JSON.stringify(host)} submit="Ayarları kaydet" onSubmit={async d=>{await request('/'+host.id,'PATCH',{name:str(d,'name'),...str(d,'adminKey')?{adminKey:str(d,'adminKey')}:{},options:{nativeEnabled:d.has('nativeEnabled'),computerMode:str(d,'computerMode'),hostComputerId:str(d,'hostComputerId')||null,gatewayPort:Number(str(d,'gatewayPort')),workerRoots:str(d,'workerRoots').split(/\r?\n/).map(s=>s.trim()).filter(Boolean)}});setResult('Kaydedildi. Bağlantıyı değiştirmek için Ayarları uygula düğmesine basın.');await refresh();}}>
    <FormGrid><Field name="name" label="Host adı" value={host.name} required/><Field name="gatewayPort" label="Native gateway portu" type="number" value={host.options.gatewayPort} required/></FormGrid>
    {!host.local&&<Field name="adminKey" label="Yeni yönetici anahtarı" type="password" description="Boş bırakırsan mevcut anahtar korunur. Anahtar geri gösterilmez."/>}
    <Field name="workerRoots" label="Windows worker çalışma dizinleri" type="textarea" value={host.options.workerRoots.join('\n')} description="Görev başlangıç ve çıktı dizinleri. Tam erişim açıkken terminal komutları PC’nin diğer erişilebilir dosyalarını da kullanabilir."/>
    <SelectField name="computerMode" label="Dot’un bilgisayarı" defaultValue={host.options.computerMode||'pc'} options={[{value:'pc',label:'Bağlanan PC — gerçek Windows masaüstü'},{value:'linux',label:'Ayrı Linux ortamı — WSL bilgisayarı'},{value:'host',label:'Sunucuya bağlı bilgisayar — VPS veya başka bir PC'}]}/>
    <HostComputerSelect host={host}/>
    <Check name="nativeEnabled" label="Ana Codex proxy’sini çalıştır" checked={host.options.nativeEnabled}/>
    <p className="text-sm text-muted">Gateway portunu değiştirirsen Codex’i kendin kapatıp yeniden aç. Linux worker için WSL bilgisayarının önceden kurulmuş olması gerekir.</p>
   </Form></Disclose>
   {!host.local&&<HostTools host={host}/>}
   {!host.local&&state.activeId!==host.id&&<Disclose summary="Host kaydını kaldır"><Button size="sm" variant="danger" onPress={()=>void action(host.id,'delete')}>Bu hostu sil</Button></Disclose>}
  </Section>)}
  {state&&<Section title="Host ekle" description="Uzak damndots sunucusunun HTTPS veya Tailscale (http://100.x.y.z:9340) adresini ve yönetici anahtarını gir. Anahtar bu PC’nin backend’inde şifrelenerek saklanır."><Form submit="Hostu kaydet" onSubmit={async d=>{await request('','POST',{name:str(d,'name'),serverUrl:str(d,'serverUrl'),adminKey:str(d,'adminKey')});await refresh();}}><FormGrid><Field name="name" label="Host adı" required/><Field name="serverUrl" label="Backend adresi" placeholder="https://dots.example.com veya http://100.64.0.10:9340" required/></FormGrid><Field name="adminKey" label="Host yönetici anahtarı" type="password" required/></Form></Section>}
  <NetworkPanel/>
  <TransportPanel/>
  <ComputerSetupPanel/>
 </>;
}

const LAYOUTS=[
 {key:'local-local',title:'Dot ve bilgisayar bu PC’de',text:'Varsayılan düzen. Backend, Dot ve bilgisayar aynı Windows PC’de çalışır.'},
 {key:'local-remote',title:'Dot bu PC’de, bilgisayar uzakta',text:'Bilgisayarlar bölümünden uzaktaki Windows PC veya VPS’e worker kur, sonra bu hostun bilgisayarını “Sunucuya bağlı bilgisayar” yap.'},
 {key:'remote-local',title:'Dot uzak sunucuda, bilgisayar bu PC’de',text:'Aşağıdan uzak sunucuyu ekle ve kullan. Bilgisayar modu “Bağlanan PC” kalırsa bu PC’nin ekranı Dot’a bağlanır.'},
 {key:'remote-remote',title:'Dot ve bilgisayar uzakta',text:'Uzak sunucuyu ekle ve bilgisayar modunu “Sunucuya bağlı bilgisayar” yap. Bu PC yalnızca Codex proxy’sini çalıştırır.'},
];
function Deployment({state}:{state:State}){
 const active=state.items.find(h=>h.id===state.activeId),mode=state.activeOptions.computerMode||'pc',current=(active?.local?'local':'remote')+'-'+(mode==='host'?'remote':'local');
 const computer=mode==='host'?'sunucuya bağlı bilgisayar':mode==='linux'?'bu PC’deki Linux (WSL)':'bu PC’nin Windows ekranı';
 return <Section title="Dağıtım düzeni" description="Dot’un nerede çalıştığını ve hangi bilgisayarı kullandığını seç. Aktif düzen işaretli.">
  <div className="grid gap-3 sm:grid-cols-2">{LAYOUTS.map(l=><div key={l.key} aria-current={l.key===current?'true':undefined} className={'rounded-2xl border p-4 '+(l.key===current?'border-accent bg-surface-secondary':'border-border')}>
   <div className="flex items-center justify-between gap-2"><strong className="text-sm">{l.title}</strong>{l.key===current&&<span className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">Aktif</span>}</div>
   <p className="mt-1 text-sm text-muted">{l.text}</p></div>)}</div>
  <p className="text-sm text-muted">Şu an: Dot {active?.local?'bu PC’de':active?.name+' sunucusunda'}; bilgisayar: {computer}.</p>
 </Section>;
}
function HostComputerSelect({host}:{host:Host}){
 const [items,setItems]=useState<HostComputer[]>([]),[error,setError]=useState('');
 useEffect(()=>{let live=true;fetch('/api/connections/'+host.id+'/computers').then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error||'Bilgisayarlar alınamadı.');if(live){setItems(v.items||[]);setError('');}}).catch(e=>{if(live)setError((e as Error).message);});return()=>{live=false;};},[host.id]);
 return <>
  <SelectField name="hostComputerId" label="Sunucudaki bilgisayar" defaultValue={host.options.hostComputerId||''} options={[{value:'',label:'Otomatik — ilk çevrimiçi bilgisayar'},...items.map(c=>({value:c.id,label:c.name+' · '+c.platform+' · '+(c.state==='online'?'çevrimiçi':'çevrimdışı')}))]} description="Yalnızca “Sunucuya bağlı bilgisayar” modunda kullanılır. Bu hosta kayıtlı bilgisayarlar listelenir."/>
  {error&&<p className="text-sm text-muted">Bilgisayar listesi alınamadı: {error}</p>}
 </>;
}

function HostTools({host}:{host:Host}){
 const [enrollment,setEnrollment]=useState<{token:string;expiresAt:string}>(),[dots,setDots]=useState<{id:string;name:string}[]>([]),[dotId,setDotId]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;fetch('/api/connections/local-dots').then(async r=>{const v=await r.json();if(r.ok&&live){setDots(v.items||[]);setDotId(v.items?.[0]?.id||'');}}).catch(()=>{});return()=>{live=false;};},[]);
 const call=async(path:string,body?:unknown)=>{const r=await fetch('/api/connections/'+host.id+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})});const v=await r.json();if(!r.ok)throw Error(v.error||'İşlem başarısız.');return v;};
 const run=async(task:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await task();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 let address=host.serverUrl;try{const u=new URL(host.serverUrl);address=u.protocol==='https:'?u.origin:u.hostname+' -ServerPort '+(u.port||'80');}catch{}
 const install='irm '+INSTALLER+' -OutFile $env:TEMP\\install-dots-worker.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\\install-dots-worker.ps1 -ServerAddress '+address;
 return <>
  <Disclose summary="Bu sunucuya bilgisayar bağla"><div className="flex flex-col gap-3">
   <p className="text-sm text-muted">Bağlanacak Windows PC veya VPS’te yönetici PowerShell aç ve sırayla çalıştır. Kayıt anahtarı tek kullanımlıktır ve 10 dakika geçerlidir.</p>
   <Actions><Button size="sm" isDisabled={busy} onPress={()=>void run(async()=>{setEnrollment(await call('/enrollment'));})}>Kayıt anahtarı oluştur</Button></Actions>
   {enrollment&&<><Code>{install}</Code><Code>{'C:\\Dots\\start-worker.cmd --enrollment '+enrollment.token}</Code><p className="text-xs text-muted">Son kullanım: {time(enrollment.expiresAt)}</p></>}
  </div></Disclose>
  <Disclose summary="Bir Dot’u bu sunucuya kopyala"><div className="flex flex-col gap-3">
   <p className="text-sm text-muted">Dot’un adı, modeli ve talimatları bu sunucuda yeni bir Dot olarak oluşturulur. Avatar ve sohbet geçmişi taşınmaz. Aynı adlı Dot varsa dokunulmaz.</p>
   {dots.length>0?<SelectField label="Bu PC’deki Dot" value={dotId} onChange={setDotId} options={dots.map(d=>({value:d.id,label:d.name}))}/>:<p className="text-sm text-muted">Bu PC’de kopyalanacak Dot bulunamadı.</p>}
   <Actions><Button size="sm" isDisabled={busy||!dotId} onPress={()=>void run(async()=>{const v=await call('/copy-dot',{dotId});setNotice(v.existing?'Bu sunucuda “'+v.name+'” zaten var; değiştirilmedi.':'“'+v.name+'” bu sunucuya kopyalandı.');})}>Kopyala</Button></Actions>
  </div></Disclose>
  <Notice error={error}/>{notice&&<p role="status" className="text-sm text-success">{notice}</p>}
 </>;
}

