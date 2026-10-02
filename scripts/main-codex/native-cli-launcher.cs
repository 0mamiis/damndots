using System;
using System.IO;
using System.Diagnostics;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Web.Script.Serialization;

public static class DotsCliLauncher {
 static void Pump(Stream source,Stream destination){var buffer=new byte[8192];int count;while((count=source.Read(buffer,0,buffer.Length))>0){destination.Write(buffer,0,count);destination.Flush();}}
 static string Quote(string arg){
  var b=new StringBuilder("\"");int slashes=0;
  foreach(char c in arg){if(c=='\\'){slashes++;continue;}if(c=='"'){b.Append('\\',slashes*2+1);b.Append('"');slashes=0;continue;}b.Append('\\',slashes);slashes=0;b.Append(c);}
  b.Append('\\',slashes*2);b.Append('"');return b.ToString();
 }
 public static int Main(string[] args){
  try{
   string manifest=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"cli-bridge.json");
   var settings=(Dictionary<string,object>)new JavaScriptSerializer().DeserializeObject(File.ReadAllText(manifest));
   int command=Array.IndexOf(args,"app-server");bool proxy=command>=0;
   if(command>=0&&command+1<args.Length&&!args[command+1].StartsWith("-"))proxy=false;
   var start=new ProcessStartInfo();
   start.FileName=(string)settings[proxy?"node":"realCli"];var all=new List<string>();
   if(proxy){all.Add((string)settings["script"]);all.Add(manifest);}
   all.AddRange(args);var text=new StringBuilder();foreach(string arg in all){if(text.Length>0)text.Append(' ');text.Append(Quote(arg));}
   start.Arguments=text.ToString();start.UseShellExecute=false;start.CreateNoWindow=true;start.RedirectStandardInput=true;start.RedirectStandardOutput=true;start.RedirectStandardError=true;
   using(var child=Process.Start(start)){
    var stdin=new Thread(()=>{try{Pump(Console.OpenStandardInput(),child.StandardInput.BaseStream);child.StandardInput.Close();}catch{}});stdin.IsBackground=true;stdin.Start();
    var stdout=new Thread(()=>{try{Pump(child.StandardOutput.BaseStream,Console.OpenStandardOutput());}catch{}});stdout.IsBackground=true;stdout.Start();
    var stderr=new Thread(()=>{try{Pump(child.StandardError.BaseStream,Console.OpenStandardError());}catch{}});stderr.IsBackground=true;stderr.Start();
    child.WaitForExit();stdout.Join(2000);stderr.Join(2000);return child.ExitCode;
   }
  }catch{Console.Error.WriteLine("Codex CLI launcher could not start.");return 1;}
 }
}
