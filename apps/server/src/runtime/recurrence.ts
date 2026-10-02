import recurrence from 'rrule';
const { rrulestr }=recurrence;

function wallDate(date:Date,timezone:string):Date {
  const values=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const part=(key:string)=>Number(values.find(value=>value.type===key)?.value);
  return new Date(Date.UTC(part('year'),part('month')-1,part('day'),part('hour'),part('minute'),part('second')));
}
function instantDate(wall:Date,timezone:string):Date {
  if(timezone==='UTC') return wall;
  let candidate=wall.getTime();
  const seen=new Set<number>();
  for(let attempt=0;attempt<6;attempt++) {
    const offset=wallDate(new Date(candidate),timezone).getTime()-candidate;
    const next=wall.getTime()-offset;
    if(next===candidate) return new Date(next);
    if(seen.has(next)) return new Date(Math.max(next,candidate)); // nonexistent DST wall time advances into the valid hour
    seen.add(candidate);candidate=next;
  }
  return new Date(candidate);
}
function compact(date:Date):string {return date.toISOString().replaceAll('-','').replaceAll(':','').replace(/\.\d{3}Z$/,'');}
function parseUtc(value:string):Date {
  const match=/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if(!match) throw new Error('Invalid RFC date');
  return new Date(Date.UTC(+match[1],+match[2]-1,+match[3],+match[4],+match[5],+match[6]));
}

/** Evaluate recurrence in a UTC wall-clock domain, then resolve its timezone.
 * rrule's TZID implementation depends on the process timezone; this adapter is
 * deterministic on Windows/Istanbul and on UTC server hosts without changing TZ.
 */
export function nextRecurrence(raw:string,timezone:string,anchor:string,after:string):string|null {
  new Intl.DateTimeFormat('en',{timeZone:timezone});
  let lines=raw.trim().replace(/\r\n/g,'\n').replace(/\n[ \t]/g,'').split('\n').filter(line=>line.trim()&&!/^\s*(?:BEGIN|END):VEVENT\s*$/i.test(line));
  if(!lines.length) throw new Error('RRULE or DTSTART is required');
  if(lines.length===1&&lines[0].startsWith('FREQ=')) lines=[`RRULE:${lines[0]}`];
  const start=lines.find(line=>/^DTSTART(?:;[^:]*)?:/i.test(line));
  const explicitZone=start?/;TZID=([^:;]+)/i.exec(start)?.[1]?.replace(/^"|"$/g,''):undefined;
  const zone=start?.endsWith('Z')?'UTC':explicitZone??timezone;
  new Intl.DateTimeFormat('en',{timeZone:zone});
  lines=lines.map(line=>{
    if(/^DTSTART|^RDATE|^EXDATE/i.test(line)) {
      const colon=line.indexOf(':');if(colon<0) throw new Error('Invalid RFC date');
      const prefix=line.slice(0,colon).replace(/;TZID=[^;:]*/i,'');
      const values=line.slice(colon+1).split(',').map(value=>zone!=='UTC'&&value.endsWith('Z')?compact(wallDate(parseUtc(value),zone)):value.replace(/Z$/,''));
      return `${prefix}:${values.join(',')}`;
    }
    if(zone!=='UTC'&&/^RRULE|^EXRULE/i.test(line)) return line.replace(/UNTIL=(\d{8}T\d{6}Z)/g,(_,value)=>`UNTIL=${compact(wallDate(parseUtc(value),zone))}`);
    return line;
  });
  if(start&&!lines.some(line=>/^RRULE:|^RDATE:/i.test(line))) lines.push('RRULE:FREQ=DAILY;COUNT=1');
  if(!start) lines.unshift(`DTSTART:${compact(wallDate(new Date(anchor),zone))}`);
  const rule=rrulestr(lines.join('\n'),{dtstart:wallDate(new Date(anchor),zone),forceset:true});
  let cursor=wallDate(new Date(after),zone);
  for(let attempts=0;attempts<16;attempts++) {
    const candidate=rule.after(cursor,false);
    if(!candidate) return null;
    const actual=instantDate(candidate,zone);
    if(actual.getTime()>Date.parse(after)) return actual.toISOString();
    cursor=candidate;
  }
  throw new Error('Unable to resolve recurrence after the requested time');
}
