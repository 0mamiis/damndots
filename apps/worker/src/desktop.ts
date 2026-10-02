import {EventEmitter} from 'node:events';
import {spawn,execFile,type ChildProcess} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createServer,type Server} from 'node:http';
import {createWriteStream} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {StreamInput} from './stream-input.js';
import {desktopHome} from './desktop-home.js';

const run=promisify(execFile);
export interface DesktopAppearance {name:string;avatarImage?:string|null;avatarManifest?:Record<string,any>|null;}
export interface DesktopApp {id:string;name:string;command:string;args:string[];icon:string;}
const definitions:DesktopApp[]=[
 {id:'slicer',name:'3D Slicer',command:'/opt/slicer/Slicer',args:[],icon:'slicer'},
 {id:'blender',name:'Blender',command:'blender',args:[],icon:'blender'},
 {id:'drawing',name:'Draw',command:'drawing',args:[],icon:'com.github.maoschanz.drawing'},
 {id:'freecad',name:'FreeCAD',command:'freecad',args:[],icon:'org.freecad.FreeCAD'},
 {id:'gimp',name:'GIMP',command:'gimp',args:[],icon:'gimp'},
 {id:'go',name:'Go',command:'qgo',args:[],icon:'qgo'},
 {id:'godot',name:'Godot',command:'godot',args:['--rendering-driver','opengl3'],icon:'godot'},
 {id:'inkscape',name:'Inkscape',command:'inkscape',args:[],icon:'org.inkscape.Inkscape'},
 {id:'kdenlive',name:'Kdenlive',command:'kdenlive',args:[],icon:'kdenlive'},
 {id:'kicad',name:'KiCad',command:'kicad',args:[],icon:'kicad'},
 {id:'code',name:'Code',command:'code',args:['--no-sandbox'],icon:'vscode'},
 {id:'writer',name:'Writer',command:'libreoffice',args:['--writer'],icon:'libreoffice-writer'},
 {id:'calc',name:'Calc',command:'libreoffice',args:['--calc'],icon:'libreoffice-calc'},
 {id:'qgis',name:'QGIS',command:'qgis',args:[],icon:'qgis'},
 {id:'paraview',name:'ParaView',command:'paraview',args:[],icon:'paraview'},
 {id:'openscad',name:'OpenSCAD',command:'openscad',args:[],icon:'openscad'},
 {id:'terminal',name:'Terminal',command:'xfce4-terminal',args:['--disable-server'],icon:'utilities-terminal'},
 {id:'files',name:'Files',command:'thunar',args:[],icon:'system-file-manager'},
];
const palette:Record<string,string>={yellow:'#ffdf55',light_yellow:'#ffdf55',cyan:'#34c5ee',light_cyan:'#66d9ee',blue:'#86b7ef',light_blue:'#aecdf5',pink:'#ef8bb6',light_pink:'#f7b9d5',orchid:'#cc82db',light_orchid:'#dfb1e7',purple:'#b793e0',violet:'#bc9be5',lime:'#cbdc75',light_lime:'#e0eaaa',teal:'#71c6b7',light_teal:'#a7dfd5',coral:'#ef997d',light_coral:'#ffc0a8',gray:'#c2c6cf',light_gray:'#d8dae1'};
export function desktopColors(manifest?:Record<string,any>|null){const color=String(manifest?.appearance?.color??'gray'),base=palette[color]??palette.gray;const rgb=[1,3,5].map(i=>parseInt(base.slice(i,i+2),16));const light=rgb.map(x=>Math.round(255*0.88+x*0.12));return {base,light:'#'+light.map(x=>x.toString(16).padStart(2,'0')).join(''),rgb,foreground:'#4d4941'};}
interface DesktopSession {id:string;directory:string;display:string;env:NodeJS.ProcessEnv;control:'agent'|'user';appearance:DesktopAppearance;children:ChildProcess[];csrf:string;dbusPid?:number;settings?:ChildProcess;}
const valid=(id:string)=>{if(!/^[a-f0-9-]{36}$/i.test(id))throw new Error('Invalid desktop session id');};
export function desktopKeysymName(keysym:number):string|undefined{
 const names:Record<number,string>={65288:'BackSpace',65289:'Tab',65293:'Return',65307:'Escape',65535:'Delete',65379:'Insert',65360:'Home',65367:'End',65365:'Prior',65366:'Next',65361:'Left',65362:'Up',65363:'Right',65364:'Down',65505:'Shift_L',65506:'Shift_R',65507:'Control_L',65508:'Control_R',65513:'Alt_L',65514:'Alt_R',65515:'Super_L',65516:'Super_R',65509:'Caps_Lock',65383:'Menu'};
 if(names[keysym])return names[keysym];if(keysym>=65470&&keysym<=65481)return 'F'+(keysym-65469);if(keysym>=0x20&&keysym<=0xff)return String.fromCodePoint(keysym);return undefined;
}

