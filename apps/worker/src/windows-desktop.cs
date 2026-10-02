using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Threading;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public class DamndotsDesktop {
 [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] static extern void mouse_event(uint f,uint x,uint y,uint data,UIntPtr extra);
 [DllImport("user32.dll")] static extern uint SendInput(uint n,INPUT[] inputs,int size);
 [DllImport("user32.dll")] static extern short VkKeyScan(char c);
 [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CURSORINFO info);
 [DllImport("user32.dll")] static extern bool DrawIcon(IntPtr dc,int x,int y,IntPtr icon);
 [StructLayout(LayoutKind.Sequential)] struct CURSORINFO {public int size;public int flags;public IntPtr cursor;public Point point;}
 [StructLayout(LayoutKind.Sequential)] struct INPUT {public uint type;public UNION u;}
 [StructLayout(LayoutKind.Explicit)] struct UNION {[FieldOffset(0)]public MOUSE m;[FieldOffset(0)]public KEY k;}
 [StructLayout(LayoutKind.Sequential)] struct MOUSE {public int x,y;public uint data,flags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Sequential)] struct KEY {public ushort vk,scan;public uint flags,time;public UIntPtr extra;}
 static volatile bool running=true;static Rectangle bounds;static HashSet<int> held=new HashSet<int>();
 static void Key(int vk,bool down,bool extended=false){var i=new INPUT{type=1,u=new UNION{k=new KEY{vk=(ushort)vk,flags=(down?0u:2u)|(extended?1u:0u)}}};if(SendInput(1,new[]{i},Marshal.SizeOf(typeof(INPUT)))!=1)throw new Exception("Windows input unavailable (locked desktop or elevated application)");}
 static void Text(string text){foreach(char c in text){var a=new INPUT{type=1,u=new UNION{k=new KEY{scan=c,flags=4}}};var b=a;b.u.k.flags=6;if(SendInput(2,new[]{a,b},Marshal.SizeOf(typeof(INPUT)))!=2)throw new Exception("Windows text input unavailable");}}
 static void Keysym(int sym,bool down){
  if(sym>=1&&sym<=3){uint flag=sym==1?(down?2u:4u):sym==2?(down?32u:64u):(down?8u:16u);mouse_event(flag,0,0,0,UIntPtr.Zero);return;}
  int vk=0;bool extended=false;
  switch(sym){case 65288:vk=8;break;case 65289:vk=9;break;case 65293:vk=13;break;case 65307:vk=27;break;case 65535:vk=46;extended=true;break;case 65379:vk=45;extended=true;break;case 65360:vk=36;extended=true;break;case 65367:vk=35;extended=true;break;case 65365:vk=33;extended=true;break;case 65366:vk=34;extended=true;break;case 65361:vk=37;extended=true;break;case 65362:vk=38;extended=true;break;case 65363:vk=39;extended=true;break;case 65364:vk=40;extended=true;break;case 65505:vk=160;break;case 65506:vk=161;break;case 65507:vk=162;break;case 65508:vk=163;extended=true;break;case 65513:vk=164;break;case 65514:vk=165;extended=true;break;case 65515:vk=91;extended=true;break;case 65516:vk=92;extended=true;break;}
  if(sym>=65470&&sym<=65481)vk=112+sym-65470;
  if(vk!=0){Key(vk,down,extended);return;}
  if(sym>=32&&sym<=126){short mapped=VkKeyScan((char)sym);if(mapped!=-1){Key(mapped&255,down);return;}}
  if(down){int code=sym>=0x1000100?sym-0x1000000:sym;if(code>=32&&code<=0x10ffff)Text(char.ConvertFromUtf32(code));}
 }
 static void Command(string line){var p=line.Split(' ');switch(p[0]){
  case "move":SetCursorPos(bounds.X+(int)(Math.ClampCompat(int.Parse(p[1]),0,1279)*bounds.Width/1280.0),bounds.Y+(int)(Math.ClampCompat(int.Parse(p[2]),0,799)*bounds.Height/800.0));break;
  case "wheel":mouse_event(0x800,0,0,unchecked((uint)(int.Parse(p[2])*120)),UIntPtr.Zero);if(p[1]!="0")mouse_event(0x1000,0,0,unchecked((uint)(int.Parse(p[1])*120)),UIntPtr.Zero);break;
  case "keydown":{int key=int.Parse(p[1]);Keysym(key,true);held.Add(key);break;}case "keyup":{int key=int.Parse(p[1]);Keysym(key,false);held.Remove(key);break;}
  case "text":Text(Encoding.UTF8.GetString(Convert.FromBase64String(p[1])));break;
  case "release":foreach(int key in new List<int>(held)){Keysym(key,false);}held.Clear();break;
  case "stop":foreach(int key in new List<int>(held)){Keysym(key,false);}held.Clear();running=false;break;
 }}
 public static void Main(string[] args){SetProcessDPIAware();bounds=Screen.PrimaryScreen.Bounds;
  if(args.Length>0&&args[0]=="--png"){using(var image=new Bitmap(bounds.Width,bounds.Height))using(var g=Graphics.FromImage(image))using(var scaled=new Bitmap(1280,800))using(var target=Graphics.FromImage(scaled)){g.CopyFromScreen(bounds.Location,Point.Empty,bounds.Size,CopyPixelOperation.SourceCopy);target.DrawImage(image,0,0,1280,800);using(var output=Console.OpenStandardOutput())scaled.Save(output,ImageFormat.Png);}return;}
  var input=new Thread(()=>{string line;while(running&&(line=Console.ReadLine())!=null){int tab=line.IndexOf('\t');string id=tab>=0?line.Substring(0,tab):"";try{Command(tab>=0?line.Substring(tab+1):line);if(id!="")Console.Error.WriteLine("ACK "+id);}catch(Exception e){if(id!="")Console.Error.WriteLine("ERR "+id+" "+e.Message);else Console.Error.WriteLine(e.Message);}}running=false;});input.IsBackground=true;input.Start();
  using(var output=Console.OpenStandardOutput())using(var writer=new BinaryWriter(output))using(var original=new Bitmap(bounds.Width,bounds.Height))using(var scaled=new Bitmap(1280,800))using(var g=Graphics.FromImage(original))using(var target=Graphics.FromImage(scaled)){
   ImageCodecInfo jpeg=null;foreach(var c in ImageCodecInfo.GetImageEncoders())if(c.MimeType=="image/jpeg")jpeg=c;var quality=new EncoderParameters(1);quality.Param[0]=new EncoderParameter(System.Drawing.Imaging.Encoder.Quality,72L);
   while(running){var started=DateTime.UtcNow;try{g.CopyFromScreen(bounds.Location,Point.Empty,bounds.Size,CopyPixelOperation.SourceCopy);var cursor=new CURSORINFO{size=Marshal.SizeOf(typeof(CURSORINFO))};if(GetCursorInfo(ref cursor)&&cursor.flags==1){var dc=g.GetHdc();try{DrawIcon(dc,cursor.point.X-bounds.X,cursor.point.Y-bounds.Y,cursor.cursor);}finally{g.ReleaseHdc(dc);}}
    target.DrawImage(original,0,0,1280,800);using(var memory=new MemoryStream()){scaled.Save(memory,jpeg,quality);var b=memory.ToArray();writer.Write(b.Length);writer.Write(b);writer.Flush();}
   }catch(Exception e){Console.Error.WriteLine("Capture unavailable: "+e.Message);Thread.Sleep(200);}var delay=50-(int)(DateTime.UtcNow-started).TotalMilliseconds;if(delay>0)Thread.Sleep(delay);}
  }
 }
}
static class Math {public static int ClampCompat(int n,int min,int max){return n<min?min:n>max?max:n;}}
