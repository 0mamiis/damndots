import {randomUUID} from 'node:crypto';
import type {RecordStore} from '@dots/contracts';

export interface DotBrowserSession {id:string;dotId:string;computerId:string;sessionId:string;}
/** The agent and its native computer panel use one persistent browser per Dot/computer. */
export function dotBrowserSession(store:RecordStore,dotId:string,computerId:string,requested?:string):DotBrowserSession {
  const id=dotId+':'+computerId;
  return store.transaction(()=>{
    let session=store.get<DotBrowserSession>('dot_browser_sessions',id);
    if(requested&&session?.sessionId!==requested)throw Object.assign(new Error('Browser session does not belong to this Dot and computer'),{statusCode:403});
    if(!session){session={id,dotId,computerId,sessionId:randomUUID()};store.put('dot_browser_sessions',session);}
    return session;
  });
}
