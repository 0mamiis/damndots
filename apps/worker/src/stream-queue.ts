/** Serialize control events while replacing only consecutive pending pointer moves.
 * A click/key/control boundary always preserves the pointer position before it.
 * This prevents a slow input sink from replaying a trail of stale mouse moves.
 */
export class StreamEventQueue<T> {
  private pending:T[]=[];
  private running=false;
  private closed=false;
  constructor(private handle:(event:T)=>Promise<void>,private isMove:(event:T)=>boolean){}
  push(event:T){
    if(this.closed)return;
    const last=this.pending.length-1;
    if(last>=0&&this.isMove(event)&&this.isMove(this.pending[last]))this.pending[last]=event;
    else this.pending.push(event);
    if(!this.running)void this.drain();
  }
  private async drain(){
    this.running=true;
    try{while(!this.closed&&this.pending.length){const event=this.pending.shift()!;try{await this.handle(event);}catch{ /* Keep later key releases and control messages flowing. */ }}}
    finally{this.running=false;}
  }
  close(){this.closed=true;this.pending.length=0;}
}
