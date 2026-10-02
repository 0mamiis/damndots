import {readdir,readFile,lstat} from 'node:fs/promises';
import {join,resolve,extname,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

export const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const rootFiles=['.gitignore','.dockerignore','.gitattributes','.env.example','.node-version','LICENSE','README.md','SECURITY.md','CONTRIBUTING.md','THIRD_PARTY_NOTICES.md','Dockerfile','compose.yaml','package.json','package-lock.json','tsconfig.base.json','Start-Dots.cmd','Start-Dots-Main.cmd','Open-Codex.cmd','Restore-Main-Profile.cmd'];
const ignoredDirectories=new Set(['node_modules','.next','.data','.git','work','instance','dist','coverage','playwright-report','test-results']);
const localHelpers=new Set(['browser-check.ts','cancel-test-task.ts','download-output.ts','grep-asset.cjs','inspect-state.ts','legacy-context-check.ts','native-profile-check.ts','pending-approvals.ts','probe-models.ts','resolve-test-approval.ts','restart-test-server.ps1']);
const extensions=new Set(['.ts','.tsx','.mjs','.cjs','.js','.json','.md','.html','.css','.svg','.ps1','.cs','.sh','.cmd','.vbs','.yaml','.yml']);
export function excludedPath(path){
 const parts=path.replaceAll('\\','/').split('/'),name=parts.at(-1);
 return parts.some(p=>ignoredDirectories.has(p))||/^\.env(?:\.|$)/.test(name)&&name!=='.env.example'||/\.(?:log|tsbuildinfo|sqlite(?:-.+)?|db(?:-.+)?|key|pem|p12|pfx|crt|zip|tar|gz|wsl|iso|exe|dll)$/i.test(name)||['auth.json','client.json','computer.json'].includes(name)||name.startsWith('id_ed25519')||parts[0]==='scripts'&&(name.startsWith('live-')||localHelpers.has(name));
}
export async function collectReleaseFiles(root=projectRoot){
 const files=[];
 async function visit(path){
  if(excludedPath(path))return;
  const full=join(root,path),info=await lstat(full);
  if(info.isSymbolicLink())throw Error('Source archive refuses symlinks: '+path);
  if(info.isDirectory()){for(const item of await readdir(full))await visit(path+'/'+item);return;}
  if(!info.isFile()||info.size>4*1024*1024)throw Error('Unexpected public source file: '+path);
  if(!rootFiles.includes(path)&&!extensions.has(extname(path)))throw Error('Unsupported source file type: '+path);
  files.push(path);
 }
 for(const name of [...rootFiles,'apps','packages','scripts','docs','.github']){
  try{await visit(name);}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 return files.sort();
}
export function sourceText(bytes,path){
 const text=bytes[0]===255&&bytes[1]===254?bytes.subarray(2).toString('utf16le'):bytes.toString('utf8');
 if(text.includes('\0')||text.includes('\ufffd'))throw Error('Non-text or invalid encoding in source: '+path);
 return text;
}
export function inspectSource(path,text){
 const findings=[];
 const patterns=[
  ['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{64,}-----END/],
  ['provider key',/\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['GitHub token',/\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['Google key',/\bAIza[A-Za-z0-9_-]{25,}\b/],
  ['embedded JWT',/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/],
  ['personal Windows path',/[A-Z]:[\\/]+Users[\\/]+[^\\/\s"']+[\\/]/i],
  ['credential in URL',/https?:\/\/[^\s/:"']+:[^\s/@"']+@/i],
 ];
 // Reserved example.com rejection fixtures contain deliberate dummy URL credentials.
 const scan=text.replace(/https?:\/\/(?:user|admin):password@(?:[a-z0-9-]+\.)?example\.com\b/gi,'https://example.com');
 for(const [reason,pattern] of patterns)if(pattern.test(scan))findings.push(path+': '+reason);
 return findings;
}
export async function verifyRelease(root=projectRoot){
 const files=await collectReleaseFiles(root),findings=[];
 for(const path of files){const text=sourceText(await readFile(join(root,path)),path);findings.push(...inspectSource(path,text));
  if(path.endsWith('.md'))for(const match of text.matchAll(/\]\(([^)\s]+)\)/g)){
   const href=match[1];if(/^(?:https?:|#|mailto:)/i.test(href))continue;
   const target=resolve(dirname(join(root,path)),href.split('#')[0]),rel=relative(root,target);
   if(isAbsolute(rel)||rel.startsWith('..')){findings.push(path+': documentation link escapes source');continue;}
   try{await lstat(target);}catch{findings.push(path+': broken link '+href);}
  }
 }
 // Check the Git index as well: an ignore rule cannot protect an already tracked secret.
 try{
  const gitRoot=execFileSync('git',['rev-parse','--show-toplevel'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
  if(resolve(gitRoot)===resolve(root)){
   const tracked=execFileSync('git',['ls-files','--cached','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean),allowed=new Set(files);
   for(const path of tracked){if(!allowed.has(path)||excludedPath(path))findings.push(path+': excluded file is tracked by Git');else{
    const bytes=execFileSync('git',['show',':'+path],{cwd:root,maxBuffer:5*1024*1024,stdio:['ignore','pipe','ignore']});findings.push(...inspectSource('Git index '+path,sourceText(bytes,path)));
   }}
  }
 }catch(error){if(error.status!==128&&error.code!=='ENOENT')throw error;}
 if(findings.length)throw Error('Release source check failed:\n'+findings.join('\n'));
 return files;
}
