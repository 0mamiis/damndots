/** Text rules for the voice call pipeline: keeps speech-recognition noise out of the Dot's conversation. */

/** Models sometimes describe sounds, e.g. [cough] or (laughs). Those are never what the user said. */
export function stripAnnotations(text:string):string {
  return String(text??'').replace(/\[[^\]]*\]/g,' ').replace(/\([^)]*\)/g,' ').replace(/\*[^*]*\*/g,' ').replace(/\s+/g,' ').trim();
}

const normalizePlain=(text:string)=>text.toLowerCase().replace(/\s+/g,' ').trim();
const normalize=(text:string)=>text.toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N} ]/gu,' ').replace(/\s+/g,' ').trim();
/** Short words that recognition models invent from silence or breathing. They are accepted only after a clearly voiced sentence. */
const FILLERS=new Set(['evet','hayır','hayir','tamam','hıhı','hıh','hı','hm','hmm','mm','he','ha','şey','sey','eh','ah','oh','yes','yeah','no','okay','ok','thank you','thanks','teşekkürler','teşekkür ederim','bye','görüşürüz']);
/** Subtitle credits and sign-offs that appear when a model "hears" noise or silence. */
const CREDITS=[/altyazı/,/altyazi/,/izlediğiniz için/,/izledi[gğ]iniz için/,/abone ol/,/thanks for watching/,/thank you for watching/,/subtitles? by/,/amara\.org/,/transcribed by/,/bir sonraki videoda/];

/** True when a transcript is most likely not real speech: credits, or a lone filler word from a very short sound. */
export function isNoiseTranscript(text:string,seconds:number):boolean {
  const t=normalize(text);if(t.replace(/ /g,'').length<2)return true;
  const plain=normalizePlain(text);if(CREDITS.some(rule=>rule.test(t)||rule.test(plain)))return true;
  if(seconds<0.5&&FILLERS.has(t))return true;
  return false;
}

/** Names the speaker is likely to say, so recognition does not turn "Null" into "Nur". */
export function voiceVocabulary(runtime:{listDots():{name:string}[]}):string[] {
  const names=runtime.listDots().map(dot=>dot.name).filter(name=>name&&name.length<=40);
  return [...new Set([...names,'Dot','Codex','Blender','Godot','Debian','Chromium','Linux'])].slice(0,24);
}

/** Voice calls use a lighter reasoning effort so the reply starts quickly. DOTS_VOICE_EFFORT=inherit keeps the Dot's own setting. */
export function voiceEffort():string|null {
  const value=(process.env.DOTS_VOICE_EFFORT??'low').trim();
  return value&&value!=='inherit'?value:null;
}

export function voiceStyle(dotName:string):string {
  return 'Live voice call: the user is speaking to you and your answer will be read aloud. Reply in the language the user speaks, in at most two or three short natural sentences, without markdown, lists, code or links. Answer right away; if the request needs longer work, say in one sentence what you will do and keep the details for the chat. Speech recognition may mishear words or names; your name is "'+dotName+'", so treat similar-sounding words as that name, and ask briefly only if the request is truly unclear.';
}

/** Text placed before a spoken request: reply style, plus recent chat when the call starts a fresh thread. */
export function voicePrefix(dotName:string,messages:{taskId?:string|null;role:string;text:string}[],currentTaskId:string,fresh:boolean):string {
  let history='';
  if(fresh){
    const recent=messages.filter(m=>m.taskId!==currentTaskId&&m.text).slice(-10).map(m=>(m.role==='user'?'User: ':'You: ')+m.text.replace(/\s+/g,' ').slice(0,240));
    history=recent.length?'Recent chat, for context only:\n'+recent.join('\n')+'\n\n':'';
  }
  return '['+voiceStyle(dotName)+']\n\n'+history+'The user said by voice: ';
}