/** A real X11 desktop per Dot session. Frames and input refer to the entire desktop, including native apps and browser chrome. */
export class LinuxDesktop extends EventEmitter {
 private sessions=new Map<string,DesktopSession>();
 private opening=new Map<string,Promise<DesktopSession>>();
 private displays=new Set<number>();
 private server?:Server;private base='';private apps:DesktopApp[]=[];private icons=new Map<string,Buffer>();
 browserOpen?: (id:string)=>Promise<void>;
 constructor(private dataDir:string,private workspace:string){super();if(process.platform!=='linux')throw new Error('The full computer needs the Linux worker');}
 async start(){
  for(const app of definitions){try{await run('which',[app.command]);this.apps.push(app);}catch{if(app.command.startsWith('/'))try{await access(app.command);this.apps.push(app);}catch{}}}
  this.server=createServer((req,res)=>{void this.handle(req,res).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});});
  await new Promise<void>(r=>this.server!.listen(0,'127.0.0.1',r));this.base='http://127.0.0.1:'+(this.server.address() as any).port;
 }
 private child(s:DesktopSession,command:string,args:string[]){const log=createWriteStream(join(s.directory,'apps.log'),{flags:'a',mode:0o600});const p=spawn(command,args,{env:s.env,cwd:this.workspace,stdio:['ignore','pipe','pipe']});p.stdout?.pipe(log,{end:false});p.stderr?.pipe(log,{end:false});p.once('exit',()=>log.end());s.children.push(p);p.on('error',()=>log.end());return p;}
 async ensure(id:string):Promise<DesktopSession>{
  valid(id);const existing=this.sessions.get(id);if(existing)return existing;const pending=this.opening.get(id);if(pending)return pending;
  const job=(async()=>{
   const directory=join(this.dataDir,id);await mkdir(directory,{recursive:true,mode:0o700});await mkdir(this.workspace,{recursive:true});
   let prior:any;try{prior=JSON.parse(await readFile(join(directory,'desktop.json'),'utf8'));}catch{}
   let number=99;
   while(number<2000){if(this.displays.has(number)){number++;continue;}try{await access('/tmp/.X'+number+'-lock');number++;continue;}catch{}if(this.displays.has(number)){number++;continue;}break;}
   if(number>=2000)throw new Error('No free isolated desktop display');
   this.displays.add(number);
   const runtimeDir=join(directory,'runtime');await mkdir(runtimeDir,{recursive:true,mode:0o700});
   const env:NodeJS.ProcessEnv={...process.env,DISPLAY:':'+number,WAYLAND_DISPLAY:'',WSL_INTEROP:'',GDK_BACKEND:'x11',QT_QPA_PLATFORM:'xcb',SDL_VIDEODRIVER:'x11',XDG_SESSION_TYPE:'x11',XDG_RUNTIME_DIR:runtimeDir,LIBGL_ALWAYS_SOFTWARE:'1',DONT_PROMPT_WSL_INSTALL:'1',LANG:'en_US.UTF-8',DOTS_DESKTOP_SESSION_ID:id};
   const s:DesktopSession={id,directory,display:':'+number,env,control:'agent',appearance:prior?.appearance??{name:'dot'},children:[],csrf:randomUUID()};
   this.sessions.set(id,s);
   this.child(s,'Xvfb',[s.display,'-screen','0','1280x800x24','-nolisten','tcp','-ac','-noreset']);
   let ready=false;for(let n=0;n<80;n++){try{await run('xdpyinfo',[],{env,maxBuffer:1024*1024});ready=true;break;}catch{await new Promise(r=>setTimeout(r,50));}}
   if(!ready)throw new Error('Linux desktop display did not start');
   const dbus=await run('dbus-daemon',['--session','--fork','--print-address=1','--print-pid=1'],{env});const lines=dbus.stdout.trim().split('\n');s.env.DBUS_SESSION_BUS_ADDRESS=lines[0];s.dbusPid=Number(lines[1]);
   const wm=join(directory,'openbox.xml');
   await writeFile(wm,'<?xml version="1.0"?><openbox_config xmlns="http://openbox.org/3.4/rc"><theme><name>Clearlooks</name><titleLayout>NLIMC</titleLayout></theme><desktops><number>1</number></desktops><keyboard><keybind key="W-e"><action name="Execute"><command>thunar '+this.workspace+'</command></action></keybind><keybind key="C-A-t"><action name="Execute"><command>xfce4-terminal --disable-server</command></action></keybind></keyboard><mouse><context name="Titlebar"><mousebind button="Left" action="Drag"><action name="Move"/></mousebind><mousebind button="Left" action="DoubleClick"><action name="ToggleMaximize"/></mousebind></context><context name="Frame"><mousebind button="A-Left" action="Drag"><action name="Move"/></mousebind></context></mouse></openbox_config>');
   this.child(s,'openbox',['--config-file',wm]);this.child(s,'picom',['--backend','xrender','--no-vsync']);
   await this.writeDock(s);this.child(s,'tint2',['-c',join(directory,'tint2.conf')]);
   await this.apply(s,s.appearance);s.settings=this.child(s,'xsettingsd',['--config',join(directory,'xsettings.conf')]);await writeFile(join(directory,'session.env'),JSON.stringify(env));return s;
  })().catch(async error=>{const s=this.sessions.get(id);if(s)await this.dispose(s);this.sessions.delete(id);throw error;}).finally(()=>this.opening.delete(id));this.opening.set(id,job);return job;
 }
 async environment(id:string){return (await this.ensure(id)).env;}
 home(id:string){return this.base+'/s/'+id+'/';}
 control(id:string){return this.sessions.get(id)?.control??'agent';}
 async setControl(id:string,control:'agent'|'user'){const s=this.sessions.get(id);if(s){s.control=control;await this.save(s);}}
 private async save(s:DesktopSession){await writeFile(join(s.directory,'desktop.json'),JSON.stringify({appearance:s.appearance,control:s.control}),{mode:0o600});}
 async appearance(id:string,value:DesktopAppearance){const s=await this.ensure(id);const next={name:String(value.name||s.appearance.name||'dot'),avatarManifest:value.avatarManifest??null,avatarImage:value.avatarImage===undefined?s.appearance.avatarImage:value.avatarImage};if(JSON.stringify(next)===JSON.stringify(s.appearance))return;await this.apply(s,next);}
 private async apply(s:DesktopSession,value:DesktopAppearance){
  s.appearance={name:String(value.name||s.appearance.name||'dot'),avatarManifest:value.avatarManifest??null,avatarImage:value.avatarImage===undefined?s.appearance.avatarImage:value.avatarImage};
  const colors=desktopColors(s.appearance.avatarManifest);await run('xsetroot',['-solid',colors.base],{env:s.env});
  const wallpaper=join(s.directory,'wallpaper.png');await run('python3',['-c','from PIL import Image; import sys; Image.new("RGB", (1280,800), sys.argv[1]).save(sys.argv[2])',colors.base,wallpaper],{env:s.env});await run('feh',['--no-fehbg','--bg-fill',wallpaper],{env:s.env});
  const name='YourDot-'+colors.base.slice(1),theme=join(process.env.HOME||'/home/dot','.themes',name);await mkdir(join(theme,'gtk-3.0'),{recursive:true});await mkdir(join(theme,'openbox-3'),{recursive:true});
  await writeFile(join(theme,'gtk-3.0/gtk.css'),'@define-color theme_bg_color '+colors.base+';\n@define-color theme_base_color '+colors.light+';\n@define-color theme_fg_color '+colors.foreground+';\n@define-color theme_text_color '+colors.foreground+';\n@define-color theme_selected_bg_color '+colors.base+';\n@define-color theme_selected_fg_color '+colors.foreground+';\nwindow,toolbar,headerbar,.titlebar { background-color: @theme_bg_color; color: @theme_fg_color; }\nentry,textview { background-color: @theme_base_color; color: @theme_text_color; }\n');
  await writeFile(join(theme,'openbox-3/themerc'),'window.active.title.bg: flat solid\nwindow.active.title.bg.color: '+colors.base+'\nwindow.inactive.title.bg: flat solid\nwindow.inactive.title.bg.color: '+colors.base+'\nwindow.active.label.bg: parentrelative\nwindow.active.label.text.color: '+colors.foreground+'\nwindow.inactive.label.text.color: '+colors.foreground+'\nwindow.active.button.unpressed.bg: parentrelative\nwindow.active.button.unpressed.image.color: '+colors.foreground+'\nwindow.inactive.button.unpressed.bg: parentrelative\nwindow.inactive.button.unpressed.image.color: '+colors.foreground+'\nwindow.active.border.color: '+colors.base+'\nwindow.inactive.border.color: '+colors.base+'\nwindow.client.padding.width: 0\nwindow.client.padding.height: 0\nborder.width: 1\n');
  const wm=join(s.directory,'openbox.xml');let xml=await readFile(wm,'utf8');xml=xml.replace(/<name>[^<]*<\/name>/,'<name>'+name+'</name>');await writeFile(wm,xml);await run('openbox',['--reconfigure'],{env:s.env}).catch(()=>{});
  await writeFile(join(s.directory,'xsettings.conf'),'Net/ThemeName "'+name+'"\nNet/IconThemeName "Adwaita"\nGtk/FontName "Noto Sans 10"\nGtk/CursorThemeName "Adwaita"\nGtk/CursorThemeSize 24\nXft/DPI 98304\n');s.settings?.kill('SIGHUP');
  await this.save(s);this.emit('appearance',s.id,s.appearance);
 }
 chromeArgs(id:string){if(!this.sessions.has(id))throw new Error('Desktop is not ready');return ['--window-position=55,42','--window-size=1170,674','--no-first-run','--no-default-browser-check','--disable-session-crashed-bubble'];}
 private async writeDock(s:DesktopSession){
  const files:string[]=[];
  let browserIcon='chromium';for(const name of ['chromium','google-chrome'])for(const size of ['128x128','64x64','48x48']){const file='/usr/share/icons/hicolor/'+size+'/apps/'+name+'.png';try{await access(file);browserIcon=file;}catch{}if(browserIcon.startsWith('/'))break;}
  for(const [id,label,icon] of [['browser','Browser',browserIcon],['terminal','Terminal','utilities-terminal'],['files','Files','system-file-manager']]){
   const file=join(s.directory,id+'.desktop');const url=this.home(s.id)+'launch/'+id+'?k='+s.csrf;
   await writeFile(file,'[Desktop Entry]\nType=Application\nName='+label+'\nIcon='+icon+'\nExec=curl --silent --request POST '+url+'\nTerminal=false\n');files.push(file);
  }
  await writeFile(join(s.directory,'tint2.conf'),'# Dot computer dock\nrounded = 20\nborder_width = 1\nbackground_color = #ffffff 65\nborder_color = #ffffff 35\npanel_position = bottom center horizontal\npanel_size = 190 64\npanel_padding = 10 6 6\npanel_margin = 0 18\npanel_items = L\npanel_background_id = 1\nstrut_policy = follow_size\nlauncher_background_id = 0\nlauncher_padding = 8 0 8\nlauncher_icon_size = 44\nlauncher_icon_theme = Adwaita\n'+files.map(f=>'launcher_item_app = '+f).join('\n')+'\n');
 }
 async launch(id:string,appId:string){const s=await this.ensure(id);if(appId==='browser'){await this.browserOpen?.(id);return;}const app=this.apps.find(a=>a.id===appId);if(!app)throw new Error('Application is not installed');const args=[...app.args];if(appId==='terminal')args.push('--working-directory='+this.workspace);if(appId==='files'||appId==='code')args.push(this.workspace);this.child(s,app.command,args);}
 async input(id:string,event:StreamInput,actor:'user'|'agent'='user'){
  const s=await this.ensure(id);if(actor==='user'&&s.control!=='user')return;if(actor==='agent'&&s.control==='user')throw new Error('Desktop is under user control');
  const call=(args:string[])=>run('xdotool',args,{env:s.env});
  // --sync waits for a pointer change, which can stall redundant/clamped moves.
  if(event.type==='move'){await call(['mousemove',String(Math.max(0,Math.min(1279,event.x))),String(Math.max(0,Math.min(799,event.y)))]);return;}
  if(event.type==='wheel'){for(const [n,positive,negative] of [[event.y,4,5],[event.x,6,7]])if(n)await call(['click','--repeat',String(Math.min(15,Math.max(1,Math.round(Math.abs(n))))),'--delay','10',String(n>0?positive:negative)]);return;}
  if(event.keysym<=3&&event.keysym>=1){await call([event.type==='keydown'?'mousedown':'mouseup',String(event.keysym)]);return;}
  // Let X11 clients observe a temporary Unicode keymap before xdotool restores it.
  if(event.keysym>=0x01000100){if(event.type==='keydown')await call(['type','--clearmodifiers','--delay','12',String.fromCodePoint(event.keysym-0x01000000)]);return;}
  const punctuation:Record<string,string>={' ':'space','!':'exclam','"':'quotedbl','#':'numbersign','$':'dollar','%':'percent','&':'ampersand',"'":'apostrophe','(':'parenleft',')':'parenright','*':'asterisk','+':'plus',',':'comma','-':'minus','.':'period','/':'slash',':':'colon',';':'semicolon','<':'less','=':'equal','>':'greater','?':'question','@':'at','[':'bracketleft','\\':'backslash',']':'bracketright','^':'asciicircum','_':'underscore','`':'grave','{':'braceleft','|':'bar','}':'braceright','~':'asciitilde'};
  const name=desktopKeysymName(event.keysym);if(name){if(name.length===1&&name.codePointAt(0)!>126){if(event.type==='keydown')await call(['type','--clearmodifiers','--delay','12',name]);}else await call([event.type==='keydown'?'keydown':'keyup','--delay','0',punctuation[name]||name]);}
 }
 async screenshot(id:string){const s=await this.ensure(id),file=join(s.directory,'screen.png');await run('scrot',['--silent','--overwrite',file],{env:s.env});return (await readFile(file)).toString('base64');}
 async execute(p:Record<string,any>,actor:'agent'|'user'='agent'){
  const id=p.sessionId;valid(id);const s=await this.ensure(id);if(actor==='agent'&&s.control==='user'&&!['appearance','list','screenshot'].includes(p.action))throw new Error('Desktop is under user control');
  switch(p.action){
   case 'appearance':await this.appearance(id,p.appearance);return {sessionId:id,width:1280,height:800,control:s.control};
   case 'launch':await this.launch(id,p.app);break;
   case 'click':if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||(p.button!==undefined&&![1,2,3].includes(p.button)))throw new Error('Invalid desktop click');await this.input(id,{type:'move',x:p.x,y:p.y},actor);await this.input(id,{type:'keydown',keysym:p.button||1},actor);await this.input(id,{type:'keyup',keysym:p.button||1},actor);break;
   case 'type':if(typeof p.text!=='string'||p.text.length>20000)throw new Error('Invalid desktop text');await run('xdotool',['type','--clearmodifiers','--delay','0',p.text],{env:s.env});break;
   case 'press':if(typeof p.key!=='string'||!/^[-+A-Za-z0-9_]{1,100}$/.test(p.key))throw new Error('Invalid desktop key');await run('xdotool',['key',p.key],{env:s.env});break;
   case 'screenshot':case 'list':break;
   default:throw new Error('Unsupported desktop action');
  }
  const ids=await run('xdotool',['search','--onlyvisible','--name','.'],{env:s.env}).catch(()=>({stdout:''}));const windows=[];
  for(const window of ids.stdout.trim().split('\n').filter(Boolean).slice(0,16)){const name=await run('xdotool',['getwindowname',window],{env:s.env}).catch(()=>({stdout:''}));if(name.stdout.trim())windows.push({id:window,title:name.stdout.trim()});}
  return {sessionId:id,width:1280,height:800,control:s.control,apps:this.apps.map(a=>({id:a.id,name:a.name})),windows,...p.action==='list'?{}:{screenshot:await this.screenshot(id)}};
 }
 async capture(id:string,receive:(jpeg:string)=>void):Promise<()=>void>{
  // X11 gives us the format: avoid probing a long startup buffer and flush each frame.
  const s=await this.ensure(id),p=spawn('ffmpeg',['-loglevel','error','-probesize','32','-analyzeduration','0','-fpsprobesize','0','-f','x11grab','-draw_mouse','1','-framerate','30','-video_size','1280x800','-i',s.display,'-threads','2','-q:v','5','-pix_fmt','yuvj420p','-f','image2pipe','-vcodec','mjpeg','-flush_packets','1','pipe:1'],{env:s.env,stdio:['ignore','pipe','ignore']});let buffer=Buffer.alloc(0);
  p.stdout!.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);let end;while((end=buffer.indexOf(Buffer.from([255,217])))>=0){const frame=buffer.subarray(0,end+2);buffer=buffer.subarray(end+2);if(frame[0]===255&&frame[1]===216)receive(frame.toString('base64'));}if(buffer.length>8*1024*1024)buffer=Buffer.alloc(0);});p.on('error',()=>{});return ()=>p.kill('SIGTERM');
 }
 private async icon(app:DesktopApp):Promise<Buffer|undefined>{if(this.icons.has(app.id))return this.icons.get(app.id);const names=[app.icon,app.id,app.command.split('/').pop()!];for(const name of names)for(const location of ['/usr/share/icons/hicolor/scalable/apps','/usr/share/icons/hicolor/256x256/apps','/usr/share/icons/hicolor/128x128/apps','/usr/share/icons/hicolor/96x96/apps','/usr/share/icons/hicolor/48x48/apps','/usr/share/icons/Adwaita/scalable/places','/usr/share/icons/Adwaita/scalable/apps','/usr/share/pixmaps'])for(const extension of ['svg','png']){try{const b=await readFile(join(location,name+'.'+extension));this.icons.set(app.id,b);return b;}catch{}}return undefined;}
 private async handle(req:any,res:any){
  const url=new URL(req.url,'http://127.0.0.1'),m=/^\/s\/([a-f0-9-]{36})\/(.*)$/.exec(url.pathname);if(!m){res.writeHead(404);res.end();return;}const s=await this.ensure(m[1]),part=m[2];
  res.setHeader('cache-control','no-store');
  if(part==='profile'){res.setHeader('content-type','application/json');res.end(JSON.stringify({appearance:s.appearance,colors:desktopColors(s.appearance.avatarManifest),apps:this.apps.map(a=>({id:a.id,name:a.name})),csrf:s.csrf}));return;}
  if(part.startsWith('launch/')){if(req.method!=='POST'||url.searchParams.get('k')!==s.csrf){res.writeHead(403);res.end();return;}if(s.control!=='user'){res.writeHead(409);res.end('Take over first');return;}await this.launch(s.id,part.slice(7));res.end('ok');return;}
  if(part.startsWith('icon/')){const app=this.apps.find(a=>a.id===part.slice(5)),image=app?await this.icon(app):undefined;if(!image){res.writeHead(404);res.end();return;}res.setHeader('content-type',image.subarray(0,4).equals(Buffer.from([137,80,78,71]))?'image/png':'image/svg+xml');res.end(image);return;}
  res.setHeader('content-type','text/html');res.end(desktopHome(s.id));
 }
 private async dispose(s:DesktopSession){
  const children=s.children.filter(p=>p.exitCode===null&&!p.killed);
  await Promise.all(children.map(p=>new Promise<void>(r=>{const timeout=setTimeout(()=>{p.kill('SIGKILL');r();},1500);p.once('exit',()=>{clearTimeout(timeout);r();});p.kill('SIGTERM');})));
  if(s.dbusPid)try{process.kill(s.dbusPid,'SIGTERM');}catch{}
  this.displays.delete(Number(s.display.slice(1)));
 }
 async close(){await Promise.allSettled([...this.opening.values()]);for(const s of this.sessions.values()){await this.save(s);await this.dispose(s);}this.sessions.clear();await new Promise<void>(r=>this.server?this.server.close(()=>r()):r());this.server=undefined;}
}
