/** Resmi Dots panelinin (Neko tarzı) veri kanalı protokolü: [tür u8][uzunluk u16 LE][yük]. */
export type StreamInput=
  |{type:'move';x:number;y:number}
  |{type:'wheel';x:number;y:number}
  |{type:'keydown'|'keyup';keysym:number};

const MOVE=1,SCROLL=2,KEY_DOWN=3,KEY_UP=4;
export function decodeInput(bytes:Uint8Array):StreamInput|undefined{
  if(bytes.length<3)return;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),type=view.getUint8(0),length=view.getUint16(1,true);
  if(bytes.length<3+length)return;
  if(type===MOVE&&length===4)return {type:'move',x:view.getUint16(3,true),y:view.getUint16(5,true)};
  if(type===SCROLL&&length===4)return {type:'wheel',x:view.getInt16(3,true),y:view.getInt16(5,true)};
  if((type===KEY_DOWN||type===KEY_UP)&&length===8){
    const value=view.getBigUint64(3,true);if(value>BigInt(Number.MAX_SAFE_INTEGER))return;
    return {type:type===KEY_DOWN?'keydown':'keyup',keysym:Number(value)};
  }
}

/** Panel fare düğmelerini 1, 2, 3 anahtar kodu olarak yollar (sol, orta, sağ). */
export const mouseButtonOf=(keysym:number):'left'|'middle'|'right'|undefined=>keysym===1?'left':keysym===2?'middle':keysym===3?'right':undefined;
/** XF86Back / XF86Forward: fare yan düğmeleri. */
export const navigationOf=(keysym:number):'back'|'forward'|undefined=>keysym===269025062?'back':keysym===269025063?'forward':undefined;

const NAMED:Record<number,string>={
  65288:'Backspace',65289:'Tab',65293:'Enter',65307:'Escape',65535:'Delete',65379:'Insert',
  65360:'Home',65367:'End',65365:'PageUp',65366:'PageDown',65361:'ArrowLeft',65362:'ArrowUp',65363:'ArrowRight',65364:'ArrowDown',
  65505:'Shift',65506:'Shift',65507:'Control',65508:'Control',65513:'Alt',65514:'Alt',65027:'AltGraph',65511:'Meta',65512:'Meta',65515:'Meta',65516:'Meta',
  65509:'CapsLock',65383:'ContextMenu',65450:'Multiply',65451:'Add',65453:'Subtract',65454:'Decimal',65455:'Divide',
};
for(let i=0;i<10;i++)NAMED[65456+i]=String(i);
for(let i=1;i<=12;i++)NAMED[65469+i]='F'+i;

/** X11 keysym değerini Playwright tuş adına çevirir. Tanınmayan tuşlar yok sayılır. */
export function keysymToKey(keysym:number):string|undefined{
  if(NAMED[keysym])return NAMED[keysym];
  if(keysym>=0x20&&keysym<=0x7e)return String.fromCharCode(keysym);
  if(keysym>=0xa0&&keysym<=0xff)return String.fromCharCode(keysym);
  if(keysym>=0x01000100&&keysym<=0x0110ffff)return String.fromCodePoint(keysym-0x01000000);
}

/** Panel tekerlek değerini (-10..10, ters çevrilmiş) sayfa kaydırma pikseline çevirir. */
export const wheelPixels=(value:number)=>Math.round(-value*30);
