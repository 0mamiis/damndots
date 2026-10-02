import { randomUUID } from 'node:crypto';

/** Bir model yanıtı sessizce bitmesin veya sonsuza kadar veri beklemesin. */
export async function* guardedResponses(
  source:AsyncIterable<string|Uint8Array>,
  options:{idleMs?:number;stop?:()=>void}={}
):AsyncGenerator<string|Uint8Array> {
  const decoder=new TextDecoder(),iterator=source[Symbol.asyncIterator]();
  let terminal=false,buffer='';
  const observe=(text:string)=>{
    buffer+=text;
    let cut:number;
    while((cut=buffer.search(/\r?\n\r?\n/))>=0){
      const block=buffer.slice(0,cut);buffer=buffer.slice(cut).replace(/^\r?\n\r?\n/,'');
      for(const line of block.split(/\r?\n/)){
        if(!line.startsWith('data:'))continue;
        try{const j=JSON.parse(line.slice(5).trim());if(/^response\.(completed|incomplete|failed)$/.test(j.type))terminal=true;}catch{}
      }
    }
    if(buffer.length>1024*1024)buffer=buffer.slice(-65536);
  };
  try{
    while(true){
      let timer:ReturnType<typeof setTimeout>|undefined;
      const next=await Promise.race([
        iterator.next(),
        new Promise<never>((_,reject)=>{timer=setTimeout(()=>{options.stop?.();reject(new Error('idle'));},options.idleMs??60000);})
      ]).finally(()=>clearTimeout(timer));
      if(next.done)break;
      observe(typeof next.value==='string'?next.value:decoder.decode(next.value,{stream:true}));
      yield next.value;
      if(terminal)break;
    }
    if(!terminal)throw new Error('ended');
  }catch(error){
    if(!terminal){
      options.stop?.();
      const idle=error instanceof Error&&error.message==='idle';
      const event={type:'response.failed',sequence_number:0,response:{id:'resp_'+randomUUID().replaceAll('-',''),object:'response',status:'failed',error:{code:'invalid_prompt',message:idle?'Model sağlayıcısı 60 saniye boyunca veri göndermedi. Yeniden deneyin veya başka model seçin.':'Model sağlayıcısının yanıt akışı tamamlanmadan kesildi. Yeniden deneyin.'}}};
      yield 'event: response.failed\ndata: '+JSON.stringify(event)+'\n\n';
    }
  }finally{
    const returned=iterator.return?.();
    if(returned)void returned.catch(()=>{});
  }
}
