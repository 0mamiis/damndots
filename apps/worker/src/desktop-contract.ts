import type {StreamInput} from './stream-input.js';
import type {DesktopAppearance} from './desktop.js';
export interface ComputerDesktop {
 start():Promise<void>;ensure(id:string):Promise<any>;close():Promise<void>;
 screenshot(id:string):Promise<string>;capture(id:string,receive:(jpeg:string)=>void):Promise<()=>void>;
 input(id:string,event:StreamInput,actor?:'user'|'agent'):Promise<void>;
 appearance(id:string,value:DesktopAppearance):Promise<void>;
 execute(p:Record<string,any>,actor?:'agent'|'user'):Promise<any>;
 control(id:string):'agent'|'user';setControl(id:string,control:'agent'|'user'):Promise<void>;
}
