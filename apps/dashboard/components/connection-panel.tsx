"use client";
import {useEffect,useState} from 'react';
import {Button} from '@heroui/react';
import {Actions,Check,Disclose,Field,Form,FormGrid,Loading,Notice,PageHeading,Section,Status,str,time,SelectField} from './ui';
import {TransportPanel} from './transport-panel';
import {ComputerSetupPanel} from './computer-setup-panel';
type Options={nativeEnabled:boolean;workerEnabled:boolean;linuxEnabled:boolean;gatewayPort:number;workerRoots:string[];computerMode?:'pc'|'linux'};
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
   <Disclose summary="Bağlantı ayarlarını düzenle"><Form key={JSON.stringify(host)} submit="Ayarları kaydet" onSubmit={async d=>{await request('/'+host.id,'PATCH',{name:str(d,'name'),...str(d,'adminKey')?{adminKey:str(d,'adminKey')}:{},options:{nativeEnabled:d.has('nativeEnabled'),computerMode:str(d,'computerMode'),gatewayPort:Number(str(d,'gatewayPort')),workerRoots:str(d,'workerRoots').split(/\r?\n/).map(s=>s.trim()).filter(Boolean)}});setResult('Kaydedildi. Bağlantıyı değiştirmek için Ayarları uygula düğmesine basın.');await refresh();}}>
    <FormGrid><Field name="name" label="Host adı" value={host.name} required/><Field name="gatewayPort" label="Native gateway portu" type="number" value={host.options.gatewayPort} required/></FormGrid>
    {!host.local&&<Field name="adminKey" label="Yeni yönetici anahtarı" type="password" description="Boş bırakırsan mevcut anahtar korunur. Anahtar geri gösterilmez."/>}
    <Field name="workerRoots" label="Windows worker çalışma dizinleri" type="textarea" value={host.options.workerRoots.join('\n')} description="Görev başlangıç ve çıktı dizinleri. Tam erişim açıkken terminal komutları PC’nin diğer erişilebilir dosyalarını da kullanabilir."/>
    <SelectField name="computerMode" label="Dot’un bilgisayarı" defaultValue={host.options.computerMode||'pc'} options={[{value:'pc',label:'Bağlanan PC — gerçek Windows masaüstü'},{value:'linux',label:'Ayrı Linux ortamı — WSL bilgisayarı'}]}/>
    <Check name="nativeEnabled" label="Ana Codex proxy’sini çalıştır" checked={host.options.nativeEnabled}/>
    <p className="text-sm text-muted">Gateway portunu değiştirirsen Codex’i kendin kapatıp yeniden aç. Linux worker için WSL bilgisayarının önceden kurulmuş olması gerekir.</p>
   </Form></Disclose>
   {!host.local&&state.activeId!==host.id&&<Disclose summary="Host kaydını kaldır"><Button size="sm" variant="danger" onPress={()=>void action(host.id,'delete')}>Bu hostu sil</Button></Disclose>}
  </Section>)}
  {state&&<Section title="Host ekle" description="Uzak damndots sunucusunun HTTPS adresini ve yönetici anahtarını gir. Anahtar bu PC’nin backend’inde şifrelenerek saklanır."><Form submit="Hostu kaydet" onSubmit={async d=>{await request('','POST',{name:str(d,'name'),serverUrl:str(d,'serverUrl'),adminKey:str(d,'adminKey')});await refresh();}}><FormGrid><Field name="name" label="Host adı" required/><Field name="serverUrl" label="Backend adresi" placeholder="https://dots.example.com" required/></FormGrid><Field name="adminKey" label="Host yönetici anahtarı" type="password" required/></Form></Section>}
  <TransportPanel/>
  <ComputerSetupPanel/>
 </>;
}
